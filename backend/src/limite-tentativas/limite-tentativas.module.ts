import { Module } from '@nestjs/common';
import { normalizeIp, ThrottlerModule } from '@nestjs/throttler';
import { normalizarEmail } from '../comum/validacao';

const MINUTO = 60_000;
// IPv6: um cliente costuma ter o /64 inteiro (IPs ilimitados). Todo limite por IP agrupa o
// /64 (o tracker padrao do throttler usa ipv6SubnetPrefix; o login-chave, normalizeIp).
// IPv4 nao muda.
const PREFIXO_IPV6 = 64;

// Armazenamento EM MEMORIA (padrao do throttler): vale para 1 instancia do backend.
// Com mais de uma instancia, trocar por storage Redis. IP real atras de proxy: NOTTA_TRUST_PROXY.
// Os throttlers sao ligados por rota (LimiteLogin / LimiteCadastroClinica / LimiteEquipe /
// LimiteTrocarSenha), nao globais.
// Excecao: `api`, aplicado pelo LimiteApiGuard GLOBAL a toda rota autenticada (as rotas com
// limite proprio o pulam no guard de rota, entao ele nunca conta 2x).
export const THROTTLERS = [
  { name: 'login-ip', ttl: MINUTO, limit: 20 },
  {
    name: 'login-chave',
    ttl: MINUTO,
    limit: 5,
    // Corpo CRU (o guard roda antes do ValidationPipe): normaliza aqui tambem.
    getTracker: (req: Record<string, any>) =>
      `${normalizeIp(req.ip as string, PREFIXO_IPV6)}|${normalizarEmail((req.body as { email?: unknown } | undefined)?.email)}`,
  },
  { name: 'clinicas', ttl: 60 * MINUTO, limit: 5 },
  {
    name: 'equipe',
    ttl: 60 * MINUTO,
    limit: 20,
    // Chave = psicologo do token (nao IP). Sem `?.` de proposito: rota publica que
    // nao pulada no SkipThrottle quebra alto (500) em vez de dividir
    // um contador unico entre todo mundo.
    getTracker: (req: Record<string, any>) =>
      (req.user as { psicologoId: string }).psicologoId,
  },
  // Troca da propria senha (bcrypt compare + hash): por psicologo do token, como `equipe`.
  {
    name: 'trocar-senha',
    ttl: 60 * MINUTO,
    limit: 10,
    getTracker: (req: Record<string, any>) =>
      (req.user as { psicologoId: string }).psicologoId,
  },
  // Uso normal da API por psicologo (somado entre TODAS as rotas autenticadas).
  { name: 'api', ttl: MINUTO, limit: 300 },
];

@Module({
  imports: [
    ThrottlerModule.forRoot({
      throttlers: THROTTLERS,
      setHeaders: false,
      ipv6SubnetPrefix: PREFIXO_IPV6,
    }),
  ],
})
export class LimiteTentativasModule {}
