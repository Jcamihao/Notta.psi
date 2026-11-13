import { randomUUID } from 'node:crypto';
import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { UsuarioAutenticado } from '../auth/jwt-auth.guard';
import { AuditoriaService } from '../auditoria/auditoria.service';
import {
  aadDe,
  CriptografiaService,
} from '../criptografia/criptografia.service';
import { aadGeracao } from '../geracao-ia/geracao-ia.tipos';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import type { CriarTransferenciaDto } from './transferencias.dto';

const NAO_ENCONTRADO = 'Pedido nao encontrado';
const GERACAO_EM_ANDAMENTO =
  'Há uma geração de IA em andamento. Tente de novo em instantes.';
const PEDIDO_ABERTO =
  'Ja existe um pedido de transferencia aberto para este psicologo';
// Tamanho do lote (pacientes por chamada de executar). Teto da funcao transferencia_origem.
const LOTE = 50;
// SQLSTATE das funcoes: P0002 = no_data_found (404 identico); P0001 = bloqueio de IA (409);
// 23505 = corrida no indice de pedido aberto (409).
const SQL_NAO_ENCONTRADO = 'P0002';
const SQL_BLOQUEADA = 'P0001';
const SQL_UNICO = '23505';

type LinhaPedido = {
  id: string;
  origem_id: string;
  origem_nome: string;
  destino_id: string;
  destino_nome: string;
  criado_por_id: string;
  estado: string;
  criado_em: Date;
  expira_em: Date;
  concluido_em: Date | null;
  total: number;
};

// Saida de transferencia_origem: origem e destino vem do PEDIDO, nunca do cliente.
type Origem = {
  origemId: string;
  destinoId: string;
  pacientes: {
    id: string;
    nomeCifrado: string;
    nascimentoCifrado: string | null;
    telefoneCifrado: string | null;
    emailCifrado: string | null;
  }[];
  documentos: { id: string; pacienteId: string; conteudoCifrado: string }[];
  geracoes: {
    id: string;
    pacienteId: string;
    textoCifrado: string | null;
    mapaCifrado: string | null;
  }[];
  restantes: number;
};

// Entrada de transferencia_aplicar: os NOVOS cifrados (AAD do destino).
type Payload = {
  pacientes: {
    id: string;
    nomeCifrado: string;
    nascimentoCifrado: string | null;
    telefoneCifrado: string | null;
    emailCifrado: string | null;
  }[];
  documentos: { id: string; pacienteId: string; conteudoCifrado: string }[];
  geracoes: {
    id: string;
    pacienteId: string;
    textoCifrado: string | null;
    mapaCifrado: string | null;
  }[];
};

// Transferencia de pacientes (item 67). Quem decide e o BANCO (funcoes SECURITY DEFINER). Aqui: o
// recifrar do lote (AAD antigo -> AAD novo), a trilha na mesma transacao e a traducao dos erros do banco.
// Nunca loga nome, texto, cifrado nem id de paciente: so o NOME do tipo do erro.
@Injectable()
export class TransferenciasService {
  private readonly logger = new Logger(TransferenciasService.name);

  constructor(
    private readonly tenant: TenantPrismaService,
    private readonly cripto: CriptografiaService,
    private readonly auditoria: AuditoriaService,
  ) {}

  async criar(user: UsuarioAutenticado, dto: CriarTransferenciaDto) {
    // id no app: a funcao o grava e a trilha o usa.
    const id = randomUUID();
    const linha = await this.comErros(() =>
      this.tenant.runComoUsuario(user, async (tx) => {
        await tx.$executeRaw`SELECT pedido_transferencia_criar(${id}::uuid, ${dto.origemId}, ${dto.destinoId})`;
        await this.auditoria.registrar(
          tx,
          user,
          'PEDIU_TRANSFERENCIA',
          'PedidoTransferencia',
          id,
        );
        return this.lerVisivel(tx, id);
      }),
    );
    return {
      id: linha.id,
      origemId: linha.origem_id,
      destinoId: linha.destino_id,
      estado: linha.estado,
      expiraEm: linha.expira_em,
      total: linha.total,
    };
  }

  // O que o chamador pode ver (a policy decide): ADMIN, todos da clinica; outro, so os dirigidos a ele.
  async listar(user: UsuarioAutenticado) {
    const linhas = await this.tenant.runComoUsuario(
      user,
      (tx) =>
        tx.$queryRaw<
          LinhaPedido[]
        >`SELECT * FROM pedidos_transferencia_visiveis()`,
    );
    return linhas.map(paraResposta);
  }

