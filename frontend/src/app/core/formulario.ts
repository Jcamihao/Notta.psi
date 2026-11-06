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

// Senha NOVA (cadastro, colega, troca): ate 72 bytes e pelo menos 10 CARACTERES (item 45). So
// conveniencia: quem decide "comum", "pessoal" e "sequencia" e o servidor (422 com motivo).
export const MINIMO_SENHA = 10;
export const senhaNova: ValidatorFn = (c) => {
  const s = String(c.value ?? '');
  if (new TextEncoder().encode(s).length > 72) return { senhaLonga: true };
  return [...s].length < MINIMO_SENHA ? { senhaCurta: true } : null;
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

// Data da sessao (item 12): opcional, de 1900 em diante, nunca futura.
export const sessaoValida: ValidatorFn = (c) => {
  if (vazio(c)) return null;
  const v = String(c.value);
  if (v < '1900-01-01') return { sessaoAntiga: true };
  return v > hojeLocal() ? { sessaoFutura: true } : null;
};

// Texto do documento: nao aparamos (so rejeitamos vazio); o limite conta como o servidor (length).
export const conteudoMaximo =
  (max: number): ValidatorFn =>
  (c) =>
    String(c.value ?? '').length > max ? { conteudoLongo: true } : null;

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
  senhaCurta: 'A senha precisa de pelo menos 10 caracteres.',
  senhaComum:
    'Essa senha é muito comum. Escolha outra, de preferência uma frase longa que só você conheça.',
  senhaPessoal: 'A senha não pode conter o nome nem o e-mail da conta. Escolha outra.',
  senhaRepetida: 'Evite repetições e sequências, como 1111111111 ou abcdefghij.',
  senhaFraca: 'Essa senha é fraca demais. Escolha outra, mais longa e menos previsível.',
  senhaLonga: 'Senha longa demais: o limite é 72 bytes (acentos e emojis ocupam mais).',
  nomeLongo: 'O nome pode ter até 120 caracteres.',
  nascimentoFuturo: 'A data de nascimento não pode ser no futuro.',
  nascimentoAntigo: 'Informe uma data de nascimento a partir de 1900.',
  sessaoFutura: 'A data da sessão não pode ser no futuro.',
  sessaoAntiga: 'Informe uma data de sessão a partir de 1900.',
  conteudoLongo: 'O texto pode ter até 20.000 caracteres. Divida em mais de um documento.',
  telefone: 'Use de 8 a 20 caracteres: só números, espaço, +, - e parênteses.',
  emailLongo: 'O e-mail pode ter até 254 caracteres.',
  emUso: 'Este e-mail já tem cadastro. Entre com ele ou use outro.',
  emUsoEquipe: 'Este e-mail já está cadastrado no Notta.psi. Use outro e-mail.',
  senhaAtualIncorreta: 'Senha atual incorreta. Confira e digite de novo.',
  senhaIgual: 'A nova senha precisa ser diferente da atual.',
  confirmacaoDiferente: 'As senhas não conferem. Digite a nova senha igual nos dois campos.',
};

// 422 de senha fraca traz `motivo` (CURTA, COMUM, PESSOAL, REPETIDA). Devolve a chave do erro do
// campo, ou null quando o 422 e outro (ex.: "Senha atual incorreta", que nao traz `motivo`).
const ERRO_POR_MOTIVO: Record<string, string> = {
  CURTA: 'senhaCurta',
  COMUM: 'senhaComum',
  PESSOAL: 'senhaPessoal',
  REPETIDA: 'senhaRepetida',
};
export function erroDeSenhaFraca(e: HttpErrorResponse): string | null {
  if (e.status !== 422) return null;
  const motivo = (e.error as { motivo?: unknown } | null)?.motivo;
  return typeof motivo === 'string' ? (ERRO_POR_MOTIVO[motivo] ?? 'senhaFraca') : null;
}

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
