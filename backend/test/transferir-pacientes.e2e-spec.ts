import { randomUUID } from 'node:crypto';
import { NestExpressApplication } from '@nestjs/platform-express';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import {
  aadDe,
  CriptografiaService,
} from '../src/criptografia/criptografia.service';
import { aadGeracao } from '../src/geracao-ia/geracao-ia.tipos';
import { PrismaService } from '../src/prisma/prisma.service';
import { TenantPrismaService } from '../src/prisma/tenant-prisma.service';
import { comoOwner } from './acesso-owner';
import { CLIENTE_API } from './cliente-api';
import {
  apagarClinicas,
  corpoClinica,
  criarAppSemLimite,
} from './criar-app-sem-limite';

// Transferencia de pacientes (item 67) pela API, no Postgres real: duas autorizacoes (ADMIN cria, DESTINO
// aceita e executa), o 404 identico, a recifragem AAD antigo -> novo, a cascata de psicologoId, a trilha e
// as barreiras do banco. Mexe no esquema (DISABLE TRIGGER para envelhecer um pedido como dono): por isso
// roda na suite serial (test/jest-e2e-serial.json).
if (!process.env.DATABASE_URL_OWNER) {
  throw new Error(
    'DATABASE_URL_OWNER ausente: teste de transferencia exige o papel praxis_owner (ver backend/README.md)',
  );
}

const SENHA = 'senha-forte-123';
const sufixo = randomUUID().slice(0, 8);
const email = (n: string) => `tr-${n}-${sufixo}@teste.local`;
const APP_URL = 'https://app.teste.local';
const CLIENTE = { ...CLIENTE_API, Origin: APP_URL };
const NAO_ENCONTRADO = 'Pedido nao encontrado';
const BLOQUEADA =
  'Há uma geração de IA em andamento. Tente de novo em instantes.';
const TEXTO_RASCUNHO = 'TEXTO-CLINICO-RASCUNHO-TRANSF';
const TEXTO_APROVADO = 'TEXTO-CLINICO-APROVADO-TRANSF';
const TEXTO_CORRECAO = 'TEXTO-CLINICO-CORRECAO-TRANSF';
const NOME_P1 = 'Paciente Transferida Um';
const NOME_P2 = 'Paciente Transferida Dois';
const NOME_P3 = 'Paciente Transferida Tres';
const NOME_P4 = 'Paciente Excluida Antes';
const TEL_P1 = '(11) 99111-2222';
const cripto = new CriptografiaService();

type U = {
  clinicaId: string;
  psicologoId: string;
  token: string;
  nome: string;
};

let app: NestExpressApplication;
let prismaApp: PrismaClient;
let tenant: TenantPrismaService;
const criadas: string[] = [];
let appUrlAntes: string | undefined;

const http = () => request(app.getHttpServer());
const com = (token: string, r: request.Test) =>
  r.set('Authorization', `Bearer ${token}`);

async function login(e: string) {
  const res = await http()
    .post('/auth/login')
    .set(CLIENTE)
    .send({ email: e, senha: SENHA })
    .expect(200);
  return (res.body as { token: string }).token;
}

async function novaClinica(e: string, nome: string): Promise<U> {
  const res = await http()
    .post('/clinicas')
    .set(CLIENTE)
    .send(corpoClinica(e, { senha: SENHA, nomePsicologo: nome }))
    .expect(201);
  const { clinicaId, psicologoId } = res.body as {
    clinicaId: string;
    psicologoId: string;
  };
  criadas.push(clinicaId);
  return { clinicaId, psicologoId, token: await login(e), nome };
}

// Colega criado pelo ADMIN, com a senha trocada (senao toda rota daria 403).
async function novoColega(dono: U, e: string, nome: string): Promise<U> {
  const res = await com(dono.token, http().post('/psicologos'))
    .send({ nome, email: e, senha: SENHA, abordagemPadrao: 'ACT' })
    .expect(201);
  const provisorio = await login(e);
  const troca = await http()
    .post('/auth/trocar-senha')
    .set(CLIENTE)
    .set('Authorization', `Bearer ${provisorio}`)
    .send({ senhaAtual: SENHA, novaSenha: 'senha-definitiva-1' })
    .expect(200);
  return {
    clinicaId: dono.clinicaId,
    psicologoId: (res.body as { psicologoId: string }).psicologoId,
    token: (troca.body as { token: string }).token,
    nome,
  };
}

async function desativar(admin: U, alvo: U) {
  await com(
    admin.token,
    http().post(`/psicologos/${alvo.psicologoId}/desativar`),
  )
    .send({})
    .expect(200);
}

// Convite por link aceito pelo paciente (sem login): vira consentimento CONCEDIDO.
async function consentir(u: U, pacienteId: string) {
  const convite = await com(
    u.token,
    http().post(`/pacientes/${pacienteId}/convites-consentimento`),
  )
    .send({})
    .expect(201);
  const token = (convite.body as { link: string }).link.split('/termo/')[1];
  await http()
    .post(`/publico/consentimento/${token}/aceitar`)
    .set(CLIENTE)
    .send({ aceito: true })
    .expect(200);
}

async function criarPaciente(u: U, nome: string, telefone?: string) {
  const res = await com(u.token, http().post('/pacientes'))
    .send({ nome, ...(telefone && { telefone }) })
    .expect(201);
  return (res.body as { id: string }).id;
}

async function criarDocumento(
  u: U,
  pacienteId: string,
  conteudo: string,
  extra = {},
) {
  const res = await com(
    u.token,
    http().post(`/pacientes/${pacienteId}/documentos`),
  )
    .send({ tipo: 'EVOLUCAO', dataSessao: '2026-10-01', conteudo, ...extra })
    .expect(201);
  return (res.body as { id: string }).id;
}