  // So contagens de pacientes vivos por psicologo DESATIVADO (ADMIN). Nenhum nome de paciente.
  async contagens(user: UsuarioAutenticado) {
    const linhas = await this.comErros(() =>
      this.tenant.runComoUsuario(
        user,
        (tx) =>
          tx.$queryRaw<
            { psicologo_id: string; total: number }[]
          >`SELECT psicologo_id, total FROM transferencia_contagens()`,
      ),
    );
    return linhas.map((l) => ({ psicologoId: l.psicologo_id, total: l.total }));
  }

  async aceitar(user: UsuarioAutenticado, id: string) {
    await this.comErros(() =>
      this.tenant.runComoUsuario(user, async (tx) => {
        await tx.$executeRaw`SELECT pedido_transferencia_aceitar(${id}::uuid)`;
        await this.auditoria.registrar(
          tx,
          user,
          'ACEITOU_TRANSFERENCIA',
          'PedidoTransferencia',
          id,
        );
      }),
    );
    return { estado: 'ACEITO' as const };
  }

  async recusar(user: UsuarioAutenticado, id: string) {
    await this.comErros(() =>
      this.tenant.runComoUsuario(user, async (tx) => {
        await tx.$executeRaw`SELECT pedido_transferencia_recusar(${id}::uuid)`;
        await this.auditoria.registrar(
          tx,
          user,
          'RECUSOU_TRANSFERENCIA',
          'PedidoTransferencia',
          id,
        );
      }),
    );
    return { estado: 'RECUSADO' as const };
  }

  async cancelar(user: UsuarioAutenticado, id: string) {
    await this.comErros(() =>
      this.tenant.runComoUsuario(user, async (tx) => {
        await tx.$executeRaw`SELECT pedido_transferencia_cancelar(${id}::uuid)`;
        await this.auditoria.registrar(
          tx,
          user,
          'CANCELOU_TRANSFERENCIA',
          'PedidoTransferencia',
          id,
        );
      }),
    );
    return { estado: 'CANCELADO' as const };
  }

  // Executa UM lote, pelo DESTINO, em UMA transacao: trava o lote no banco, decifra com o AAD da origem,
  // recifra com o AAD do destino (em memoria, sem rede), aplica no banco (que confere o conjunto exato),
  // grava a trilha. Qualquer falha desfaz tudo. Resposta: so contagens.
  async executar(user: UsuarioAutenticado, id: string) {
    return this.comErros(() =>
      this.tenant.runComoUsuario(user, async (tx) => {
        const [{ dados }] = await tx.$queryRaw<
          { dados: Origem }[]
        >`SELECT transferencia_origem(${id}::uuid, ${LOTE}::int) AS dados`;
        const payload = this.recifrarLote(user.clinicaId, dados);
        const [{ resultado }] = await tx.$queryRaw<
          { resultado: { transferidos: number; restantes: number } }[]
        >`SELECT transferencia_aplicar(${id}::uuid, ${JSON.stringify(payload)}::jsonb) AS resultado`;
        for (const p of payload.pacientes) {
          await this.auditoria.registrar(
            tx,
            user,
            'TRANSFERIU',
            'Paciente',
            p.id,
          );
        }
        if (resultado.transferidos > 0) {
          await this.auditoria.registrar(
            tx,
            user,
            'TRANSFERIU_PACIENTES',
            'Psicologo',
            dados.origemId,
          );
          await this.auditoria.registrar(
            tx,
            user,
            'RECEBEU_PACIENTES',
            'Psicologo',
            dados.destinoId,
          );
        }
        return {
          transferidos: resultado.transferidos,
          restantes: resultado.restantes,
        };
      }),
    );
  }

