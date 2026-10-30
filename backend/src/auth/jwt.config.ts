import { JwtModuleOptions } from '@nestjs/jwt';

// HS256 fixado na assinatura E na verificacao (sem `algorithms`, o jsonwebtoken aceitaria
// HS384/HS512 com o mesmo segredo). Validado no boot: falha fechada, sem ecoar o valor.
export function opcoesJwt(
  env: NodeJS.ProcessEnv = process.env,
): JwtModuleOptions {
  const segredo = env.NOTTA_JWT_SECRET;
  if (!segredo || segredo.length < 32) {
    throw new Error(
      'NOTTA_JWT_SECRET obrigatoria: minimo 32 caracteres (gere com: openssl rand -base64 48)',
    );
  }
  return {
    secret: segredo,
    signOptions: { algorithm: 'HS256', expiresIn: '8h' },
    verifyOptions: { algorithms: ['HS256'] },
  };
}
