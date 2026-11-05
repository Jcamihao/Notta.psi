import type { JwtService } from '@nestjs/jwt';

// Cabecalhos de um cliente que NAO e navegador (testes, scripts): `x-notta-cliente: api` faz o login
// devolver o JWT de acesso no corpo (`token`) para `Authorization: Bearer`; `Origin` e a origem
// aceita pelo CSRF do login (padrao de dev/test = NOTTA_APP_URL ausente = http://localhost:4200).
export const ORIGEM_APP = 'http://localhost:4200';
export const CLIENTE_API = {
  'x-notta-cliente': 'api',
  Origin: ORIGEM_APP,
};

// JWT novo (mesmos claims, inclusive `sid`) assinado AGORA, para testes que adiantam Date.now acima
// dos 15 minutos do acesso. A sessao no banco continua a mesma.
export async function reassinar(jwt: JwtService, token: string) {
  const { sub, clinicaId, tv, sid } = jwt.decode<{
    sub: string;
    clinicaId: string;
    tv: number;
    sid: string;
  }>(token);
  return jwt.signAsync({ sub, clinicaId, tv, sid });
}
