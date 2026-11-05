import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditoriaService } from '../auditoria/auditoria.service';
import type { UsuarioAutenticado } from '../auth/jwt-auth.guard';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import type { Evento } from './consentimento.dto';
import { TERMO_VIGENTE } from './termo-consentimento';

export type Estado = 'NENHUM' | Evento;
export type Origem = 'PSICOLOGO' | 'PACIENTE';
type Dono = Pick<UsuarioAutenticado, 'clinicaId' | 'psicologoId'>;

const NAO_ENCONTRADO = 'Paciente nao encontrado';
const TRANSICAO_INVALIDA = 'Transicao invalida';

// NENHUM|REVOGADO --CONCEDIDO--> CONCEDIDO; CONCEDIDO --REVOGADO--> REVOGADO. So isso.
export function transicaoValida(estado: Estado, evento: Evento): boolean {
  return evento === 'CONCEDIDO'
    ? estado !== 'CONCEDIDO'
    : estado === 'CONCEDIDO';
}

// Consentimento por paciente, somente-acrescentar: cada evento e uma linha nova (nada e
// sobrescrito); estado = evento da maior `seq`. Clinica e psicologo SEMPRE do token.
@Injectable()
export class ConsentimentoService {
  constructor(
    private readonly tenant: TenantPrismaService,
    private readonly auditoria: AuditoriaService,
  ) {}

  async obter(user: UsuarioAutenticado, pacienteId: string) {
    const r = await this.tenant.runComoUsuario(user, async (tx) => {
      if (!(await this.pacienteDoUsuario(tx, user, pacienteId))) return null;
      await this.auditoria.registrar(
        tx,
        user,
        'LEU',
        'Consentimento',
        pacienteId,
      );
      return this.resumo(tx, user, pacienteId);
    });
    if (!r) throw new NotFoundException(NAO_ENCONTRADO);
    return r;
  }

