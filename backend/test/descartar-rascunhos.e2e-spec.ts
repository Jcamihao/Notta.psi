import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import {
  armazemPrisma,
  descartarVencidos,
  formatar,
  Opcoes,
} from '../src/ferramentas/descartar';
import { PrismaService } from '../src/prisma/prisma.service';
import { TenantPrismaService } from '../src/prisma/tenant-prisma.service';
import { apagarClinicas, comoOwner } from './acesso-owner';

// Retencao de rascunho (item 52A) no Postgres real: a funcao descartar_rascunhos_vencidos, o comando
// (armazemPrisma + descartarVencidos) e as permissoes. Padrao dos vizinhos: notta_app para o runtime,
// notta_owner (comoOwner) para o dono. Envelhecer linhas = o dono muda atualizadoEm (producao intacta:
// a funcao recebe o corte como parametro e nao depende do relogio do banco).
if (!process.env.DATABASE_URL_OWNER) {
  throw new Error(
    'DATABASE_URL_OWNER ausente: teste de descarte exige o papel notta_owner (ver backend/README.md)',
  );
}

const DIA = 24 * 60 * 60 * 1000;
const agora = () => new Date();
const ha = (dias: number) => new Date(Date.now() - dias * DIA);

const app = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_URL! } },
});
const tenant = new TenantPrismaService(app as unknown as PrismaService);
const sufixo = randomUUID().slice(0, 8);

type U = { clinicaId: string; psicologoId: string };
const CLINICAS = [
  randomUUID(),
  randomUUID(),
  randomUUID(),
  randomUUID(),
  randomUUID(),
  randomUUID(),
  randomUUID(),
];
const [A, B, C, D, E, F, G] = CLINICAS;
const SENTINELA = 'TEXTO-CLINICO-SENTINELA-52A';

async function criarClinica(id: string) {
  await tenant.run(id, (tx) =>
    tx.clinica.create({
      data: { id, nome: `desc-${id.slice(0, 8)}-${sufixo}` },
    }),
  );
}

async function criarPsi(clinicaId: string, nome: string): Promise<U> {
  const p = await tenant.run(clinicaId, (tx) =>
    tx.psicologo.create({
      data: {
        clinicaId,
        nome,
        email: `${nome}-${sufixo}@teste.local`,
        senhaHash: 'x',
        abordagemPadrao: 'TCC',
        // Criado pelo ADMIN: senha provisoria (a policy de insert do runtime exige).
        senhaProvisoria: true,
      },
    }),
  );
  return { clinicaId, psicologoId: p.id };
}

async function criarPaciente(u: U): Promise<string> {
  return tenant.runComoUsuario(u, async (tx) => {
    const id = randomUUID();
    await tx.paciente.create({
      data: {
        id,
        clinicaId: u.clinicaId,
        psicologoId: u.psicologoId,
        nomeCifrado: 'x',
      },
    });
    return id;
  });
}

// Rascunho criado pelo runtime (notta_app). `atualizadoEm` fica como o banco/Prisma definir.
async function rascunho(
  u: U,
  pacienteId: string,
  extra: { geradoPorIa?: boolean; substituiId?: string } = {},
): Promise<string> {
  return tenant.runComoUsuario(u, async (tx) => {
    const id = randomUUID();
    await tx.documento.create({
      data: {
        id,
        clinicaId: u.clinicaId,
        psicologoId: u.psicologoId,
        pacienteId,
        tipo: 'NOTA_BRUTA',
        conteudoCifrado: SENTINELA,
        ...extra,
      },
    });
    return id;
  });
}

// O dono envelhece um rascunho: atualizadoEm = `dias` atras. So para teste.
async function envelhecer(u: U, id: string, dias: number) {
  await comoOwner(
    u.clinicaId,
    (tx) =>
      tx.documento.update({
        where: { id },
        data: { atualizadoEm: ha(dias) },
      }),
    { psicologoId: u.psicologoId },
  );
}

