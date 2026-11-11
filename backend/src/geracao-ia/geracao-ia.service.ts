import { randomUUID } from 'node:crypto';
import {
  ConflictException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { GeracaoIa, Prisma } from '@prisma/client';
import { AuditoriaService } from '../auditoria/auditoria.service';
import type { UsuarioAutenticado } from '../auth/jwt-auth.guard';
import { ConsentimentoService } from '../consentimento/consentimento.service';
import { CriptografiaService } from '../criptografia/criptografia.service';
import { DocumentosService } from '../documentos/documentos.service';
import {
  anonimizar,
  TextoIaInvalidoError,
  validarTamanho,
} from '../ia/anonimizador';
import { IA_CONFIG, type IaConfig } from '../ia/ia.config';
import { PacientesService } from '../pacientes/pacientes.service';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { inicioDoDia, proximaMeiaNoite } from './dia-sp';
import type { PreviaIaDto } from './geracao-ia.dto';
import { GeracaoIaExecutor } from './geracao-ia.executor';
import { aadGeracao, SO_PACIENTE_VIVO } from './geracao-ia.tipos';

const PREVIA_VALE_MS = 30 * 60_000;
// PENDENTE sem terminar ha mais que isso vira FALHOU (o SelahIA espera ate 45 s; o cliente, 50 s).
const PENDENTE_VELHO_MS = 120_000;

const IA_INDISPONIVEL = 'IA indisponivel';
const PACIENTE_NAO_ENCONTRADO = 'Paciente nao encontrado';
const DOCUMENTO_NAO_ENCONTRADO = 'Documento nao encontrado';
const GERACAO_NAO_ENCONTRADA = 'Geracao nao encontrada';
const SO_NOTA_BRUTA = 'A origem precisa ser uma nota bruta';
const NOTA_LONGA =
  'Nota longa demais para a IA (maximo 8000 caracteres apos anonimizar)';
const PREVIA_EXPIRADA = 'Previa expirada, gere outra';
const NAO_E_PREVIA = 'Esta geracao nao esta em previa';
const FALHA_DE_CONFIG = 'Falha de configuracao da IA, avise o suporte';
const JA_EM_ANDAMENTO = 'Ja ha uma geracao em andamento';

// 429 do limite diario: o controller le `retryAfterSeg` para o cabecalho Retry-After.
export class LimiteDiarioException extends HttpException {
  constructor(
    corpo: { limite: number; usadas: number; renovaEm: Date },
    readonly retryAfterSeg: number,
  ) {
    super(
      { mensagem: 'Limite diario de geracoes por IA atingido', ...corpo },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}

type Resposta = { status: 200 | 202; corpo: object };

// Pedidos de geracao por IA. Clinica e psicologo SEMPRE do token; todo acesso por
// runComoUsuario; auditoria na MESMA transacao. NUNCA I/O de rede aqui (o executor chama o
// SelahIA fora de transacao) e nunca texto clinico em log, erro ou auditoria.
@Injectable()
export class GeracaoIaService {
  private readonly logger = new Logger(GeracaoIaService.name);

  constructor(
    private readonly tenant: TenantPrismaService,
    private readonly cripto: CriptografiaService,
    private readonly auditoria: AuditoriaService,
    private readonly consentimento: ConsentimentoService,
    private readonly documentos: DocumentosService,
    private readonly pacientes: PacientesService,
    private readonly executor: GeracaoIaExecutor,
    @Inject(IA_CONFIG) private readonly config: IaConfig,
  ) {}

  // Item 20: anonimiza a nota e mostra o texto que SAIRIA. Nada vai a IA aqui.
  async previa(
    user: UsuarioAutenticado,
    pacienteId: string,
    origemId: string,
    dto: PreviaIaDto,
  ) {
    if (!this.config.habilitada) {
      throw new ServiceUnavailableException(IA_INDISPONIVEL);
    }
    const id = randomUUID();
    return this.tenant.runComoUsuario(user, async (tx) => {
      const dono = { clinicaId: user.clinicaId, psicologoId: user.psicologoId };
      const paciente = await tx.paciente.findFirst({
        where: { id: pacienteId, ...dono, excluidoEm: null },
      });
      if (!paciente) throw new NotFoundException(PACIENTE_NAO_ENCONTRADO);
      const origem = await tx.documento.findFirst({
        where: { id: origemId, pacienteId, ...dono },
      });
      if (!origem) throw new NotFoundException(DOCUMENTO_NAO_ENCONTRADO);
      await this.consentimento.exigirConcedido(tx, user, pacienteId);
      if (origem.tipo !== 'NOTA_BRUTA')
        throw new ConflictException(SO_NOTA_BRUTA);

      const psicologo = await tx.psicologo.findFirstOrThrow({
        where: { id: user.psicologoId, clinicaId: user.clinicaId },
        select: { abordagemPadrao: true },
      });
      const { textoAnonimizado, mapa } = anonimizar(
        this.documentos.textoDe(origem),
        {
          nomesPaciente: [this.pacientes.nomeDe(paciente)],
          termosExtras: dto.termosExtras,
        },
      );
      try {
        validarTamanho(textoAnonimizado);
      } catch (e) {
        if (e instanceof TextoIaInvalidoError) {
          throw new UnprocessableEntityException(NOTA_LONGA);
        }
        throw e;
      }

      const expiraEm = new Date(Date.now() + PREVIA_VALE_MS);
      await tx.geracaoIa.create({
        data: {
          id,
          ...dono,
          pacienteId,
          origemId,
          tipoDocumento: dto.tipoDocumento,
          abordagem: psicologo.abordagemPadrao,
          estado: 'PREVIA',
          textoCifrado: this.cripto.cifrar(
            user.clinicaId,
            textoAnonimizado,
            aadGeracao('textoCifrado', id, user.psicologoId),
          ),
          mapaCifrado: this.cripto.cifrar(
            user.clinicaId,
            JSON.stringify(mapa),
            aadGeracao('mapaCifrado', id, user.psicologoId),
          ),
          expiraEm,
        },
      });
      await this.auditoria.registrar(tx, user, 'PREVIA_IA', 'GeracaoIa', id);
      return {
        id,
        estado: 'PREVIA' as const,
        tipoDocumento: dto.tipoDocumento,
        textoAnonimizado,
        expiraEm,
      };
    });
  }

  // Item 21: o cliente nunca reenvia texto, so confirma. UPDATE condicional atomico: so o
  // vencedor da corrida dispara a chamada, e so DEPOIS do commit.
  async confirmar(user: UsuarioAutenticado, id: string): Promise<Resposta> {
    const dono = { clinicaId: user.clinicaId, psicologoId: user.psicologoId };
    let r: { resposta: Resposta; disparar: boolean };
    try {
      r = await this.tenant.runComoUsuario(user, async (tx) => {
        await this.expirarPendentes(tx, user);
        const ler = () =>
          tx.geracaoIa.findFirst({
            where: { id, ...dono, ...SO_PACIENTE_VIVO },
          });
        const g = await ler();
        if (!g) throw new NotFoundException(GERACAO_NAO_ENCONTRADA);
        const pronta = this.respostaSemDisparar(g);
        if (pronta) return { resposta: pronta, disparar: false };

        if (!this.config.habilitada) {
          throw new ServiceUnavailableException(IA_INDISPONIVEL);
        }
        const agora = new Date(Date.now());
        const usadas = await this.usadas(tx, user, agora);
        if (usadas >= this.config.limiteDiario) {
          const renovaEm = proximaMeiaNoite(agora);
          throw new LimiteDiarioException(
            { limite: this.config.limiteDiario, usadas, renovaEm },
            Math.max(
              1,
              Math.ceil((renovaEm.getTime() - agora.getTime()) / 1000),
            ),
          );
        }
        const u = await tx.geracaoIa.updateMany({
          where: {
            id,
            ...dono,
            ...SO_PACIENTE_VIVO,
            OR: [
              { estado: 'PREVIA', expiraEm: { gt: agora } },
              { estado: 'FALHOU', retentavel: true },
            ],
          },
          data: {
            estado: 'PENDENTE',
            motivo: null,
            retentavel: null,
            finalizadoEm: null,
          },
        });
        if (u.count === 0) {
          // Outra confirmacao ganhou (ou a previa expirou no meio): responde pelo estado atual.
          const atual = await ler();
          if (!atual) throw new NotFoundException(GERACAO_NAO_ENCONTRADA);
          const resposta = this.respostaSemDisparar(atual);
          if (resposta) return { resposta, disparar: false };
          throw new ConflictException(PREVIA_EXPIRADA);
        }
        // Dado vai sair do sistema (a 1a vez e cada retentativa): fica na trilha, na mesma transacao.
        await this.auditoria.registrar(tx, user, 'ENVIOU_IA', 'GeracaoIa', id);
        return {
          resposta: { status: 202, corpo: { id, estado: 'PENDENTE' } },
          disparar: true,
        };
      });
    } catch (e) {
      // Indice parcial: ja existe OUTRA geracao PENDENTE deste psicologo.
      if ((e as { code?: string }).code === 'P2002') {
        throw new HttpException(JA_EM_ANDAMENTO, HttpStatus.TOO_MANY_REQUESTS);
      }
      throw e;
    }
    if (r.disparar) void this.executor.executar(id, dono);
    return r.resposta;
  }

  // Item 21 (consulta): sem texto. PENDENTE velho vira FALHOU na leitura (cobre reinicio do servidor).
  async consultar(user: UsuarioAutenticado, id: string) {
    const g = await this.tenant.runComoUsuario(user, async (tx) => {
      await this.expirarPendentes(tx, user);
      return tx.geracaoIa.findFirst({
        where: {
          id,
          clinicaId: user.clinicaId,
          psicologoId: user.psicologoId,
          ...SO_PACIENTE_VIVO,
        },
      });
    });
    if (!g) throw new NotFoundException(GERACAO_NAO_ENCONTRADA);
    return this.consulta(g);
  }

  async listar(user: UsuarioAutenticado, pacienteId: string) {
    const linhas = await this.tenant.runComoUsuario(user, async (tx) => {
      const dono = { clinicaId: user.clinicaId, psicologoId: user.psicologoId };
      const paciente = await tx.paciente.findFirst({
        where: { id: pacienteId, ...dono, excluidoEm: null },
        select: { id: true },
      });
      if (!paciente) return null;
      await this.expirarPendentes(tx, user);
      return tx.geracaoIa.findMany({
        where: { pacienteId, ...dono },
        orderBy: { criadoEm: 'desc' },
        take: 20,
      });
    });
    if (!linhas) throw new NotFoundException(PACIENTE_NAO_ENCONTRADO);
    return linhas.map((g) => this.consulta(g));
  }

  // Reabrir a previa (quem voltou ao app): so enquanto PREVIA e dentro do prazo.
  async obterPrevia(user: UsuarioAutenticado, id: string) {
    return this.tenant.runComoUsuario(user, async (tx) => {
      const g = await tx.geracaoIa.findFirst({
        where: {
          id,
          clinicaId: user.clinicaId,
          psicologoId: user.psicologoId,
          ...SO_PACIENTE_VIVO,
        },
      });
      if (!g) throw new NotFoundException(GERACAO_NAO_ENCONTRADA);
      if (g.estado !== 'PREVIA' || !g.textoCifrado) {
        throw new ConflictException(NAO_E_PREVIA);
      }
      if (g.expiraEm.getTime() <= Date.now()) {
        throw new ConflictException(PREVIA_EXPIRADA);
      }
      let textoAnonimizado: string;
      try {
        textoAnonimizado = this.cripto.decifrar(
          g.clinicaId,
          g.textoCifrado,
          aadGeracao('textoCifrado', g.id, g.psicologoId),
        );
      } catch (e) {
        // So o tipo do erro: a excecao nao carrega o texto, mas nao arriscamos.
        this.logger.error(`falha ao decifrar geracao: ${(e as Error).name}`);
        throw new InternalServerErrorException();
      }
      await this.auditoria.registrar(tx, user, 'LEU', 'GeracaoIa', id);
      return { textoAnonimizado, expiraEm: g.expiraEm };
    });
  }

  async uso(user: UsuarioAutenticado) {
    const agora = new Date(Date.now());
    const usadas = await this.tenant.runComoUsuario(user, (tx) =>
      this.usadas(tx, user, agora),
    );
    return {
      habilitada: this.config.habilitada,
      limite: this.config.limiteDiario,
      usadas,
      renovaEm: proximaMeiaNoite(agora),
    };
  }

  // Estados que respondem sem disparar nada (ou recusam). null = pode disparar.
  private respostaSemDisparar(g: GeracaoIa): Resposta | null {
    if (g.estado === 'PRONTO') return { status: 200, corpo: this.consulta(g) };
    if (g.estado === 'PENDENTE') {
      return { status: 202, corpo: { id: g.id, estado: 'PENDENTE' } };
    }
    if (g.estado === 'PREVIA' && g.expiraEm.getTime() <= Date.now()) {
      throw new ConflictException(PREVIA_EXPIRADA);
    }
    if (g.estado === 'FALHOU' && g.retentavel !== true) {
      throw new ConflictException(FALHA_DE_CONFIG);
    }
    return null;
  }

  private async expirarPendentes(
    tx: Prisma.TransactionClient,
    user: UsuarioAutenticado,
  ) {
    await tx.geracaoIa.updateMany({
      where: {
        clinicaId: user.clinicaId,
        psicologoId: user.psicologoId,
        estado: 'PENDENTE',
        atualizadoEm: { lt: new Date(Date.now() - PENDENTE_VELHO_MS) },
      },
      data: {
        estado: 'FALHOU',
        motivo: 'TEMPO_ESGOTADO',
        retentavel: true,
        finalizadoEm: new Date(Date.now()),
      },
    });
  }

  private usadas(
    tx: Prisma.TransactionClient,
    user: UsuarioAutenticado,
    agora: Date,
  ) {
    // So PRONTO conta: FALHOU e PENDENTE nao gastam o limite.
    return tx.geracaoIa.count({
      where: {
        clinicaId: user.clinicaId,
        psicologoId: user.psicologoId,
        estado: 'PRONTO',
        finalizadoEm: { gte: inicioDoDia(agora) },
      },
    });
  }

  private consulta(g: GeracaoIa) {
    return {
      id: g.id,
      estado: g.estado,
      tipoDocumento: g.tipoDocumento,
      origemId: g.origemId,
      documentoId: g.documentoId,
      motivo: g.motivo,
      retentavel: g.retentavel,
      avisos: g.avisos,
      criadoEm: g.criadoEm,
      finalizadoEm: g.finalizadoEm,
    };
  }
}
