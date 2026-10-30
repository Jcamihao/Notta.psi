import { randomUUID } from 'node:crypto';
import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { CUSTO_BCRYPT } from '../auth/auth.service';
import { normalizarEmail } from '../comum/validacao';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import type { CriarClinicaDto } from './clinicas.controller';

@Injectable()
export class ClinicasService {
  private readonly logger = new Logger(ClinicasService.name);

  constructor(private readonly tenant: TenantPrismaService) {}

  async criar(dto: CriarClinicaDto) {
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
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        throw new ConflictException('E-mail ja cadastrado');
      }
      // Erro do Prisma pode trazer os argumentos da query (hash, e-mail): loga so o tipo.
      this.logger.error(
        `falha ao criar clinica: ${e instanceof Prisma.PrismaClientKnownRequestError ? e.code : (e as Error).name}`,
      );
      throw new InternalServerErrorException();
    }
  }
}
