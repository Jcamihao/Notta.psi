import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { Paciente, Prisma } from '@prisma/client';
import type { UsuarioAutenticado } from '../auth/jwt-auth.guard';
import {
  aadDe,
  CriptografiaService,
} from '../criptografia/criptografia.service';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import type { CriarPacienteDto, EditarPacienteDto } from './pacientes.dto';

const TETO_LISTA = 500;
const NAO_ENCONTRADO = 'Paciente nao encontrado';

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
  ) {}

  async criar(user: UsuarioAutenticado, dto: CriarPacienteDto) {
    // id no app, antes do INSERT: ele entra no AAD.
    const id = randomUUID();
    const cifrados = this.cifrar(user, id, dto);
    const linha = await this.tenant.runComoUsuario(user, (tx) =>
      tx.paciente.create({
        data: {
          id,
          clinicaId: user.clinicaId,
          psicologoId: user.psicologoId,
          nomeCifrado: cifrados.nomeCifrado!,
          ...cifrados,
        },
      }),
    );
    return this.paraResposta(linha);
  }

  async listar(user: UsuarioAutenticado) {
    const linhas = await this.tenant.runComoUsuario(user, (tx) =>
      tx.paciente.findMany({
        where: { clinicaId: user.clinicaId, psicologoId: user.psicologoId },
        orderBy: { criadoEm: 'asc' },
        take: TETO_LISTA,
      }),
    );
    return linhas
      .map((l) => this.paraResposta(l))
      .sort((a, b) =>
        a.nome.localeCompare(b.nome, 'pt-BR', { sensitivity: 'base' }),
      );
  }

  async obter(user: UsuarioAutenticado, id: string) {
    const linha = await this.tenant.runComoUsuario(user, (tx) =>
      this.buscar(tx, user, id),
    );
    if (!linha) throw new NotFoundException(NAO_ENCONTRADO);
    return this.paraResposta(linha);
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
        where: { id, clinicaId: user.clinicaId, psicologoId: user.psicologoId },
        data: cifrados,
      });
      return r.count === 1 ? this.buscar(tx, user, id) : null;
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
      where: { id, clinicaId: user.clinicaId, psicologoId: user.psicologoId },
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
