import { randomBytes } from 'node:crypto';
import {
  BadRequestException,
  Injectable,
  OnModuleInit,
  UnauthorizedException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import bcrypt from 'bcrypt';
import { relogio } from '../comum/relogio';
import { normalizarEmail } from '../comum/validacao';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { UsuarioAutenticado } from './jwt-auth.guard';
import { exigirSenhaForte } from './politica-senha';
import { SessaoAtual, SessaoService } from './sessao.service';

// Fixo em codigo (nao vem de env). Usado no cadastro e no hash falso do login.
export const CUSTO_BCRYPT = 12;

@Injectable()
export class AuthService implements OnModuleInit {
  private hashFalso = '';

  constructor(
    private readonly tenant: TenantPrismaService,
    private readonly sessoes: SessaoService,
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
    // Sessao nova (familia nova, 7 dias) + os dados do usuario, na mesma transacao.
    const { usuario, sessao } = await this.tenant.run(
      psicologo.clinicaId,
      async (tx) => ({
        sessao: await this.sessoes.criar(tx, {
          clinicaId: psicologo.clinicaId,
          psicologoId: psicologo.id,
        }),
        usuario: await this.perfil(tx, psicologo.clinicaId, psicologo.id),
      }),
      { psicologoId: psicologo.id },
    );
    return {
      usuario,
      acesso: await this.sessoes.assinar(psicologo, sessao.sessaoId),
      refresh: sessao.refresh,
      absolutaAte: sessao.absolutaAte,
    };
  }

  // Troca da PROPRIA senha (obrigatoria com senha provisoria, voluntaria nos outros casos).
  async trocarSenha(
    user: UsuarioAutenticado,
    sessao: SessaoAtual,
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
        select: { senhaHash: true, email: true, nome: true },
      }),
    );
    if (!atual) throw new UnauthorizedException();
    // Politica de senha forte (item 45) antes de gastar bcrypt. 422 com motivo; nao e 401.
    exigirSenhaForte(novaSenha, atual);
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
      // Todas as OUTRAS sessoes do psicologo caem (a senha mudou: quem a tinha perde o acesso).
      // A atual segue: mesmo sid, JWT novo com o `tv` novo.
      await tx.sessao.updateMany({
        where: {
          clinicaId,
          psicologoId: id,
          familia: { not: sessao.familia },
          revogadaEm: null,
        },
        data: { revogadaEm: relogio.agora(), motivoRevogacao: 'SENHA_TROCADA' },
      });
      return tx.psicologo.findFirstOrThrow({
        where: { id, clinicaId },
        select: { id: true, clinicaId: true, tokenVersao: true },
      });
    });
    if (!p) throw incorreta();
    return this.sessoes.assinar(p, sessao.id);
  }

  // Dados do usuario logado: GET /eu e o `usuario` do login.
  private async perfil(
    tx: Prisma.TransactionClient,
    clinicaId: string,
    psicologoId: string,
  ) {
    const p = await tx.psicologo.findFirst({
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
    });
    if (!p) throw new UnauthorizedException();
    const { id, ...resto } = p;
    return { psicologoId: id, ...resto };
  }

  eu({ psicologoId, clinicaId }: UsuarioAutenticado) {
    return this.tenant.run(clinicaId, (tx) =>
      this.perfil(tx, clinicaId, psicologoId),
    );
  }

  renovar(refreshCru: string) {
    return this.sessoes.renovar(refreshCru);
  }
}
