import { HttpErrorResponse } from '@angular/common/http';
import { Component, OnDestroy, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ArrowLeft, ChevronDown, CircleAlert, LucideAngularModule } from 'lucide-angular';
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
import { PacientesService } from '../pacientes/pacientes.service';
import { ButtonComponent } from '../ui/button.component';
import { AvisoIdentificacaoComponent } from './aviso-identificacao.component';
import {
  DocumentosService,
  LIMITE_CONTEUDO,
  ROTULO_TIPO,
  TipoDocumento,
} from './documentos.service';

const OBRIGATORIO = {
  tipo: 'Escolha o tipo do documento.',
  dataSessao: 'Informe uma data válida.',
  conteudo: 'Escreva o texto do documento.',
};

// Novo documento: sem autosave e sem copia do texto fora do formulario (nem storage, nem URL,
// nem state do router). O texto sai da memoria ao enviar ou ao sair da pagina.
@Component({
  selector: 'app-documento-novo-page',
  imports: [
    ReactiveFormsModule,
    LucideAngularModule,
    RouterLink,
    ButtonComponent,
    AvisoIdentificacaoComponent,
  ],
  templateUrl: './documento-novo.page.html',
  styleUrl: './documento-novo.page.scss',
})
export class DocumentoNovoPage implements OnDestroy {
  readonly icones = { ArrowLeft, ChevronDown, CircleAlert };
  private readonly servico = inject(DocumentosService);
  private readonly pacientes = inject(PacientesService);
  private readonly router = inject(Router);
  readonly pacienteId = inject(ActivatedRoute).snapshot.paramMap.get('id')!;

  readonly tipos = Object.entries(ROTULO_TIPO) as [TipoDocumento, string][];
  readonly limite = LIMITE_CONTEUDO.toLocaleString('pt-BR');
  readonly hoje = hojeLocal();
  readonly enviando = signal(false);
  readonly erroGeral = signal('');
  readonly form = new FormGroup({
    tipo: new FormControl('', { nonNullable: true, validators: [preenchido] }),
    dataSessao: new FormControl('', { nonNullable: true, validators: [sessaoValida] }),
    conteudo: new FormControl('', {
      nonNullable: true,
      validators: [preenchido, conteudoMaximo(LIMITE_CONTEUDO)],
    }),
  });
  private readonly texto = toSignal(this.form.controls.conteudo.valueChanges, {
    initialValue: '',
  });
  // Nome so para o detector (item 13) e para confirmar o paciente na tela; se falhar, segue sem.
  readonly nomePaciente = signal('');
  readonly caracteres = computed(() => this.texto().length.toLocaleString('pt-BR'));
  readonly acimaDoLimite = computed(() => this.texto().length > LIMITE_CONTEUDO);
  readonly dadosAchados = computed(() => detectarDados(this.texto(), this.nomePaciente()));

  constructor() {
    this.pacientes.obter(this.pacienteId).subscribe({
      next: (p) => this.nomePaciente.set(p.nome),
      error: () => undefined,
    });
  }

  focarTexto(): void {
    document.getElementById('dc-conteudo')?.focus();
  }

  erro(nome: keyof typeof OBRIGATORIO): string {
    return mensagemCampo(this.form.controls[nome], OBRIGATORIO[nome]);
  }

  ngOnDestroy(): void {
    this.limpar();
  }

  enviar(): void {
    if (this.enviando()) return;
    this.erroGeral.set('');
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      focarPrimeiroErro(this.form, 'dc');
      return;
    }
    this.enviando.set(true);
    const v = this.form.getRawValue();
    this.servico
      .criar(this.pacienteId, {
        tipo: v.tipo as TipoDocumento,
        ...(v.dataSessao && { dataSessao: v.dataSessao }),
        conteudo: v.conteudo,
      })
      .subscribe({
        next: () => this.voltar('documento-criado'),
        error: (e: HttpErrorResponse) => this.falhar(e),
      });
  }

  private falhar(e: HttpErrorResponse): void {
    this.enviando.set(false);
    // O servidor recusou: o texto nao vai ser salvo, entao nao fica na tela.
    if (e.status === 403 && e.error?.message === 'Consentimento nao concedido') {
      this.voltar('sem-consentimento');
    } else if (e.status === 404) {
      this.limpar();
      void this.router.navigateByUrl('/pacientes', { state: { aviso: 'nao-encontrado' } });
    } else this.erroGeral.set(mensagemHttp(e));
  }

  private voltar(aviso: AvisoDetalhe): void {
    this.limpar();
    void this.router.navigateByUrl(`/pacientes/${this.pacienteId}`, { state: { aviso } });
  }

  private limpar(): void {
    this.form.reset();
  }
}
