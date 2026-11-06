import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import bcrypt from 'bcrypt';
import { CUSTO_BCRYPT } from '../auth/auth.service';
import { exigirSenhaForte } from '../auth/politica-senha';
import { erroAoCriarPsicologo } from '../comum/novo-psicologo';
import { normalizarEmail } from '../comum/validacao';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import type { CriarClinicaDto } from './clinicas.controller';

@Injectable()
export class ClinicasService {
  private readonly logger = new Logger(ClinicasService.name);

  constructor(private readonly tenant: TenantPrismaService) {}

  async criar(dto: CriarClinicaDto) {
    // Politica de senha ANTES do bcrypt (barato) e do e-mail unico: a recusa nao depende de o
    // e-mail ja existir (nao serve de sonda).
    exigirSenhaForte(dto.senha, { email: dto.email, nome: dto.nomePsicologo });
    // bcrypt (CPU) FORA da transacao: nao segura conexao do pool.
    const senhaHash = await bcrypt.hash(dto.senha, CUSTO_BCRYPT);
    const clinicaId = randomUUID();
    try {
      // UMA transacao: se o psicologo falhar, a clinica tambem e desfeita.
      const psicologo = await this.tenant.run(clinicaId, async (tx) => {
        await tx.clinica.create({
          data: { id: clinicaId, nome: dto.nomeClinica },
        });
        return tx.psicologo.create({
          data: {
            clinicaId,
            nome: dto.nomePsicologo,
            email: normalizarEmail(dto.email),
            senhaHash,
            abordagemPadrao: dto.abordagemPadrao,
            papel: 'ADMIN',
          },
          select: { id: true },
        });
      });
      return { clinicaId, psicologoId: psicologo.id };
    } catch (e) {
      throw erroAoCriarPsicologo(e, this.logger, 'clinica');
    }
  }
}
