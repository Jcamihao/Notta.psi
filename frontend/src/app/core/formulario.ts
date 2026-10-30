import { HttpErrorResponse } from '@angular/common/http';
import { AbstractControl, FormGroup, ValidatorFn } from '@angular/forms';

// Validacao no cliente e so conveniencia: o servidor e a autoridade.

export const preenchido: ValidatorFn = (c) =>
  String(c.value ?? '').trim() ? null : { required: true };

export const emailValido: ValidatorFn = (c) =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(c.value ?? '').trim()) ? null : { email: true };

// bcrypt so usa 72 BYTES: conta bytes UTF-8, nao caracteres (emoji = 4 bytes).
export const senhaBytes =
  (min: number): ValidatorFn =>
  (c) => {
    const n = new TextEncoder().encode(String(c.value ?? '')).length;
    if (n > 72) return { senhaLonga: true };
    return n < min ? { senhaCurta: true } : null;
  };

const MENSAGENS: Record<string, string> = {
  email: 'Digite um e-mail válido, como nome@clinica.com.',
  senhaCurta: 'A senha precisa de pelo menos 8 caracteres.',
  senhaLonga: 'Senha longa demais: o limite é 72 bytes (acentos e emojis ocupam mais).',
  emUso: 'Este e-mail já tem cadastro. Entre com ele ou use outro.',
  emUsoEquipe: 'Este e-mail já está cadastrado no Notta.psi. Use outro e-mail.',
};

// Erro so aparece depois do blur ou do envio (touched), nunca a cada tecla.
export function mensagemCampo(c: AbstractControl, obrigatorio: string): string {
  if (!c.touched || !c.errors) return '';
  if (c.errors['required']) return obrigatorio;
  return MENSAGENS[Object.keys(c.errors)[0]] ?? obrigatorio;
}

// Os ids dos campos seguem `<prefixo>-<nome do controle>`.
export function focarPrimeiroErro(form: FormGroup, prefixo: string): void {
  const nome = Object.keys(form.controls).find((k) => form.controls[k].invalid);
  if (nome) document.getElementById(`${prefixo}-${nome}`)?.focus();
}

export function mensagemHttp(e: HttpErrorResponse): string {
  if (e.status === 400) return 'Alguns campos estão inválidos. Revise e tente de novo.';
  if (e.status === 429) {
    const s = Number(e.headers.get('Retry-After'));
    if (!Number.isInteger(s) || s <= 0)
      return 'Muitas tentativas. Aguarde um pouco e tente de novo.';
    return `Muitas tentativas. Tente de novo em ${s} ${s === 1 ? 'segundo' : 'segundos'}.`;
  }
  return 'Não foi possível concluir agora. Confira sua conexão e tente de novo.';
}
