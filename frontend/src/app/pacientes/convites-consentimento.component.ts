import { HttpErrorResponse } from '@angular/common/http';
import {
  Component,
  DestroyRef,
  Injector,
  OnInit,
  afterNextRender,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { CircleAlert, CircleCheck, LucideAngularModule } from 'lucide-angular';
import { dataHoraBr } from '../core/datas';
import { mensagemHttp } from '../core/formulario';
import { ButtonComponent } from '../ui/button.component';
import { PillComponent } from '../ui/pill.component';
import {
  Convite,
  ConviteConsentimentoService,
  ConviteCriado,
  TOM_CONVITE,
  convitePendenteVivo,
  rotuloConvite,
} from './convite-consentimento.service';

// No maximo 1 consulta a cada 15 s, so com convite pendente e a aba visivel. A proxima consulta
// so e marcada quando a anterior volta: nunca ha mais de uma em voo.
const INTERVALO_MS = 15000;
const FALHAS_MAXIMAS = 5;

// Subsecao "Termo por link" do cartao de consentimento. O link (token) fica SO no signal `criado`
// deste componente: nao vai para storage, URL, router state nem console, e some ao sair.
@Component({
  selector: 'app-convites-consentimento',
  imports: [LucideAngularModule, ButtonComponent, PillComponent],
  templateUrl: './convites-consentimento.component.html',
  styleUrl: './convites-consentimento.component.scss',
})
export class ConvitesConsentimentoComponent implements OnInit {
  readonly icones = { CircleAlert, CircleCheck };
  readonly tom = TOM_CONVITE;
  readonly rotuloDe = rotuloConvite;
  readonly vivo = convitePendenteVivo;
  readonly pacienteId = input.required<string>();
  // So NENHUM e REVOGADO podem receber termo; com CONCEDIDO o botao some.
  readonly podeEnviar = input.required<boolean>();
  // O paciente aceitou enquanto a tela estava aberta: o cartao recarrega o estado.
  readonly aceito = output<void>();
  private readonly servico = inject(ConviteConsentimentoService);
  private readonly documento = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);
  private readonly injector = inject(Injector);

  readonly convites = signal<Convite[] | null>(null);
  readonly erroLista = signal(false);
  readonly criado = signal<ConviteCriado | null>(null);
  readonly criando = signal(false);
  readonly cancelando = signal(false);
  readonly confirmandoId = signal<string | null>(null);
  readonly erro = signal('');
  readonly aviso = signal('');

  private temporizador: ReturnType<typeof setTimeout> | undefined;
  private emVoo = false;
  private refazer = false;
  private falhas = 0;

  constructor() {
    const aoVoltar = () => {
      if (this.documento.visibilityState === 'visible') this.carregar();
      else clearTimeout(this.temporizador);
    };
    this.documento.addEventListener('visibilitychange', aoVoltar);
    this.destroyRef.onDestroy(() => {
      this.documento.removeEventListener('visibilitychange', aoVoltar);
      clearTimeout(this.temporizador);
      this.criado.set(null);
    });
    // Consentimento concedido (aqui ou em outro lugar): o link mostrado nao serve mais.
    effect(() => {
      if (!this.podeEnviar()) this.criado.set(null);
    });
  }

  ngOnInit(): void {
    this.carregar();
  }

  dataHora(iso: string): string {
    return dataHoraBr(iso);
  }

  carregar(): void {
    clearTimeout(this.temporizador);
    if (this.emVoo) {
      // Uma consulta ja esta a caminho e pode ter saido antes da mudanca: refaz ao voltar.
      this.refazer = true;
      return;
    }
    this.emVoo = true;
    this.servico.listar(this.pacienteId()).subscribe({
      next: (lista) => {
        this.emVoo = false;
        this.falhas = 0;
        this.erroLista.set(false);
        this.compararComAnterior(lista);
        this.convites.set(lista);
        if (this.refazer) {
          this.refazer = false;
          this.carregar();
        } else this.agendar();
      },
      error: (e: HttpErrorResponse) => {
        this.emVoo = false;
        this.refazer = false;
        // 401 e 403 (senha provisoria) o interceptor ja trata; aqui rede, 5xx e 429.
        if (e.status === 404 || this.convites() === null) this.erroLista.set(true);
        this.falhas++;
        if (this.falhas < FALHAS_MAXIMAS && e.status !== 404) this.agendar();
      },
    });
  }

  enviarTermo(): void {
    if (this.criando()) return;
    this.limparMensagens();
    this.criando.set(true);
    this.servico.criar(this.pacienteId()).subscribe({
      next: (c) => {
        this.criando.set(false);
        this.criado.set(c);
        this.focar('conv-link-bloco');
        this.carregar();
      },
      error: (e: HttpErrorResponse) => {
        this.criando.set(false);
        if (e.status === 409) {
          this.erro.set('O consentimento já foi concedido. Atualizando o estado.');
          this.aceito.emit();
        } else if (e.status === 404) this.erro.set('Paciente não encontrado.');
        else this.erro.set(mensagemHttp(e));
      },
    });
  }

  async copiar(): Promise<void> {
    const link = this.criado()?.link;
    if (!link) return;
    this.limparMensagens();
    try {
      await navigator.clipboard.writeText(link);
      this.aviso.set('Link copiado');
    } catch {
      // Sem permissao de area de transferencia: seleciona o texto para copiar na mao.
      (this.documento.getElementById('conv-link') as HTMLInputElement | null)?.select();
      this.erro.set('Não foi possível copiar sozinho. Com o link selecionado, use Ctrl+C.');
    }
  }

  selecionar(campo: HTMLInputElement): void {
    campo.select();
  }

  pedirCancelamento(id: string): void {
    this.limparMensagens();
    this.confirmandoId.set(id);
    this.focar(`conv-manter-${id}`);
  }

  manter(id: string): void {
    this.confirmandoId.set(null);
    this.focar(`conv-cancelar-${id}`);
  }

  cancelar(id: string): void {
    if (this.cancelando()) return;
    this.limparMensagens();
    this.cancelando.set(true);
    this.servico.cancelar(this.pacienteId(), id).subscribe({
      next: () => {
        this.cancelando.set(false);
        this.confirmandoId.set(null);
        if (this.criado()?.id === id) this.criado.set(null);
        this.aviso.set('Convite cancelado. O link deixou de funcionar.');
        this.carregar();
      },
      error: (e: HttpErrorResponse) => {
        this.cancelando.set(false);
        this.confirmandoId.set(null);
        if (e.status === 409) {
          // Mudou em outro lugar (paciente respondeu, ou ja cancelado): mostra o estado real.
          this.erro.set('Este convite já não estava pendente. Veja o estado na lista.');
          this.carregar();
        } else if (e.status === 404) this.erro.set('Convite não encontrado.');
        else this.erro.set(mensagemHttp(e));
      },
    });
  }

  // Convite que estava pendente e agora foi respondido: avisa e, se aceito, pede o estado novo.
  private compararComAnterior(lista: Convite[]): void {
    const antes = this.convites();
    if (!antes) return;
    for (const a of antes.filter((c) => c.estado === 'PENDENTE')) {
      const agora = lista.find((c) => c.id === a.id);
      if (agora?.estado === 'ACEITO') {
        this.criado.set(null);
        this.limparMensagens();
        this.aviso.set('O paciente aceitou o termo.');
        this.aceito.emit();
      } else if (agora?.estado === 'RECUSADO') {
        if (this.criado()?.id === a.id) this.criado.set(null);
        this.limparMensagens();
        this.aviso.set('O paciente não aceitou o termo.');
      }
    }
  }

  private agendar(): void {
    clearTimeout(this.temporizador);
    if (this.documento.visibilityState !== 'visible') return;
    if (!this.convites()?.some(convitePendenteVivo)) return;
    this.temporizador = setTimeout(() => this.carregar(), INTERVALO_MS);
  }

  private limparMensagens(): void {
    this.erro.set('');
    this.aviso.set('');
  }

  private focar(id: string): void {
    afterNextRender(() => this.documento.getElementById(id)?.focus(), {
      injector: this.injector,
    });
  }
}