// Lido como praxis_owner, no contexto de `psicologoId` (RLS do dono). So SELECT.
const comoDono = <T>(
  clinicaId: string,
  psicologoId: string,
  fn: (tx: Parameters<Parameters<typeof comoOwner>[1]>[0]) => Promise<T>,
) => comoOwner(clinicaId, fn, { psicologoId });

// Varre a API: o pedido e a lista de pacientes/docs do destino. Nada de texto clinico em resposta.
const esperaSemTexto = (corpo: unknown, proibidos: string[]) => {
  const s = JSON.stringify(corpo);
  for (const p of proibidos) expect(s).not.toContain(p);
};

function ids(corpo: unknown) {
  return (corpo as { id: string }[]).map((x) => x.id);
}

// Envelhece um pedido como dono (criadoEm e expiraEm juntos, por causa do CHECK de 14 dias). Desliga o
// trigger SO dentro da transacao: o ALTER e DDL, por isso a suite e serial.
async function envelhecerPedido(admin: U, pedidoId: string, dias: number) {
  const criadoEm = new Date(Date.now() - dias * 86_400_000);
  const expiraEm = new Date(criadoEm.getTime() + 14 * 86_400_000);
  // Contexto do ADMIN: a policy de SELECT vale para o UPDATE (o scan), e so o ADMIN ve todos os pedidos.
  await comoOwner(
    admin.clinicaId,
    async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.transferindo', '1', true)`;
      await tx.$executeRawUnsafe(
        `ALTER TABLE "PedidoTransferencia" DISABLE TRIGGER pedido_transferencia_barreira_linha`,
      );
      await tx.$executeRaw`UPDATE "PedidoTransferencia" SET "criadoEm" = ${criadoEm}, "expiraEm" = ${expiraEm} WHERE "id" = ${pedidoId}::uuid`;
      await tx.$executeRawUnsafe(
        `ALTER TABLE "PedidoTransferencia" ENABLE TRIGGER pedido_transferencia_barreira_linha`,
      );
    },
    { psicologoId: admin.psicologoId },
  );
}

beforeAll(async () => {
  appUrlAntes = process.env.PRAXIS_APP_URL;
  process.env.PRAXIS_APP_URL = APP_URL;
  app = await criarAppSemLimite();
  // connection_limit=1 no cliente de teste do banco: prova que o contexto nao vaza entre transacoes.
  const url = new URL(process.env.DATABASE_URL!);
  url.searchParams.set('connection_limit', '1');
  prismaApp = new PrismaClient({
    datasources: { db: { url: url.toString() } },
  });
  tenant = new TenantPrismaService(prismaApp as unknown as PrismaService);
});

afterAll(async () => {
  await apagarClinicas(app, criadas);
  await prismaApp?.$disconnect();
  await app?.close();
  if (appUrlAntes === undefined) delete process.env.PRAXIS_APP_URL;
  else process.env.PRAXIS_APP_URL = appUrlAntes;
});

