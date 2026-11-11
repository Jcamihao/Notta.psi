import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditoriaService } from '../auditoria/auditoria.service';
import type { UsuarioAutenticado } from '../auth/jwt-auth.guard';
import { relogio } from '../comum/relogio';
import { ConsentimentoService } from '../consentimento/consentimento.service';
import { TERMO_VIGENTE } from '../consentimento/termo-consentimento';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { CONVITE_CONFIG, type ConviteConfig } from './convite.config';
import { gerarToken, hashToken } from './convite.token';

type Dono = Pick<UsuarioAutenticado, 'clinicaId' | 'psicologoId'>;

const NAO_ENCONTRADO = 'Paciente nao encontrado';
const PRAZO_MS = 7 * 24 * 3600 * 1000;
const LISTA_MAX = 20;
const CONVITE_MUDOU = 'O convite mudou enquanto voce enviava. Tente de novo.';

// Rotas do PSICOLOGO (autenticado, runComoUsuario, auditoria na mesma transacao). O token existe
// so em memoria: sai uma vez na resposta do POST e nunca e gravado, logado nem auditado.
@Injectable()
export class ConviteConsentimentoService {
  constructor(
    private readonly tenant: TenantPrismaService,
    private readonly auditoria: AuditoriaService,
    private readonly consentimento: ConsentimentoService,
    @Inject(CONVITE_CONFIG) private readonly config: ConviteConfig,
  ) {}

  async criar(user: UsuarioAutenticado, pacienteId: string) {
    const token = gerarToken();
    const agora = relogio.agora();
    try {
      return await this.tenant.runComoUsuario(user, async (tx) => {
        await this.exigirPaciente(tx, user, pacienteId);
        const estado = await this.consentimento.estadoDe(tx, user, pacienteId);
        if (estado === 'CONCEDIDO') {
          throw new ConflictException('Consentimento ja concedido');
        }
        // Convite novo substitui o PENDENTE (mesmo vencido: o indice unico parcial conta todo
        // PENDENTE). O UPDATE e condicional: se o paciente aceitou agora, ele nao pega.
        const pendente = await tx.conviteConsentimento.findFirst({
          where: { ...this.dono(user), pacienteId, estado: 'PENDENTE' },
          select: { id: true },
        });
        if (pendente) {
          const r = await tx.conviteConsentimento.updateMany({
            where: { ...this.dono(user), id: pendente.id, estado: 'PENDENTE' },
            data: { estado: 'CANCELADO', usadoEm: agora },
          });
          if (r.count !== 1) throw new ConflictException(CONVITE_MUDOU);
          await this.auditoria.registrar(
            tx,
            user,
            'CANCELOU_CONVITE',
            'ConviteConsentimento',
            pendente.id,
          );
        }
        const convite = await tx.conviteConsentimento.create({
          data: {
            ...this.dono(user),
            pacienteId,
            tokenHash: hashToken(token),
            termoVersao: TERMO_VIGENTE.versao,
            expiraEm: new Date(agora.getTime() + PRAZO_MS),
          },
          select: { id: true, expiraEm: true },
        });
        await this.auditoria.registrar(
          tx,
          user,
          'CRIOU_CONVITE',
          'ConviteConsentimento',
          convite.id,
        );
        return {
          id: convite.id,
          link: `${this.config.appUrl}/termo/${token}`,
          expiraEm: convite.expiraEm.toISOString(),
        };
      });
    } catch (e) {
      // Dois "Enviar termo" ao mesmo tempo: o indice unico parcial barra o 2o.
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        throw new ConflictException(CONVITE_MUDOU);
      }
      throw e;
    }
  }

  async listar(user: UsuarioAutenticado, pacienteId: string) {
    const agora = relogio.agora();
    return this.tenant.runComoUsuario(user, async (tx) => {
      await this.exigirPaciente(tx, user, pacienteId);
      await this.auditoria.registrar(
        tx,
        user,
        'LISTOU',
        'ConviteConsentimento',
        pacienteId,
      );
      const linhas = await tx.conviteConsentimento.findMany({
        where: { ...this.dono(user), pacienteId },
        orderBy: { criadoEm: 'desc' },
        take: LISTA_MAX,
        select: {
          id: true,
          estado: true,
          criadoEm: true,
          expiraEm: true,
          usadoEm: true,
          termoVersao: true,
        },
      });
      // Sem token nem link (so o hash existe no banco).
      return linhas.map((l) => ({
        id: l.id,
        estado: l.estado,
        expirado: l.estado === 'PENDENTE' && l.expiraEm <= agora,
        criadoEm: l.criadoEm.toISOString(),
        expiraEm: l.expiraEm.toISOString(),
        usadoEm: l.usadoEm ? l.usadoEm.toISOString() : null,
        termoVersao: l.termoVersao,
      }));
    });
  }

  async cancelar(user: UsuarioAutenticado, pacienteId: string, id: string) {
    const agora = relogio.agora();
    return this.tenant.runComoUsuario(user, async (tx) => {
      await this.exigirPaciente(tx, user, pacienteId);
      const r = await tx.conviteConsentimento.updateMany({
        where: { ...this.dono(user), id, pacienteId, estado: 'PENDENTE' },
        data: { estado: 'CANCELADO', usadoEm: agora },
      });
      if (r.count !== 1) {
        const existe = await tx.conviteConsentimento.findFirst({
          where: { ...this.dono(user), id, pacienteId },
          select: { id: true },
        });
        if (existe) throw new ConflictException('Convite nao esta pendente');
        throw new NotFoundException('Convite nao encontrado');
      }
      await this.auditoria.registrar(
        tx,
        user,
        'CANCELOU_CONVITE',
        'ConviteConsentimento',
        id,
      );
      return { id, estado: 'CANCELADO' as const };
    });
  }

  private dono(user: Dono) {
    return { clinicaId: user.clinicaId, psicologoId: user.psicologoId };
  }

  private async exigirPaciente(
    tx: Prisma.TransactionClient,
    user: Dono,
    pacienteId: string,
  ) {
    const p = await tx.paciente.findFirst({
      where: { id: pacienteId, ...this.dono(user), excluidoEm: null },
      select: { id: true },
    });
    if (!p) throw new NotFoundException(NAO_ENCONTRADO);
  }
}
