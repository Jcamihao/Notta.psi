import { JwtModuleOptions } from '@nestjs/jwt';

// Valores que ja foram publicados no repo (.env.example antigo): nunca valem.
const PUBLICADOS = ['troque-isto-por-um-segredo-longo-e-aleatorio-fake'];

// HS256 fixado na assinatura E na verificacao (sem `algorithms`, o jsonwebtoken aceitaria
// HS384/HS512 com o mesmo segredo). Validado no boot: falha fechada, sem ecoar o valor.
export function opcoesJwt(
  env: NodeJS.ProcessEnv = process.env,
): JwtModuleOptions {
  const segredo = env.NOTTA_JWT_SECRET;
  // Baixa entropia: menos de 10 caracteres distintos (pega tambem "todos iguais").
  if (
    !segredo ||
    segredo.length < 32 ||
    new Set(segredo).size < 10 ||
    PUBLICADOS.includes(segredo)
  ) {
    throw new Error(
      'NOTTA_JWT_SECRET obrigatoria: minimo 32 caracteres aleatorios, nunca o valor de exemplo (gere com: openssl rand -base64 48)',
    );
  }
  return {
    secret: segredo,
    signOptions: { algorithm: 'HS256', expiresIn: '8h' },
    verifyOptions: { algorithms: ['HS256'] },
  };
}
