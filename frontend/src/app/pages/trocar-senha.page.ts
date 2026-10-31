import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import {
  erroSeDiferente,
  erroSeIgual,
  focarPrimeiroErro,
  mensagemCampo,
  mensagemHttp,
  senhaBytes,
} from '../core/formulario';
import { SessaoStore } from '../core/sessao.store';
import { UsuarioStore } from '../core/usuario.store';

const OBRIGATORIO = {
  senhaAtual: 'Informe sua senha atual.',
  novaSenha: 'Escolha a nova senha.',
  confirmar: 'Digite a nova senha de novo.',
};

// Troca de senha (itens 62 e 57). Com senha provisoria e obrigatoria: o guard traz a pessoa para
// ca e o shell esconde a navegacao. Sem ela, e a troca voluntaria pelo link do cabecalho.
@Component({
  selector: 'app-trocar-senha-page',
  imports: [ReactiveFormsModule],
  templateUrl: './trocar-senha.page.html',
  styleUrl: './trocar-senha.page.scss',
})
export class TrocarSenhaPage {
  private readonly http = inject(HttpClient);
  private readonly sessao = inject(SessaoStore);
  private readonly router = inject(Router);

  readonly obrigatoria = inject(UsuarioStore).senhaProvisoria;
  readonly enviando = signal(false);
  readonly erroGeral = signal('');
  readonly form = new FormGroup({
    senhaAtual: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, senhaBytes(1)],
    }),
    novaSenha: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, senhaBytes(8), erroSeIgual('senhaAtual', 'senhaIgual')],
    }),
    confirmar: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, erroSeDiferente('novaSenha', 'confirmacaoDiferente')],
    }),
  });

  erro(nome: keyof typeof OBRIGATORIO): string {
    return mensagemCampo(this.form.controls[nome], OBRIGATORIO[nome]);
  }

  trocar(): void {
    if (this.enviando()) return;
    this.erroGeral.set('');
    const c = this.form.controls;
    // Os validadores que comparam campos so rodam quando o proprio campo muda.
    c.novaSenha.updateValueAndValidity();
    c.confirmar.updateValueAndValidity();
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      focarPrimeiroErro(this.form, 'ts');
      return;
    }
    this.enviando.set(true);
    const { senhaAtual, novaSenha } = this.form.getRawValue();
    this.http
      .post<{ token: string }>('/api/auth/trocar-senha', { senhaAtual, novaSenha })
      .subscribe({
        next: ({ token }) => {
          this.form.reset();
          // Token novo: os antigos deixam de valer. O UsuarioStore recarrega o /eu sozinho.
          this.sessao.entrar(token);
          void this.router.navigateByUrl('/', { state: { senhaTrocada: true } });
        },
        error: (e: HttpErrorResponse) => {
          this.enviando.set(false);
          // Senha nunca fica na tela depois do envio. Foca antes de limpar, senao o blur do campo
          // de onde saiu acende "obrigatorio" antes da pessoa agir.
          document.getElementById('ts-senhaAtual')?.focus();
          this.form.reset();
          if (e.status === 422) {
            c.senhaAtual.setErrors({ senhaAtualIncorreta: true });
            c.senhaAtual.markAsTouched();
          } else {
            this.erroGeral.set(mensagemHttp(e));
          }
        },
      });
  }
}
