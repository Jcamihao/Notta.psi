import { createSecretKey } from 'node:crypto';
import { JwtModuleOptions } from '@nestjs/jwt';
import {
  contemConhecido,
  permiteSegredoDeTeste,
  SEGREDOS_CONHECIDOS,
} from '../comum/segredos-conhecidos';

// Acesso de 15 minutos (item 46); a sessao se renova pelo refresh (cookie), ate 7 dias.
export const ACESSO_SEGUNDOS = 15 * 60;

// HS256 fixado na assinatura E na verificacao (sem `algorithms`, o jsonwebtoken aceitaria
// HS384/HS512 com o mesmo segredo). Validado no boot: falha fechada, sem ecoar o valor.
export function opcoesJwt(
  env: NodeJS.ProcessEnv = process.env,
): JwtModuleOptions {
  const segredo = env.PRAXIS_JWT_SECRET;
  const deTeste =
    !!segredo &&
    permiteSegredoDeTeste(env) &&
    contemConhecido(segredo, SEGREDOS_CONHECIDOS.jwtDeTeste);
  // Fraco: curto, menos de 16 caracteres distintos (pega tambem "todos iguais") ou valor
  // conhecido (aparado, sem caixa, com prefixo/sufixo).
  if (
    !segredo ||
    (!deTeste &&
      (segredo.trim().length < 32 ||
        new Set(segredo.trim()).size < 16 ||
        contemConhecido(segredo, SEGREDOS_CONHECIDOS.jwtPublicados) ||
        contemConhecido(segredo, SEGREDOS_CONHECIDOS.jwtDeTeste)))
  ) {
    throw new Error(
      'PRAXIS_JWT_SECRET obrigatoria: minimo 32 caracteres aleatorios (16+ distintos), nunca um valor de exemplo ou de teste (gere com: openssl rand -base64 48)',
    );
  }
  return {
    // KeyObject: o jsonwebtoken pula o createPublicKey que tentaria (e falharia, caro) a cada
    // verify com string; sob rajada isso era ~20% da CPU do processo.
    secret: createSecretKey(Buffer.from(segredo)),
    signOptions: { algorithm: 'HS256', expiresIn: ACESSO_SEGUNDOS },
    verifyOptions: { algorithms: ['HS256'] },
  };
}
