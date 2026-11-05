import { HttpErrorResponse } from '@angular/common/http';
import {
  Component,
  DestroyRef,
  Injector,
  afterNextRender,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { ButtonComponent } from '../ui/button.component';
import {
  AVISOS_SAIDA,
  Geracao,
  IaService,
  TEXTO_ANDAMENTO_OUTRO,
  classificarErroConfirmar,
  mensagemMotivo,
} from './ia.service';

const INTERVALO_MS = 3000;
// Depois de tantas falhas seguidas de rede/servidor para de insistir e oferece "Atualizar".
const FALHAS_MAXIMAS = 5;

// Acompanhamento de um pedido ja enviado: consulta GET /geracoes-ia/:id a cada 3 s (a proxima
// consulta so e marcada quando a anterior volta, entao nunca ha mais de uma chamada em voo) e
// para ao ficar PRONTO/FALHOU ou ao sair da pagina. So guarda ids e estado, nunca texto clinico.
@Component({
  selector: 'app-ia-acompanhar',
  imports: [RouterLink, ButtonComponent],
  templateUrl: './ia-acompanhar.component.html',
  styleUrl: './ia-acompanhar.component.scss',
})
export class IaAcompanharComponent {
  readonly pacienteId = input.required<string>();
  readonly geracaoId = input.required<string>();
  // Outro pedido ja estava em andamento: a pagina passa a acompanhar esse.
  readonly trocar = output<string>();
  private readonly ia = inject(IaService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly injector = inject(Injector);

  readonly avisosTexto = AVISOS_SAIDA;
  readonly geracao = signal<Geracao | null>(null);
  readonly semRede = signal(false);
  readonly parado = signal(false);
  readonly naoEncontrado = signal(false);
  readonly reenviando = signal(false);
  readonly erroEnvio = signal('');

  private temporizador: ReturnType<typeof setTimeout> | undefined;
  private falhas = 0;

  constructor() {
    effect(() => {
      const id = this.geracaoId();
      untracked(() => this.iniciar(id));
    });
    this.destroyRef.onDestroy(() => clearTimeout(this.temporizador));
  }

  motivo(g: Geracao): string {
    return mensagemMotivo(g.motivo);
  }

  // "Atualizar" (apos varias falhas seguidas) volta a consultar.
  atualizar(): void {
    this.parado.set(false);
    this.falhas = 0;
    this.consultar();
  }

  // Retentativa sem limite: confirmar de novo (o back so dispara de verdade se ainda for FALHOU
  // retentavel; nunca reenvia texto, nao gasta o limite do dia ate ficar PRONTO).
  tentarDeNovo(): void {
    if (this.reenviando()) return;
    this.erroEnvio.set('');
    this.reenviando.set(true);
    this.ia
      .confirmar(this.geracaoId())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.reenviando.set(false);
          this.geracao.update(
            (g) => g && { ...g, estado: 'PENDENTE', motivo: null, retentavel: null },
          );
          this.foco('ia-acomp-titulo');
          this.consultar();
        },
        error: (e: HttpErrorResponse) => {
          this.reenviando.set(false);
          this.falharEnvio(e);
        },
      });
  }

  private falharEnvio(e: HttpErrorResponse): void {
    const r = classificarErroConfirmar(e);
    if (r.tipo === 'texto') this.erroEnvio.set(r.texto);
    else if (r.tipo === 'sumiu') this.naoEncontrado.set(true);
    else if (r.tipo === 'expirada') {
      this.erroEnvio.set('O pedido expirou. Volte à nota e gere outra prévia.');
    } else this.buscarEmAndamento();
  }

  // O limite e de um pedido por vez por psicologo: acha o que esta rodando neste paciente.
  private buscarEmAndamento(): void {
    this.ia
      .listar(this.pacienteId())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (lista) => {
          const outro = lista.find((g) => g.estado === 'PENDENTE');
          if (outro) this.trocar.emit(outro.id);
          else this.erroEnvio.set(TEXTO_ANDAMENTO_OUTRO);
        },
        error: () => this.erroEnvio.set(TEXTO_ANDAMENTO_OUTRO),
      });
  }

  private iniciar(id: string): void {
    clearTimeout(this.temporizador);
    this.geracao.set(null);
    this.semRede.set(false);
    this.parado.set(false);
    this.naoEncontrado.set(false);
    this.reenviando.set(false);
    this.erroEnvio.set('');
    this.falhas = 0;
    this.consultar(id);
  }

  private consultar(id = this.geracaoId()): void {
    clearTimeout(this.temporizador);
    this.ia
      .consultar(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (g) => {
          if (id !== this.geracaoId()) return;
          this.falhas = 0;
          this.semRede.set(false);
          const antes = this.geracao()?.estado;
          this.geracao.set(g);
          if (g.estado === 'PENDENTE') {
            this.temporizador = setTimeout(() => this.consultar(), INTERVALO_MS);
          } else if (antes === 'PENDENTE' && g.estado === 'PRONTO') {
            this.foco('ia-abrir');
          }
        },
        error: (e: HttpErrorResponse) => {
          if (id !== this.geracaoId()) return;
          if (e.status === 404) {
            this.naoEncontrado.set(true);
            return;
          }
          // 401 e 403 (senha provisoria) o interceptor ja trata; aqui rede, 5xx e 429.
          this.semRede.set(true);
          this.falhas++;
          if (this.falhas >= FALHAS_MAXIMAS) this.parado.set(true);
          else this.temporizador = setTimeout(() => this.consultar(), INTERVALO_MS);
        },
      });
  }

  private foco(id: string): void {
    afterNextRender(() => document.getElementById(id)?.focus(), { injector: this.injector });
  }
}
