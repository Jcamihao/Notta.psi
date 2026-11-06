// Gera UMA chave mestra nova (32 bytes em hex = 64 caracteres) e imprime so ela.
// Equivale a `openssl rand -hex 32`. Uso: npm run chave:gerar
// Nunca logar a saida nem copiar para o repo: ela vai direto para o cofre.
import { randomBytes } from 'node:crypto';

process.stdout.write(`${randomBytes(32).toString('hex')}\n`);
