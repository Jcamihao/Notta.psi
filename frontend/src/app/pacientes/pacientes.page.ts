import { Component, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink } from '@angular/router';
import { CircleAlert, CircleCheck, LucideAngularModule } from 'lucide-angular';
import { filter, map } from 'rxjs';
import { AvatarComponent } from '../ui/avatar.component';
import { ButtonComponent } from '../ui/button.component';
import { PillComponent } from '../ui/pill.component';
import { ROTULO_CONSENTIMENTO, TOM_CONSENTIMENTO } from './consentimento.service';
import { Paciente, PacientesService } from './pacientes.service';

// Recado que a tela anterior deixa no state da navegacao (so um codigo fixo, nunca dado de
// paciente: o state vai para o historico do navegador).
export type AvisoPacientes = 'criado' | 'nao-encontrado' | 'excluido' | 'nao-encontrado-exclusao';

// 'YYYY-MM-DD' -> 'DD/MM/AAAA' sem passar por Date (new Date('1990-05-17') mostra o dia anterior
// no Brasil).
export function dataBr(iso: string): string {
  const [a, m, d] = iso.split('-');
  return `${d}/${m}/${a}`;
}

@Component({
  selector: 'app-pacientes-page',
  imports: [LucideAngularModule, RouterLink, AvatarComponent, ButtonComponent, PillComponent],
  templateUrl: './pacientes.page.html',
  styleUrl: './pacientes.page.scss',
})
export class PacientesPage {
  readonly icones = { CircleAlert, CircleCheck };
  private readonly servico = inject(PacientesService);
  private readonly router = inject(Router);

  readonly dataBr = dataBr;
  readonly rotulo = ROTULO_CONSENTIMENTO;
  readonly tom = TOM_CONSENTIMENTO;
  readonly lista = signal<Paciente[] | null>(null);
  readonly erroLista = signal(false);
  readonly aviso = toSignal(
    this.router.events.pipe(
      filter((e) => e instanceof NavigationEnd),
      map(
        () =>
          (this.router.lastSuccessfulNavigation?.extras.state?.['aviso'] as
            AvisoPacientes | undefined) ?? null,
      ),
    ),
    { initialValue: null },
  );

  constructor() {
    this.carregar();
  }

  carregar(): void {
    this.erroLista.set(false);
    this.servico.listar().subscribe({
      next: (l) => this.lista.set(l),
      // 401 e 403 (senha provisoria) o interceptor ja trata; aqui so a falha de rede ou 5xx.
      error: () => this.erroLista.set(true),
    });
  }
}