  async registrar(
    user: UsuarioAutenticado,
    pacienteId: string,
    evento: Evento,
  ) {
    try {
      const r = await this.tenant.runComoUsuario(user, async (tx) => {
        if (!(await this.pacienteDoUsuario(tx, user, pacienteId))) return null;
        const ultimo = await this.ultimo(tx, user, pacienteId);
        const estado: Estado = ultimo ? (ultimo.evento as Evento) : 'NENHUM';
        if (!transicaoValida(estado, evento)) {
          throw new ConflictException(TRANSICAO_INVALIDA);
        }
        // REVOGADO guarda o termo vigente do ultimo CONCEDIDO; CONCEDIDO grava o termo atual.
        const termo =
          evento === 'CONCEDIDO' || !ultimo
            ? TERMO_VIGENTE
            : { versao: ultimo.termoVersao, texto: ultimo.termoTexto };
        await tx.consentimento.create({
          data: {
            clinicaId: user.clinicaId,
            psicologoId: user.psicologoId,
            pacienteId,
            seq: (ultimo?.seq ?? 0) + 1,
            evento,
            termoVersao: termo.versao,
            termoTexto: termo.texto,
          },
        });
        // Mesma transacao: se a trilha falhar, o consentimento nao fica gravado.
        await this.auditoria.registrar(
          tx,
          user,
          evento === 'CONCEDIDO' ? 'CONCEDEU' : 'REVOGOU',
          'Consentimento',
          pacienteId,
        );
        return this.resumo(tx, user, pacienteId);
      });
      if (!r) throw new NotFoundException(NAO_ENCONTRADO);
      return r;
    } catch (e) {
      // Duas gravacoes concorrentes na mesma seq: a segunda perde (unique pacienteId+seq).
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        throw new ConflictException(TRANSICAO_INVALIDA);
      }
      throw e;
    }
  }

  // Para o item 12 (gerar documento): 403 se o estado nao for CONCEDIDO.
  async exigirConcedido(
    tx: Prisma.TransactionClient,
    user: Dono,
    pacienteId: string,
  ) {
    const ultimo = await this.ultimo(tx, user, pacienteId);
    if (ultimo?.evento !== 'CONCEDIDO') {
      throw new ForbiddenException('Consentimento nao concedido');
    }
  }

  // Estado de varios pacientes com UMA consulta (lista de /pacientes, sem N+1).
  async estadosDe(
    tx: Prisma.TransactionClient,
    user: Dono,
    pacienteIds: string[],
  ): Promise<Map<string, Estado>> {
    if (pacienteIds.length === 0) return new Map();
    const linhas = await tx.consentimento.findMany({
      where: {
        clinicaId: user.clinicaId,
        psicologoId: user.psicologoId,
        pacienteId: { in: pacienteIds },
      },
      distinct: ['pacienteId'],
      orderBy: [{ pacienteId: 'asc' }, { seq: 'desc' }],
      select: { pacienteId: true, evento: true },
    });
    return new Map(linhas.map((l) => [l.pacienteId, l.evento as Estado]));
  }

  // Aceite do paciente pelo link (item 22), DENTRO da transacao publica, com o contexto do dono do
  // convite ja assumido e o convite ja ACEITO (a policy restritiva exige os dois). Devolve false
  // (sem gravar) se o consentimento ja esta CONCEDIDO, por exemplo registrado a mao no meio do
  // caminho: o convite fica ACEITO sem evento novo. Termo = o vigente (o convite so vale se a
  // versao dele e a vigente).
  async concederPorConvite(
    tx: Prisma.TransactionClient,
    dono: Dono,
    pacienteId: string,
    conviteId: string,
  ): Promise<boolean> {
    const ultimo = await this.ultimo(tx, dono, pacienteId);
    if (ultimo?.evento === 'CONCEDIDO') return false;
    await tx.consentimento.create({
      data: {
        clinicaId: dono.clinicaId,
        psicologoId: dono.psicologoId,
        pacienteId,
        seq: (ultimo?.seq ?? 0) + 1,
        evento: 'CONCEDIDO',
        origem: 'PACIENTE',
        conviteId,
        termoVersao: TERMO_VIGENTE.versao,
        termoTexto: TERMO_VIGENTE.texto,
      },
    });
    return true;
  }

  async estadoDe(
    tx: Prisma.TransactionClient,
    user: Dono,
    pacienteId: string,
  ): Promise<Estado> {
    const ultimo = await this.ultimo(tx, user, pacienteId);
    return ultimo ? (ultimo.evento as Estado) : 'NENHUM';
  }

  private ultimo(tx: Prisma.TransactionClient, user: Dono, pacienteId: string) {
    return tx.consentimento.findFirst({
      where: {
        pacienteId,
        clinicaId: user.clinicaId,
        psicologoId: user.psicologoId,
      },
      orderBy: { seq: 'desc' },
    });
  }

  private pacienteDoUsuario(
    tx: Prisma.TransactionClient,
    user: Dono,
    id: string,
  ) {
    return tx.paciente.findFirst({
      where: { id, clinicaId: user.clinicaId, psicologoId: user.psicologoId },
      select: { id: true },
    });
  }

  private async resumo(
    tx: Prisma.TransactionClient,
    user: Dono,
    pacienteId: string,
  ) {
    const linhas = await tx.consentimento.findMany({
      where: {
        pacienteId,
        clinicaId: user.clinicaId,
        psicologoId: user.psicologoId,
      },
      orderBy: { seq: 'asc' },
      select: {
        seq: true,
        evento: true,
        termoVersao: true,
        origem: true,
        criadoEm: true,
      },
    });
    const ultima = linhas[linhas.length - 1];
    return {
      estado: (ultima ? ultima.evento : 'NENHUM') as Estado,
      desde: ultima ? ultima.criadoEm.toISOString() : null,
      historico: linhas.map((l) => ({
        seq: l.seq,
        evento: l.evento as Evento,
        termoVersao: l.termoVersao,
        origem: l.origem as Origem,
        em: l.criadoEm.toISOString(),
      })),
    };
  }
}
