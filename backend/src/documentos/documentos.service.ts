import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { Documento, Prisma } from '@prisma/client';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { descarteEm } from '../comum/retencao';
import type { UsuarioAutenticado } from '../auth/jwt-auth.guard';
import { ConsentimentoService } from '../consentimento/consentimento.service';
import {
  aadDe,
  CriptografiaService,
} from '../criptografia/criptografia.service';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import type {
  CriarDocumentoDto,
  EditarDocumentoDto,
  StatusDocumento,
} from './documentos.dto';

const TETO_LISTA = 200;
const PACIENTE_NAO_ENCONTRADO = 'Paciente nao encontrado';
const DOCUMENTO_NAO_ENCONTRADO = 'Documento nao encontrado';
const APROVADO_NAO_EDITA = 'Documento aprovado nao pode ser editado';
const JA_APROVADO = 'Documento ja aprovado';
const SO_APROVADO_CORRIGE = 'So documento aprovado pode ser corrigido';
const CORPO_VAZIO = 'Informe conteudo ou dataSessao';

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
      if (dto.substituiId)
        await this.exigirAprovado(tx, user, pacienteId, dto.substituiId);
      const criado = await tx.documento.create({
        data: {
          id,
          clinicaId: user.clinicaId,
          psicologoId: user.psicologoId,
          pacienteId,
          tipo: dto.tipo,
          dataSessao: dto.dataSessao ? new Date(dto.dataSessao) : null,
          conteudoCifrado,
          substituiId: dto.substituiId ?? null,
        },
      });
      await this.auditoria.registrar(tx, user, 'CRIOU', 'Documento', id);
      return criado;
    });
    if (!linha) throw new NotFoundException(PACIENTE_NAO_ENCONTRADO);
    return this.completo(linha);
  }

  // So metadados: nada e decifrado (nem lido) aqui.
  async listar(
    user: UsuarioAutenticado,
    pacienteId: string,
    status?: StatusDocumento,
  ) {
    const linhas = await this.tenant.runComoUsuario(user, async (tx) => {
      if (!(await this.pacienteDoUsuario(tx, user, pacienteId))) return null;
      const achadas = await tx.documento.findMany({
        where: {
          pacienteId,
          clinicaId: user.clinicaId,
          psicologoId: user.psicologoId,
          ...(status && { status }),
        },
        select: {
          id: true,
          tipo: true,
          dataSessao: true,
          status: true,
          aprovadoEm: true,
          substituiId: true,
          geradoPorIa: true,
          criadoEm: true,
          atualizadoEm: true,
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
    return linhas.map(({ atualizadoEm, ...l }) => ({
      ...l,
      dataSessao: dia(l.dataSessao),
      descarteEm: this.descarteDe(l.status, atualizadoEm),
    }));
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
          paciente: { excluidoEm: null },
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

  // Atomico: o `status = 'RASCUNHO'` no WHERE do UPDATE e a decisao (nao um SELECT antes). Se uma
  // aprovacao concorrente ganhar, o UPDATE reavalia o WHERE apos o lock e acha 0 linhas.
  async editar(
    user: UsuarioAutenticado,
    pacienteId: string,
    id: string,
    dto: EditarDocumentoDto,
  ) {
    if (dto.conteudo === undefined && dto.dataSessao === undefined)
      throw new BadRequestException(CORPO_VAZIO);
    // Mesmo AAD da criacao (id e dono nao mudam): a leitura decifra igual.
    const conteudoCifrado =
      dto.conteudo === undefined
        ? undefined
        : this.cripto.cifrar(
            user.clinicaId,
            dto.conteudo,
            aadDe('Documento', 'conteudoCifrado', id, user.psicologoId),
          );
    const linha = await this.tenant.runComoUsuario(user, async (tx) => {
      const r = await tx.documento.updateMany({
        where: { ...this.dono(user, pacienteId, id), status: 'RASCUNHO' },
        data: {
          conteudoCifrado,
          dataSessao:
            dto.dataSessao === undefined
              ? undefined
              : dto.dataSessao && new Date(dto.dataSessao),
        },
      });
      if (r.count === 0)
        return this.recusar(tx, user, pacienteId, id, APROVADO_NAO_EDITA);
      await this.auditoria.registrar(tx, user, 'EDITOU', 'Documento', id);
      return tx.documento.findFirstOrThrow({
        where: this.dono(user, pacienteId, id),
      });
    });
    return this.completo(linha);
  }

  // Irreversivel (o trigger do banco tambem barra qualquer UPDATE em aprovado). Vale com
  // consentimento revogado: o documento nasceu sob consentimento.
  async aprovar(user: UsuarioAutenticado, pacienteId: string, id: string) {
    const linha = await this.tenant.runComoUsuario(user, async (tx) => {
      const r = await tx.documento.updateMany({
        where: { ...this.dono(user, pacienteId, id), status: 'RASCUNHO' },
        data: { status: 'APROVADO', aprovadoEm: new Date() },
      });
      if (r.count === 0)
        return this.recusar(tx, user, pacienteId, id, JA_APROVADO);
      await this.auditoria.registrar(tx, user, 'APROVOU', 'Documento', id);
      return tx.documento.findFirstOrThrow({
        where: this.dono(user, pacienteId, id),
      });
    });
    return this.completo(linha);
  }

  // Rascunho vindo da IA (item 20/21), chamado pelo executor DENTRO da transacao dele, com o `id`
  // ja escolhido (o pedido GeracaoIa aponta para ele). So aqui se cifra o texto gerado.
  async criarGeradoPorIa(
    tx: Prisma.TransactionClient,
    user: Pick<UsuarioAutenticado, 'clinicaId' | 'psicologoId'>,
    d: {
      id: string;
      pacienteId: string;
      tipo: 'EVOLUCAO' | 'ANAMNESE';
      conteudo: string;
    },
  ) {
    await tx.documento.create({
      data: {
        id: d.id,
        clinicaId: user.clinicaId,
        psicologoId: user.psicologoId,
        pacienteId: d.pacienteId,
        tipo: d.tipo,
        conteudoCifrado: this.cripto.cifrar(
          user.clinicaId,
          d.conteudo,
          aadDe('Documento', 'conteudoCifrado', d.id, user.psicologoId),
        ),
        geradoPorIa: true,
      },
    });
    await this.auditoria.registrar(tx, user, 'CRIOU', 'Documento', d.id);
  }

  // Texto decifrado de uma nota (origem da geracao por IA). Falha = 500 generico, so o tipo no log.
  textoDe(
    l: Pick<Documento, 'id' | 'clinicaId' | 'psicologoId' | 'conteudoCifrado'>,
  ) {
    try {
      return this.cripto.decifrar(
        l.clinicaId,
        l.conteudoCifrado,
        aadDe('Documento', 'conteudoCifrado', l.id, l.psicologoId),
      );
    } catch (e) {
      this.logger.error(`falha ao decifrar documento: ${(e as Error).name}`);
      throw new InternalServerErrorException();
    }
  }

  // Paciente excluido (item 26) some do prontuario: documento dele = 404, como o inexistente.
  private dono(user: UsuarioAutenticado, pacienteId: string, id: string) {
    return {
      id,
      pacienteId,
      clinicaId: user.clinicaId,
      psicologoId: user.psicologoId,
      paciente: { excluidoEm: null },
    };
  }

  // UPDATE de 0 linhas: aprovado = 409 com `mensagem`; alheio, de outro paciente e inexistente = 404.
  private async recusar(
    tx: Prisma.TransactionClient,
    user: UsuarioAutenticado,
    pacienteId: string,
    id: string,
    mensagem: string,
  ): Promise<never> {
    const achado = await tx.documento.findFirst({
      where: this.dono(user, pacienteId, id),
      select: { status: true },
    });
    if (achado?.status === 'APROVADO') throw new ConflictException(mensagem);
    throw new NotFoundException(DOCUMENTO_NAO_ENCONTRADO);
  }

  // Correcao so de documento APROVADO do mesmo paciente (a FK ja garante paciente e dono).
  private async exigirAprovado(
    tx: Prisma.TransactionClient,
    user: UsuarioAutenticado,
    pacienteId: string,
    id: string,
  ) {
    const achado = await tx.documento.findFirst({
      where: this.dono(user, pacienteId, id),
      select: { status: true },
    });
    if (!achado) throw new NotFoundException(DOCUMENTO_NAO_ENCONTRADO);
    if (achado.status !== 'APROVADO')
      throw new ConflictException(SO_APROVADO_CORRIGE);
  }

  private pacienteDoUsuario(
    tx: Prisma.TransactionClient,
    user: UsuarioAutenticado,
    id: string,
  ) {
    return tx.paciente.findFirst({
      where: {
        id,
        clinicaId: user.clinicaId,
        psicologoId: user.psicologoId,
        excluidoEm: null,
      },
      select: { id: true },
    });
  }

  // So rascunho tem data de descarte (atualizadoEm + prazo). Aprovado nunca e apagado: null.
  private descarteDe(status: string, atualizadoEm: Date): Date | null {
    return status === 'RASCUNHO' ? descarteEm(atualizadoEm) : null;
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
        aprovadoEm: l.aprovadoEm,
        substituiId: l.substituiId,
        geradoPorIa: l.geradoPorIa,
        criadoEm: l.criadoEm,
        atualizadoEm: l.atualizadoEm,
        descarteEm: this.descarteDe(l.status, l.atualizadoEm),
      };
    } catch (e) {
      // So o tipo: a excecao nao carrega o texto, mas nao arriscamos.
      this.logger.error(`falha ao decifrar documento: ${(e as Error).name}`);
      throw new InternalServerErrorException();
    }
  }
}