  // Decifra cada cifrado com o AAD da ORIGEM e recifra com o AAD do DESTINO (os dois ids vem do
  // pedido, lidos pelo banco). Nulo continua nulo. Falha de qualquer um = 500 generico, nada parcial.
  private recifrarLote(clinicaId: string, dados: Origem): Payload {
    const { origemId, destinoId } = dados;
    const pacientes = dados.pacientes.map((p) => ({
      id: p.id,
      nomeCifrado: this.trocar(
        clinicaId,
        p.nomeCifrado,
        aadDe('Paciente', 'nomeCifrado', p.id, origemId),
        aadDe('Paciente', 'nomeCifrado', p.id, destinoId),
      ),
      nascimentoCifrado: this.trocarOpcional(
        clinicaId,
        p.nascimentoCifrado,
        aadDe('Paciente', 'nascimentoCifrado', p.id, origemId),
        aadDe('Paciente', 'nascimentoCifrado', p.id, destinoId),
      ),
      telefoneCifrado: this.trocarOpcional(
        clinicaId,
        p.telefoneCifrado,
        aadDe('Paciente', 'telefoneCifrado', p.id, origemId),
        aadDe('Paciente', 'telefoneCifrado', p.id, destinoId),
      ),
      emailCifrado: this.trocarOpcional(
        clinicaId,
        p.emailCifrado,
        aadDe('Paciente', 'emailCifrado', p.id, origemId),
        aadDe('Paciente', 'emailCifrado', p.id, destinoId),
      ),
    }));
    const documentos = dados.documentos.map((d) => ({
      id: d.id,
      pacienteId: d.pacienteId,
      conteudoCifrado: this.trocar(
        clinicaId,
        d.conteudoCifrado,
        aadDe('Documento', 'conteudoCifrado', d.id, origemId),
        aadDe('Documento', 'conteudoCifrado', d.id, destinoId),
      ),
    }));
    const geracoes = dados.geracoes.map((g) => ({
      id: g.id,
      pacienteId: g.pacienteId,
      textoCifrado: this.trocarOpcional(
        clinicaId,
        g.textoCifrado,
        aadGeracao('textoCifrado', g.id, origemId),
        aadGeracao('textoCifrado', g.id, destinoId),
      ),
      mapaCifrado: this.trocarOpcional(
        clinicaId,
        g.mapaCifrado,
        aadGeracao('mapaCifrado', g.id, origemId),
        aadGeracao('mapaCifrado', g.id, destinoId),
      ),
    }));
    return { pacientes, documentos, geracoes };
  }

  private trocar(
    clinicaId: string,
    valor: string,
    aadAntigo: string,
    aadNovo: string,
  ): string {
    try {
      return this.cripto.cifrar(
        clinicaId,
        this.cripto.decifrar(clinicaId, valor, aadAntigo),
        aadNovo,
      );
    } catch (e) {
      this.logger.error(`falha ao recifrar no lote: ${(e as Error).name}`);
      throw new InternalServerErrorException();
    }
  }

  private trocarOpcional(
    clinicaId: string,
    valor: string | null,
    aadAntigo: string,
    aadNovo: string,
  ): string | null {
    return valor === null
      ? null
      : this.trocar(clinicaId, valor, aadAntigo, aadNovo);
  }

  private async lerVisivel(
    tx: Prisma.TransactionClient,
    id: string,
  ): Promise<LinhaPedido> {
    const [linha] = await tx.$queryRaw<
      LinhaPedido[]
    >`SELECT * FROM pedidos_transferencia_visiveis() WHERE id = ${id}::uuid`;
    if (!linha) throw new NotFoundException(NAO_ENCONTRADO);
    return linha;
  }

  // Erro do banco vira resposta de negocio; o resto sobe como esta (500 generico). Log: so o nome do erro.
  private async comErros<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError) {
        const codigo = (e.meta as { code?: string } | undefined)?.code;
        if (codigo === SQL_NAO_ENCONTRADO) {
          throw new NotFoundException(NAO_ENCONTRADO);
        }
        if (codigo === SQL_BLOQUEADA) {
          throw new ConflictException(GERACAO_EM_ANDAMENTO);
        }
        if (codigo === SQL_UNICO) throw new ConflictException(PEDIDO_ABERTO);
      }
      this.logger.error(`falha na transferencia: ${(e as Error).name}`);
      throw e;
    }
  }
}

function paraResposta(l: LinhaPedido) {
  return {
    id: l.id,
    origemId: l.origem_id,
    origemNome: l.origem_nome,
    destinoId: l.destino_id,
    destinoNome: l.destino_nome,
    criadoPorId: l.criado_por_id,
    estado: l.estado,
    criadoEm: l.criado_em,
    expiraEm: l.expira_em,
    concluidoEm: l.concluido_em,
    total: l.total,
  };
}
