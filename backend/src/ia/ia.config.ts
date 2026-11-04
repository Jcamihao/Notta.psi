import {
  normalizarSegredo,
  SEGREDOS_CONHECIDOS,
} from '../comum/segredos-conhecidos';

// Maior que os 45 s que o SelahIA espera o Gemini.
export const TIMEOUT_SELAHIA_MS = 50_000;

export const IA_CONFIG = Symbol('IA_CONFIG');

export interface IaConfig {
  habilitada: boolean;
  url: string;
  apiKey: string;
  timeoutMs: number;
}

const HOSTS_LOCAIS = ['localhost', '127.0.0.1'];

// Item 42. Falha fechada no boot, sem repetir chave nem URL (pode ter senha embutida).
// So o valor exato "1" liga a IA: "true", "sim" ou espaco sobrando ficam DESLIGADOS (lado seguro).
export function lerConfigIa(env: NodeJS.ProcessEnv = process.env): IaConfig {
  const desligada: IaConfig = {
    habilitada: false,
    url: '',
    apiKey: '',
    timeoutMs: TIMEOUT_SELAHIA_MS,
  };
  if (env.NOTTA_IA_HABILITADA !== '1') return desligada;

  let url: URL;
  try {
    url = new URL((env.SELAHIA_URL ?? '').trim());
  } catch {
    throw new Error('SELAHIA_URL ausente ou invalida (use https://...)');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('SELAHIA_URL invalida: use https://...');
  }
  if (url.username !== '' || url.password !== '') {
    throw new Error('SELAHIA_URL nao pode ter usuario nem senha embutidos');
  }
  if (url.protocol === 'http:') {
    const dev = ['development', 'test'].includes(
      (env.NODE_ENV ?? '').trim().toLowerCase(),
    );
    if (!dev || !HOSTS_LOCAIS.includes(url.hostname)) {
      throw new Error(
        'SELAHIA_URL precisa ser https (http so em development/test e so para localhost ou 127.0.0.1)',
      );
    }
  }

  const apiKey = (env.SELAHIA_API_KEY ?? '').trim();
  if (
    apiKey === '' ||
    SEGREDOS_CONHECIDOS.selahiaExemplos.some(
      (k) => k === normalizarSegredo(apiKey),
    )
  ) {
    throw new Error(
      'SELAHIA_API_KEY obrigatoria quando a IA esta habilitada (a chave do app NottaPsiBack, nunca um valor de exemplo)',
    );
  }

  return {
    habilitada: true,
    url: url.origin + url.pathname.replace(/\/+$/, ''),
    apiKey,
    timeoutMs: TIMEOUT_SELAHIA_MS,
  };
}
