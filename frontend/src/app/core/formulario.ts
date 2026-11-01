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

// Campos opcionais do paciente (contrato do item 9). Vazio e valido; o servidor e a autoridade.
const vazio = (c: AbstractControl) => !String(c.value ?? '').trim();

export const nomeCurto: ValidatorFn = (c) =>
  String(c.value ?? '').trim().length > 120 ? { nomeLongo: true } : null;

export const hojeLocal = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// Valor do <input type="date">: 'YYYY-MM-DD' (comparacao de texto serve nesse formato).
export const nascimentoValido: ValidatorFn = (c) => {
  if (vazio(c)) return null;
  const v = String(c.value);
  if (v < '1900-01-01') return { nascimentoAntigo: true };
  return v > hojeLocal() ? { nascimentoFuturo: true } : null;
};

export const telefoneValido: ValidatorFn = (c) => {
  if (vazio(c)) return null;
  const v = String(c.value).trim();
  return /^[0-9 +\-()]{8,20}$/.test(v) ? null : { telefone: true };
};

export const emailOpcional: ValidatorFn = (c) => {
  if (vazio(c)) return null;
  if (String(c.value).trim().length > 254) return { emailLongo: true };
  return emailValido(c);
};

const MENSAGENS: Record<string, string> = {
  email: 'Digite um e-mail válido, como nome@clinica.com.',
  senhaCurta: 'A senha precisa de pelo menos 8 caracteres.',
  senhaLonga: 'Senha longa demais: o limite é 72 bytes (acentos e emojis ocupam mais).',
  nomeLongo: 'O nome pode ter até 120 caracteres.',
  nascimentoFuturo: 'A data de nascimento não pode ser no futuro.',
  nascimentoAntigo: 'Informe uma data de nascimento a partir de 1900.',
  telefone: 'Use de 8 a 20 caracteres: só números, espaço, +, - e parênteses.',
  emailLongo: 'O e-mail pode ter até 254 caracteres.',
  emUso: 'Este e-mail já tem cadastro. Entre com ele ou use outro.',
  emUsoEquipe: 'Este e-mail já está cadastrado no Notta.psi. Use outro e-mail.',
  senhaAtualIncorreta: 'Senha atual incorreta. Confira e digite de novo.',
  senhaIgual: 'A nova senha precisa ser diferente da atual.',
  confirmacaoDiferente: 'As senhas não conferem. Digite a nova senha igual nos dois campos.',
};

// Compara com outro campo do mesmo form. So reavalia quando ESTE campo muda: quem usa chama
// updateValueAndValidity() antes de enviar.
export const erroSeIgual =
  (outro: string, erro: string): ValidatorFn =>
  (c) =>
    c.value === c.parent?.get(outro)?.value ? { [erro]: true } : null;
export const erroSeDiferente =
  (outro: string, erro: string): ValidatorFn =>
  (c) =>
    c.value !== c.parent?.get(outro)?.value ? { [erro]: true } : null;

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
