import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
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
  readonly form = new FormGroup({
    nome: new FormControl('', { nonNullable: true, validators: [preenchido, nomeCurto] }),
    nascimento: new FormControl('', { nonNullable: true, validators: [nascimentoValido] }),
    telefone: new FormControl('', { nonNullable: true, validators: [telefoneValido] }),
    email: new FormControl('', { nonNullable: true, validators: [emailOpcional] }),
  });

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

  private lerAviso(): { texto: string; ok: boolean } | null {
    const codigo = this.router.getCurrentNavigation()?.extras.state?.['aviso'] as
      AvisoDetalhe | undefined;
    return (codigo && AVISOS_DETALHE[codigo]) || null;
  }

  private preencher(p: Paciente): void {
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
