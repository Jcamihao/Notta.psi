import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { ABORDAGENS, rotuloAbordagem } from '../core/abordagens';
import {
  emailValido,
  focarPrimeiroErro,
  mensagemCampo,
  mensagemHttp,
  preenchido,
  senhaBytes,
} from '../core/formulario';

// Item de GET /psicologos (contrato.md, item 8).
export interface MembroEquipe {
  psicologoId: string;
  nome: string;
  email: string;
  papel: 'ADMIN' | 'PSICOLOGO';
  abordagemPadrao: string;
  criadoEm: string;
}

const OBRIGATORIO = {
  nome: 'Informe o nome.',
  email: 'Informe o e-mail.',
  senha: 'Defina uma senha provisória.',
  abordagem: 'Escolha a abordagem principal.',
};

const DATA = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

@Component({
  selector: 'app-equipe-page',
  imports: [ReactiveFormsModule],
  templateUrl: './equipe.page.html',
  styleUrl: './equipe.page.scss',
})
export class EquipePage {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);

  readonly abordagens = ABORDAGENS;
  readonly rotuloAbordagem = rotuloAbordagem;
  readonly lista = signal<MembroEquipe[] | null>(null);
  readonly erroLista = signal(false);
  readonly enviando = signal(false);
  readonly erroGeral = signal('');
  readonly confirmacao = signal('');
  readonly form = new FormGroup({
    nome: new FormControl('', { nonNullable: true, validators: [preenchido] }),
    email: new FormControl('', { nonNullable: true, validators: [preenchido, emailValido] }),
    senha: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, senhaBytes(8)],
    }),
    abordagem: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
  });

  constructor() {
    this.carregar();
  }

  data(iso: string): string {
    return DATA.format(new Date(iso));
  }

  erro(nome: keyof typeof OBRIGATORIO): string {
    return mensagemCampo(this.form.controls[nome], OBRIGATORIO[nome]);
  }

  carregar(): void {
    this.erroLista.set(false);
    this.http.get<MembroEquipe[]>('/api/psicologos').subscribe({
      next: (l) => this.lista.set(l),
      error: (e: HttpErrorResponse) => {
        if (e.status === 403) void this.router.navigateByUrl('/');
        else this.erroLista.set(true);
      },
    });
  }

  adicionar(): void {
    if (this.enviando()) return;
    this.erroGeral.set('');
    this.confirmacao.set('');
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      focarPrimeiroErro(this.form, 'eq');
      return;
    }
    this.enviando.set(true);
    const v = this.form.getRawValue();
    const nome = v.nome.trim();
    this.http
      .post('/api/psicologos', {
        nome,
        email: v.email.trim(),
        senha: v.senha,
        abordagemPadrao: v.abordagem,
      })
      .subscribe({
        next: () => {
          this.enviando.set(false);
          this.form.reset();
          this.confirmacao.set(
            `${nome} agora faz parte da equipe. Combine a senha provisória com a pessoa por um canal seguro; ela escolherá a própria no primeiro acesso.`,
          );
          this.carregar();
        },
        error: (e: HttpErrorResponse) => {
          this.enviando.set(false);
          // A senha nunca fica na tela depois do envio. Limpa depois de mover o foco, senao o
          // blur do campo senha acende "Defina uma senha provisória" antes da pessoa agir.
          if (e.status === 409) {
            // markAsTouched: quem enviou com Enter no campo ainda nao saiu dele.
            this.form.controls.email.setErrors({ emUsoEquipe: true });
            this.form.controls.email.markAsTouched();
            document.getElementById('eq-email')?.focus();
          } else if (e.status === 403) {
            this.erroGeral.set('Você não tem permissão para gerenciar a equipe.');
            void this.router.navigateByUrl('/');
          } else {
            this.erroGeral.set(mensagemHttp(e));
          }
          this.form.controls.senha.reset();
        },
      });
  }
}
