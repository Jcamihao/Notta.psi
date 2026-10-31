import {
  CallHandler,
  ExecutionContext,
  ServiceUnavailableException,
} from '@nestjs/common';
import { lastValueFrom, Subject, throwError } from 'rxjs';
import { TETO_HASH, TetoHashInterceptor } from './teto-hash';

const interceptor = new TetoHashInterceptor();

function contexto() {
  const headers: Record<string, string> = {};
  const ctx = {
    switchToHttp: () => ({
      getResponse: () => ({
        header: (k: string, v: string) => (headers[k] = v),
      }),
    }),
  } as unknown as ExecutionContext;
  return { ctx, headers };
}

// Handler que so termina quando o teste manda (simula o bcrypt em andamento).
function pendente() {
  const fim = new Subject<string>();
  const handler: CallHandler = { handle: () => fim.asObservable() };
  return { handler, fim };
}

describe('TetoHashInterceptor', () => {
  it(`ate ${TETO_HASH} em andamento passam; o seguinte = 503 + Retry-After 1; liberou, passa de novo`, async () => {
    const emAndamento = Array.from({ length: TETO_HASH }, () => {
      const p = pendente();
      const resultado = lastValueFrom(
        interceptor.intercept(contexto().ctx, p.handler),
      );
      return { ...p, resultado };
    });

    const { ctx, headers } = contexto();
    let erro: unknown;
    try {
      interceptor.intercept(ctx, pendente().handler);
    } catch (e) {
      erro = e;
    }
    expect(erro).toBeInstanceOf(ServiceUnavailableException);
    expect((erro as ServiceUnavailableException).getResponse()).toEqual({
      statusCode: 503,
      message: 'Servico indisponivel',
    });
    expect(headers['Retry-After']).toBe('1');

    // Um termina (sucesso), outro falha: os dois liberam a vaga.
    emAndamento[0].fim.next('ok');
    emAndamento[0].fim.complete();
    await expect(emAndamento[0].resultado).resolves.toBe('ok');
    emAndamento[1].fim.error(new Error('falhou'));
    await expect(emAndamento[1].resultado).rejects.toThrow('falhou');

    const a = pendente();
    const b = pendente();
    const ra = lastValueFrom(interceptor.intercept(contexto().ctx, a.handler));
    const rb = lastValueFrom(interceptor.intercept(contexto().ctx, b.handler));
    expect(() =>
      interceptor.intercept(contexto().ctx, pendente().handler),
    ).toThrow(ServiceUnavailableException);

    for (const p of [...emAndamento.slice(2), a, b]) {
      p.fim.next('ok');
      p.fim.complete();
    }
    await Promise.all([
      ra,
      rb,
      ...emAndamento.slice(2).map((p) => p.resultado),
    ]);
  });

  it('erro sincrono do handler tambem libera a vaga', async () => {
    for (let i = 0; i < TETO_HASH + 2; i++) {
      await expect(
        lastValueFrom(
          interceptor.intercept(contexto().ctx, {
            handle: () => throwError(() => new Error('x')),
          }),
        ),
      ).rejects.toThrow('x');
    }
  });
});
