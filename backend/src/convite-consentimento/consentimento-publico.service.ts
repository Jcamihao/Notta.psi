import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { relogio } from '../comum/relogio';
import { ConsentimentoService } from '../consentimento/consentimento.service';
import { TERMO_VIGENTE } from '../consentimento/termo-consentimento';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { hashToken, LINK_INVALIDO } from './convite.token';

type Dono = { clinicaId: string; psicologoId: string };

// Rotas PUBLICAS do termo (paciente, sem login). Tudo na transacao `runConvite`: o contexto e o
// hash do token; a clinica e o psicologo vem DO CONVITE. Qualquer motivo de "nao vale" (token
// desconhecido, expirado, cancelado, usado, outra versao do termo, psicologo desativado) e o MESMO
// 404. Nunca devolve dado do paciente. Nada e logado: nem token, nem hash, nem texto.
@Injectable()
export class ConsentimentoPublicoService {
  constructor(
    private readonly tenant: TenantPrismaService,
    private readonly auditoria: AuditoriaService,
    private readonly consentimento: ConsentimentoService,
  ) {}

  abrir(token: string) {
    const hash = hashToken(token);
    return this.tenant.runConvite(hash, async (tx, assumirDono) => {
      const convite = await tx.conviteConsentimento.findFirst({
        where: this.valido(hash),
        select: { clinicaId: true, psicologoId: true, expiraEm: true },
      });
      if (!convite) throw new NotFoundException(LINK_INVALIDO);
      await assumirDono(convite);
      const psicologo = await this.psicologoAtivo(tx, convite);
      return {
        clinica: psicologo.clinica.nome,
        psicologo: psicologo.nome,
        termo: { versao: TERMO_VIGENTE.versao, texto: TERMO_VIGENTE.texto },
        expiraEm: convite.expiraEm.toISOString(),
      };
    });
  }

  async aceitar(token: string) {
    const hash = hashToken(token);
    // O unico conflito possivel e o psicologo registrar a mao no mesmo instante (unique da seq):
    // a transacao desfaz e a 2a tentativa ve CONCEDIDO e so marca o convite ACEITO.
    for (let tentativa = 1; ; tentativa++) {
      try {
        return await this.aceitarUmaVez(hash);
      } catch (e) {
        const colisao =
          e instanceof Prisma.PrismaClientKnownRequestError &&
          e.code === 'P2002';
        if (!colisao || tentativa >= 2) throw e;
      }
    }
  }

  recusar(token: string) {
    const hash = hashToken(token);
    return this.tenant.runConvite(hash, async (tx, assumirDono) => {
      const convite = await this.virar(tx, hash, 'RECUSADO');
      await assumirDono(convite);
      await this.psicologoAtivo(tx, convite);
      await this.auditoria.registrar(
        tx,
        convite,
        'PACIENTE_RECUSOU_TERMO',
        'Consentimento',
        convite.pacienteId,
      );
      return { ok: true as const };
    });
  }

  private aceitarUmaVez(hash: string) {
    return this.tenant.runConvite(hash, async (tx, assumirDono) => {
      // 1) convite -> ACEITO (condicional): clique duplo e duas abas = so um passa.
      const convite = await this.virar(tx, hash, 'ACEITO');
      await assumirDono(convite);
      await this.psicologoAtivo(tx, convite);
      // 2) evento CONCEDIDO (origem PACIENTE) so depois: a policy exige o convite ACEITO.
      await this.consentimento.concederPorConvite(
        tx,
        convite,
        convite.pacienteId,
        convite.id,
      );
      // 3) trilha, na mesma transacao. psicologoId = o dono do paciente.
      await this.auditoria.registrar(
        tx,
        convite,
        'PACIENTE_ACEITOU_TERMO',
        'Consentimento',
        convite.pacienteId,
      );
      return { ok: true as const };
    });
  }

  // UPDATE condicional PENDENTE e nao expirado (e termo vigente) -> `estado`. 0 linhas = 404.
  private async virar(
    tx: Prisma.TransactionClient,
    hash: string,
    estado: 'ACEITO' | 'RECUSADO',
  ) {
    const r = await tx.conviteConsentimento.updateMany({
      where: this.valido(hash),
      data: { estado, usadoEm: relogio.agora() },
    });
    if (r.count !== 1) throw new NotFoundException(LINK_INVALIDO);
    return tx.conviteConsentimento.findFirstOrThrow({
      where: { tokenHash: hash },
      select: {
        id: true,
        clinicaId: true,
        psicologoId: true,
        pacienteId: true,
      },
    });
  }

  // Convite que ainda vale: PENDENTE, dentro do prazo e feito com o termo vigente (o paciente so
  // aceita o texto que viu; versao nova do termo invalida os links antigos).
  private valido(hash: string) {
    return {
      tokenHash: hash,
      estado: 'PENDENTE',
      expiraEm: { gt: relogio.agora() },
      termoVersao: TERMO_VIGENTE.versao,
    };
  }

  private async psicologoAtivo(tx: Prisma.TransactionClient, dono: Dono) {
    const p = await tx.psicologo.findFirst({
      where: { id: dono.psicologoId, clinicaId: dono.clinicaId, ativo: true },
      select: { nome: true, clinica: { select: { nome: true } } },
    });
    if (!p) throw new NotFoundException(LINK_INVALIDO);
    return p;
  }
}