// Aprovado com atualizadoEm antigo (o app grava atualizadoEm no UPDATE de aprovacao).
async function aprovadoEm(
  u: U,
  pacienteId: string,
  dias: number,
): Promise<string> {
  const id = await rascunho(u, pacienteId);
  const antigo = ha(dias);
  await tenant.runComoUsuario(u, (tx) =>
    tx.documento.update({
      where: { id },
      data: { status: 'APROVADO', aprovadoEm: antigo, atualizadoEm: antigo },
    }),
  );
  return id;
}

// GeracaoIa pelo dono (o pedido e criado PREVIA e avanca pelas transicoes do trigger).
async function geracao(
  u: U,
  origemId: string,
  alvo: {
    estado: 'PREVIA' | 'PENDENTE' | 'FALHOU' | 'PRONTO';
    documentoId?: string;
  },
): Promise<string> {
  const id = randomUUID();
  const opts = { psicologoId: u.psicologoId };
  const origem = await comoOwner(
    u.clinicaId,
    (tx) =>
      tx.documento.findUniqueOrThrow({
        where: { id: origemId },
        select: { pacienteId: true },
      }),
    opts,
  );
  await comoOwner(
    u.clinicaId,
    (tx) =>
      tx.geracaoIa.create({
        data: {
          id,
          clinicaId: u.clinicaId,
          psicologoId: u.psicologoId,
          pacienteId: origem.pacienteId,
          origemId,
          tipoDocumento: 'EVOLUCAO',
          abordagem: 'TCC',
          estado: 'PREVIA',
          textoCifrado: 't',
          mapaCifrado: 'm',
          expiraEm: new Date(Date.now() + DIA),
        },
      }),
    opts,
  );
  if (alvo.estado === 'PREVIA') return id;
  await comoOwner(
    u.clinicaId,
    (tx) =>
      tx.geracaoIa.update({ where: { id }, data: { estado: 'PENDENTE' } }),
    opts,
  );
  if (alvo.estado === 'PENDENTE') return id;
  if (alvo.estado === 'FALHOU') {
    await comoOwner(
      u.clinicaId,
      (tx) =>
        tx.geracaoIa.update({
          where: { id },
          data: {
            estado: 'FALHOU',
            motivo: 'REDE',
            retentavel: true,
            finalizadoEm: agora(),
          },
        }),
      opts,
    );
    return id;
  }
  await comoOwner(
    u.clinicaId,
    (tx) =>
      tx.geracaoIa.update({
        where: { id },
        data: {
          estado: 'PRONTO',
          documentoId: alvo.documentoId,
          finalizadoEm: agora(),
          textoCifrado: null,
          mapaCifrado: null,
          motivo: null,
          retentavel: null,
        },
      }),
    opts,
  );
  return id;
}

// Quem ainda existe (leitura do dono, com o psicologo no contexto).
async function existentesDocs(u: U, ids: string[]): Promise<Set<string>> {
  const achados = await comoOwner(
    u.clinicaId,
    (tx) =>
      tx.documento.findMany({
        where: { id: { in: ids } },
        select: { id: true },
      }),
    { psicologoId: u.psicologoId },
  );
  return new Set(achados.map((d) => d.id));
}

async function existentesGer(u: U, ids: string[]): Promise<Set<string>> {
  const achados = await comoOwner(
    u.clinicaId,
    (tx) =>
      tx.geracaoIa.findMany({
        where: { id: { in: ids } },
        select: { id: true },
      }),
    { psicologoId: u.psicologoId },
  );
  return new Set(achados.map((g) => g.id));
}

async function descartesDe(u: U, recursoIds: string[]): Promise<string[]> {
  const linhas = await comoOwner(
    u.clinicaId,
    (tx) =>
      tx.auditoria.findMany({
        where: {
          acao: 'DESCARTOU',
          recurso: 'Documento',
          recursoId: { in: recursoIds },
        },
        select: { recursoId: true, psicologoId: true, clinicaId: true },
      }),
    { psicologoId: u.psicologoId },
  );
  for (const l of linhas) {
    if (l.clinicaId !== u.clinicaId || l.psicologoId !== u.psicologoId) {
      throw new Error('auditoria DESCARTOU com dono errado');
    }
  }
  return linhas.map((l) => l.recursoId as string);
}

