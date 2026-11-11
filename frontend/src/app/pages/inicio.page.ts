import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  ArrowRight,
  CircleAlert,
  LucideAngularModule,
  RotateCw,
  UserPlus,
  Users,
} from 'lucide-angular';
import { dataHoraBr } from '../core/datas';
import { SessaoStore } from '../core/sessao.store';
import {
  EstadoConsentimento,
  ROTULO_CONSENTIMENTO,
  TOM_CONSENTIMENTO,
} from '../pacientes/consentimento.service';
import { Paciente, PacientesService } from '../pacientes/pacientes.service';
import { ButtonComponent } from '../ui/button.component';
import { PillComponent } from '../ui/pill.component';

const RECENTES = 5;

// Inicio: uma unica chamada (GET /pacientes, lista do proprio psicologo). Resumo e recentes saem
// dessa lista; nada de contagem de rascunhos, agenda ou financeiro aqui.
@Component({
  selector: 'app-inicio-page',
  imports: [LucideAngularModule, RouterLink, ButtonComponent, PillComponent],
  templateUrl: './inicio.page.html',
  styleUrl: './inicio.page.scss',
})
export class InicioPage {
  readonly icones = { ArrowRight, CircleAlert, RotateCw, UserPlus, Users };
  private readonly sessao = inject(SessaoStore);
  private readonly servico = inject(PacientesService);

  readonly usuario = this.sessao.usuario;
  // Data invalida (nao deveria vir da API) nao quebra a tela: simplesmente some.
  readonly cadastradoEm = (iso: string): string | null =>
    Number.isNaN(Date.parse(iso)) ? null : dataHoraBr(iso);
  readonly rotulo = ROTULO_CONSENTIMENTO;
  readonly tom = TOM_CONSENTIMENTO;
  readonly lista = signal<Paciente[] | null>(null);
  readonly erroLista = signal(false);

  // Paciente sem o campo (corpo de POST/PATCH) conta como NENHUM.
  readonly estadoDe = (p: Paciente): EstadoConsentimento => p.consentimento ?? 'NENHUM';

  readonly total = computed(() => this.lista()?.length ?? 0);
  readonly semConsentimento = computed(
    () => (this.lista() ?? []).filter((p) => this.estadoDe(p) !== 'CONCEDIDO').length,
  );
  // Copia antes de ordenar (a lista original nao muda). sort e estavel: empate de data mantem a
  // ordem que a API mandou. Data invalida conta como a mais antiga (0), nunca NaN no comparador.
  private readonly instante = (iso: string): number => {
    const t = Date.parse(iso);
    return Number.isNaN(t) ? 0 : t;
  };
  readonly recentes = computed(() =>
    [...(this.lista() ?? [])]
      .sort((a, b) => this.instante(b.criadoEm) - this.instante(a.criadoEm))
      .slice(0, RECENTES),
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
