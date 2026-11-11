import { HttpErrorResponse } from '@angular/common/http';
import { Component, Injector, afterNextRender, computed, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ArrowLeft, CircleAlert, CircleCheck, LucideAngularModule } from 'lucide-angular';
import {
  emailOpcional,
  focarPrimeiroErro,
  hojeLocal,
  mensagemCampo,
  mensagemHttp,
  nascimentoValido,
  nomeCurto,
  preenchido,
  telefoneValido,
} from '../core/formulario';
import { DocumentosSecaoComponent } from '../documentos/documentos-secao.component';
import { PedidosIaSecaoComponent } from '../ia/pedidos-ia-secao.component';
import { BAIXAR_ARQUIVO } from '../core/download';
import { ButtonComponent } from '../ui/button.component';
import { ConsentimentoCardComponent } from './consentimento-card.component';
import { EstadoConsentimento } from './consentimento.service';
import { AvisoPacientes } from './pacientes.page';
import { Paciente, PacientesService } from './pacientes.service';

const OBRIGATORIO = {
  nome: 'Informe o nome do paciente.',
  nascimento: 'Informe uma data válida.',
  telefone: 'Informe um telefone válido.',
  email: 'Informe um e-mail válido.',
};

// Recado que as telas de documento deixam no state da navegacao ao voltar para o paciente
// (so um codigo fixo, nunca texto de documento: o state vai para o historico do navegador).
export type AvisoDetalhe = 'sem-consentimento' | 'documento-nao-encontrado' | 'documento-criado';

const AVISOS_DETALHE: Record<AvisoDetalhe, { texto: string; ok: boolean }> = {
  'sem-consentimento': {
    texto: 'O consentimento deste paciente não está concedido. O documento não foi salvo.',
    ok: false,
  },
  'documento-nao-encontrado': { texto: 'Documento não encontrado.', ok: false },
  'documento-criado': { texto: 'Documento criado como rascunho.', ok: true },
};

// Exportacao (LGPD): so a mensagem fixa aparece; o corpo do erro nunca e lido nem mostrado.
const ERRO_EXPORTAR_GERAL = 'Não foi possível baixar agora. Tente de novo.';
const ERRO_EXPORTAR_413 = 'Este paciente tem histórico grande demais para baixar de uma vez.';
const ERRO_EXPORTAR_429 = 'Você atingiu o limite de downloads por hora. Tente de novo mais tarde.';

// Confirmacao do nome na exclusao: sem espacos nas pontas, sem diferenciar maiusculas nem acentos.
function normalizarNome(s: string): string {
  return s.trim().normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('pt-BR');
}

// Criar (/pacientes/novo) e ver/editar (/pacientes/:id) usam a mesma tela: o id da rota decide.
@Component({
  selector: 'app-paciente-form-page',
  imports: [
    ReactiveFormsModule,
    LucideAngularModule,
    RouterLink,
    ButtonComponent,
    ConsentimentoCardComponent,
    DocumentosSecaoComponent,
    PedidosIaSecaoComponent,
  ],
  templateUrl: './paciente-form.page.html',
  styleUrl: './paciente-form.page.scss',
})
export class PacienteFormPage {
  readonly icones = { ArrowLeft, CircleAlert, CircleCheck };
  private readonly servico = inject(PacientesService);
  private readonly router = inject(Router);
  readonly id = inject(ActivatedRoute).snapshot.paramMap.get('id');

