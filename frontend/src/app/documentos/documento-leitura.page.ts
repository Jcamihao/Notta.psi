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
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ArrowLeft, CircleAlert, CircleCheck, LucideAngularModule } from 'lucide-angular';
import { dataHoraBr } from '../core/datas';
import { detectarDados } from '../core/dados-identificaveis';
import {
  conteudoMaximo,
  focarPrimeiroErro,
  hojeLocal,
  mensagemCampo,
  mensagemHttp,
  preenchido,
  sessaoValida,
} from '../core/formulario';
import { AvisoDetalhe } from '../pacientes/paciente-form.page';
import { dataBr } from '../pacientes/pacientes.page';
import { PacientesService } from '../pacientes/pacientes.service';
import { ButtonComponent } from '../ui/button.component';
import { PillComponent } from '../ui/pill.component';
import { AvisoIdentificacaoComponent } from './aviso-identificacao.component';
import {
  AtualizacaoDocumento,
  Documento,
  DocumentosService,
  LIMITE_CONTEUDO,
  ROTULO_STATUS,
  ROTULO_TIPO,
  TOM_STATUS,
  TipoDocumento,
} from './documentos.service';

const OBRIGATORIO = {
  dataSessao: 'Informe uma data válida.',
  conteudo: 'Escreva o texto do documento.',
};

// Do documento original so guardamos o que o rotulo "Corrige: ..." precisa (nunca o texto).
interface Original {
  id: string;
  tipo: TipoDocumento | null;
  dataSessao: string | null;
}

// Leitura do documento, com edicao e aprovacao do rascunho (itens 14 e 15). O texto vive so
// neste signal e no formulario de edicao, e e mostrado por interpolacao (nunca innerHTML); sai
// da memoria ao sair da pagina. Aprovado e somente leitura (o banco tambem barra).
@Component({
  selector: 'app-documento-leitura-page',
  imports: [
    ReactiveFormsModule,
    LucideAngularModule,
    RouterLink,
    ButtonComponent,
    PillComponent,
    AvisoIdentificacaoComponent,
  ],
  templateUrl: './documento-leitura.page.html',
  styleUrl: './documento-leitura.page.scss',
})
export class DocumentoLeituraPage implements OnDestroy {
  readonly icones = { ArrowLeft, CircleAlert, CircleCheck };
  private readonly servico = inject(DocumentosService);
  private readonly pacientes = inject(PacientesService);
  private readonly router = inject(Router);
  private readonly injector = inject(Injector);
  readonly pacienteId = inject(ActivatedRoute).snapshot.paramMap.get('id')!;
  private docId = '';

  readonly dataBr = dataBr;
  readonly dataHora = dataHoraBr;
  readonly tipo = ROTULO_TIPO;
  readonly status = ROTULO_STATUS;
  readonly tom = TOM_STATUS;
  readonly limite = LIMITE_CONTEUDO.toLocaleString('pt-BR');
  readonly hoje = hojeLocal();
  readonly documento = signal<Documento | null>(null);
  readonly erroCarga = signal(false);
  readonly original = signal<Original | null>(null);
  readonly editando = signal(false);
  readonly confirmando = signal(false);
  readonly salvando = signal(false);
  readonly aprovando = signal(false);
  readonly erroGeral = signal('');
  readonly mensagem = signal('');
  readonly nomePaciente = signal('');
  private nomePedido = false;

  readonly form = new FormGroup({
    dataSessao: new FormControl('', { nonNullable: true, validators: [sessaoValida] }),
    conteudo: new FormControl('', {
      nonNullable: true,
      validators: [preenchido, conteudoMaximo(LIMITE_CONTEUDO)],
    }),
  });
  private readonly texto = toSignal(this.form.controls.conteudo.valueChanges, {
    initialValue: '',
  });
  readonly caracteres = computed(() => this.texto().length.toLocaleString('pt-BR'));
  readonly acimaDoLimite = computed(() => this.texto().length > LIMITE_CONTEUDO);
  readonly dadosAchados = computed(() => detectarDados(this.texto(), this.nomePaciente()));

  constructor() {
    // Do corrigido para o original a rota e a mesma e so o docId muda: a tela reage ao param.
    inject(ActivatedRoute)
      .paramMap.pipe(takeUntilDestroyed())
      .subscribe((p) => {
        this.docId = p.get('docId')!;
        this.reiniciar();
        this.carregar();
      });
  }

  erro(nome: keyof typeof OBRIGATORIO): string {
    return mensagemCampo(this.form.controls[nome], OBRIGATORIO[nome]);
  }

  rotuloOriginal(o: Original): string {
    if (!o.tipo) return 'documento anterior';
    return `${ROTULO_TIPO[o.tipo]} ${o.dataSessao ? `de ${dataBr(o.dataSessao)}` : 'sem data de sessão'}`;
  }

  carregar(): void {
    this.erroCarga.set(false);
    this.servico.obter(this.pacienteId, this.docId).subscribe({
      next: (d) => {
        this.documento.set(d);
        if (d.substituiId && this.original()?.id !== d.substituiId)
          this.carregarOriginal(d.substituiId);
      },
      error: (e: HttpErrorResponse) => {
        if (e.status === 404) this.voltar('documento-nao-encontrado');
        // 401 e 403 (senha provisoria) o interceptor ja trata; aqui rede, 5xx e 400.
        else this.erroCarga.set(true);
      },
    });
  }

