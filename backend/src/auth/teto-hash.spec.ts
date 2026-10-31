import {
  CallHandler,
  ExecutionContext,
  ServiceUnavailableException,
} from '@nestjs/common';
import { lastValueFrom, Subject, throwError } from 'rxjs';
import { TETO_HASH, TETO_HASH_POR_IP, TetoHashInterceptor } from './teto-hash';

const interceptor = new TetoHashInterceptor();

// Sem `ip`, cada contexto vem de um IPv4 novo (o teto global nao depende do teto por IP).
let proximo = 0;
function contexto(ip: string = `10.0.${proximo >> 8}.${proximo++ & 255}`) {
  const headers: Record<string, string> = {};
  const ctx = {
    switchToHttp: () => ({
      getRequest: () => ({ ip }),
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

  describe('M-3: teto por IP (/64 no IPv6)', () => {
    // Abre uma rota com hash em andamento; devolve como terminar.
    function abrir(ip: string) {
      const p = pendente();
      const resultado = lastValueFrom(
        interceptor.intercept(contexto(ip).ctx, p.handler),
      );
      return {
        resultado,
        fim: () => {
          p.fim.next('ok');
          p.fim.complete();
          return resultado;
        },
      };
    }
    const recusa = (ip: string) => {
      const { ctx, headers } = contexto(ip);
      let erro: unknown;
      try {
        interceptor.intercept(ctx, pendente().handler);
      } catch (e) {
        erro = e;
      }
      return { erro, headers };
    };

    it(`um IP segura no maximo ${TETO_HASH_POR_IP} vagas; a proxima = 503 + Retry-After 1; outro IP passa; liberou, volta`, async () => {
      const presas = Array.from({ length: TETO_HASH_POR_IP }, () =>
        abrir('203.0.113.7'),
      );
      const { erro, headers } = recusa('203.0.113.7');
      expect(erro).toBeInstanceOf(ServiceUnavailableException);
      expect(headers['Retry-After']).toBe('1');
      // Outro IP continua logando durante a rajada.
      const outro = abrir('203.0.113.8');
      await outro.fim();
      await presas[0].fim();
      const depois = abrir('203.0.113.7');
      expect(recusa('203.0.113.7').erro).toBeInstanceOf(
        ServiceUnavailableException,
      );
      await Promise.all([depois.fim(), presas[1].fim()]);
      await abrir('203.0.113.7').fim();
    });

    it('IPv6: o /64 inteiro divide o teto (IPs diferentes do mesmo /64 contam juntos)', async () => {
      const a = abrir('2001:db8:1:2::1');
      const b = abrir('2001:db8:1:2:ffff:ffff:ffff:ffff');
      expect(recusa('2001:db8:1:2:abcd::9').erro).toBeInstanceOf(
        ServiceUnavailableException,
      );
      // /64 vizinho e outro tracker.
      await abrir('2001:db8:1:3::1').fim();
      await Promise.all([a.fim(), b.fim()]);
    });

    it(`um unico /64 nao consegue manter as ${TETO_HASH} vagas do teto global`, async () => {
      const abertas: ReturnType<typeof abrir>[] = [];
      let recusadas = 0;
      for (let i = 0; i < 4 * TETO_HASH; i++) {
        // IPv6 diferente a cada requisicao, todos dentro do MESMO /64
        try {
          abertas.push(abrir(`2001:db8:aa:bb:${i.toString(16)}::1`));
        } catch {
          recusadas++;
        }
      }
      expect(abertas.length).toBe(TETO_HASH_POR_IP);
      expect(recusadas).toBe(4 * TETO_HASH - TETO_HASH_POR_IP);
      // Sobra vaga global para quem vem de outro IP.
      await abrir('198.51.100.1').fim();
      await Promise.all(abertas.map((x) => x.fim()));
    });

    it('erro do handler libera a vaga do IP', async () => {
      for (let i = 0; i < TETO_HASH_POR_IP + 3; i++) {
        await expect(
          lastValueFrom(
            interceptor.intercept(contexto('192.0.2.9').ctx, {
              handle: () => throwError(() => new Error('x')),
            }),
          ),
        ).rejects.toThrow('x');
      }
    });
  });
});