  readonly avisoDetalhe = this.lerAviso();
  // Estado do consentimento, vindo do cartao; a secao Documentos so nasce depois dele.
  readonly consentimento = signal<EstadoConsentimento | null>(null);
  // "Pedidos de IA" so pede a lista depois das listas de documentos: tudo em sequencia.
  readonly documentosCarregados = signal(false);
  readonly hoje = hojeLocal();
  readonly carregando = signal(this.id !== null);
  readonly erroCarga = signal(false);
  readonly enviando = signal(false);
  readonly erroGeral = signal('');
  readonly confirmacao = signal('');
  // Exclusao (so no detalhe): confirmacao inline com o nome digitado; `excluindo` trava a chamada.
  readonly confirmandoExclusao = signal(false);
  readonly excluindo = signal(false);
  readonly erroExclusao = signal('');
  readonly nomeDigitado = signal('');
  // Nome salvo (o que aparece na lista), nao o que esta editado no campo.
  readonly nomeSalvo = signal('');
  // Exportacao (so no detalhe): confirmacao inline; `exportando` trava a chamada (uma so por vez).
  readonly baixar = inject(BAIXAR_ARQUIVO);
  readonly confirmandoExportacao = signal(false);
  readonly exportando = signal(false);
  readonly erroExportacao = signal('');
  readonly sucessoExportacao = signal('');
  readonly podeExcluir = computed(() => {
    const alvo = normalizarNome(this.nomeSalvo());
    return alvo !== '' && normalizarNome(this.nomeDigitado()) === alvo;
  });
  readonly form = new FormGroup({
    nome: new FormControl('', { nonNullable: true, validators: [preenchido, nomeCurto] }),
    nascimento: new FormControl('', { nonNullable: true, validators: [nascimentoValido] }),
    telefone: new FormControl('', { nonNullable: true, validators: [telefoneValido] }),
    email: new FormControl('', { nonNullable: true, validators: [emailOpcional] }),
  });

  private readonly injector = inject(Injector);

  constructor() {
    if (this.id) this.carregar(this.id);
  }

  erro(nome: keyof typeof OBRIGATORIO): string {
    return mensagemCampo(this.form.controls[nome], OBRIGATORIO[nome]);
  }

  limparNascimento(): void {
    this.form.controls.nascimento.setValue('');
    this.form.controls.nascimento.markAsDirty();
    document.getElementById('pc-nascimento')?.focus();
  }

  carregar(id: string): void {
    this.erroCarga.set(false);
    this.carregando.set(true);
    this.servico.obter(id).subscribe({
      next: (p) => {
        this.preencher(p);
        this.carregando.set(false);
      },
      error: (e: HttpErrorResponse) => {
        if (e.status === 404) this.voltar('nao-encontrado');
        else {
          this.carregando.set(false);
          this.erroCarga.set(true);
        }
      },
    });
  }

  salvar(): void {
    if (this.enviando()) return;
    this.erroGeral.set('');
    this.confirmacao.set('');
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      focarPrimeiroErro(this.form, 'pc');
      return;
    }
    this.enviando.set(true);
    const v = this.form.getRawValue();
    const nome = v.nome.trim();
    const nascimento = v.nascimento.trim();
    const telefone = v.telefone.trim();
    const email = v.email.trim();