  ngOnDestroy(): void {
    this.reiniciar();
  }

  // ---- item 14: editar rascunho ----

  editar(): void {
    const d = this.documento();
    if (d?.status !== 'RASCUNHO') return;
    this.mensagem.set('');
    this.erroGeral.set('');
    this.form.reset({ dataSessao: d.dataSessao ?? '', conteudo: d.conteudo });
    this.editando.set(true);
    this.carregarNome();
    this.foco('de-conteudo');
  }

  cancelarEdicao(): void {
    this.sairDaEdicao();
    this.foco('de-editar');
  }

  focarTexto(): void {
    document.getElementById('de-conteudo')?.focus();
  }

  salvar(): void {
    const d = this.documento();
    if (!d || this.salvando()) return;
    this.erroGeral.set('');
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      focarPrimeiroErro(this.form, 'de');
      return;
    }
    // PATCH so com o que mudou (dataSessao vazia apaga a data).
    const v = this.form.getRawValue();
    const corpo: AtualizacaoDocumento = {};
    if (v.conteudo !== d.conteudo) corpo.conteudo = v.conteudo;
    if (v.dataSessao !== (d.dataSessao ?? '')) corpo.dataSessao = v.dataSessao || null;
    if (!Object.keys(corpo).length) {
      this.sairDaEdicao();
      this.mensagem.set('Nenhuma alteração para salvar.');
      this.foco('de-editar');
      return;
    }
    this.salvando.set(true);
    this.servico.atualizar(this.pacienteId, d.id, corpo).subscribe({
      next: (novo) => {
        this.salvando.set(false);
        this.documento.set(novo);
        this.sairDaEdicao();
        this.mensagem.set('Alterações salvas.');
        this.foco('de-editar');
      },
      error: (e: HttpErrorResponse) => this.falhar(e, 'editar'),
    });
  }

  // ---- item 15: aprovar (irreversivel) ----

  pedirAprovacao(): void {
    this.mensagem.set('');
    this.erroGeral.set('');
    this.confirmando.set(true);
    this.foco('de-cancelar-aprovacao');
  }

  cancelarAprovacao(): void {
    if (this.aprovando()) return;
    this.confirmando.set(false);
    this.foco('de-aprovar');
  }

  aprovar(): void {
    const d = this.documento();
    if (!d || this.aprovando()) return;
    this.aprovando.set(true);
    this.servico.aprovar(this.pacienteId, d.id).subscribe({
      next: (novo) => {
        this.aprovando.set(false);
        this.confirmando.set(false);
        // O servidor devolve o que foi aprovado: a tela mostra exatamente esse texto.
        this.documento.set(novo);
        this.mensagem.set('Documento aprovado.');
        this.foco('de-faixa');
      },
      error: (e: HttpErrorResponse) => this.falhar(e, 'aprovar'),
    });
  }

  private falhar(e: HttpErrorResponse, acao: 'editar' | 'aprovar'): void {
    this.salvando.set(false);
    this.aprovando.set(false);
    if (e.status === 404) {
      this.reiniciar();
      this.voltar('documento-nao-encontrado');
    } else if (e.status === 409) {
      // Outra aba/aparelho aprovou antes: avisa e recarrega (o banco ja barrou a mudanca).
      this.erroGeral.set(
        acao === 'editar'
          ? 'Documento aprovado não pode ser editado.'
          : 'Este documento já foi aprovado. Atualizei a tela.',
      );
      this.sairDaEdicao();
      this.confirmando.set(false);
      this.carregar();
    } else {
      this.confirmando.set(false);
      this.erroGeral.set(mensagemHttp(e));
    }
  }

  private sairDaEdicao(): void {
    this.editando.set(false);
    this.form.reset();
  }

  private reiniciar(): void {
    this.documento.set(null);
    this.original.set(null);
    this.editando.set(false);
    this.confirmando.set(false);
    this.salvando.set(false);
    this.aprovando.set(false);
    this.erroGeral.set('');
    this.mensagem.set('');
    this.form.reset();
  }

  // Nome so para o detector do item 13; busca uma vez, ao abrir a edicao. Se falhar, segue sem.
  private carregarNome(): void {
    if (this.nomePedido) return;
    this.nomePedido = true;
    this.pacientes.obter(this.pacienteId).subscribe({
      next: (p) => this.nomePaciente.set(p.nome),
      error: () => undefined,
    });
  }

  private carregarOriginal(id: string): void {
    this.servico.obter(this.pacienteId, id).subscribe({
      next: (o) => this.original.set({ id, tipo: o.tipo, dataSessao: o.dataSessao }),
      error: () => this.original.set({ id, tipo: null, dataSessao: null }),
    });
  }

  private foco(id: string): void {
    afterNextRender(() => document.getElementById(id)?.focus(), { injector: this.injector });
  }

  private voltar(aviso: AvisoDetalhe): void {
    void this.router.navigateByUrl(`/pacientes/${this.pacienteId}`, { state: { aviso } });
  }
}
