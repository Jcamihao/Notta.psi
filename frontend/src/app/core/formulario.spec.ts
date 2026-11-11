import { HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { mensagemHttp } from './formulario';

const erro = (status: number, headers?: Record<string, string>, body: unknown = null) =>
  new HttpErrorResponse({
    status,
    error: body,
    headers: new HttpHeaders(headers ?? {}),
  });

const DEMANDA = 'Estamos com muita demanda agora. Tente de novo em instantes.';
const GENERICA = 'Não foi possível concluir agora. Confira sua conexão e tente de novo.';

describe('mensagemHttp', () => {
  describe('503 (teto de logins simultaneos ou banco ocupado)', () => {
    it('sem Retry-After: mensagem de demanda, sem contagem', () => {
      expect(mensagemHttp(erro(503))).toBe(DEMANDA);
    });

    it('com Retry-After inteiro > 0: mostra os segundos', () => {
      expect(mensagemHttp(erro(503, { 'Retry-After': '5' }))).toBe(
        'Estamos com muita demanda agora. Tente de novo em 5 segundos.',
      );
    });

    it('Retry-After = 1: singular "1 segundo"', () => {
      expect(mensagemHttp(erro(503, { 'Retry-After': '1' }))).toBe(
        'Estamos com muita demanda agora. Tente de novo em 1 segundo.',
      );
    });

    it('Retry-After invalido (0, negativo, nao numerico, fracionario, vazio): sem contagem', () => {
      for (const valor of ['0', '-3', 'abc', '1.5', '']) {
        expect(mensagemHttp(erro(503, { 'Retry-After': valor })))
          .withContext(`Retry-After=${JSON.stringify(valor)}`)
          .toBe(DEMANDA);
      }
    });

    it('Retry-After em data HTTP (nao numerico): sem contagem', () => {
      expect(mensagemHttp(erro(503, { 'Retry-After': 'Wed, 21 Oct 2026 07:28:00 GMT' }))).toBe(
        DEMANDA,
      );
    });

    it('nao le o corpo do erro', () => {
      expect(
        mensagemHttp(erro(503, {}, { statusCode: 503, message: 'Servico indisponivel' })),
      ).toBe(DEMANDA);
    });
  });

  describe('400 e 429 continuam iguais', () => {
    it('400: campos invalidos', () => {
      expect(mensagemHttp(erro(400))).toBe(
        'Alguns campos estão inválidos. Revise e tente de novo.',
      );
    });

    it('429 com Retry-After: segundos', () => {
      expect(mensagemHttp(erro(429, { 'Retry-After': '42' }))).toBe(
        'Muitas tentativas. Tente de novo em 42 segundos.',
      );
    });

    it('429 com Retry-After = 1: singular', () => {
      expect(mensagemHttp(erro(429, { 'Retry-After': '1' }))).toBe(
        'Muitas tentativas. Tente de novo em 1 segundo.',
      );
    });

    it('429 sem Retry-After: aguarde um pouco', () => {
      expect(mensagemHttp(erro(429))).toBe('Muitas tentativas. Aguarde um pouco e tente de novo.');
    });
  });

  describe('demais erros', () => {
    it('500 e rede (status 0): mensagem generica', () => {
      expect(mensagemHttp(erro(500))).toBe(GENERICA);
      expect(mensagemHttp(erro(0))).toBe(GENERICA);
    });
  });
});
