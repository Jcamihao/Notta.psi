import { randomUUID } from 'node:crypto';
import {
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { Documento, Prisma } from '@prisma/client';
import { AuditoriaService } from '../auditoria/auditoria.service';
import type { UsuarioAutenticado } from '../auth/jwt-auth.guard';
import { ConsentimentoService } from '../consentimento/consentimento.service';
import {
  aadDe,
  CriptografiaService,
} from '../criptografia/criptografia.service';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import type { CriarDocumentoDto } from './documentos.dto';

const TETO_LISTA = 200;
const PACIENTE_NAO_ENCONTRADO = 'Paciente nao encontrado';
const DOCUMENTO_NAO_ENCONTRADO = 'Documento nao encontrado';

const dia = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

// UNICO lugar que cifra e decifra documento. Nunca loga o conteudo (nem em excecao): so o tipo
// do erro. Clinica e psicologo SEMPRE do token, nunca do corpo.
@Injectable()
export class DocumentosService {
  private readonly logger = new Logger(DocumentosService.name);

  constructor(
    private readonly tenant: TenantPrismaService,
    private readonly cripto: CriptografiaService,
    private readonly auditoria: AuditoriaService,
    private readonly consentimento: ConsentimentoService,
  ) {}

  async criar(
    user: UsuarioAutenticado,
    pacienteId: string,
    dto: CriarDocumentoDto,
  ) {
    // id no app, antes do INSERT: ele entra no AAD.
    const id = randomUUID();
    const conteudoCifrado = this.cripto.cifrar(
      user.clinicaId,
      dto.conteudo,
      aadDe('Documento', 'conteudoCifrado', id, user.psicologoId),
    );
    // Ordem: 404 (paciente nao e seu) antes de 403 (sem consentimento). Auditoria na MESMA
    // transacao: se a trilha falhar, o documento nao fica criado.
    const linha = await this.tenant.runComoUsuario(user, async (tx) => {
      if (!(await this.pacienteDoUsuario(tx, user, pacienteId))) return null;
      await this.consentimento.exigirConcedido(tx, user, pacienteId);
      const criado = await tx.documento.create({
        data: {
          id,
          clinicaId: user.clinicaId,
          psicologoId: user.psicologoId,
          pacienteId,
          tipo: dto.tipo,
          dataSessao: dto.dataSessao ? new Date(dto.dataSessao) : null,
          conteudoCifrado,
        },
      });
      await this.auditoria.registrar(tx, user, 'CRIOU', 'Documento', id);
      return criado;
    });
    if (!linha) throw new NotFoundException(PACIENTE_NAO_ENCONTRADO);
    return this.completo(linha);
  }

  // So metadados: nada e decifrado (nem lido) aqui.
  async listar(user: UsuarioAutenticado, pacienteId: string) {
    const linhas = await this.tenant.runComoUsuario(user, async (tx) => {
      if (!(await this.pacienteDoUsuario(tx, user, pacienteId))) return null;
      const achadas = await tx.documento.findMany({
        where: {
          pacienteId,
          clinicaId: user.clinicaId,
          psicologoId: user.psicologoId,
        },
        select: {
          id: true,
          tipo: true,
          dataSessao: true,
          status: true,
          criadoEm: true,
        },
        orderBy: { criadoEm: 'desc' },
        take: TETO_LISTA,
      });
      await this.auditoria.registrar(
        tx,
        user,
        'LISTOU',
        'Documento',
        pacienteId,
      );
      return achadas;
    });
    if (!linhas) throw new NotFoundException(PACIENTE_NAO_ENCONTRADO);
    return linhas.map((l) => ({ ...l, dataSessao: dia(l.dataSessao) }));
  }

  async obter(user: UsuarioAutenticado, pacienteId: string, id: string) {
    const linha = await this.tenant.runComoUsuario(user, async (tx) => {
      // Uma consulta so: documento alheio, de outro paciente seu ou inexistente = mesmo 404.
      const achado = await tx.documento.findFirst({
        where: {
          id,
          pacienteId,
          clinicaId: user.clinicaId,
          psicologoId: user.psicologoId,
        },
      });
      // 404 nao grava: nao existe leitura a registrar.
      if (achado)
        await this.auditoria.registrar(tx, user, 'LEU', 'Documento', id);
      return achado;
    });
    if (!linha) throw new NotFoundException(DOCUMENTO_NAO_ENCONTRADO);
    return this.completo(linha);
  }

  private pacienteDoUsuario(
    tx: Prisma.TransactionClient,
    user: UsuarioAutenticado,
    id: string,
  ) {
    return tx.paciente.findFirst({
      where: { id, clinicaId: user.clinicaId, psicologoId: user.psicologoId },
      select: { id: true },
    });
  }

  private completo(l: Documento) {
    try {
      return {
        id: l.id,
        pacienteId: l.pacienteId,
        tipo: l.tipo,
        dataSessao: dia(l.dataSessao),
        conteudo: this.cripto.decifrar(
          l.clinicaId,
          l.conteudoCifrado,
          aadDe('Documento', 'conteudoCifrado', l.id, l.psicologoId),
        ),
        status: l.status,
        criadoEm: l.criadoEm,
        atualizadoEm: l.atualizadoEm,
      };
    } catch (e) {
      // So o tipo: a excecao nao carrega o texto, mas nao arriscamos.
      this.logger.error(`falha ao decifrar documento: ${(e as Error).name}`);
      throw new InternalServerErrorException();
    }
  }
}
