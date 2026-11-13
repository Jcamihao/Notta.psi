import { HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { dataBr } from './pacientes.page';
import {
  DocumentoResumo,
  DocumentosService,
  ROTULO_STATUS,
  ROTULO_TIPO,
  TOM_STATUS,
} from '../documentos/documentos.service';
import { Consentimento, ConsentimentoService, OrigemConsentimento } from './consentimento.service';
import {
  Convite,
  ConviteConsentimentoService,
  TOM_CONVITE,
  rotuloConvite,
} from './convite-consentimento.service';
import { Paciente, PacientesService } from './pacientes.service';

// Linha do tempo de UM paciente: so tipo, estado e datas. Nunca texto de documento (o servico nem
// pede o campo conteudo). Monta tudo no front a partir dos servicos que ja existem.
export type TipoEvento = 'CADASTRO' | 'CONSENTIMENTO' | 'TERMO' | 'DOCUMENTO';

export interface Evento {
  id: string;
  // Data do evento em ISO. Vazia ou invalida quando o dado nao traz data: o evento vai para o fim.
  quando: string;
  tipo: TipoEvento;
  titulo: string;
  detalhe?: string;
  estado?: { texto: string; tom: 'pink' | 'blue' | 'yellow' };
  ia?: boolean;
  // Commands do routerLink (so documentos tem link).
  link?: string[];
}

export interface EntradasLinhaDoTempo {
  pacienteId: string;
  paciente: Pick<Paciente, 'criadoEm'>;
  consentimento: Pick<Consentimento, 'historico'>;
  convites: Convite[];
  aprovados: DocumentoResumo[];
  rascunhos: DocumentoResumo[];
}

export interface Grupo {
  chave: string;
  rotulo: string;
  eventos: Evento[];
}

const ORIGEM: Record<OrigemConsentimento, string> = {
  PSICOLOGO: 'Registrado pelo psicólogo',
  PACIENTE: 'Aceito pelo paciente por link',
};

const MES_ANO = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' });
const ROTULO_SEM_DATA = 'Data não informada';

// Valida o instante; nulo, vazio ou malformado conta como sem data.
const instante = (iso: string): number | null => {
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
};

export const dataValida = (iso: string): boolean => instante(iso) !== null;

// Junta as leituras num unico feed. Ordem: mais recente primeiro; empate e estavel (mantem a ordem
// de entrada); data invalida ou ausente vai para o fim, na ordem de entrada.
export function montarLinhaDoTempo(entradas: EntradasLinhaDoTempo): Evento[] {
  const { pacienteId: pid } = entradas;
  const eventos: Evento[] = [
    {
      id: 'cadastro',
      quando: entradas.paciente.criadoEm,
      tipo: 'CADASTRO',
      titulo: 'Paciente cadastrado',
    },
    ...entradas.consentimento.historico.map((h): Evento => ({
      id: `consentimento-${h.seq}`,
      quando: h.em,
      tipo: 'CONSENTIMENTO',
      titulo: h.evento === 'CONCEDIDO' ? 'Consentimento concedido' : 'Consentimento revogado',
      detalhe: `${ORIGEM[h.origem]} · Termo ${h.termoVersao}`,
    })),
    ...entradas.convites.map((c): Evento => {
      const texto = rotuloConvite(c);
      return {
        id: `termo-${c.id}`,
        quando: c.criadoEm,
        tipo: 'TERMO',
        titulo: 'Termo enviado por link',
        estado: { texto, tom: TOM_CONVITE[texto] },
      };
    }),
    ...entradas.aprovados.map((d) => documentoEvento(pid, d, 'aprovado')),
    ...entradas.rascunhos.map((d) => documentoEvento(pid, d, 'rascunho')),
  ];
  return ordenar(eventos);
}

function documentoEvento(
  pid: string,
  d: DocumentoResumo,
  situacao: 'aprovado' | 'rascunho',
): Evento {
  const tipo = ROTULO_TIPO[d.tipo];
  const aprovado = situacao === 'aprovado';
  return {
    id: `${situacao}-${d.id}`,
    quando: (aprovado ? d.aprovadoEm : d.criadoEm) ?? '',
    tipo: 'DOCUMENTO',
    titulo: aprovado ? `${tipo} aprovada` : `Rascunho de ${tipo.toLowerCase()}`,
    ...(d.dataSessao && { detalhe: `Sessão de ${dataBr(d.dataSessao)}` }),
    estado: { texto: ROTULO_STATUS[d.status], tom: TOM_STATUS[d.status] },
    ia: d.geradoPorIa,
    link: ['/pacientes', pid, 'documentos', d.id],
  };
}

// Array.prototype.sort e estavel: com comparador 0 para empates, a ordem de entrada e mantida.
function ordenar(eventos: Evento[]): Evento[] {
  return eventos.sort((a, b) => {
    const ta = instante(a.quando);
    const tb = instante(b.quando);
    if (ta === null && tb === null) return 0;
    if (ta === null) return 1;
    if (tb === null) return -1;
    return tb - ta;
  });
}

// Agrupa por mes civil no fuso do navegador. A lista ja vem ordenada, entao cada grupo mantem essa
// ordem. Sem data vai para um grupo proprio no fim.
export function agruparPorMes(eventos: Evento[]): Grupo[] {
  const grupos: Grupo[] = [];
  const porChave = new Map<string, Grupo>();
  for (const ev of eventos) {
    const ms = instante(ev.quando);
    let chave: string;
    let rotulo: string;
    if (ms === null) {
      chave = 'sem-data';
      rotulo = ROTULO_SEM_DATA;
    } else {
      const d = new Date(ms);
      chave = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      rotulo = MES_ANO.format(d);
    }
    let grupo = porChave.get(chave);
    if (!grupo) {
      grupo = { chave, rotulo, eventos: [] };
      porChave.set(chave, grupo);
      grupos.push(grupo);
    }
    grupo.eventos.push(ev);
  }
  return grupos;
}

// Paciente que nao existe mais (excluido) ou e de outro psicologo: a tela volta para a lista.
export class PacienteNaoEncontrado extends Error {
  constructor() {
    super('paciente não encontrado');
  }
}

export interface LinhaDoTempo {
  nome: string;
  eventos: Evento[];
}

// Cinco leituras em SEQUENCIA (limite de 5 requisicoes simultaneas, HANDOFF secao 8): cada uma so
// sai quando a anterior terminou. Sem cache: cada visita le de novo.
@Injectable({ providedIn: 'root' })
export class LinhaDoTempoService {
  private readonly pacientes = inject(PacientesService);
  private readonly consentimento = inject(ConsentimentoService);
  private readonly convites = inject(ConviteConsentimentoService);
  private readonly documentos = inject(DocumentosService);

  async carregar(pacienteId: string): Promise<LinhaDoTempo> {
    const paciente = await firstValueFrom(this.pacientes.obter(pacienteId)).catch((e: unknown) => {
      if (e instanceof HttpErrorResponse && e.status === 404) throw new PacienteNaoEncontrado();
      throw e;
    });
    const consentimento = await firstValueFrom(this.consentimento.obter(pacienteId));
    const convites = await firstValueFrom(this.convites.listar(pacienteId));
    const aprovados = await firstValueFrom(this.documentos.listar(pacienteId, 'APROVADO'));
    const rascunhos = await firstValueFrom(this.documentos.listar(pacienteId, 'RASCUNHO'));
    return {
      nome: paciente.nome,
      eventos: montarLinhaDoTempo({
        pacienteId,
        paciente,
        consentimento,
        convites,
        aprovados,
        rascunhos,
      }),
    };
  }
}
