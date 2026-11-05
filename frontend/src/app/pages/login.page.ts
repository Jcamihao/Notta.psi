import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import {
  emailValido,
  focarPrimeiroErro,
  mensagemCampo,
  mensagemHttp,
  preenchido,
  senhaBytes,
} from '../core/formulario';
import { Eu, SessaoStore } from '../core/sessao.store';
import { AcessoComponent } from '../layout/acesso.component';
import { CircleAlert, LucideAngularModule } from 'lucide-angular';
import { ButtonComponent } from '../ui/button.component';

const OBRIGATORIO = { email: 'Informe seu e-mail.', senha: 'Informe sua senha.' };

@Component({
  selector: 'app-login-page',
  imports: [ReactiveFormsModule, RouterLink, AcessoComponent, LucideAngularModule, ButtonComponent],
  templateUrl: './login.page.html',
})
export class LoginPage {
  readonly icones = { CircleAlert };
  private readonly http = inject(HttpClient);
  private readonly sessao = inject(SessaoStore);
  private readonly router = inject(Router);

  // A sessao caiu sozinha (acesso e renovacao falharam): o aviso vem do store, nao de URL.
  readonly sessaoExpirada = this.sessao.expirada;
  readonly enviando = signal(false);
  readonly erroGeral = signal('');
  readonly form = new FormGroup({
    email: new FormControl('', { nonNullable: true, validators: [preenchido, emailValido] }),
    senha: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, senhaBytes(1)],
    }),
  });

  erro(nome: keyof typeof OBRIGATORIO): string {
    return mensagemCampo(this.form.controls[nome], OBRIGATORIO[nome]);
  }

  entrar(): void {
    if (this.enviando()) return;
    this.erroGeral.set('');
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      focarPrimeiroErro(this.form, 'login');
      return;
    }
    this.enviando.set(true);
    const { email, senha } = this.form.getRawValue();
    this.http.post<{ usuario: Eu }>('/api/auth/login', { email: email.trim(), senha }).subscribe({
      next: ({ usuario }) => {
        this.sessao.entrar(usuario);
        void this.router.navigateByUrl('/');
      },
      error: (e: HttpErrorResponse) => {
        this.enviando.set(false);
        if (e.status !== 401) return this.erroGeral.set(mensagemHttp(e));
        // Nunca dizer qual dos dois errou.
        this.form.controls.senha.reset();
        this.erroGeral.set('E-mail ou senha incorretos.');
        document.getElementById('login-senha')?.focus();
      },
    });
  }
}