async function rodar(op: Partial<Opcoes>, dias = 7) {
  const owner = new PrismaClient({
    datasources: { db: { url: process.env.DATABASE_URL_OWNER! } },
  });
  try {
    return await descartarVencidos(
      armazemPrisma(owner),
      { lote: 500, dryRun: false, ...op },
      { agora: agora(), dias },
    );
  } finally {
    await owner.$disconnect();
  }
}

// Cenario principal (clinica A), montado uma vez; o comando roda uma vez sobre ele.

let psiA: U;
let psiP: U;
let pacA: string;
let pacP: string;
let pacExcluido: string;
let aprovado: string;
const ids = {
  velho: '',
  recente: '',
  quaseVencido: '',
  editadoAgora: '',
  previa: '',
  falhou: '',
  origemPronto: '',
  geradoPronto: '',
  pendenteOrigem: '',
  corrige: '',
  pacienteExcluido: '',
};
const gerPrevia = { id: '' };
const gerFalhou = { id: '' };
const gerPronto = { id: '' };
const gerPendente = { id: '' };

beforeAll(async () => {
  for (const id of CLINICAS) await criarClinica(id);
  psiA = await criarPsi(A, 'desc-a');
  psiP = await criarPsi(A, 'desc-p');
  pacA = await criarPaciente(psiA);
  pacP = await criarPaciente(psiP);
  pacExcluido = await criarPaciente(psiA);

  ids.velho = await rascunho(psiA, pacA);
  await envelhecer(psiA, ids.velho, 10);

  ids.recente = await rascunho(psiA, pacA);
  await envelhecer(psiA, ids.recente, 1);

  ids.quaseVencido = await rascunho(psiA, pacA);
  await envelhecer(psiA, ids.quaseVencido, 6.5);

  // Vencido por idade, mas editado agora: a edicao zera o prazo.
  ids.editadoAgora = await rascunho(psiA, pacA);
  await envelhecer(psiA, ids.editadoAgora, 8);
  await tenant.runComoUsuario(psiA, (tx) =>
    tx.documento.update({
      where: { id: ids.editadoAgora },
      data: { conteudoCifrado: 'nova versao' },
    }),
  );

  // Aprovado velho: nunca apagado (com corte de 1900 ja fica antes do corte de 7 dias).
  aprovado = await aprovadoEm(psiA, pacA, 365 * 120);

  // Rascunho com GeracaoIa PREVIA (como origem).
  ids.previa = await rascunho(psiA, pacA);
  await envelhecer(psiA, ids.previa, 10);
  gerPrevia.id = await geracao(psiA, ids.previa, { estado: 'PREVIA' });

  // Rascunho com GeracaoIa FALHOU (como origem).
  ids.falhou = await rascunho(psiA, pacA);
  await envelhecer(psiA, ids.falhou, 10);
  gerFalhou.id = await geracao(psiA, ids.falhou, { estado: 'FALHOU' });

  // Origem de geracao PRONTA cujo documento gerado tambem e rascunho velho.
  ids.origemPronto = await rascunho(psiA, pacA);
  await envelhecer(psiA, ids.origemPronto, 10);
  ids.geradoPronto = await rascunho(psiA, pacA, { geradoPorIa: true });
  await envelhecer(psiA, ids.geradoPronto, 10);
  gerPronto.id = await geracao(psiA, ids.origemPronto, {
    estado: 'PRONTO',
    documentoId: ids.geradoPronto,
  });

  // Rascunho velho com GeracaoIa PENDENTE (executor em voo): fica.
  ids.pendenteOrigem = await rascunho(psiP, pacP);
  await envelhecer(psiP, ids.pendenteOrigem, 10);
  gerPendente.id = await geracao(psiP, ids.pendenteOrigem, {
    estado: 'PENDENTE',
  });

  // Rascunho que corrige o aprovado (substituiId): sai; o aprovado fica.
  ids.corrige = await rascunho(psiA, pacA, { substituiId: aprovado });
  await envelhecer(psiA, ids.corrige, 10);

  // Rascunho de paciente excluido (anonimizacao): sai.
  ids.pacienteExcluido = await rascunho(psiA, pacExcluido);
  await envelhecer(psiA, ids.pacienteExcluido, 10);
  await comoOwner(
    A,
    async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.anonimizando', '1', true)`;
      await tx.paciente.update({
        where: { id: pacExcluido },
        data: { excluidoEm: agora() },
      });
    },
    { psicologoId: psiA.psicologoId },
  );
});