    if (this.id) {
      // PATCH: campo vazio vira null e o servidor limpa o dado.
      this.servico
        .atualizar(this.id, {
          nome,
          nascimento: nascimento || null,
          telefone: telefone || null,
          email: email || null,
        })
        .subscribe({
          next: (p) => {
            this.enviando.set(false);
            this.preencher(p);
            this.confirmacao.set('Alterações salvas.');
          },
          error: (e) => this.falhar(e),
        });
      return;
    }
    this.servico
      .criar({
        nome,
        ...(nascimento && { nascimento }),
        ...(telefone && { telefone }),
        ...(email && { email }),
      })
      .subscribe({
        next: () => {
          this.enviando.set(false);
          void this.router.navigateByUrl('/pacientes', { state: { aviso: 'criado' } });
        },
        error: (e) => this.falhar(e),
      });
  }

  pedirExclusao(): void {
    this.erroExclusao.set('');
    this.nomeDigitado.set('');
    this.confirmandoExclusao.set(true);
    this.focar('pc-excluir-nome');
  }

  digitarNome(evento: Event): void {
    this.nomeDigitado.set((evento.target as HTMLInputElement).value);
  }

  cancelarExclusao(): void {
    if (this.excluindo()) return;
    this.confirmandoExclusao.set(false);
    this.nomeDigitado.set('');
    this.erroExclusao.set('');
    this.focar('pc-excluir-abrir');
  }

  excluirPaciente(): void {
    if (this.excluindo() || !this.podeExcluir() || !this.id) return;
    this.excluindo.set(true);
    this.erroExclusao.set('');
    this.servico.excluir(this.id).subscribe({
      // Sucesso: a tela sai. O botao fica travado (nada de segundo DELETE antes de navegar).
      next: () => void this.router.navigateByUrl('/pacientes', { state: { aviso: 'excluido' } }),
      error: (e: HttpErrorResponse) => this.falharExclusao(e),
    });
  }

  private falharExclusao(e: HttpErrorResponse): void {
    // 404 (inexistente, alheio ou ja excluido): a lista explica. O botao segue travado.
    if (e.status === 404) {
      this.voltar('nao-encontrado-exclusao');
      return;
    }
    this.excluindo.set(false);
    this.erroExclusao.set(
      e.status === 409
        ? 'Algo mudou enquanto excluíamos. Tente de novo.'
        : 'Não foi possível excluir agora. Tente de novo.',
    );
    this.focar('pc-excluir-nome');
  }

  pedirExportacao(): void {
    this.erroExportacao.set('');
    this.sucessoExportacao.set('');
    this.confirmandoExportacao.set(true);
    this.focar('pc-exportar-confirmar');
  }

  cancelarExportacao(): void {
    if (this.exportando()) return;
    this.confirmandoExportacao.set(false);
    this.erroExportacao.set('');
    this.focar('pc-exportar-abrir');
  }

  exportarPaciente(): void {
    if (this.exportando() || !this.id) return;
    this.exportando.set(true);
    this.erroExportacao.set('');
    this.sucessoExportacao.set('');
    this.servico.exportar(this.id).subscribe({
      next: (resposta) => this.receberExportacao(resposta.body),
      error: (e: HttpErrorResponse) => this.falharExportacao(e),
    });
  }

  private receberExportacao(arquivo: Blob | null): void {
    this.exportando.set(false);
    try {
      if (!arquivo) throw new Error('sem arquivo');
      this.baixar(arquivo, `paciente-${this.id}.json`);
    } catch {
      this.erroExportacao.set(ERRO_EXPORTAR_GERAL);
      this.focar('pc-exportar-erro');
      return;
    }
    // Sucesso: a confirmacao fecha e o foco volta ao botao; nada do arquivo fica guardado.
    this.confirmandoExportacao.set(false);
    this.sucessoExportacao.set('Arquivo baixado. Guarde em local seguro.');
    this.focar('pc-exportar-abrir');
  }

  private falharExportacao(e: HttpErrorResponse): void {
    // Erro chega como blob: so o status e usado. 404 volta para a lista, como na exclusao.
    this.exportando.set(false);
    if (e.status === 404) {
      this.voltar('nao-encontrado-exclusao');
      return;
    }
    this.erroExportacao.set(
      e.status === 413
        ? ERRO_EXPORTAR_413
        : e.status === 429
          ? ERRO_EXPORTAR_429
          : ERRO_EXPORTAR_GERAL,
    );
    this.focar('pc-exportar-erro');
  }

  private focar(id: string): void {
    afterNextRender(() => document.getElementById(id)?.focus(), { injector: this.injector });
  }

  private lerAviso(): { texto: string; ok: boolean } | null {
    const codigo = this.router.getCurrentNavigation()?.extras.state?.['aviso'] as
      AvisoDetalhe | undefined;
    return (codigo && AVISOS_DETALHE[codigo]) || null;
  }

  private preencher(p: Paciente): void {
    this.nomeSalvo.set(p.nome);
    this.form.reset({
      nome: p.nome,
      nascimento: p.nascimento ?? '',
      telefone: p.telefone ?? '',
      email: p.email ?? '',
    });
  }

  private falhar(e: HttpErrorResponse): void {
    this.enviando.set(false);
    if (e.status === 404) this.voltar('nao-encontrado');
    else this.erroGeral.set(mensagemHttp(e));
  }

  private voltar(aviso: AvisoPacientes): void {
    void this.router.navigateByUrl('/pacientes', { state: { aviso } });
  }
}
