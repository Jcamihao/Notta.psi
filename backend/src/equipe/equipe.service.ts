import { Injectable, Logger } from '@nestjs/common';
import bcrypt from 'bcrypt';
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

  constructor(private readonly tenant: TenantPrismaService) {}

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
          },
          select: { id: true },
        }),
      );
      return { psicologoId: p.id };
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
}
