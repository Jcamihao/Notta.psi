import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import bcrypt from 'bcrypt';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { CUSTO_BCRYPT } from '../auth/auth.service';
import type { UsuarioAutenticado } from '../auth/jwt-auth.guard';
import { erroAoCriarPsicologo } from '../comum/novo-psicologo';
import { normalizarEmail } from '../comum/validacao';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import type { CriarPsicologoDto } from './equipe.controller';

// Psicologo usa a policy tenant_isolation (clinica), nao psicologo_proprio:
// o ADMIN ve nome/e-mail dos colegas, nunca prontuario (docs/ACESSO.md).
// Clinica SEMPRE do token (`user`), nunca do corpo.
@Injectable()
export class EquipeService {
  private readonly logger = new Logger(EquipeService.name);

  constructor(
    private readonly tenant: TenantPrismaService,
    private readonly auditoria: AuditoriaService,
  ) {}

  async criar(user: UsuarioAutenticado, dto: CriarPsicologoDto) {
    // bcrypt (CPU) FORA da transacao: nao segura conexao do pool.
    const senhaHash = await bcrypt.hash(dto.senha, CUSTO_BCRYPT);
    try {
      const p = await this.tenant.run(user.clinicaId, (tx) =>
        tx.psicologo.create({
          data: {
            clinicaId: user.clinicaId,
            nome: dto.nome,
            email: normalizarEmail(dto.email),
            senhaHash,
            abordagemPadrao: dto.abordagemPadrao,
            papel: 'PSICOLOGO',
            // Senha definida pelo ADMIN: o colega e obrigado a trocar no 1o acesso (item 62),
            // assim o ADMIN nao fica com acesso a conta (e ao prontuario) dele.
            senhaProvisoria: true,
          },
          select: { id: true, ativo: true, desativadoEm: true },
        }),
      );
      const { id, ...resto } = p;
      return { psicologoId: id, ...resto };
    } catch (e) {
      throw erroAoCriarPsicologo(e, this.logger, 'psicologo');
    }
  }

  async listar(user: UsuarioAutenticado) {
    // select explicito: senhaHash nunca sai do banco. where com clinicaId: codigo E RLS.
    const lista = await this.tenant.run(user.clinicaId, (tx) =>
      tx.psicologo.findMany({
        where: { clinicaId: user.clinicaId },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          nome: true,
          email: true,
          papel: true,
          abordagemPadrao: true,
          ativo: true,
          desativadoEm: true,
          createdAt: true,
        },
      }),
    );
    return lista.map(({ id, createdAt, ...resto }) => ({
      psicologoId: id,
      ...resto,
      criadoEm: createdAt,
    }));
  }

  // ADMIN desativa um colega (item 58). Atomico: UPDATE com `ativo = true` e `papel = PSICOLOGO`
  // no WHERE, sob a policy psicologo_desativar_colega + trigger (nunca reativa, nunca a si).
  // Auditoria na MESMA transacao. Dados clinicos do desativado nao sao tocados.
  desativar(user: UsuarioAutenticado, id: string) {
    const { clinicaId } = user;
    return this.tenant.runComoUsuario(user, async (tx) => {
      const { count } = await tx.psicologo.updateMany({
        where: { id, clinicaId, papel: 'PSICOLOGO', ativo: true },
        data: { ativo: false, desativadoEm: new Date() },
      });
      if (count !== 1) {
        // 0 linhas: relê para dizer o motivo (404 igual para outra clinica e inexistente).
        const alvo = await tx.psicologo.findFirst({
          where: { id, clinicaId },
          select: { ativo: true },
        });
        if (!alvo) throw new NotFoundException('Psicologo nao encontrado');
        throw new ConflictException(
          alvo.ativo
            ? 'Nao e possivel desativar este usuario'
            : 'Psicologo ja desativado',
        );
      }
      await this.auditoria.registrar(tx, user, 'DESATIVOU', 'Psicologo', id);
      return tx.psicologo.findFirstOrThrow({
        where: { id, clinicaId },
        select: {
          id: true,
          nome: true,
          email: true,
          papel: true,
          abordagemPadrao: true,
          ativo: true,
          desativadoEm: true,
        },
      });
    });
  }
}
