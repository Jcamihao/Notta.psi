import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type Paciente } from '@prisma/client';
import type { UsuarioAutenticado } from '../auth/jwt-auth.guard';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { ConsentimentoService } from '../consentimento/consentimento.service';
import {
  aadDe,
  CriptografiaService,
} from '../criptografia/criptografia.service';
import { aadGeracao } from '../geracao-ia/geracao-ia.tipos';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import type { CriarPacienteDto, EditarPacienteDto } from './pacientes.dto';

const TETO_LISTA = 500;
const NAO_ENCONTRADO = 'Paciente nao encontrado';
// Exclusao (item 26): texto FIXO e nao clinico no lugar do conteudo. Cada um e cifrado com o AAD
// da propria linha (nunca reaproveitado de outra).
const TOMBSTONE_NOME = 'Paciente excluido';
const TOMBSTONE_CONTEUDO = 'Conteudo excluido a pedido (LGPD)';
const TOMBSTONE_MAPA = '{}';
// SQLSTATE e codigo da funcao: P0002 = no_data_found; 22023 = tombstone faltando (corrida).
const SQL_NAO_ENCONTRADO = 'P0002';
const SQL_TOMBSTONE_AUSENTE = '22023';

// campo da API -> coluna cifrada. A coluna entra no AAD (cifrado nao troca de coluna).
const COLUNAS = {
  nome: 'nomeCifrado',
  nascimento: 'nascimentoCifrado',
  telefone: 'telefoneCifrado',
  email: 'emailCifrado',
} as const;
type Campo = keyof typeof COLUNAS;
const CAMPOS = Object.keys(COLUNAS) as Campo[];

// nome nunca e null (coluna NOT NULL); os outros 3 aceitam null (limpar).
type Cifrados = {
  nomeCifrado?: string;
  nascimentoCifrado?: string | null;
  telefoneCifrado?: string | null;
  emailCifrado?: string | null;
};

// UNICO lugar que cifra e decifra paciente. Nunca loga nome, nascimento, telefone nem e-mail
// (nem em excecao): so o tipo do erro. Clinica e psicologo SEMPRE do token, nunca do corpo.
@Injectable()
export class PacientesService {
  private readonly logger = new Logger(PacientesService.name);

  constructor(
    private readonly tenant: TenantPrismaService,
    private readonly cripto: CriptografiaService,
    private readonly auditoria: AuditoriaService,
    private readonly consentimento: ConsentimentoService,
  ) {}

  async criar(user: UsuarioAutenticado, dto: CriarPacienteDto) {
    // id no app, antes do INSERT: ele entra no AAD.
    const id = randomUUID();
    const cifrados = this.cifrar(user, id, dto);
    // Auditoria na MESMA transacao: se a trilha falhar, o paciente nao fica criado.
    const linha = await this.tenant.runComoUsuario(user, async (tx) => {
      const criado = await tx.paciente.create({
        data: {
          id,
          clinicaId: user.clinicaId,
          psicologoId: user.psicologoId,
          nomeCifrado: cifrados.nomeCifrado!,
          ...cifrados,
        },
      });
      await this.auditoria.registrar(tx, user, 'CRIOU', 'Paciente', id);
      return criado;
    });
    return this.paraResposta(linha);
  }

  async listar(user: UsuarioAutenticado) {
    const { linhas, estados } = await this.tenant.runComoUsuario(
      user,
      async (tx) => {
        const achadas = await tx.paciente.findMany({
          where: {
            clinicaId: user.clinicaId,
            psicologoId: user.psicologoId,
            excluidoEm: null,
          },
          orderBy: { criadoEm: 'asc' },
          take: TETO_LISTA,
        });
        await this.auditoria.registrar(tx, user, 'LISTOU', 'Paciente');
        // UMA consulta para todos os pacientes (sem N+1).
        const estados = await this.consentimento.estadosDe(
          tx,
          user,
          achadas.map((a) => a.id),
        );
        return { linhas: achadas, estados };
      },
    );
    return linhas
      .map((l) => ({
        ...this.paraResposta(l),
        consentimento: estados.get(l.id) ?? 'NENHUM',
      }))
      .sort((a, b) =>
        a.nome.localeCompare(b.nome, 'pt-BR', { sensitivity: 'base' }),
      );
  }

  async obter(user: UsuarioAutenticado, id: string) {
    const { linha, estado } = await this.tenant.runComoUsuario(
      user,
      async (tx) => {
        const achado = await this.buscar(tx, user, id);
        // 404 nao grava: nao existe leitura a registrar.
        if (!achado) return { linha: null, estado: null };
        await this.auditoria.registrar(tx, user, 'LEU', 'Paciente', id);
        return {
          linha: achado,
          estado: await this.consentimento.estadoDe(tx, user, id),
        };
      },
    );
    if (!linha) throw new NotFoundException(NAO_ENCONTRADO);
    return { ...this.paraResposta(linha), consentimento: estado };
  }

