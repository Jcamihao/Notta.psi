import { HttpErrorResponse } from '@angular/common/http';
import {
  Component,
  ElementRef,
  Injector,
  OnInit,
  afterNextRender,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { CircleAlert, CircleCheck, LucideAngularModule } from 'lucide-angular';
import { dataHoraBr } from '../core/datas';
import { mensagemHttp } from '../core/formulario';
import { ButtonComponent } from '../ui/button.component';
import { PillComponent } from '../ui/pill.component';
import { ConvitesConsentimentoComponent } from './convites-consentimento.component';
import {
  Consentimento,
  ConsentimentoService,
  EstadoConsentimento,
  EventoConsentimento,
  ROTULO_CONSENTIMENTO,
  TOM_CONSENTIMENTO,
} from './consentimento.service';

// Cartao "Consentimento" do detalhe do paciente. Carrega o proprio estado (a pagina so o cria
// depois de carregar o paciente, entao nunca ha mais de 2 chamadas ao mesmo tempo).
@Component({
  selector: 'app-consentimento-card',
  imports: [LucideAngularModule, ButtonComponent, PillComponent, ConvitesConsentimentoComponent],
  templateUrl: './consentimento-card.component.html',
  styleUrl: './consentimento-card.component.scss',
})
export class ConsentimentoCardComponent implements OnInit {
  readonly icones = { CircleAlert, CircleCheck };
  readonly rotulo = ROTULO_CONSENTIMENTO;
  readonly tom = TOM_CONSENTIMENTO;
  readonly pacienteId = input.required<string>();
  // Avisa a pagina do estado atual (ao carregar, registrar, revogar ou recarregar apos 409).
  readonly estadoMudou = output<EstadoConsentimento>();
  private readonly servico = inject(ConsentimentoService);
  private readonly injector = inject(Injector);
  private readonly estadoRef = viewChild('estadoRef', { read: ElementRef });
  private readonly cancelarRef = viewChild('cancelarRef', { read: ElementRef });
  private readonly revogarRef = viewChild('revogarRef', { read: ElementRef });

  readonly dados = signal<Consentimento | null>(null);
  readonly erroCarga = signal(false);
  readonly enviando = signal(false);
  readonly confirmando = signal(false);
  readonly erro = signal('');
  readonly aviso = signal('');

  ngOnInit(): void {
    this.carregar();
  }

  dataHora(iso: string): string {
    return dataHoraBr(iso);
  }

  carregar(): void {
    this.erroCarga.set(false);
    this.servico.obter(this.pacienteId()).subscribe({
      next: (d) => this.definir(d),
      // 401 e 403 (senha provisoria) o interceptor ja trata; aqui rede, 5xx e 404.
      error: () => this.erroCarga.set(true),
    });
  }

  pedirRevogacao(): void {
    this.limparMensagens();
    this.confirmando.set(true);
    this.focar(this.cancelarRef);
  }

  cancelar(): void {
    this.confirmando.set(false);
    this.focar(this.revogarRef);
  }

  registrar(evento: EventoConsentimento): void {
    if (this.enviando()) return;
    this.limparMensagens();
    this.enviando.set(true);
    this.servico.registrar(this.pacienteId(), evento).subscribe({
      next: (d) => {
        this.enviando.set(false);
        this.confirmando.set(false);
        this.definir(d);
        this.aviso.set(
          evento === 'CONCEDIDO' ? 'Consentimento registrado.' : 'Consentimento revogado.',
        );
        this.focar(this.estadoRef);
      },
      error: (e: HttpErrorResponse) => this.falhar(e),
    });
  }

  private definir(d: Consentimento): void {
    this.dados.set(d);
    this.estadoMudou.emit(d.estado);
  }

  private falhar(e: HttpErrorResponse): void {
    this.enviando.set(false);
    this.confirmando.set(false);
    if (e.status === 409) {
      // Outra aba ou outro dispositivo mudou o estado: recarrega e avisa.
      this.erro.set('O estado mudou, confira e tente de novo.');
      this.carregar();
    } else if (e.status === 404) this.erro.set('Paciente não encontrado.');
    else this.erro.set(mensagemHttp(e));
  }

  private limparMensagens(): void {
    this.erro.set('');
    this.aviso.set('');
  }

  private focar(ref: () => ElementRef<HTMLElement> | undefined): void {
    afterNextRender(() => ref()?.nativeElement.focus(), { injector: this.injector });
  }
}