describe('transferencia de pacientes (item 67, API + banco)', () => {
  // Cenario principal: A (desativado) com 4 pacientes (1 excluido), B (ativo) recebe, C (ativo) observa.
  let admin: U;
  let A: U;
  let B: U;
  let C: U;
  let P1: string;
  let P2: string;
  let P3: string;
  let P4: string;
  let docRascunho: string;
  let docAprovado: string;
  let docCorrecao: string;
  let docP3: string;
  let pedidoId: string;
  let rascunhoAntes: Date;
  const CONVITE_PENDENTE = { id: '' };

  it('cenario: A cria pacientes, consentimento por link, aprova, corrige e exclui; ADMIN desativa A', async () => {
    admin = await novaClinica(email('admin'), 'Admin Transf');
    A = await novoColega(admin, email('a'), 'Psicologa Origem');
    B = await novoColega(admin, email('b'), 'Psicologo Destino');
    C = await novoColega(admin, email('c'), 'Psicologa Terceira');

    P1 = await criarPaciente(A, NOME_P1, TEL_P1);
    P2 = await criarPaciente(A, NOME_P2);
    P3 = await criarPaciente(A, NOME_P3);
    P4 = await criarPaciente(A, NOME_P4);

    // Documento so nasce com consentimento CONCEDIDO por link (o paciente aceita sem login).
    await consentir(A, P1);
    await consentir(A, P2);

    // P3: convite PENDENTE (sem consentimento concedido; vai virar CANCELADO na transferencia).
    const pendente = await com(
      A.token,
      http().post(`/pacientes/${P3}/convites-consentimento`),
    )
      .send({})
      .expect(201);
    CONVITE_PENDENTE.id = (pendente.body as { id: string }).id;

    // P2: rascunho, APROVADO e correcao em rascunho do aprovado.
    docRascunho = await criarDocumento(A, P2, TEXTO_RASCUNHO);
    docAprovado = await criarDocumento(A, P2, TEXTO_APROVADO);
    await com(
      A.token,
      http().post(`/pacientes/${P2}/documentos/${docAprovado}/aprovar`),
    )
      .send({})
      .expect(200);
    docCorrecao = await criarDocumento(A, P2, TEXTO_CORRECAO, {
      substituiId: docAprovado,
    });

    // P3: um documento (origem da geracao previa). Sem consentimento, por isso entra como dono.
    docP3 = randomUUID();
    await comoDono(A.clinicaId, A.psicologoId, (tx) =>
      tx.documento.create({
        data: {
          id: docP3,
          clinicaId: A.clinicaId,
          psicologoId: A.psicologoId,
          pacienteId: P3,
          tipo: 'EVOLUCAO',
          conteudoCifrado: cripto.cifrar(
            A.clinicaId,
            'Nota da P3',
            aadDe('Documento', 'conteudoCifrado', docP3, A.psicologoId),
          ),
        },
      }),
    );

    // P3: GeracaoIa PREVIA com texto e mapa (insert como dono, no contexto de A).
    const geracaoId = randomUUID();
    await comoDono(A.clinicaId, A.psicologoId, (tx) =>
      tx.geracaoIa.create({
        data: {
          id: geracaoId,
          clinicaId: A.clinicaId,
          psicologoId: A.psicologoId,
          pacienteId: P3,
          origemId: docP3,
          tipoDocumento: 'EVOLUCAO',
          abordagem: 'TCC',
          estado: 'PREVIA',
          textoCifrado: cripto.cifrar(
            A.clinicaId,
            'Texto anonimizado da previa',
            aadGeracao('textoCifrado', geracaoId, A.psicologoId),
          ),
          mapaCifrado: cripto.cifrar(
            A.clinicaId,
            '[]',
            aadGeracao('mapaCifrado', geracaoId, A.psicologoId),
          ),
          expiraEm: new Date(Date.now() + 86_400_000),
        },
      }),
    );

    // P4: excluido (anonimizado) por A antes da transferencia: fica com A.
    await com(A.token, http().delete(`/pacientes/${P4}`)).expect(200);

    // Rascunho: marca o relogio de atualizadoEm para comparar depois.
    rascunhoAntes = await comoDono(
      admin.clinicaId,
      A.psicologoId,
      async (tx) => {
        const d = await tx.documento.findUniqueOrThrow({
          where: { id: docRascunho },
        });
        return d.atualizadoEm;
      },
    );

    await desativar(admin, A);
  });

  it('ADMIN cria o pedido A -> B (201, PENDENTE, total = 3 vivos; o excluido nao conta)', async () => {
    const res = await com(admin.token, http().post('/transferencias'))
      .send({ origemId: A.psicologoId, destinoId: B.psicologoId })
      .expect(201);
    const corpo = res.body as Record<string, unknown>;
    expect(Object.keys(corpo).sort()).toEqual(
      ['destinoId', 'estado', 'expiraEm', 'id', 'origemId', 'total'].sort(),
    );
    expect(corpo).toMatchObject({
      origemId: A.psicologoId,
      destinoId: B.psicologoId,
      estado: 'PENDENTE',
      total: 3,
    });
    pedidoId = corpo.id as string;
    esperaSemTexto(corpo, [NOME_P1, NOME_P2, NOME_P3, TEXTO_APROVADO]);
  });

  it('visibilidade: ADMIN e DESTINO veem o pedido; C nao; o destino ve so nome da origem e contagem', async () => {
    const lista = await com(admin.token, http().get('/transferencias')).expect(
      200,
    );
    expect(ids(lista.body)).toContain(pedidoId);

    const deB = await com(B.token, http().get('/transferencias')).expect(200);
    const item = (
      deB.body as { id: string; origemNome: string; total: number }[]
    ).find((x) => x.id === pedidoId);
    expect(item).toMatchObject({ origemNome: 'Psicologa Origem', total: 3 });
    esperaSemTexto(deB.body, [
      NOME_P1,
      NOME_P2,
      NOME_P3,
      TEXTO_RASCUNHO,
      TEXTO_APROVADO,
      TEL_P1,
    ]);

    const deC = await com(C.token, http().get('/transferencias')).expect(200);
    expect(ids(deC.body)).not.toContain(pedidoId);
  });

  it('antes do aceite: B nao executa (404); ADMIN nao aceita nem executa (404); C nao aceita (404)', async () => {
    const exec = await com(
      B.token,
      http().post(`/transferencias/${pedidoId}/executar`),
    ).expect(404);
    expect(exec.body).toMatchObject({ message: NAO_ENCONTRADO });
    const adminAceita = await com(
      admin.token,
      http().post(`/transferencias/${pedidoId}/aceitar`),
    ).expect(404);
    expect(adminAceita.body).toMatchObject({ message: NAO_ENCONTRADO });
    await com(
      admin.token,
      http().post(`/transferencias/${pedidoId}/executar`),
    ).expect(404);
    await com(
      C.token,
      http().post(`/transferencias/${pedidoId}/aceitar`),
    ).expect(404);
  });

  it('o DESTINO aceita (200 ACEITO) e executa o lote: {transferidos: 3, restantes: 0}', async () => {
    const aceita = await com(
      B.token,
      http().post(`/transferencias/${pedidoId}/aceitar`),
    ).expect(200);
    expect(aceita.body).toEqual({ estado: 'ACEITO' });

    const exec = await com(
      B.token,
      http().post(`/transferencias/${pedidoId}/executar`),
    ).expect(200);
    expect(exec.body).toEqual({ transferidos: 3, restantes: 0 });
    esperaSemTexto(exec.body, [NOME_P1, TEXTO_APROVADO]);
  });

  it('B le os 3 pacientes e o texto de todos os documentos (inclusive o APROVADO), e o aprovado segue imutavel', async () => {
    const pacientes = await com(B.token, http().get('/pacientes')).expect(200);
    expect(ids(pacientes.body).sort()).toEqual([P1, P2, P3].sort());
    expect(ids(pacientes.body)).not.toContain(P4);
    const nomes = (pacientes.body as { id: string; nome: string }[]).map(
      (p) => [p.id, p.nome],
    );
    expect(Object.fromEntries(nomes)).toMatchObject({
      [P1]: NOME_P1,
      [P2]: NOME_P2,
      [P3]: NOME_P3,
    });

    const textos = await comoDono(
      admin.clinicaId,
      B.psicologoId,
      async (tx) => {
        const docs = await tx.documento.findMany({ where: { pacienteId: P2 } });
        return Object.fromEntries(
          docs.map((d) => [
            d.id,
            {
              status: d.status,
              substituiId: d.substituiId,
              texto: cripto.decifrar(
                B.clinicaId,
                d.conteudoCifrado,
                aadDe('Documento', 'conteudoCifrado', d.id, B.psicologoId),
              ),
            },
          ]),
        );
      },
    );
    expect(textos[docRascunho]).toMatchObject({
      status: 'RASCUNHO',
      texto: TEXTO_RASCUNHO,
    });
    expect(textos[docAprovado]).toMatchObject({
      status: 'APROVADO',
      texto: TEXTO_APROVADO,
    });
    expect(textos[docCorrecao]).toMatchObject({
      status: 'RASCUNHO',
      substituiId: docAprovado,
      texto: TEXTO_CORRECAO,
    });

    // O aprovado nao muda pela API (imutavel): o PATCH nao passa.
    await com(
      B.token,
      http().patch(`/pacientes/${P2}/documentos/${docAprovado}`),
    )
      .send({ conteudo: 'alterado' })
      .expect((r) => expect(r.status).toBeGreaterThanOrEqual(400));
  });

  it('C e o ADMIN veem 404 identico para os pacientes transferidos (= paciente inexistente)', async () => {
    const padrao = await com(
      C.token,
      http().get(`/pacientes/${randomUUID()}`),
    ).expect(404);
    for (const quem of [C, admin]) {
      for (const p of [P1, P2, P3]) {
        const r = await com(quem.token, http().get(`/pacientes/${p}`)).expect(
          404,
        );
        expect(r.body).toEqual(padrao.body);
      }
    }
  });

  it('banco: psicologoId = B em Paciente, Documento, Consentimento, Convite e GeracaoIa; o excluido segue com A', async () => {
    await comoDono(admin.clinicaId, B.psicologoId, async (tx) => {
      const pacs = await tx.paciente.findMany({
        where: { id: { in: [P1, P2, P3] } },
      });
      expect(pacs.every((p) => p.psicologoId === B.psicologoId)).toBe(true);
      const docs = await tx.documento.findMany({
        where: { pacienteId: { in: [P1, P2, P3] } },
      });
      expect(docs.length).toBe(4);
      expect(docs.every((d) => d.psicologoId === B.psicologoId)).toBe(true);
      const cons = await tx.consentimento.findMany({
        where: { pacienteId: P1 },
      });
      expect(cons.length).toBeGreaterThan(0);
      expect(cons.every((c) => c.psicologoId === B.psicologoId)).toBe(true);
      const ger = await tx.geracaoIa.findMany({ where: { pacienteId: P3 } });
      expect(ger.length).toBe(1);
      expect(ger[0].psicologoId).toBe(B.psicologoId);
    });
    await comoDono(admin.clinicaId, A.psicologoId, async (tx) => {
      const excl = await tx.paciente.findUniqueOrThrow({ where: { id: P4 } });
      expect(excl.psicologoId).toBe(A.psicologoId);
      expect(excl.excluidoEm).not.toBeNull();
    });
  });

  it('recifragem: o AAD antigo (A) nao decifra mais; o novo (B) decifra o nome', async () => {
    const p = await comoDono(admin.clinicaId, B.psicologoId, (tx) =>
      tx.paciente.findUniqueOrThrow({ where: { id: P1 } }),
    );
    expect(
      cripto.decifrar(
        B.clinicaId,
        p.nomeCifrado,
        aadDe('Paciente', 'nomeCifrado', P1, B.psicologoId),
      ),
    ).toBe(NOME_P1);
    expect(() =>
      cripto.decifrar(
        B.clinicaId,
        p.nomeCifrado,
        aadDe('Paciente', 'nomeCifrado', P1, A.psicologoId),
      ),
    ).toThrow();
  });

  it('convite PENDENTE dos transferidos vira CANCELADO (com usadoEm); o consentimento CONCEDIDO segue', async () => {
    await comoDono(admin.clinicaId, B.psicologoId, async (tx) => {
      const c = await tx.conviteConsentimento.findUniqueOrThrow({
        where: { id: CONVITE_PENDENTE.id },
      });
      expect(c.estado).toBe('CANCELADO');
      expect(c.usadoEm).not.toBeNull();
      const conc = await tx.consentimento.findMany({
        where: { pacienteId: P1, evento: 'CONCEDIDO' },
      });
      expect(conc.length).toBe(1);
    });
  });

  it('rascunho mantem atualizadoEm; o pedido ganhou concluidoEm; a trilha esta completa', async () => {
    const depois = await comoDono(
      admin.clinicaId,
      B.psicologoId,
      async (tx) => {
        const d = await tx.documento.findUniqueOrThrow({
          where: { id: docRascunho },
        });
        return d.atualizadoEm;
      },
    );
    expect(depois.getTime()).toBe(rascunhoAntes.getTime());

    const lista = await com(admin.token, http().get('/transferencias')).expect(
      200,
    );
    const item = (
      lista.body as { id: string; estado: string; concluidoEm: string | null }[]
    ).find((x) => x.id === pedidoId);
    expect(item).toMatchObject({ estado: 'ACEITO' });
    expect(item!.concluidoEm).not.toBeNull();

    // A trilha de cada ator e lida no contexto DELE (a policy de auditoria e do proprio psicologo).
    const trilhaDeB = await comoDono(admin.clinicaId, B.psicologoId, (tx) =>
      tx.auditoria.findMany({
        where: {
          clinicaId: admin.clinicaId,
          acao: {
            in: [
              'TRANSFERIU',
              'TRANSFERIU_PACIENTES',
              'RECEBEU_PACIENTES',
              'ACEITOU_TRANSFERENCIA',
            ],
          },
        },
      }),
    );
    const trilhaDoAdmin = await comoDono(
      admin.clinicaId,
      admin.psicologoId,
      (tx) =>
        tx.auditoria.findMany({
          where: { clinicaId: admin.clinicaId, acao: 'PEDIU_TRANSFERENCIA' },
        }),
    );
    const trilha = [...trilhaDeB, ...trilhaDoAdmin];
    const porAcao = (a: string) => trilha.filter((t) => t.acao === a);
    expect(
      porAcao('TRANSFERIU')
        .map((t) => t.recursoId)
        .sort(),
    ).toEqual([P1, P2, P3].sort());
    expect(
      porAcao('TRANSFERIU').every((t) => t.psicologoId === B.psicologoId),
    ).toBe(true);
    expect(porAcao('TRANSFERIU_PACIENTES')[0]).toMatchObject({
      recurso: 'Psicologo',
      recursoId: A.psicologoId,
      psicologoId: B.psicologoId,
    });
    expect(porAcao('RECEBEU_PACIENTES')[0]).toMatchObject({
      recurso: 'Psicologo',
      recursoId: B.psicologoId,
    });
    expect(porAcao('ACEITOU_TRANSFERENCIA')[0]).toMatchObject({
      psicologoId: B.psicologoId,
      recursoId: pedidoId,
    });
    expect(porAcao('PEDIU_TRANSFERENCIA')[0]).toMatchObject({
      psicologoId: admin.psicologoId,
      recurso: 'PedidoTransferencia',
      recursoId: pedidoId,
    });

    // A trilha ANTIGA de A continua com A (linhas nao foram reatribuidas).
    const antigas = await comoDono(admin.clinicaId, A.psicologoId, (tx) =>
      tx.auditoria.count({
        where: { psicologoId: A.psicologoId, recursoId: P1 },
      }),
    );
    expect(antigas).toBeGreaterThan(0);
  });

  it('depois do lote, o pedido nao aceita outro lote: 404 (ja concluido)', async () => {
    await com(
      B.token,
      http().post(`/transferencias/${pedidoId}/executar`),
    ).expect(404);
  });

  // ---- Cenarios independentes (cada um com o proprio colega de origem) ----

  it('um so pedido aberto por origem: o segundo criar da mesma origem vira 404 (o primeiro segue aberto)', async () => {
    const origem = await novoColega(admin, email('dup'), 'Origem Duplicada');
    await criarPaciente(origem, 'Paciente Duplicada');
    await desativar(admin, origem);
    const primeiro = await com(admin.token, http().post('/transferencias'))
      .send({ origemId: origem.psicologoId, destinoId: C.psicologoId })
      .expect(201);
    await com(admin.token, http().post('/transferencias'))
      .send({ origemId: origem.psicologoId, destinoId: B.psicologoId })
      .expect(404);
    await com(
      admin.token,
      http().delete(`/transferencias/${(primeiro.body as { id: string }).id}`),
    ).expect(200);
  });

  it('criar: so ADMIN (403 para psicologo comum); origem ativa, destino inativo, origem=destino, ids inexistentes e de outra clinica = 404 identico', async () => {
    const origem = await novoColega(admin, email('ori'), 'Origem Validacao');
    await criarPaciente(origem, 'Paciente Validacao');
    await desativar(admin, origem);
    const inativo = await novoColega(admin, email('inat'), 'Inativa');
    await desativar(admin, inativo);
    const outra = await novaClinica(email('outra'), 'Outra Clinica');
    const outraOrigem = await novoColega(
      outra,
      email('outra-o'),
      'Outra Origem',
    );
    await criarPaciente(outraOrigem, 'Outro Paciente');
    await desativar(outra, outraOrigem);
    // Origem desativada SEM nenhum paciente vivo: o pedido nao nasce (mesmo 404).
    const vazia = await novoColega(admin, email('vazia'), 'Origem Vazia');
    await desativar(admin, vazia);

    const padrao = await com(admin.token, http().post('/transferencias'))
      .send({ origemId: randomUUID(), destinoId: C.psicologoId })
      .expect(404);
    const casos: [string, string][] = [
      [B.psicologoId, C.psicologoId], // origem ativa
      [origem.psicologoId, inativo.psicologoId], // destino inativo
      [origem.psicologoId, origem.psicologoId], // origem = destino
      [origem.psicologoId, outra.psicologoId], // destino de outra clinica
      [outraOrigem.psicologoId, C.psicologoId], // origem de outra clinica
      [randomUUID(), C.psicologoId], // origem inexistente
      [vazia.psicologoId, C.psicologoId], // origem desativada sem paciente vivo
    ];
    for (const [o, d] of casos) {
      const r = await com(admin.token, http().post('/transferencias'))
        .send({ origemId: o, destinoId: d })
        .expect(404);
      expect(r.body).toEqual(padrao.body);
    }

    await com(B.token, http().post('/transferencias'))
      .send({ origemId: origem.psicologoId, destinoId: C.psicologoId })
      .expect(403);
    await com(B.token, http().get('/transferencias/contagens')).expect(403);
  });

  it('cancelamento: ADMIN cancela o PENDENTE (200 CANCELADO); B nao cancela (403); cancelado nao aceita (404)', async () => {
    const origem = await novoColega(admin, email('can'), 'Origem Cancelar');
    await criarPaciente(origem, 'Paciente Cancelar');
    await desativar(admin, origem);
    const p = await com(admin.token, http().post('/transferencias'))
      .send({ origemId: origem.psicologoId, destinoId: B.psicologoId })
      .expect(201);
    const id = (p.body as { id: string }).id;
    await com(B.token, http().delete(`/transferencias/${id}`)).expect(403);
    const c = await com(
      admin.token,
      http().delete(`/transferencias/${id}`),
    ).expect(200);
    expect(c.body).toEqual({ estado: 'CANCELADO' });
    await com(B.token, http().post(`/transferencias/${id}/aceitar`)).expect(
      404,
    );
    // Cancelado libera a origem para um novo pedido.
    const novo = await com(admin.token, http().post('/transferencias'))
      .send({ origemId: origem.psicologoId, destinoId: B.psicologoId })
      .expect(201);
    await com(
      admin.token,
      http().delete(`/transferencias/${(novo.body as { id: string }).id}`),
    ).expect(200);
  });

  it('recusa pelo DESTINO: RECUSADO; depois nao executa (404); ADMIN nao recusa (404)', async () => {
    const origem = await novoColega(admin, email('rec'), 'Origem Recusada');
    await criarPaciente(origem, 'Paciente Recusada');
    await desativar(admin, origem);
    const p = await com(admin.token, http().post('/transferencias'))
      .send({ origemId: origem.psicologoId, destinoId: B.psicologoId })
      .expect(201);
    const id = (p.body as { id: string }).id;
    await com(admin.token, http().post(`/transferencias/${id}/recusar`)).expect(
      404,
    );
    const r = await com(
      B.token,
      http().post(`/transferencias/${id}/recusar`),
    ).expect(200);
    expect(r.body).toEqual({ estado: 'RECUSADO' });
    await com(B.token, http().post(`/transferencias/${id}/executar`)).expect(
      404,
    );
    await com(B.token, http().post(`/transferencias/${id}/aceitar`)).expect(
      404,
    );
  });

  it('pedido vencido (14 dias) nao aceita, nao recusa e nao executa; o ADMIN ainda cancela', async () => {
    const origem = await novoColega(admin, email('venc'), 'Origem Vencida');
    await criarPaciente(origem, 'Paciente Vencida');
    await desativar(admin, origem);
    const p = await com(admin.token, http().post('/transferencias'))
      .send({ origemId: origem.psicologoId, destinoId: B.psicologoId })
      .expect(201);
    const id = (p.body as { id: string }).id;
    await envelhecerPedido(admin, id, 15);
    await com(B.token, http().post(`/transferencias/${id}/aceitar`)).expect(
      404,
    );
    await com(B.token, http().post(`/transferencias/${id}/recusar`)).expect(
      404,
    );
    await com(admin.token, http().delete(`/transferencias/${id}`)).expect(200);
  });

  it('GeracaoIa PENDENTE na origem: 409 com a mensagem fixa, e NADA muda; quando sai de PENDENTE, transfere', async () => {
    const origem = await novoColega(admin, email('ia'), 'Origem Com IA');
    const pac = await criarPaciente(origem, 'Paciente Com IA');
    await consentir(origem, pac);
    const doc = await criarDocumento(origem, pac, 'Nota com IA');
    const gid = randomUUID();
    await comoDono(admin.clinicaId, origem.psicologoId, (tx) =>
      tx.geracaoIa.create({
        data: {
          id: gid,
          clinicaId: admin.clinicaId,
          psicologoId: origem.psicologoId,
          pacienteId: pac,
          origemId: doc,
          tipoDocumento: 'EVOLUCAO',
          abordagem: 'TCC',
          estado: 'PREVIA',
          textoCifrado: cripto.cifrar(
            admin.clinicaId,
            'Previa',
            aadGeracao('textoCifrado', gid, origem.psicologoId),
          ),
          mapaCifrado: cripto.cifrar(
            admin.clinicaId,
            '[]',
            aadGeracao('mapaCifrado', gid, origem.psicologoId),
          ),
          expiraEm: new Date(Date.now() + 86_400_000),
        },
      }),
    );
    // PREVIA -> PENDENTE (o executor da IA estaria em voo).
    await comoDono(admin.clinicaId, origem.psicologoId, (tx) =>
      tx.geracaoIa.update({ where: { id: gid }, data: { estado: 'PENDENTE' } }),
    );
    await desativar(admin, origem);
    const p = await com(admin.token, http().post('/transferencias'))
      .send({ origemId: origem.psicologoId, destinoId: B.psicologoId })
      .expect(201);
    const id = (p.body as { id: string }).id;
    await com(B.token, http().post(`/transferencias/${id}/aceitar`)).expect(
      200,
    );
    const bloqueio = await com(
      B.token,
      http().post(`/transferencias/${id}/executar`),
    ).expect(409);
    expect(bloqueio.body).toMatchObject({ message: BLOQUEADA });
    const nada = await comoDono(admin.clinicaId, origem.psicologoId, (tx) =>
      tx.paciente.findUniqueOrThrow({ where: { id: pac } }),
    );
    expect(nada.psicologoId).toBe(origem.psicologoId);

    // Sai de PENDENTE (FALHOU): agora o lote passa.
    await comoDono(admin.clinicaId, origem.psicologoId, (tx) =>
      tx.geracaoIa.update({
        where: { id: gid },
        data: {
          estado: 'FALHOU',
          motivo: 'TIMEOUT',
          retentavel: true,
          finalizadoEm: new Date(),
        },
      }),
    );
    const ok = await com(
      B.token,
      http().post(`/transferencias/${id}/executar`),
    ).expect(200);
    expect(ok.body).toEqual({ transferidos: 1, restantes: 0 });
  });

  it('ADMIN como DESTINO: as duas etapas continuam obrigatorias (criar, depois aceitar, depois executar)', async () => {
    const origem = await novoColega(admin, email('adm'), 'Origem Para Admin');
    const pac = await criarPaciente(origem, 'Paciente Para Admin');
    await desativar(admin, origem);
    const p = await com(admin.token, http().post('/transferencias'))
      .send({ origemId: origem.psicologoId, destinoId: admin.psicologoId })
      .expect(201);
    const id = (p.body as { id: string }).id;
    await com(
      admin.token,
      http().post(`/transferencias/${id}/executar`),
    ).expect(404);
    await com(admin.token, http().post(`/transferencias/${id}/aceitar`)).expect(
      200,
    );
    const r = await com(
      admin.token,
      http().post(`/transferencias/${id}/executar`),
    ).expect(200);
    expect(r.body).toEqual({ transferidos: 1, restantes: 0 });
    expect(pac).toBeDefined();
  });

  it('falha no meio do lote (payload sem um paciente, via SQL como o app): erro e NADA muda', async () => {
    const origem = await novoColega(admin, email('falha'), 'Origem Falha');
    const p1 = await criarPaciente(origem, 'Paciente Falha Um');
    const p2 = await criarPaciente(origem, 'Paciente Falha Dois');
    await desativar(admin, origem);
    const p = await com(admin.token, http().post('/transferencias'))
      .send({ origemId: origem.psicologoId, destinoId: B.psicologoId })
      .expect(201);
    const id = (p.body as { id: string }).id;
    await com(B.token, http().post(`/transferencias/${id}/aceitar`)).expect(
      200,
    );

    await expect(
      tenant.runComoUsuario(B, async (tx) => {
        const [{ dados }] = await tx.$queryRaw<
          {
            dados: {
              pacientes: {
                id: string;
                nomeCifrado: string;
                nascimentoCifrado: null;
                telefoneCifrado: null;
                emailCifrado: null;
              }[];
              documentos: unknown[];
              geracoes: unknown[];
            };
          }[]
        >`SELECT transferencia_origem(${id}::uuid, 50) AS dados`;
        // Payload com UM paciente a menos (falta = erro).
        const payload = {
          pacientes: dados.pacientes.slice(1).map((x) => ({
            ...x,
            nomeCifrado: cripto.cifrar(
              B.clinicaId,
              'x',
              aadDe('Paciente', 'nomeCifrado', x.id, B.psicologoId),
            ),
          })),
          documentos: [],
          geracoes: [],
        };
        await tx.$queryRaw`SELECT transferencia_aplicar(${id}::uuid, ${JSON.stringify(payload)}::jsonb)`;
      }),
    ).rejects.toThrow();

    const estado = await comoDono(admin.clinicaId, origem.psicologoId, (tx) =>
      tx.paciente.findMany({ where: { id: { in: [p1, p2] } } }),
    );
    expect(estado.every((x) => x.psicologoId === origem.psicologoId)).toBe(
      true,
    );
    const pedido = await comoDono(
      admin.clinicaId,
      B.psicologoId,
      (tx) =>
        tx.$queryRaw<
          { estado: string; concluidoEm: Date | null }[]
        >`SELECT estado, "concluidoEm" FROM "PedidoTransferencia" WHERE id = ${id}::uuid`,
    );
    expect(pedido[0]).toMatchObject({ estado: 'ACEITO', concluidoEm: null });
  });

  it('duas execucoes simultaneas do mesmo pedido: sem 500, e o total sai uma vez so', async () => {
    const origem = await novoColega(admin, email('par'), 'Origem Paralela');
    for (let i = 0; i < 4; i++)
      await criarPaciente(origem, `Paciente Paralela ${i}`);
    await desativar(admin, origem);
    const p = await com(admin.token, http().post('/transferencias'))
      .send({ origemId: origem.psicologoId, destinoId: B.psicologoId })
      .expect(201);
    const id = (p.body as { id: string }).id;
    await com(B.token, http().post(`/transferencias/${id}/aceitar`)).expect(
      200,
    );
    const [r1, r2] = await Promise.all([
      com(B.token, http().post(`/transferencias/${id}/executar`)),
      com(B.token, http().post(`/transferencias/${id}/executar`)),
    ]);
    const statuses = [r1.status, r2.status];
    expect(statuses.every((s) => s === 200 || s === 404)).toBe(true);
    const soma = [r1, r2]
      .filter((r) => r.status === 200)
      .reduce(
        (acc, r) => acc + (r.body as { transferidos: number }).transferidos,
        0,
      );
    expect(soma).toBe(4);
  });

  it('lotes: 120 pacientes = 3 chamadas com restantes 70, 20 e 0 (50, 50 e 20)', async () => {
    const origem = await novoColega(admin, email('lote'), 'Origem Lotes');
    const pacientes = Array.from({ length: 120 }, (_, i) => ({
      id: randomUUID(),
      nome: `Paciente Lote ${i}`,
    }));
    await comoDono(admin.clinicaId, origem.psicologoId, (tx) =>
      tx.paciente.createMany({
        data: pacientes.map((x) => ({
          id: x.id,
          clinicaId: admin.clinicaId,
          psicologoId: origem.psicologoId,
          nomeCifrado: cripto.cifrar(
            admin.clinicaId,
            x.nome,
            aadDe('Paciente', 'nomeCifrado', x.id, origem.psicologoId),
          ),
        })),
      }),
    );
    await desativar(admin, origem);
    const p = await com(admin.token, http().post('/transferencias'))
      .send({ origemId: origem.psicologoId, destinoId: B.psicologoId })
      .expect(201);
    expect((p.body as { total: number }).total).toBe(120);
    const id = (p.body as { id: string }).id;
    await com(B.token, http().post(`/transferencias/${id}/aceitar`)).expect(
      200,
    );
    const r1 = await com(
      B.token,
      http().post(`/transferencias/${id}/executar`),
    ).expect(200);
    const r2 = await com(
      B.token,
      http().post(`/transferencias/${id}/executar`),
    ).expect(200);
    const r3 = await com(
      B.token,
      http().post(`/transferencias/${id}/executar`),
    ).expect(200);
    expect([r1.body, r2.body, r3.body]).toEqual([
      { transferidos: 50, restantes: 70 },
      { transferidos: 50, restantes: 20 },
      { transferidos: 20, restantes: 0 },
    ]);
  });

  it('contagens: so ADMIN, so desativados, so a contagem', async () => {
    const r = await com(
      admin.token,
      http().get('/transferencias/contagens'),
    ).expect(200);
    const lista = r.body as { psicologoId: string; total: number }[];
    expect(lista.every((x) => typeof x.total === 'number')).toBe(true);
    expect(lista.map((x) => x.psicologoId)).not.toContain(B.psicologoId);
    esperaSemTexto(r.body, [NOME_P1, TEXTO_APROVADO]);
  });

  it('validacao: uuid invalido = 400 (criar, aceitar, executar)', async () => {
    await com(admin.token, http().post('/transferencias'))
      .send({ origemId: 'nao-uuid', destinoId: B.psicologoId })
      .expect(400);
    await com(B.token, http().post('/transferencias/nao-uuid/aceitar')).expect(
      400,
    );
    await com(B.token, http().post('/transferencias/nao-uuid/executar')).expect(
      400,
    );
  });

  it('a autorizacao esta DENTRO do banco: praxis_app chama as funcoes direto (sem o guard da API) e recebe P0002', async () => {
    const codigo = async (f: () => Promise<unknown>) => {
      const e = await f().then(
        () => null,
        (err: unknown) => err,
      );
      return (e as { meta?: { code?: string } } | null)?.meta?.code;
    };
    // Nao-ADMIN criando, cancelando e listando contagens: o banco recusa com o mesmo P0002.
    expect(
      await codigo(() =>
        tenant.runComoUsuario(
          B,
          (tx) =>
            tx.$executeRaw`SELECT pedido_transferencia_criar(${randomUUID()}::uuid, ${C.psicologoId}, ${B.psicologoId})`,
        ),
      ),
    ).toBe('P0002');
    expect(
      await codigo(() =>
        tenant.runComoUsuario(
          B,
          (tx) =>
            tx.$executeRaw`SELECT pedido_transferencia_cancelar(${pedidoId}::uuid)`,
        ),
      ),
    ).toBe('P0002');
    expect(
      await codigo(() =>
        tenant.runComoUsuario(
          B,
          (tx) => tx.$queryRaw`SELECT * FROM transferencia_contagens()`,
        ),
      ),
    ).toBe('P0002');
    // ADMIN que NAO e o destino nao aceita (o pedido nem aparece para ele como destino).
    expect(
      await codigo(() =>
        tenant.runComoUsuario(
          admin,
          (tx) =>
            tx.$executeRaw`SELECT pedido_transferencia_aceitar(${pedidoId}::uuid)`,
        ),
      ),
    ).toBe('P0002');
    // Sem lote travado nesta transacao, transferencia_aplicar nao roda (nao se aplica sem origem).
    expect(
      await codigo(() =>
        tenant.runComoUsuario(
          B,
          (tx) =>
            tx.$queryRaw`SELECT transferencia_aplicar(${pedidoId}::uuid, ${'{"pacientes":[],"documentos":[],"geracoes":[]}'}::jsonb)`,
        ),
      ),
    ).toBe('22023');
  });

  it('a excecao de cascata e ESTREITA: o dono sem a flag, ou com a flag mas para outro destino, nao muda psicologoId de documento', async () => {
    const outro = randomUUID();
    const alvo = await comoDono(admin.clinicaId, B.psicologoId, (tx) =>
      tx.documento.findFirstOrThrow({
        where: { pacienteId: P2, status: 'APROVADO' },
      }),
    );
    // Sem a flag: o trigger documento_imutavel barra (a identidade mudou e o documento e aprovado).
    await expect(
      comoOwner(
        admin.clinicaId,
        (tx) =>
          tx.$executeRaw`UPDATE "Documento" SET "psicologoId" = ${outro} WHERE "id" = ${alvo.id}`,
        { psicologoId: B.psicologoId },
      ),
    ).rejects.toThrow();
    // Com a flag, mas o novo psicologoId NAO e o destino do lote (a flag guarda quem recebe): barrado.
    await expect(
      comoOwner(
        admin.clinicaId,
        async (tx) => {
          await tx.$executeRaw`SELECT set_config('app.transferindo', ${B.psicologoId}, true)`;
          await tx.$executeRaw`UPDATE "Documento" SET "psicologoId" = ${outro} WHERE "id" = ${alvo.id}`;
        },
        { psicologoId: B.psicologoId },
      ),
    ).rejects.toThrow();
    // Sem a flag, a consulta e o documento seguem com B.
    const depois = await comoDono(admin.clinicaId, B.psicologoId, (tx) =>
      tx.documento.findUniqueOrThrow({ where: { id: alvo.id } }),
    );
    expect(depois.psicologoId).toBe(B.psicologoId);
  });

  it('praxis_app: sem UPDATE de psicologoId, sem escrita em PedidoTransferencia; leitura sem contexto = zero linhas', async () => {
    const x = randomUUID();
    await expect(
      tenant.runComoUsuario(
        B,
        (tx) =>
          tx.$executeRaw`UPDATE "Paciente" SET "psicologoId" = ${x} WHERE "id" = ${P1}`,
      ),
    ).rejects.toThrow();
    await expect(
      tenant.runComoUsuario(
        B,
        (tx) =>
          tx.$executeRaw`INSERT INTO "PedidoTransferencia" ("id","clinicaId","origemId","destinoId","criadoPorId","estado","criadoEm","expiraEm") VALUES (${x}::uuid, ${B.clinicaId}, ${A.psicologoId}, ${B.psicologoId}, ${B.psicologoId}, 'PENDENTE', now(), now())`,
      ),
    ).rejects.toThrow();
    await expect(
      tenant.runComoUsuario(
        B,
        (tx) =>
          tx.$executeRaw`UPDATE "PedidoTransferencia" SET "estado" = 'CANCELADO' WHERE true`,
      ),
    ).rejects.toThrow();
    await expect(
      tenant.runComoUsuario(
        B,
        (tx) => tx.$executeRaw`DELETE FROM "PedidoTransferencia" WHERE true`,
      ),
    ).rejects.toThrow();
    const semContexto = await prismaApp.$queryRaw<
      { n: bigint }[]
    >`SELECT count(*) AS n FROM "PedidoTransferencia"`;
    expect(Number(semContexto[0].n)).toBe(0);
    const vazio = await tenant.run(
      B.clinicaId,
      (tx) =>
        tx.$queryRaw<
          { v: string | null }[]
        >`SELECT current_setting('app.transferindo', true) AS v`,
    );
    expect(vazio[0].v === null || vazio[0].v === '').toBe(true);
  });

  it('resposta e lista nao vazam nome de paciente nem cifrado (so o nome da origem)', async () => {
    const lista = await com(B.token, http().get('/transferencias')).expect(200);
    const s = JSON.stringify(lista.body);
    expect(s).not.toContain('Cifrado');
    expect(s).not.toContain(NOME_P1);
  });
});
