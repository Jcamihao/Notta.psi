export const CONVITE_CONFIG = Symbol('CONVITE_CONFIG');

export interface ConviteConfig {
  // Base do link enviado ao paciente (sem barra no fim): `{appUrl}/termo/{token}`.
  appUrl: string;
}

const HOSTS_LOCAIS = ['localhost', '127.0.0.1'];
const APP_URL_DEV = 'http://localhost:4200'; // ng serve

// Item 22. Falha fechada no boot, sem repetir URL (pode ter senha embutida).
// 1) Fora de development/test (NODE_ENV aparado, sem caixa; ausente ou "production" contam como
//    producao, como em PRAXIS_TRUST_PROXY): PRAXIS_TERMO_REVISADO tem de ser exatamente "1". So o
//    dono liga, depois da revisao juridica do texto do termo (termo-consentimento.ts).
// 2) PRAXIS_APP_URL (a mesma validacao da SELAHIA_URL): https fora de development/test, sem
//    usuario/senha, sem query nem fragmento. Ausente: obrigatoria em producao; em dev/test vale
//    http://localhost:4200.
export function lerConfigConvite(
  env: NodeJS.ProcessEnv = process.env,
): ConviteConfig {
  const dev = ['development', 'test'].includes(
    (env.NODE_ENV ?? '').trim().toLowerCase(),
  );
  if (!dev && env.PRAXIS_TERMO_REVISADO !== '1') {
    throw new Error(
      'PRAXIS_TERMO_REVISADO=1 obrigatoria fora de development/test: o texto do termo de consentimento precisa de revisao juridica do dono antes de uso real',
    );
  }

  const bruto = (env.PRAXIS_APP_URL ?? '').trim();
  if (bruto === '' && dev) return { appUrl: APP_URL_DEV };

  let url: URL;
  try {
    url = new URL(bruto);
  } catch {
    throw new Error('PRAXIS_APP_URL ausente ou invalida (use https://...)');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('PRAXIS_APP_URL invalida: use https://...');
  }
  if (url.username !== '' || url.password !== '') {
    throw new Error('PRAXIS_APP_URL nao pode ter usuario nem senha embutidos');
  }
  if (url.search !== '' || url.hash !== '') {
    throw new Error('PRAXIS_APP_URL nao pode ter query nem fragmento');
  }
  if (
    url.protocol === 'http:' &&
    !(dev && HOSTS_LOCAIS.includes(url.hostname))
  ) {
    throw new Error(
      'PRAXIS_APP_URL precisa ser https (http so em development/test e so para localhost ou 127.0.0.1)',
    );
  }
  return { appUrl: url.origin + url.pathname.replace(/\/+$/, '') };
}
