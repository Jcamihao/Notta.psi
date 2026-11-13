import { Inject, Injectable, Logger } from '@nestjs/common';
import { validarTamanho } from './anonimizador';
import { IA_CONFIG, type IaConfig } from './ia.config';

export type TipoDocumentoIa = 'evolucao' | 'anamnese';
export type AbordagemIa =
  'SISTEMICA' | 'TCC' | 'PSICANALISE' | 'ACT' | 'HUMANISTA' | 'OUTRA';

// Lista fechada: nenhum texto vindo do corpo da resposta vira motivo.
export type MotivoIa =
  | 'DESABILITADA'
  | 'TIMEOUT'
  | 'REDE'
  | 'LIMITE'
  | 'ERRO_DA_IA'
  | 'RESPOSTA_INVALIDA'
  | 'CHAVE_INVALIDA'
  | 'PEDIDO_INVALIDO'
  | 'CONFIG';

export class IaDesabilitadaError extends Error {
  readonly motivo = 'DESABILITADA' as const;
  constructor() {
    super('IA desabilitada (PRAXIS_IA_HABILITADA)');
    this.name = 'IaDesabilitadaError';
  }
}

// Vale tentar de novo (rede, timeout, 429, 5xx, resposta invalida).
export class IaIndisponivelError extends Error {
  readonly retentavel = true as const;
  constructor(
    readonly motivo: MotivoIa,
    readonly status?: number,
  ) {
    super(`IA indisponivel (${motivo})`);
    this.name = 'IaIndisponivelError';
  }
}

// Tentar de novo nao ajuda (bug nosso ou chave errada).
export class IaRecusadaError extends Error {
  readonly retentavel = false as const;
  constructor(
    readonly motivo: MotivoIa,
    readonly status?: number,
  ) {
    super(`IA recusou o pedido (${motivo})`);
    this.name = 'IaRecusadaError';
  }
}

export interface PedidoRascunho {
  tipoDocumento: TipoDocumentoIa;
  abordagem: AbordagemIa;
  textoAnonimizado: string;
}

export interface RascunhoIa {
  rascunho: string;
  model: string;
  provider: string;
}

const CAMINHO = '/v1/adapters/psicologia/rascunho/gerar';
// 20000 caracteres de rascunho cabem folgados; acima disso a resposta e lixo.
const MAX_CORPO_BYTES = 1024 * 1024;

function erroDeStatus(status: number): IaIndisponivelError | IaRecusadaError {
  if (status === 429) return new IaIndisponivelError('LIMITE', status);
  if (status === 408) return new IaIndisponivelError('TIMEOUT', status);
  if (status === 502)
    return new IaIndisponivelError('RESPOSTA_INVALIDA', status);
  if (status >= 500) return new IaIndisponivelError('ERRO_DA_IA', status);
  if (status === 400 || status === 422) {
    return new IaRecusadaError('PEDIDO_INVALIDO', status);
  }
  if (status === 401 || status === 403) {
    return new IaRecusadaError('CHAVE_INVALIDA', status);
  }
  // Outro 4xx (ex.: 404) e URL/rota errada: config nossa.
  return new IaRecusadaError('CONFIG', status);
}

// Sem instanceof: o erro do fetch pode vir de outro realm (jest, undici).
const eTimeout = (e: unknown) =>
  ['TimeoutError', 'AbortError'].includes(
    (e as { name?: string } | null)?.name ?? '',
  );

async function lerCorpo(res: Response): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return '';
  const partes: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > MAX_CORPO_BYTES) {
      await reader.cancel();
      throw new IaIndisponivelError('RESPOSTA_INVALIDA', res.status);
    }
    partes.push(value);
  }
  return Buffer.concat(partes).toString('utf8');
}

function lerRascunho(corpo: string, status: number): RascunhoIa {
  let json: unknown;
  try {
    json = JSON.parse(corpo);
  } catch {
    throw new IaIndisponivelError('RESPOSTA_INVALIDA', status);
  }
  const o = json as Record<string, unknown> | null;
  if (
    typeof o !== 'object' ||
    o === null ||
    typeof o.rascunho !== 'string' ||
    o.rascunho.trim() === ''
  ) {
    throw new IaIndisponivelError('RESPOSTA_INVALIDA', status);
  }
  return {
    rascunho: o.rascunho,
    model: typeof o.model === 'string' ? o.model : '',
    provider: typeof o.provider === 'string' ? o.provider : '',
  };
}

@Injectable()
export class SelahIaClient {
  private readonly logger = new Logger(SelahIaClient.name);

  constructor(@Inject(IA_CONFIG) private readonly config: IaConfig) {}

  // Sem retry aqui: a retentativa e do usuario (item 21). NUNCA loga nota, texto
  // anonimizado, resposta nem chave: so status, motivo, latencia e inputChars.
  async gerarRascunho(pedido: PedidoRascunho): Promise<RascunhoIa> {
    if (!this.config.habilitada) throw new IaDesabilitadaError();
    validarTamanho(pedido.textoAnonimizado);
    const inputChars = pedido.textoAnonimizado.length;
    const ini = Date.now();
    const falhou = (erro: IaIndisponivelError | IaRecusadaError) => {
      this.logger.warn(
        `selahia falhou motivo=${erro.motivo} status=${erro.status ?? '-'} ms=${Date.now() - ini} inputChars=${inputChars}`,
      );
      return erro;
    };

    let res: Response;
    try {
      res = await fetch(this.config.url + CAMINHO, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-selah-api-key': this.config.apiKey,
          'x-source-app': 'NottaPsiBack',
        },
        body: JSON.stringify({
          tipoDocumento: pedido.tipoDocumento,
          abordagem: pedido.abordagem,
          textoAnonimizado: pedido.textoAnonimizado,
        }),
        // Redirecionar mandaria a chave para outro host.
        redirect: 'error',
        signal: AbortSignal.timeout(this.config.timeoutMs),
      });
    } catch (e) {
      throw falhou(new IaIndisponivelError(eTimeout(e) ? 'TIMEOUT' : 'REDE'));
    }

    if (!res.ok) {
      await res.body?.cancel().catch(() => undefined);
      throw falhou(erroDeStatus(res.status));
    }

    try {
      const rascunho = lerRascunho(await lerCorpo(res), res.status);
      this.logger.log(
        `selahia ok status=${res.status} ms=${Date.now() - ini} inputChars=${inputChars}`,
      );
      return rascunho;
    } catch (e) {
      if (e instanceof IaIndisponivelError) throw falhou(e);
      throw falhou(new IaIndisponivelError(eTimeout(e) ? 'TIMEOUT' : 'REDE'));
    }
  }
}