afterAll(async () => {
  await apagarClinicas(CLINICAS);
  await app.$disconnect();
});

describe('descarte: regras do comando (clinica A)', () => {
  let resultado: Awaited<ReturnType<typeof rodar>>;

  beforeAll(async () => {
    resultado = await rodar({ clinicaId: A });
  });

  it('apaga o rascunho vencido e nao o recente, o quase vencido ou o editado agora', async () => {
    const restam = await existentesDocs(psiA, [
      ids.velho,
      ids.recente,
      ids.quaseVencido,
      ids.editadoAgora,
    ]);
    expect(restam.has(ids.velho)).toBe(false);
    expect(restam.has(ids.recente)).toBe(true);
    expect(restam.has(ids.quaseVencido)).toBe(true);
    expect(restam.has(ids.editadoAgora)).toBe(true);
  });

  it('APROVADO velho nunca e apagado, mesmo com prazo gigante (corte de ~100 anos)', async () => {
    // 36500 dias: o corte cai bem depois de 1900 (data do aprovado): so o status o protege.
    const r = await rodar({ clinicaId: A }, 36500);
    expect(r.total.documentos).toBe(0);
    const restam = await existentesDocs(psiA, [aprovado]);
    expect(restam.has(aprovado)).toBe(true);
  });

  it('apaga o rascunho que corrige um aprovado, sem tocar o aprovado', async () => {
    const restam = await existentesDocs(psiA, [ids.corrige, aprovado]);
    expect(restam.has(ids.corrige)).toBe(false);
    expect(restam.has(aprovado)).toBe(true);
  });

  it('GeracaoIa PREVIA e FALHOU (como origem) saem junto com o rascunho', async () => {
    const docs = await existentesDocs(psiA, [ids.previa, ids.falhou]);
    expect(docs.size).toBe(0);
    const gers = await existentesGer(psiA, [gerPrevia.id, gerFalhou.id]);
    expect(gers.size).toBe(0);
  });

  it('GeracaoIa PRONTA ligada ao rascunho como GERADO sai, e o rascunho gerado tambem', async () => {
    const docs = await existentesDocs(psiA, [
      ids.origemPronto,
      ids.geradoPronto,
    ]);
    expect(docs.size).toBe(0);
    const gers = await existentesGer(psiA, [gerPronto.id]);
    expect(gers.size).toBe(0);
  });

  it('rascunho de paciente excluido tambem sai', async () => {
    const docs = await existentesDocs(psiA, [ids.pacienteExcluido]);
    expect(docs.size).toBe(0);
  });

  it('rascunho com GeracaoIa PENDENTE fica, e a propria geracao tambem', async () => {
    const docs = await existentesDocs(psiP, [ids.pendenteOrigem]);
    expect(docs.has(ids.pendenteOrigem)).toBe(true);
    const gers = await existentesGer(psiP, [gerPendente.id]);
    expect(gers.has(gerPendente.id)).toBe(true);
  });

  it('conta o que apagou: 7 documentos (um deles e o gerado) e 3 geracoes', () => {
    expect(resultado.total).toEqual({
      clinicas: 1,
      selecionados: 7,
      documentos: 7,
      geracoes: 3,
    });
  });

  it('grava uma auditoria DESCARTOU por documento apagado, com o dono do documento', async () => {
    const apagados = [
      ids.velho,
      ids.previa,
      ids.falhou,
      ids.origemPronto,
      ids.geradoPronto,
      ids.corrige,
      ids.pacienteExcluido,
    ];
    const achados = await descartesDe(psiA, apagados);
    expect([...achados].sort()).toEqual([...apagados].sort());
    // Sem auditoria para o que ficou.
    const nada = await descartesDe(psiA, [
      ids.recente,
      ids.quaseVencido,
      aprovado,
    ]);
    expect(nada).toEqual([]);
  });

  it('a saida do comando so tem numeros e ids de clinica', () => {
    const linhas = formatar(resultado);
    const permitida =
      /^(prazo=\d+ dias corte=\S+|clinica [0-9a-f-]{36}: selecionados=\d+ documentos=\d+ geracoes=\d+|total: clinicas=\d+ selecionados=\d+ documentos=\d+ geracoes=\d+|gravado: .*)$/;
    for (const l of linhas) expect(l).toMatch(permitida);
    expect(linhas.join('\n')).not.toContain(SENTINELA);
  });

  it('rodar de novo nao apaga mais nada (idempotente)', async () => {
    const r = await rodar({ clinicaId: A });
    expect(r.total.documentos).toBe(0);
    expect(r.total.geracoes).toBe(0);
  });
});

