import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { normalizarEmail } from '../comum/validacao';

const MINUTO = 60_000;

// Armazenamento EM MEMORIA (padrao do throttler): vale para 1 instancia do backend.
// Com mais de uma instancia, trocar por storage Redis. IP real atras de proxy: NOTTA_TRUST_PROXY.
// Os throttlers sao ligados por rota (LimiteLogin / LimiteCadastroClinica / LimiteEquipe), nao globais.
@Module({
  imports: [
    ThrottlerModule.forRoot({
      throttlers: [
        { name: 'login-ip', ttl: MINUTO, limit: 20 },
        {
          name: 'login-chave',
          ttl: MINUTO,
          limit: 5,
          // Corpo CRU (o guard roda antes do ValidationPipe): normaliza aqui tambem.
          getTracker: (req: Record<string, any>) =>
            `${req.ip}|${normalizarEmail((req.body as { email?: unknown } | undefined)?.email)}`,
        },
        { name: 'clinicas', ttl: 60 * MINUTO, limit: 5 },
        {
          name: 'equipe',
          ttl: 60 * MINUTO,
          limit: 20,
          // Chave = psicologo do token (nao IP). Sem `?.` de proposito: rota publica que
          // esqueceu `equipe: true` no SkipThrottle quebra alto (500) em vez de dividir
          // um contador unico entre todo mundo.
          getTracker: (req: Record<string, any>) =>
            (req.user as { psicologoId: string }).psicologoId,
        },
      ],
      setHeaders: false,
    }),
  ],
})
export class LimiteTentativasModule {}
