import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { switchMap } from 'rxjs';
import { ABORDAGENS } from '../core/abordagens';
import {
  emailValido,
  focarPrimeiroErro,
  mensagemCampo,
  mensagemHttp,
  preenchido,
  senhaBytes,
} from '../core/formulario';
import { SessaoStore } from '../core/sessao.store';
import { AcessoComponent } from '../layout/acesso.component';

const OBRIGATORIO = {
  clinica: 'Informe o nome da clínica.',
  nome: 'Informe seu nome.',
  email: 'Informe seu e-mail.',
  senha: 'Crie uma senha.',
  abordagem: 'Escolha sua abordagem principal.',
};

const texto = () => new FormControl('', { nonNullable: true, validators: [preenchido] });

@Component({
  selector: 'app-cadastro-page',
  imports: [ReactiveFormsModule, RouterLink, AcessoComponent],
  templateUrl: './cadastro.page.html',
})
export class CadastroPage {
  private readonly http = inject(HttpClient);
  private readonly sessao = inject(SessaoStore);
  private readonly router = inject(Router);

  readonly abordagens = ABORDAGENS;
  readonly enviando = signal(false);
  readonly erroGeral = signal('');
  readonly form = new FormGroup({
    clinica: texto(),
    nome: texto(),
    email: new FormControl('', { nonNullable: true, validators: [preenchido, emailValido] }),
    senha: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, senhaBytes(8)],
    }),
    abordagem: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
  });

  erro(nome: keyof typeof OBRIGATORIO): string {
    return mensagemCampo(this.form.controls[nome], OBRIGATORIO[nome]);
  }

  criar(): void {
    if (this.enviando()) return;
    this.erroGeral.set('');
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      focarPrimeiroErro(this.form, 'cad');
      return;
    }
    this.enviando.set(true);
    const v = this.form.getRawValue();
    const email = v.email.trim();
    let criada = false;
    this.http
      .post('/api/clinicas', {
        nomeClinica: v.clinica.trim(),
        nomePsicologo: v.nome.trim(),
        email,
        senha: v.senha,
        abordagemPadrao: v.abordagem,
      })
      .pipe(
        switchMap(() => {
          criada = true;
          return this.http.post<{ token: string }>('/api/auth/login', { email, senha: v.senha });
        }),
      )
      .subscribe({
        next: ({ token }) => {
          this.sessao.entrar(token);
          void this.router.navigateByUrl('/');
        },
        error: (e: HttpErrorResponse) => {
          this.enviando.set(false);
          if (criada) {
            this.erroGeral.set(
              'Sua clínica foi criada, mas não deu para entrar agora. Use “Entrar”.',
            );
          } else if (e.status === 409) {
            this.form.controls.email.setErrors({ emUso: true });
            // markAsTouched: quem enviou com Enter no campo ainda nao saiu dele.
            this.form.controls.email.markAsTouched();
            document.getElementById('cad-email')?.focus();
          } else {
            this.erroGeral.set(mensagemHttp(e));
          }
        },
      });
  }
}
