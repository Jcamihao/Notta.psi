import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Prisma } from '@prisma/client';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { relogio } from '../comum/relogio';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { FORMATO_TOKEN } from './cookies';
import type { UsuarioAutenticado } from './jwt-auth.guard';

// Item 46. Sessao = uma linha por geracao do refresh; `familia` = um login. Valores aprovados
// pelo dono: sessao maxima de 7 dias, 30 minutos parado, acesso de 15 minutos (jwt.config).
export const SESSAO_MAXIMA_MS = 7 * 24 * 3600 * 1000;
export const OCIOSA_MAXIMA_MS = 30 * 60 * 1000;

export type SessaoAtual = { id: string; familia: string };

export type Renovada = {
  acesso: string;
  refresh: string;
  absolutaAte: Date;
  sessaoId: string;
};

export const sha256 = (t: string) =>
  createHash('sha256').update(t).digest('hex');

type Dono = { clinicaId: string; psicologoId: string };

@Injectable()
export class SessaoService {
  constructor(
    private readonly tenant: TenantPrismaService,
    private readonly jwt: JwtService,
    private readonly auditoria: AuditoriaService,
  ) {}

  // Papel NAO vai no token: o guard le do banco a cada requisicao. `tv` = tokenVersao e `sid` = a
  // linha da sessao: o guard confere os dois no banco (trocar a senha ou revogar a sessao vale na hora).
  assinar(
    p: { id: string; clinicaId: string; tokenVersao: number },
    sessaoId: string,
  ) {
    return this.jwt.signAsync({
      sub: p.id,
      clinicaId: p.clinicaId,
      tv: p.tokenVersao,
      sid: sessaoId,
    });
  }

  // Cria uma linha (login: familia e prazo novos; renovacao: os da familia). DENTRO de `tx`, com
  // o psicologo no contexto. So o hash do refresh vai ao banco; o cru volta para o cookie.
  async criar(
    tx: Prisma.TransactionClient,
    dono: Dono,
    herda?: { familia: string; absolutaAte: Date },
  ) {
    const agora = relogio.agora();
    const refresh = randomBytes(32).toString('base64url');
    const absolutaAte =
      herda?.absolutaAte ?? new Date(agora.getTime() + SESSAO_MAXIMA_MS);
    const s = await tx.sessao.create({
      data: {
        id: randomUUID(),
        clinicaId: dono.clinicaId,
        psicologoId: dono.psicologoId,
        familia: herda?.familia ?? randomUUID(),
        refreshHash: sha256(refresh),
        criadoEm: agora,
        ultimoUsoEm: agora,
        absolutaAte,
      },
      select: { id: true },
    });
    return { sessaoId: s.id, refresh, absolutaAte };
  }

  private revogarFamilia(
    tx: Prisma.TransactionClient,
    dono: Dono,
    familia: string,
    motivo: 'REUSO' | 'EXPIROU' | 'SAIU',
  ) {
    return tx.sessao.updateMany({
      where: { ...dono, familia, revogadaEm: null },
      data: { revogadaEm: relogio.agora(), motivoRevogacao: motivo },
    });
  }

  // Troca o refresh por outro (rotacao). Qualquer falha = null (o controller responde o MESMO 401
  // e limpa os cookies). A transacao COMMITA tambem nos caminhos de falha que gravam (reuso e
  // expiracao revogam a familia): por isso devolve null em vez de lancar.
  async renovar(refreshCru: string): Promise<Renovada | null> {
    if (!FORMATO_TOKEN.test(refreshCru)) return null;
    const r = await this.tenant.runRefresh(
      sha256(refreshCru),
      async (tx, assumirDono) => {
        const atual = await tx.sessao.findFirst({
          where: { refreshHash: sha256(refreshCru) },
        });
        if (!atual) return null;
        const dono = {
          clinicaId: atual.clinicaId,
          psicologoId: atual.psicologoId,
        };
        await assumirDono(dono);
        const agora = relogio.agora();

        if (atual.revogadaEm) return null;
        // REUSO: o refresh ja foi trocado e alguem o apresentou de novo (copia roubada ou corrida
        // perdida): revoga a familia inteira e deixa rastro. Auditoria na MESMA transacao.
        const reuso = async () => {
          await this.revogarFamilia(tx, dono, atual.familia, 'REUSO');
          await this.auditoria.registrar(
            tx,
            dono,
            'REFRESH_REUSADO',
            'Sessao',
            atual.id,
          );
          return null;
        };
        if (atual.usadoEm) return reuso();

        if (
          agora >= atual.absolutaAte ||
          agora.getTime() - atual.ultimoUsoEm.getTime() > OCIOSA_MAXIMA_MS
        ) {
          await this.revogarFamilia(tx, dono, atual.familia, 'EXPIROU');
          return null;
        }

        const p = await tx.psicologo.findFirst({
          where: { id: dono.psicologoId, clinicaId: dono.clinicaId },
          select: { ativo: true, tokenVersao: true },
        });
        if (!p || !p.ativo) return null;

        // Atomico: so UMA renovacao marca a linha como usada; a outra (corrida) cai no reuso.
        const { count } = await tx.sessao.updateMany({
          where: { id: atual.id, usadoEm: null, revogadaEm: null },
          data: { usadoEm: agora },
        });
        if (count !== 1) return reuso();

        const nova = await this.criar(tx, dono, {
          familia: atual.familia,
          absolutaAte: atual.absolutaAte,
        });
        return {
          ...nova,
          id: dono.psicologoId,
          clinicaId: dono.clinicaId,
          tokenVersao: p.tokenVersao,
        };
      },
    );
    if (!r) return null;
    return {
      acesso: await this.assinar(r, r.sessaoId),
      refresh: r.refresh,
      absolutaAte: r.absolutaAte,
      sessaoId: r.sessaoId,
    };
  }

  // Sair: revoga a familia da sessao atual (todas as geracoes do refresh deste aparelho).
  async sair(user: UsuarioAutenticado, sessao: SessaoAtual) {
    await this.tenant.runComoUsuario(user, (tx) =>
      this.revogarFamilia(
        tx,
        { clinicaId: user.clinicaId, psicologoId: user.psicologoId },
        sessao.familia,
        'SAIU',
      ),
    );
  }

  // Sair de todos os aparelhos: revoga TODAS as sessoes do psicologo (a atual inclusive) e audita
  // na mesma transacao.
  async sairDeTodos(user: UsuarioAutenticado, sessao: SessaoAtual) {
    await this.tenant.runComoUsuario(user, async (tx) => {
      await tx.sessao.updateMany({
        where: {
          clinicaId: user.clinicaId,
          psicologoId: user.psicologoId,
          revogadaEm: null,
        },
        data: { revogadaEm: relogio.agora(), motivoRevogacao: 'SAIU_DE_TODOS' },
      });
      await this.auditoria.registrar(
        tx,
        user,
        'SAIU_DE_TODOS',
        'Sessao',
        sessao.id,
      );
    });
  }
}
