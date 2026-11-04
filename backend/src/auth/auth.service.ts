import { randomBytes } from 'node:crypto';
import {
  BadRequestException,
  Injectable,
  OnModuleInit,
  UnauthorizedException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import bcrypt from 'bcrypt';
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
        select: {
          id: true,
          clinicaId: true,
          senhaHash: true,
          tokenVersao: true,
          ativo: true,
        },
      }),
    );
    // compare SEMPRE roda (sem atalho quando o e-mail nao existe).
    const ok = await bcrypt.compare(
      senha,
      psicologo?.senhaHash ?? this.hashFalso,
    );
    // Desativado (item 58) = mesmo 401 e mesmo tempo (o compare acima roda com o hash real).
    if (!psicologo || !psicologo.ativo || !ok) {
      throw new UnauthorizedException('Credenciais invalidas');
    }
    return { token: await this.token(psicologo) };
  }

  // Papel NAO vai no token: o guard le do banco a cada requisicao.
  // `tv` = tokenVersao: o guard confere com o banco (trocar a senha revoga os antigos).
  private token(p: { id: string; clinicaId: string; tokenVersao: number }) {
    return this.jwt.signAsync({
      sub: p.id,
      clinicaId: p.clinicaId,
      tv: p.tokenVersao,
    });
  }

  // Troca da PROPRIA senha (obrigatoria com senha provisoria, voluntaria nos outros casos).
  async trocarSenha(
    user: UsuarioAutenticado,
    senhaAtual: string,
    novaSenha: string,
  ) {
    if (novaSenha === senhaAtual) {
      throw new BadRequestException('A nova senha deve ser diferente da atual');
    }
    const { psicologoId: id, clinicaId } = user;
    const atual = await this.tenant.run(clinicaId, (tx) =>
      tx.psicologo.findFirst({
        where: { id, clinicaId },
        select: { senhaHash: true },
      }),
    );
    if (!atual) throw new UnauthorizedException();
    // 422, nao 401: o front desloga em todo 401.
    const incorreta = () =>
      new UnprocessableEntityException('Senha atual incorreta');
    if (!(await bcrypt.compare(senhaAtual, atual.senhaHash))) throw incorreta();
    // bcrypt (CPU) FORA da transacao: nao segura conexao do pool.
    const senhaHash = await bcrypt.hash(novaSenha, CUSTO_BCRYPT);
    // Propria linha (policy psicologo_update_proprio). `senhaHash: atual` no where: duas trocas
    // simultaneas com a mesma senha antiga nao passam as duas (a segunda vira 422).
    const p = await this.tenant.runComoUsuario(user, async (tx) => {
      const { count } = await tx.psicologo.updateMany({
        where: { id, clinicaId, senhaHash: atual.senhaHash },
        data: {
          senhaHash,
          senhaProvisoria: false,
          tokenVersao: { increment: 1 },
        },
      });
      if (count !== 1) return null;
      return tx.psicologo.findFirstOrThrow({
        where: { id, clinicaId },
        select: { id: true, clinicaId: true, tokenVersao: true },
      });
    });
    if (!p) throw incorreta();
    return { token: await this.token(p) };
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
          senhaProvisoria: true,
          clinica: { select: { id: true, nome: true } },
        },
      }),
    );
    if (!p) throw new UnauthorizedException();
    const { id, ...resto } = p;
    return { psicologoId: id, ...resto };
  }
}
