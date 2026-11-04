import { HttpErrorResponse } from '@angular/common/http';
import {
  Component,
  Injector,
  OnDestroy,
  afterNextRender,
  computed,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import {
  ArrowLeft,
  CircleAlert,
  CircleCheck,
  LucideAngularModule,
  TriangleAlert,
} from 'lucide-angular';
import { mensagemHttp } from '../core/formulario';
import { ROTULO_TIPO } from '../documentos/documentos.service';
import { ButtonComponent } from '../ui/button.component';
import { AVISO_PREVIA, IaService, Previa, TipoGerado } from './ia.service';
import { IaTermosComponent } from './ia-termos.component';

// Codigo do anonimizador: [PACIENTE], [CPF], [CPF_2], [TERMO_1]... (colchetes do texto original
// o back ja trocou por parenteses, entao todo colchete assim e um codigo).
const CODIGO = /(\[[A-Z]+(?:_\d+)?\])/;

const TIPOS: { valor: TipoGerado; rotulo: string }[] = [
  { valor: 'EVOLUCAO', rotulo: 'Evolução' },
  { valor: 'ANAMNESE', rotulo: 'Anamnese' },
];

type Passo = 'config' | 'previa';

// Gerar rascunho por IA a partir de uma nota bruta, em passos: escolher o tipo e os termos extras,
// ver a previa EXATA do que sai do sistema. O texto anonimizado e os termos vivem so nos signals
// desta pagina (mostrados por interpolacao, nunca innerHTML) e saem da memoria ao sair dela.
@Component({
  selector: 'app-ia-gerar-page',
  imports: [LucideAngularModule, RouterLink, ButtonComponent, IaTermosComponent],
  templateUrl: './ia-gerar.page.html',
  styleUrl: './ia-gerar.page.scss',
})
export class IaGerarPage implements OnDestroy {
  readonly icones = { ArrowLeft, CircleAlert, CircleCheck, TriangleAlert };
  private readonly ia = inject(IaService);
  private readonly router = inject(Router);
  private readonly injector = inject(Injector);
  private readonly rota = inject(ActivatedRoute).snapshot;
  readonly pacienteId = this.rota.paramMap.get('id')!;
  readonly docId = this.rota.paramMap.get('docId')!;

  readonly tipos = TIPOS;
  readonly rotuloTipo = ROTULO_TIPO;
  readonly avisoPrevia = AVISO_PREVIA;
  readonly passo = signal<Passo>('config');
  readonly tipo = signal<TipoGerado>('EVOLUCAO');
  readonly termos = signal<string[]>([]);
  readonly previa = signal<Previa | null>(null);
  readonly gerando = signal(false);
  readonly erro = signal('');
  readonly mensagem = signal('');
  readonly partes = computed(() =>
    (this.previa()?.textoAnonimizado ?? '')
      .split(CODIGO)
      .map((texto, i) => ({ texto, codigo: i % 2 === 1 }))
      .filter((p) => p.texto !== ''),
  );

  ngOnDestroy(): void {
    this.limpar();
  }

  escolherTipo(tipo: TipoGerado): void {
    this.tipo.set(tipo);
  }

  adicionarTermo(termo: string): void {
    this.termos.update((t) => [...t, termo]);
  }

  removerTermo(i: number): void {
    this.termos.update((t) => t.filter((_, j) => j !== i));
  }

  verPrevia(): void {
    this.gerarPrevia(() => this.foco('ia-previa-titulo'));
  }

  // Termo novo na previa: gera OUTRA previa (cada previa e uma linha nova no back). Se falhar,
  // o termo volta atras para a lista nao divergir do texto que esta na tela.
  adicionarTermoNaPrevia(termo: string): void {
    const antes = this.termos();
    this.termos.set([...antes, termo]);
    this.gerarPrevia(
      undefined,
      () => this.termos.set(antes),
      'Prévia atualizada com o novo termo.',
    );
  }

  voltarParaConfig(): void {
    this.erro.set('');
    this.mensagem.set('');
    this.passo.set('config');
    this.foco('ia-config-titulo');
  }

  private gerarPrevia(depois?: () => void, aoFalhar?: () => void, aviso = ''): void {
    if (this.gerando()) return;
    this.erro.set('');
    this.mensagem.set('');
    this.gerando.set(true);
    this.ia.previa(this.pacienteId, this.docId, this.tipo(), this.termos()).subscribe({
      next: (p) => {
        this.gerando.set(false);
        this.previa.set(p);
        this.passo.set('previa');
        this.mensagem.set(aviso);
        depois?.();
      },
      error: (e: HttpErrorResponse) => {
        this.gerando.set(false);
        aoFalhar?.();
        this.falharPrevia(e);
      },
    });
  }

  private falharPrevia(e: HttpErrorResponse): void {
    const msg = (e.error as { message?: unknown } | null)?.message;
    if (e.status === 404) {
      this.limpar();
      void this.router.navigateByUrl(`/pacientes/${this.pacienteId}`, {
        state: { aviso: 'documento-nao-encontrado' },
      });
    } else if (e.status === 403 && msg === 'Consentimento nao concedido') {
      this.erro.set('Registre o consentimento do paciente para usar a IA.');
    } else if (e.status === 409) {
      this.erro.set('Só uma nota bruta pode ser usada como origem da IA.');
    } else if (e.status === 422) {
      this.erro.set(
        'A nota é longa demais para a IA (máximo de 8.000 caracteres depois de anonimizar). Divida a nota em partes menores.',
      );
    } else if (e.status === 503) {
      this.erro.set('A IA está desligada neste ambiente.');
    } else this.erro.set(mensagemHttp(e));
  }

  private limpar(): void {
    this.previa.set(null);
    this.termos.set([]);
  }

  private foco(id: string): void {
    afterNextRender(() => document.getElementById(id)?.focus(), { injector: this.injector });
  }
}
