import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { dataHoraBr } from '../core/datas';
import { mensagemHttp } from '../core/formulario';

// Corpo das respostas da IA (contrato.md, Onda B). Nenhuma delas traz o texto clinico, exceto
// a previa (texto ja anonimizado) e a geracao so devolve ids e estado.
export type TipoGerado = 'EVOLUCAO' | 'ANAMNESE';
export type EstadoGeracao = 'PREVIA' | 'PENDENTE' | 'PRONTO' | 'FALHOU';
export type AvisoSaida = 'DADO_NOVO' | 'CODIGO_DESCONHECIDO';

export interface UsoIa {
  habilitada: boolean;
  limite: number;
  usadas: number;
  renovaEm: string;
}

export interface Previa {
  id: string;
  estado: 'PREVIA';
  tipoDocumento: TipoGerado;
  textoAnonimizado: string;
  expiraEm: string;
}

export interface Geracao {
  id: string;
  estado: EstadoGeracao;
  tipoDocumento: TipoGerado;
  origemId: string;
  documentoId: string | null;
  motivo: string | null;
  retentavel: boolean | null;
  avisos: AvisoSaida[];
  criadoEm: string;
  finalizadoEm: string | null;
}

export const LIMITE_TERMOS = 20;
export const TAMANHO_TERMO = 60;

export const AVISO_PREVIA =
  'Este é o texto exato que vai sair do sistema. Revise: nomes de terceiros e detalhes que identificam podem não ter sido reconhecidos.';

export const AVISOS_SAIDA: Record<AvisoSaida, string> = {
  DADO_NOVO:
    'A IA escreveu um CPF, telefone ou e-mail que não estava na sua nota. Confira e apague se não fizer sentido.',
  CODIGO_DESCONHECIDO:
    'O texto tem um código entre colchetes que o sistema não conseguiu trocar pelo dado original. Confira e corrija.',
};

// Motivo de falha (lista fechada do back) em linguagem simples. Motivo novo cai no texto padrao.
const MOTIVOS: Record<string, string> = {
  TIMEOUT: 'A IA demorou demais para responder.',
  REDE: 'Não foi possível falar com a IA agora. Confira a conexão.',
  LIMITE: 'A IA está com muitos pedidos neste momento.',
  ERRO_DA_IA: 'A IA falhou ao montar o texto.',
  RESPOSTA_INVALIDA: 'A IA devolveu uma resposta que o sistema não conseguiu usar.',
  SAIDA_INVALIDA: 'O texto gerado veio vazio ou grande demais.',
  TEMPO_ESGOTADO: 'O pedido demorou mais do que o esperado e foi interrompido.',
  ERRO_INTERNO: 'Aconteceu um erro interno ao gerar o texto.',
  DESABILITADA: 'A IA está desligada neste ambiente.',
};
export const mensagemMotivo = (motivo: string | null): string =>
  (motivo && MOTIVOS[motivo]) || 'Não foi possível gerar o rascunho.';

// Tom e texto do estado do pedido (pill sempre com texto: cor nunca e a unica pista).
export const ROTULO_GERACAO: Record<EstadoGeracao, string> = {
  PREVIA: 'Prévia',
  PENDENTE: 'Gerando',
  PRONTO: 'Pronto',
  FALHOU: 'Falhou',
};
export const TOM_GERACAO: Record<EstadoGeracao, 'pink' | 'blue' | 'yellow'> = {
  PREVIA: 'yellow',
  PENDENTE: 'yellow',
  PRONTO: 'blue',
  FALHOU: 'pink',
};

// O que um erro de "confirmar" significa para a tela (1o envio e retentativa tratam igual).
export type ErroConfirmar =
  | { tipo: 'expirada' }
  | { tipo: 'andamento' }
  | { tipo: 'sumiu' }
  | { tipo: 'texto'; texto: string };

export function classificarErroConfirmar(e: HttpErrorResponse): ErroConfirmar {
  const corpo = e.error as { message?: unknown; renovaEm?: unknown } | null;
  const msg = typeof corpo?.message === 'string' ? corpo.message : '';
  if (e.status === 404) return { tipo: 'sumiu' };
  if (e.status === 409 && msg === 'Previa expirada, gere outra') return { tipo: 'expirada' };
  if (e.status === 409) {
    return {
      tipo: 'texto',
      texto:
        'A IA não está configurada direito neste ambiente. Avise o suporte; a sua nota continua salva.',
    };
  }
  if (e.status === 503) return { tipo: 'texto', texto: 'A IA está desligada neste ambiente.' };
  if (e.status === 429 && typeof corpo?.renovaEm === 'string') {
    return {
      tipo: 'texto',
      texto: `Limite diário de gerações atingido; renova em ${dataHoraBr(corpo.renovaEm)}.`,
    };
  }
  if (e.status === 429 && msg === 'Ja ha uma geracao em andamento') return { tipo: 'andamento' };
  return { tipo: 'texto', texto: mensagemHttp(e) };
}

export const TEXTO_ANDAMENTO_OUTRO =
  'Já há uma geração em andamento em outra nota. Espere ela terminar e tente de novo.';

@Injectable({ providedIn: 'root' })
export class IaService {
  private readonly http = inject(HttpClient);

  uso() {
    return this.http.get<UsoIa>('/api/ia/uso');
  }

  previa(pacienteId: string, origemId: string, tipoDocumento: TipoGerado, termosExtras: string[]) {
    return this.http.post<Previa>(
      `/api/pacientes/${pacienteId}/documentos/${origemId}/previa-ia`,
      termosExtras.length ? { tipoDocumento, termosExtras } : { tipoDocumento },
    );
  }

  // 202 (PENDENTE) ou 200 (PRONTO, corpo da consulta). O cliente nunca reenvia texto.
  confirmar(id: string) {
    return this.http.post<{ id: string; estado: EstadoGeracao }>(
      `/api/geracoes-ia/${id}/confirmar`,
      null,
    );
  }

  consultar(id: string) {
    return this.http.get<Geracao>(`/api/geracoes-ia/${id}`);
  }

  listar(pacienteId: string) {
    return this.http.get<Geracao[]>(`/api/pacientes/${pacienteId}/geracoes-ia`);
  }
}