describe('descarte: dry-run, isolamento, permissoes e concorrencia', () => {
  it('dry-run conta, nao grava e nao audita', async () => {
    const psi = await criarPsi(C, 'desc-c');
    const pac = await criarPaciente(psi);
    const x = await rascunho(psi, pac);
    const y = await rascunho(psi, pac);
    await envelhecer(psi, x, 10);
    await envelhecer(psi, y, 10);
    const r = await rodar({ clinicaId: C, dryRun: true });
    expect(r.total.documentos).toBe(2);
    expect(r.dryRun).toBe(true);
    const restam = await existentesDocs(psi, [x, y]);
    expect(restam.size).toBe(2);
    expect(await descartesDe(psi, [x, y])).toEqual([]);
  });

  it('--clinica isola: rascunho vencido de outra clinica nao e tocado', async () => {
    const psiB = await criarPsi(B, 'desc-b');
    const pac = await criarPaciente(psiB);
    const alheio = await rascunho(psiB, pac);
    await envelhecer(psiB, alheio, 10);
    await rodar({ clinicaId: C });
    const restam = await existentesDocs(psiB, [alheio]);
    expect(restam.has(alheio)).toBe(true);
    await rodar({ clinicaId: B });
    expect((await existentesDocs(psiB, [alheio])).size).toBe(0);
  });

  it('lista de clinicas (sem --clinica) traz as clinicas de teste', async () => {
    const owner = new PrismaClient({
      datasources: { db: { url: process.env.DATABASE_URL_OWNER! } },
    });
    try {
      const todas = await armazemPrisma(owner).clinicas();
      expect(todas).toEqual(expect.arrayContaining([A, B, C, D, E]));
    } finally {
      await owner.$disconnect();
    }
  });

  it('notta_app nao executa a funcao, nao lista clinicas e nao apaga (permissao negada)', async () => {
    await expect(
      app.$queryRaw`SELECT * FROM descartar_rascunhos_vencidos(now(), 10, false)`,
    ).rejects.toThrow(/permission denied/);
    await expect(
      app.$queryRaw`SELECT clinicas_para_descarte()`,
    ).rejects.toThrow(/permission denied/);
    const psi = await criarPsi(E, 'desc-e-app');
    const pac = await criarPaciente(psi);
    const x = await rascunho(psi, pac);
    await envelhecer(psi, x, 10);
    await expect(
      tenant.runComoUsuario(psi, (tx) =>
        tx.documento.deleteMany({ where: { id: x } }),
      ),
    ).rejects.toThrow(/permission denied/);
    expect((await existentesDocs(psi, [x])).has(x)).toBe(true);
  });

  it('sem contexto de clinica, leitura do runtime continua vazia', async () => {
    const linhas = await app.documento.findMany({ select: { id: true } });
    expect(linhas).toEqual([]);
  });

  it('duas execucoes simultaneas nao falham e nao apagam em dobro', async () => {
    const psi = await criarPsi(D, 'desc-d');
    const pac = await criarPaciente(psi);
    const lista: string[] = [];
    for (let i = 0; i < 7; i++) {
      const id = await rascunho(psi, pac);
      await envelhecer(psi, id, 10);
      lista.push(id);
    }
    const [r1, r2] = await Promise.all([
      rodar({ clinicaId: D, lote: 2 }),
      rodar({ clinicaId: D, lote: 2 }),
    ]);
    expect(r1.total.documentos + r2.total.documentos).toBe(7);
    expect((await existentesDocs(psi, lista)).size).toBe(0);
    const auditados = await descartesDe(psi, lista);
    expect(auditados).toHaveLength(7);
    expect(new Set(auditados).size).toBe(7);
  });
});

