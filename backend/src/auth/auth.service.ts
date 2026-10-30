import { randomBytes } from 'node:crypto';
import {
  Injectable,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import bcrypt from 'bcryptjs';
import { normalizarEmail } from '../comum/validacao';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { UsuarioAutenticado } from './jwt-auth.guard';

// Fixo em codigo (nao vem de env). Usado no cadastro e no hash falso do login.
export const CUSTO_BCRYPT = 12;

@Injectable()
export class AuthService implements OnModuleInit {
  private hashFalso = '';

  constructor(
    private readonly tenant: TenantPrismaService,
    private readonly jwt: JwtService,
  ) {}

  // Hash falso com o MESMO custo: e-mail inexistente gasta o mesmo tempo de bcrypt.
  async onModuleInit() {
    this.hashFalso = await bcrypt.hash(
      randomBytes(16).toString('hex'),
      CUSTO_BCRYPT,
    );
  }

  async login(emailBruto: string, senha: string) {
    const email = normalizarEmail(emailBruto);
    const psicologo = await this.tenant.runLogin(email, (tx) =>
      tx.psicologo.findUnique({
        where: { email },
        select: { id: true, clinicaId: true, senhaHash: true },
      }),
    );
    // compare SEMPRE roda (sem atalho quando o e-mail nao existe).
    const ok = await bcrypt.compare(
      senha,
      psicologo?.senhaHash ?? this.hashFalso,
    );
    if (!psicologo || !ok) {
      throw new UnauthorizedException('Credenciais invalidas');
    }
    // Papel NAO vai no token: o guard le do banco a cada requisicao.
    const token = await this.jwt.signAsync({
      sub: psicologo.id,
      clinicaId: psicologo.clinicaId,
    });
    return { token };
  }

  async eu({ psicologoId, clinicaId }: UsuarioAutenticado) {
    const p = await this.tenant.run(clinicaId, (tx) =>
      tx.psicologo.findFirst({
        where: { id: psicologoId, clinicaId },
        select: {
          id: true,
          nome: true,
          email: true,
          papel: true,
          abordagemPadrao: true,
          clinica: { select: { id: true, nome: true } },
        },
      }),
    );
    if (!p) throw new UnauthorizedException();
    const { id, ...resto } = p;
    return { psicologoId: id, ...resto };
  }
}