  // Exclusao por ANONIMIZACAO (LGPD, item 26). Tudo numa transacao: a funcao SQL troca o
  // conteudo cifrado por tombstones (que o app calcula aqui) e marca excluidoEm. Sem I/O de rede.
  async excluir(user: UsuarioAutenticado, id: string) {
    const dono = { clinicaId: user.clinicaId, psicologoId: user.psicologoId };
    try {
      const excluidoEm = await this.tenant.runComoUsuario(user, async (tx) => {
        const achado = await tx.paciente.findFirst({
          where: { id, ...dono, excluidoEm: null },
          select: { id: true },
        });
        if (!achado) throw new NotFoundException(NAO_ENCONTRADO);
        const docs = await tx.documento.findMany({
          where: { pacienteId: id, ...dono },
          select: { id: true },
        });
        // Geracao PRONTA ja nao tem texto cifrado (zerado no PRONTO): fica como esta.
        const geracoes = await tx.geracaoIa.findMany({
          where: { pacienteId: id, ...dono, estado: { not: 'PRONTO' } },
          select: { id: true },
        });
        const tombDocs: Record<string, string> = {};
        for (const d of docs) {
          tombDocs[d.id] = this.cripto.cifrar(
            user.clinicaId,
            TOMBSTONE_CONTEUDO,
            aadDe('Documento', 'conteudoCifrado', d.id, user.psicologoId),
          );
        }
        const tombGer: Record<string, { texto: string; mapa: string }> = {};
        for (const g of geracoes) {
          tombGer[g.id] = {
            texto: this.cripto.cifrar(
              user.clinicaId,
              TOMBSTONE_CONTEUDO,
              aadGeracao('textoCifrado', g.id, user.psicologoId),
            ),
            mapa: this.cripto.cifrar(
              user.clinicaId,
              TOMBSTONE_MAPA,
              aadGeracao('mapaCifrado', g.id, user.psicologoId),
            ),
          };
        }
        const nomeT = this.cripto.cifrar(
          user.clinicaId,
          TOMBSTONE_NOME,
          aadDe('Paciente', 'nomeCifrado', id, user.psicologoId),
        );
        const [linha] = await tx.$queryRaw<{ excluidoEm: Date }[]>`
          SELECT anonimizar_paciente(${id}, ${nomeT}, ${JSON.stringify(tombDocs)}::jsonb, ${JSON.stringify(tombGer)}::jsonb) AS "excluidoEm"`;
        // Trilha na MESMA transacao: se ela falhar, a exclusao inteira desfaz.
        await this.auditoria.registrar(tx, user, 'EXCLUIU', 'Paciente', id);
        return linha.excluidoEm;
      });
      return { excluidoEm: excluidoEm.toISOString() };
    } catch (e) {
      throw this.traduzirErroDaFuncao(e);
    }
  }

  // Erro da funcao SQL vira resposta de negocio; qualquer outro erro sobe como esta.
  private traduzirErroDaFuncao(e: unknown): unknown {
    if (e instanceof Prisma.PrismaClientKnownRequestError) {
      const codigo = (e.meta as { code?: string } | undefined)?.code;
      if (codigo === SQL_NAO_ENCONTRADO)
        return new NotFoundException(NAO_ENCONTRADO);
      if (codigo === SQL_TOMBSTONE_AUSENTE) {
        return new ConflictException(
          'Paciente mudou durante a exclusao; tente de novo',
        );
      }
    }
    return e;
  }

  async atualizar(
    user: UsuarioAutenticado,
    id: string,
    dto: EditarPacienteDto,
  ) {
    const cifrados = this.cifrar(user, id, dto);
    if (Object.keys(cifrados).length === 0) {
      throw new BadRequestException('Informe ao menos um campo');
    }
    const linha = await this.tenant.runComoUsuario(user, async (tx) => {
      const r = await tx.paciente.updateMany({
        where: {
          id,
          clinicaId: user.clinicaId,
          psicologoId: user.psicologoId,
          excluidoEm: null,
        },
        data: cifrados,
      });
      if (r.count !== 1) return null;
      await this.auditoria.registrar(tx, user, 'EDITOU', 'Paciente', id);
      return this.buscar(tx, user, id);
    });
    if (!linha) throw new NotFoundException(NAO_ENCONTRADO);
    return this.paraResposta(linha);
  }

  private buscar(
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
    });
  }

  // Cifra so os campos presentes (undefined = nao mexe; null = limpa, so nos opcionais).
  private cifrar(
    user: UsuarioAutenticado,
    id: string,
    dto: { nome?: string } & Partial<
      Record<Exclude<Campo, 'nome'>, string | null>
    >,
  ): Cifrados {
    const saida: Record<string, string | null> = {};
    for (const campo of CAMPOS) {
      const v = dto[campo];
      if (v === undefined) continue;
      saida[COLUNAS[campo]] =
        v === null
          ? null
          : this.cripto.cifrar(
              user.clinicaId,
              v,
              aadDe('Paciente', COLUNAS[campo], id, user.psicologoId),
            );
    }
    return saida;
  }

  // So o nome, decifrado (a geracao por IA precisa dele para anonimizar). Falha = 500 generico.
  nomeDe(
    l: Pick<Paciente, 'id' | 'clinicaId' | 'psicologoId' | 'nomeCifrado'>,
  ) {
    try {
      return this.cripto.decifrar(
        l.clinicaId,
        l.nomeCifrado,
        aadDe('Paciente', COLUNAS.nome, l.id, l.psicologoId),
      );
    } catch (e) {
      this.logger.error(`falha ao decifrar paciente: ${(e as Error).name}`);
      throw new InternalServerErrorException();
    }
  }

  private paraResposta(l: Paciente) {
    const ler = (campo: Campo) => {
      const valor = l[COLUNAS[campo]];
      return valor === null
        ? null
        : this.cripto.decifrar(
            l.clinicaId,
            valor,
            aadDe('Paciente', COLUNAS[campo], l.id, l.psicologoId),
          );
    };
    try {
      return {
        id: l.id,
        nome: ler('nome')!,
        nascimento: ler('nascimento'),
        telefone: ler('telefone'),
        email: ler('email'),
        criadoEm: l.criadoEm,
      };
    } catch (e) {
      // So o tipo: a excecao nao carrega texto da coluna, mas nao arriscamos.
      this.logger.error(`falha ao decifrar paciente: ${(e as Error).name}`);
      throw new InternalServerErrorException();
    }
  }
}