describe('descarte: aprovado gerado e corrida com a IA (clinica F)', () => {
  it('rascunho de origem sai, o aprovado gerado fica 100% intacto e a trilha ENVIOU_IA segue', async () => {
    const psi = await criarPsi(F, 'desc-f1');
    const pac = await criarPaciente(psi);
    const origem = await rascunho(psi, pac);
    await envelhecer(psi, origem, 10);
    const gerado = await rascunho(psi, pac, { geradoPorIa: true });
    const gerId = await geracao(psi, origem, {
      estado: 'PRONTO',
      documentoId: gerado,
    });
    // O psicologo aprova o gerado (atualizadoEm antigo: so o status o protege).
    await tenant.runComoUsuario(psi, (tx) =>
      tx.documento.update({
        where: { id: gerado },
        data: {
          status: 'APROVADO',
          aprovadoEm: ha(30),
          atualizadoEm: ha(30),
        },
      }),
    );
    await tenant.runComoUsuario(psi, (tx) =>
      tx.auditoria.create({
        data: {
          clinicaId: F,
          psicologoId: psi.psicologoId,
          acao: 'ENVIOU_IA',
          recurso: 'GeracaoIa',
          recursoId: gerId,
        },
      }),
    );
    const antes = await comoOwner(
      F,
      (tx) => tx.documento.findUniqueOrThrow({ where: { id: gerado } }),
      { psicologoId: psi.psicologoId },
    );

    const r = await rodar({ clinicaId: F });
    expect(r.total).toEqual({
      clinicas: 1,
      selecionados: 1,
      documentos: 1,
      geracoes: 1,
    });
    expect((await existentesDocs(psi, [origem])).size).toBe(0);
    expect((await existentesGer(psi, [gerId])).size).toBe(0);
    const depois = await comoOwner(
      F,
      (tx) => tx.documento.findUniqueOrThrow({ where: { id: gerado } }),
      { psicologoId: psi.psicologoId },
    );
    expect(depois).toEqual(antes);
    expect(depois.status).toBe('APROVADO');
    const trilha = await comoOwner(
      F,
      (tx) =>
        tx.auditoria.findMany({
          where: { recursoId: gerId, acao: 'ENVIOU_IA' },
          select: { id: true },
        }),
      { psicologoId: psi.psicologoId },
    );
    expect(trilha).toHaveLength(1);
    expect(await descartesDe(psi, [gerado])).toEqual([]);
  });

  it('GeracaoIa que vira PENDENTE entre a selecao e o delete: o rascunho fica (recheca sob lock)', async () => {
    const psi = await criarPsi(F, 'desc-f2');
    const pac = await criarPaciente(psi);
    const origem = await rascunho(psi, pac);
    await envelhecer(psi, origem, 10);
    const gerId = await geracao(psi, origem, { estado: 'PREVIA' });

    const exec = new PrismaClient({
      datasources: { db: { url: process.env.DATABASE_URL_OWNER! } },
    });
    try {
      let soltar!: () => void;
      let travou!: () => void;
      const travado = new Promise<void>((res) => (travou = res));
      const segura = new Promise<void>((res) => (soltar = res));
      // "Executor": PREVIA -> PENDENTE, transacao ainda aberta (o descarte nao ve o PENDENTE).
      const tx1 = new TenantPrismaService(exec as unknown as PrismaService).run(
        F,
        async (tx) => {
          await tx.geracaoIa.update({
            where: { id: gerId },
            data: { estado: 'PENDENTE' },
          });
          travou();
          await segura;
        },
        { psicologoId: psi.psicologoId },
      );
      await travado;
      const descarte = rodar({ clinicaId: F });
      await new Promise((r) => setTimeout(r, 800));
      soltar();
      await tx1;
      const r = await descarte;
      expect(r.total.selecionados).toBe(1);
      expect(r.total.documentos).toBe(0);
      expect(r.total.geracoes).toBe(0);
    } finally {
      await exec.$disconnect();
    }
    expect((await existentesDocs(psi, [origem])).has(origem)).toBe(true);
    expect((await existentesGer(psi, [gerId])).has(gerId)).toBe(true);
    expect(await descartesDe(psi, [origem])).toEqual([]);
  });

  it('rascunho travado por outra transacao e pulado sem esperar (SKIP LOCKED); sai na rodada seguinte', async () => {
    const psi = await criarPsi(F, 'desc-f3');
    const pac = await criarPaciente(psi);
    const travadoId = await rascunho(psi, pac);
    const livreId = await rascunho(psi, pac);
    await envelhecer(psi, travadoId, 10);
    await envelhecer(psi, livreId, 10);

    const outro = new PrismaClient({
      datasources: { db: { url: process.env.DATABASE_URL_OWNER! } },
    });
    try {
      let soltar!: () => void;
      let travou!: () => void;
      const travado = new Promise<void>((res) => (travou = res));
      const segura = new Promise<void>((res) => (soltar = res));
      const tx1 = new TenantPrismaService(
        outro as unknown as PrismaService,
      ).run(
        F,
        async (tx) => {
          await tx.$queryRaw`SELECT id FROM "Documento" WHERE id = ${travadoId} FOR UPDATE`;
          travou();
          await segura;
        },
        { psicologoId: psi.psicologoId },
      );
      await travado;
      // Se esperasse o lock, a rodada so terminaria depois de soltar() (que vem depois do await).
      const r = await Promise.race([
        rodar({ clinicaId: F }),
        new Promise<'travou'>((res) => setTimeout(() => res('travou'), 8000)),
      ]);
      soltar();
      await tx1;
      expect(r).not.toBe('travou');
      const feito = r as Awaited<ReturnType<typeof rodar>>;
      expect(feito.total.documentos).toBe(1);
      expect((await existentesDocs(psi, [livreId])).size).toBe(0);
      expect((await existentesDocs(psi, [travadoId])).has(travadoId)).toBe(
        true,
      );
    } finally {
      await outro.$disconnect();
    }
    await rodar({ clinicaId: F });
    expect((await existentesDocs(psi, [travadoId])).size).toBe(0);
  });

  it('o corte vale em UTC mesmo se o fuso da sessao do banco nao for UTC', async () => {
    const psi = await criarPsi(G, 'desc-g1');
    const pac = await criarPaciente(psi);
    const corte = new Date(Date.now() - 7 * DIA);
    const vencido = await rascunho(psi, pac);
    const naoVencido = await rascunho(psi, pac);
    await comoOwner(
      G,
      async (tx) => {
        await tx.documento.update({
          where: { id: vencido },
          data: { atualizadoEm: new Date(corte.getTime() - 3600_000) },
        });
        await tx.documento.update({
          where: { id: naoVencido },
          data: { atualizadoEm: new Date(corte.getTime() + 3600_000) },
        });
      },
      { psicologoId: psi.psicologoId },
    );
    const owner = new PrismaClient({
      datasources: { db: { url: process.env.DATABASE_URL_OWNER! } },
    });
    const chamar = (fuso: string, simular: boolean) =>
      owner.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('timezone', ${fuso}, true)`;
        await tx.$executeRaw`SELECT set_config('app.current_clinica_id', ${G}, true)`;
        const [r] = await tx.$queryRaw<
          { selecionados: number; documentos: number }[]
        >`
          SELECT selecionados, documentos FROM descartar_rascunhos_vencidos(
            CAST(${corte.toISOString()} AS timestamptz), 1000, CAST(${simular} AS boolean))`;
        return r;
      });
    try {
      // Fusos a leste e a oeste de UTC: o resultado nao pode mudar.
      expect((await chamar('Asia/Tokyo', true)).selecionados).toBe(1);
      expect((await chamar('Pacific/Kiritimati', true)).selecionados).toBe(1);
      const r = await chamar('America/Los_Angeles', false);
      expect(r.documentos).toBe(1);
    } finally {
      await owner.$disconnect();
    }
    expect((await existentesDocs(psi, [vencido])).size).toBe(0);
    expect((await existentesDocs(psi, [naoVencido])).has(naoVencido)).toBe(
      true,
    );
  });
});
