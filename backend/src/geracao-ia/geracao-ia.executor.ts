import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import type { UsuarioAutenticado } from '../auth/jwt-auth.guard';
import { CriptografiaService } from '../criptografia/criptografia.service';
import { DocumentosService } from '../documentos/documentos.service';
import { type ItemMapa, reidentificar } from '../ia/anonimizador';
import {
  sanearSaida,
  SaidaIaInvalidaError,
  validarTamanhoSaida,
} from '../ia/saida-ia';
import {
  type AbordagemIa,
  IaDesabilitadaError,
  IaIndisponivelError,
  IaRecusadaError,
  SelahIaClient,
} from '../ia/selahia.client';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { aadGeracao, SO_PACIENTE_VIVO } from './geracao-ia.tipos';

type Dono = Pick<UsuarioAutenticado, 'clinicaId' | 'psicologoId'>;
type Falha = { motivo: string; retentavel: boolean };

// Executor em processo (sem fila externa): roda DEPOIS do commit que marcou o pedido PENDENTE.
// Se o servidor cair no meio, o pedido fica PENDENTE e a consulta o vira FALHOU (TEMPO_ESGOTADO).
// Regra do projeto: a chamada de rede ao SelahIA fica FORA de qualquer transacao. Nada de texto
// clinico em log, motivo, aviso ou auditoria: so ids, motivo da lista fechada e nomes de erro.
@Injectable()
export class GeracaoIaExecutor {
  private readonly logger = new Logger(GeracaoIaExecutor.name);

  constructor(
    private readonly tenant: TenantPrismaService,
    private readonly cripto: CriptografiaService,
    private readonly documentos: DocumentosService,
    private readonly selahia: SelahIaClient,
  ) {}

  // Nunca rejeita (e chamado com `void`): todo erro vira FALHOU ou, no pior caso, log do nome.
  async executar(id: string, user: Dono): Promise<void> {
    try {
      await this.rodar(id, user);
    } catch (e) {
      this.logger.error(`executor ${id} falhou: ${(e as Error).name}`);
      await this.falhar(id, user, {
        motivo: 'ERRO_INTERNO',
        retentavel: true,
      }).catch(() => undefined);
    }
  }

  private async rodar(id: string, user: Dono) {
    const g = await this.tenant.runComoUsuario(user, (tx) =>
      tx.geracaoIa.findFirst({
        where: {
          id,
          clinicaId: user.clinicaId,
          psicologoId: user.psicologoId,
          estado: 'PENDENTE',
          ...SO_PACIENTE_VIVO,
        },
      }),
    );
    if (!g?.textoCifrado || !g.mapaCifrado) return;
    const textoAnonimizado = this.cripto.decifrar(
      g.clinicaId,
      g.textoCifrado,
      aadGeracao('textoCifrado', g.id, g.psicologoId),
    );
    const mapa = JSON.parse(
      this.cripto.decifrar(
        g.clinicaId,
        g.mapaCifrado,
        aadGeracao('mapaCifrado', g.id, g.psicologoId),
      ),
    ) as ItemMapa[];

    // Rede: FORA de transacao.
    let bruto: string;
    try {
      ({ rascunho: bruto } = await this.selahia.gerarRascunho({
        tipoDocumento: g.tipoDocumento === 'ANAMNESE' ? 'anamnese' : 'evolucao',
        abordagem: g.abordagem as AbordagemIa,
        textoAnonimizado,
      }));
    } catch (e) {
      return this.falhar(id, user, this.falhaDoCliente(e));
    }

    // Saida da IA e so TEXTO: sanear, devolver os nomes e conferir o tamanho. Nada e executado.
    let texto: string;
    let avisos: string[];
    try {
      const s = sanearSaida(bruto, mapa, textoAnonimizado);
      texto = reidentificar(s.texto, mapa);
      validarTamanhoSaida(texto);
      avisos = s.avisos;
    } catch (e) {
      if (e instanceof SaidaIaInvalidaError) {
        return this.falhar(id, user, {
          motivo: 'SAIDA_INVALIDA',
          retentavel: true,
        });
      }
      throw e;
    }

    // Transacao NOVA. UPDATE condicional PENDENTE -> PRONTO primeiro: so o vencedor da corrida
    // segue; 0 linhas (virou FALHOU por tempo, ou outro executor ja concluiu) = nao cria nada. Os
    // cifrados sao zerados aqui (nao precisam mais). Depois o INSERT do Documento, e a FK
    // (deferida) confere no COMMIT.
    const documentoId = randomUUID();
    await this.tenant.runComoUsuario(user, async (tx) => {
      const r = await tx.geracaoIa.updateMany({
        where: {
          id,
          clinicaId: user.clinicaId,
          psicologoId: user.psicologoId,
          estado: 'PENDENTE',
        },
        data: {
          estado: 'PRONTO',
          documentoId,
          avisos,
          finalizadoEm: new Date(Date.now()),
          textoCifrado: null,
          mapaCifrado: null,
          motivo: null,
          retentavel: null,
        },
      });
      if (r.count !== 1) return;
      await this.documentos.criarGeradoPorIa(tx, user, {
        id: documentoId,
        pacienteId: g.pacienteId,
        tipo: g.tipoDocumento === 'ANAMNESE' ? 'ANAMNESE' : 'EVOLUCAO',
        conteudo: texto,
      });
    });
  }

  private falhaDoCliente(e: unknown): Falha {
    if (e instanceof IaIndisponivelError || e instanceof IaRecusadaError) {
      return { motivo: e.motivo, retentavel: e.retentavel };
    }
    if (e instanceof IaDesabilitadaError) {
      return { motivo: e.motivo, retentavel: true };
    }
    this.logger.error(`cliente da IA falhou: ${(e as Error).name}`);
    return { motivo: 'ERRO_INTERNO', retentavel: true };
  }

  // PENDENTE -> FALHOU, condicional: se o pedido ja virou outra coisa, nao mexe. Nota, texto
  // cifrado e mapa PERMANECEM (a retentativa reenvia o mesmo texto).
  private async falhar(id: string, user: Dono, f: Falha) {
    await this.tenant.runComoUsuario(user, (tx) =>
      tx.geracaoIa.updateMany({
        where: {
          id,
          clinicaId: user.clinicaId,
          psicologoId: user.psicologoId,
          estado: 'PENDENTE',
        },
        data: {
          estado: 'FALHOU',
          motivo: f.motivo,
          retentavel: f.retentavel,
          finalizadoEm: new Date(Date.now()),
        },
      }),
    );
  }
}
