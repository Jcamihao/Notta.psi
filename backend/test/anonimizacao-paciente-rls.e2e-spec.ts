import { randomBytes, randomUUID } from 'node:crypto';
import { Papel, PrismaClient } from '@prisma/client';
import { PrismaService } from '../src/prisma/prisma.service';
import { TenantPrismaService } from '../src/prisma/tenant-prisma.service';
import { apagarClinicas, comoOwner } from './acesso-owner';

// Exclusao por anonimizacao (item 26), camada do banco, no Postgres real: a funcao
// anonimizar_paciente (SECURITY DEFINER), o GRANT so para notta_app, as excecoes dos triggers
// (so o dono, so com a flag, so as colunas listadas), o excluidoEm que nunca volta e os INSERTs
// barrados para paciente excluido.
if (!process.env.DATABASE_URL_OWNER) {
  throw new Error(
    'DATABASE_URL_OWNER ausente: teste de anonimizacao exige o papel notta_owner (ver backend/README.md)',
  );
}

// connection_limit=1: toda consulta reusa a MESMA conexao (prova vazamento de contexto).
const url = new URL(process.env.DATABASE_URL!);
url.searchParams.set('connection_limit', '1');
const app = new PrismaClient({ datasources: { db: { url: url.toString() } } });
const tenant = new TenantPrismaService(app as unknown as PrismaService);

const sufixo = randomUUID().slice(0, 8);
const A = randomUUID();
const B = randomUUID();
type U = { clinicaId: string; psicologoId: string };
const FUTURO = new Date(Date.now() + 86_400_000);
const hex64 = () => randomBytes(32).toString('hex');

async function novoPsicologo(
  clinicaId: string,
  nome: string,
  papel: Papel = Papel.PSICOLOGO,
): Promise<U> {
  const p = await tenant.run(clinicaId, (tx) =>
    tx.psicologo.create({
      data: {
        clinicaId,
        nome,
        papel,
        email: `${nome}-${randomUUID().slice(0, 8)}-${sufixo}@teste.local`,
        senhaHash: 'x',
        abordagemPadrao: 'TCC',
        senhaProvisoria: papel === Papel.PSICOLOGO,
      },
    }),
  );
  return { clinicaId, psicologoId: p.id };
}

// Paciente com 1 rascunho, 1 aprovado, 2 geracoes (PREVIA e FALHOU), 1 convite PENDENTE e 1 evento.
async function novoPaciente(dono: U) {
  const pacienteId = randomUUID();
  const rascunhoId = randomUUID();
  const aprovadoId = randomUUID();
  const previaId = randomUUID();
  const falhouId = randomUUID();
  const conviteId = randomUUID();
  await tenant.runComoUsuario(dono, async (tx) => {
    await tx.paciente.create({
      data: {
        id: pacienteId,
        clinicaId: dono.clinicaId,
        psicologoId: dono.psicologoId,
        nomeCifrado: 'cifra-nome-original',
        nascimentoCifrado: 'cifra-nasc',
        telefoneCifrado: 'cifra-tel',
        emailCifrado: 'cifra-email',
      },
    });
    const base = {
      clinicaId: dono.clinicaId,
      psicologoId: dono.psicologoId,
      pacienteId,
      tipo: 'EVOLUCAO',
      dataSessao: new Date('2026-10-01'),
    };
    await tx.documento.create({
      data: {
        ...base,
        id: rascunhoId,
        conteudoCifrado: 'cifra-rascunho-original',
      },
    });
    await tx.documento.create({
      data: {
        ...base,
        id: aprovadoId,
        conteudoCifrado: 'cifra-aprovado-original',
      },
    });
    await tx.documento.updateMany({
      where: { id: aprovadoId },
      data: { status: 'APROVADO', aprovadoEm: new Date() },
    });
    const ger = {
      clinicaId: dono.clinicaId,
      psicologoId: dono.psicologoId,
      pacienteId,
      origemId: rascunhoId,
      tipoDocumento: 'EVOLUCAO',
      abordagem: 'TCC',
      expiraEm: FUTURO,
    };
    await tx.geracaoIa.create({
      data: {
        ...ger,
        id: previaId,
        estado: 'PREVIA',
        textoCifrado: 'cifra-texto-previa',
        mapaCifrado: 'cifra-mapa-previa',
      },
    });
    await tx.geracaoIa.create({
      data: {
        ...ger,
        id: falhouId,
        estado: 'PREVIA',
        textoCifrado: 'cifra-texto-falhou',
        mapaCifrado: 'cifra-mapa-falhou',
      },
    });
    await tx.geracaoIa.updateMany({
      where: { id: falhouId },
      data: { estado: 'PENDENTE' },
    });
    await tx.geracaoIa.updateMany({
      where: { id: falhouId },
      data: {
        estado: 'FALHOU',
        motivo: 'ERRO_DA_IA',
        retentavel: true,
        finalizadoEm: new Date(),
      },
    });
    await tx.conviteConsentimento.create({
      data: {
        id: conviteId,
        clinicaId: dono.clinicaId,
        psicologoId: dono.psicologoId,
        pacienteId,
        tokenHash: hex64(),
        termoVersao: 'v1-teste',
        expiraEm: FUTURO,
      },
    });
    await tx.consentimento.create({
      data: {
        clinicaId: dono.clinicaId,
        psicologoId: dono.psicologoId,
        pacienteId,
        seq: 1,
        evento: 'CONCEDIDO',
        termoVersao: 'v1-teste',
        termoTexto: 'termo de teste',
      },
    });
  });
  return { pacienteId, rascunhoId, aprovadoId, previaId, falhouId, conviteId };
}

// Chamada da funcao no contexto de `quem` (como o app faz: mesma transacao).
const anonimizar = (
  quem: U,
  pacienteId: string,
  documentos: Record<string, string>,
  geracoes: Record<string, { texto: string; mapa: string }>,
  nome = '[paciente excluido]',
) =>
  tenant.runComoUsuario(
    quem,
    (tx) =>
      tx.$queryRaw<
        { excluidoEm: Date }[]
      >`SELECT anonimizar_paciente(${pacienteId}, ${nome}, ${JSON.stringify(documentos)}::jsonb, ${JSON.stringify(geracoes)}::jsonb) AS "excluidoEm"`,
  );

const lerPaciente = (quem: U, id: string) =>
  tenant.runComoUsuario(quem, (tx) =>
    tx.paciente.findFirstOrThrow({ where: { id } }),
  );
const lerDocumento = (quem: U, id: string) =>
  tenant.runComoUsuario(quem, (tx) =>
    tx.documento.findFirstOrThrow({ where: { id } }),
  );
const lerGeracao = (quem: U, id: string) =>
  tenant.runComoUsuario(quem, (tx) =>
    tx.geracaoIa.findFirstOrThrow({ where: { id } }),
  );

// Tudo que o teste precisa de um paciente ja excluido.
async function excluido() {
  const dono = await novoPsicologo(A, `dono-${randomUUID().slice(0, 6)}`);
  const p = await novoPaciente(dono);
  const r = await anonimizar(
    dono,
    p.pacienteId,
    { [p.rascunhoId]: 'TOMB-RASCUNHO', [p.aprovadoId]: 'TOMB-APROVADO' },
    {
      [p.previaId]: { texto: 'TOMB-TEXTO-PREVIA', mapa: 'TOMB-MAPA-PREVIA' },
      [p.falhouId]: { texto: 'TOMB-TEXTO-FALHOU', mapa: 'TOMB-MAPA-FALHOU' },
    },
  );
  return { dono, ...p, excluidoEm: r[0].excluidoEm };
}

// Flag do dono dentro de uma transacao de notta_owner (so para provar a excecao).
const comFlagDono = (
  dono: U,
  fn: (tx: Parameters<Parameters<typeof comoOwner>[1]>[0]) => Promise<unknown>,
) =>
  comoOwner(
    dono.clinicaId,
    async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.anonimizando', '1', true)`;
      return fn(tx);
    },
    { psicologoId: dono.psicologoId },
  );

let adminA: U;
let colegaA: U;
let donoB: U;

beforeAll(async () => {
  for (const [id, nome] of [
    [A, 'A'],
    [B, 'B'],
  ] as const) {
    await tenant.run(id, (tx) =>
      tx.clinica.create({ data: { id, nome: `${nome}-${sufixo}` } }),
    );
  }
  adminA = await novoPsicologo(A, 'admin-a', Papel.ADMIN);
  colegaA = await novoPsicologo(A, 'colega-a');
  donoB = await novoPsicologo(B, 'dono-b');
});

afterAll(async () => {
  await apagarClinicas([A, B]);
  await app.$disconnect();
});

describe('estrutura (item 26)', () => {
  it('excluidoEm existe, nullable, e notta_app NAO tem UPDATE nela', async () => {
    const [col] = await comoOwner(
      A,
      (tx) =>
        tx.$queryRaw<
          { is_nullable: string }[]
        >`SELECT is_nullable FROM information_schema.columns
        WHERE table_name = 'Paciente' AND column_name = 'excluidoEm'`,
    );
    expect(col.is_nullable).toBe('YES');
    const grants = await comoOwner(
      A,
      (tx) =>
        tx.$queryRaw<
          { column_name: string }[]
        >`SELECT column_name FROM information_schema.column_privileges
        WHERE table_name = 'Paciente' AND grantee = 'notta_app' AND privilege_type = 'UPDATE'`,
    );
    expect(grants.map((g) => g.column_name)).not.toContain('excluidoEm');
  });

  it('funcao SECURITY DEFINER, search_path fixo, dona = notta_owner, EXECUTE so para notta_app', async () => {
    const [f] = await comoOwner(
      A,
      (tx) =>
        tx.$queryRaw<
          { prosecdef: boolean; proconfig: string[]; dono: string }[]
        >`
        SELECT p.prosecdef, p.proconfig, pg_get_userbyid(p.proowner) AS dono
        FROM pg_proc p WHERE p.proname = 'anonimizar_paciente'`,
    );
    expect(f.prosecdef).toBe(true);
    expect(f.proconfig).toEqual(
      expect.arrayContaining(['search_path=pg_catalog, public']),
    );
    expect(f.dono).toBe('notta_owner');
    const pub = await comoOwner(
      A,
      (tx) =>
        tx.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM aclexplode(
        (SELECT proacl FROM pg_proc WHERE proname = 'anonimizar_paciente')) WHERE grantee = 0`,
    );
    expect(Number(pub[0].n)).toBe(0);
    const [priv] = await comoOwner(
      A,
      (tx) =>
        tx.$queryRaw<
          { ok: boolean }[]
        >`SELECT has_function_privilege('notta_app',
        'anonimizar_paciente(text,text,jsonb,jsonb)', 'EXECUTE') AS ok`,
    );
    expect(priv.ok).toBe(true);
  });
});

describe('quem pode anonimizar', () => {
  it('colega (PSICOLOGO da mesma clinica) nao anonimiza paciente alheio: erro generico', async () => {
    const p = await novoPaciente(adminA);
    await expect(
      anonimizar(
        colegaA,
        p.pacienteId,
        { [p.rascunhoId]: 'T', [p.aprovadoId]: 'T' },
        {
          [p.previaId]: { texto: 'T', mapa: 'T' },
          [p.falhouId]: { texto: 'T', mapa: 'T' },
        },
      ),
    ).rejects.toThrow(/Paciente nao encontrado/);
    expect((await lerPaciente(adminA, p.pacienteId)).excluidoEm).toBeNull();
  });

  it('ADMIN da clinica nao anonimiza paciente de colega', async () => {
    const dono = await novoPsicologo(A, 'dono-a2');
    const p = await novoPaciente(dono);
    await expect(
      anonimizar(
        adminA,
        p.pacienteId,
        { [p.rascunhoId]: 'T', [p.aprovadoId]: 'T' },
        {
          [p.previaId]: { texto: 'T', mapa: 'T' },
          [p.falhouId]: { texto: 'T', mapa: 'T' },
        },
      ),
    ).rejects.toThrow(/Paciente nao encontrado/);
  });

  it('psicologo de OUTRA clinica: mesmo erro generico', async () => {
    const p = await novoPaciente(adminA);
    await expect(
      anonimizar(
        donoB,
        p.pacienteId,
        { [p.rascunhoId]: 'T', [p.aprovadoId]: 'T' },
        {
          [p.previaId]: { texto: 'T', mapa: 'T' },
          [p.falhouId]: { texto: 'T', mapa: 'T' },
        },
      ),
    ).rejects.toThrow(/Paciente nao encontrado/);
  });

  it('paciente inexistente e paciente alheio dao o MESMO erro', async () => {
    const naoExiste = randomUUID();
    const p = await novoPaciente(adminA);
    await expect(anonimizar(adminA, naoExiste, {}, {})).rejects.toThrow(
      /Paciente nao encontrado/,
    );
    await expect(anonimizar(colegaA, p.pacienteId, {}, {})).rejects.toThrow(
      /Paciente nao encontrado/,
    );
  });

  it('sem contexto (nenhuma clinica/psicologo na transacao): erro generico', async () => {
    await expect(
      app.$transaction(
        (tx) =>
          tx.$queryRaw`SELECT anonimizar_paciente(${randomUUID()}, 'x', '{}'::jsonb, '{}'::jsonb)`,
      ),
    ).rejects.toThrow(/Paciente nao encontrado/);
  });
});

describe('funcao anonimiza (dono)', () => {
  it('apaga identificadores, troca conteudo, mantem status/aprovadoEm, cancela convite, zera geracoes', async () => {
    const dono = await novoPsicologo(A, 'dono-a3');
    const p = await novoPaciente(dono);
    const antesAprovado = await lerDocumento(dono, p.aprovadoId);
    const outro = await novoPaciente(dono); // outro paciente do mesmo dono: intacto

    const [r] = await anonimizar(
      dono,
      p.pacienteId,
      { [p.rascunhoId]: 'TOMB-RASCUNHO', [p.aprovadoId]: 'TOMB-APROVADO' },
      {
        [p.previaId]: { texto: 'TOMB-TEXTO-PREVIA', mapa: 'TOMB-MAPA-PREVIA' },
        [p.falhouId]: { texto: 'TOMB-TEXTO-FALHOU', mapa: 'TOMB-MAPA-FALHOU' },
      },
      '[paciente excluido]',
    );
    expect(r.excluidoEm).toBeInstanceOf(Date);

    const pac = await lerPaciente(dono, p.pacienteId);
    expect(pac).toMatchObject({
      nomeCifrado: '[paciente excluido]',
      nascimentoCifrado: null,
      telefoneCifrado: null,
      emailCifrado: null,
    });
    expect(pac.excluidoEm).toBeInstanceOf(Date);

    const aprov = await lerDocumento(dono, p.aprovadoId);
    expect(aprov.conteudoCifrado).toBe('TOMB-APROVADO');
    expect(aprov.dataSessao).toBeNull();
    expect(aprov.status).toBe('APROVADO');
    expect(aprov.aprovadoEm).toEqual(antesAprovado.aprovadoEm);
    expect(aprov.tipo).toBe(antesAprovado.tipo);
    expect(aprov.criadoEm).toEqual(antesAprovado.criadoEm);

    const rasc = await lerDocumento(dono, p.rascunhoId);
    expect(rasc).toMatchObject({
      conteudoCifrado: 'TOMB-RASCUNHO',
      dataSessao: null,
      status: 'RASCUNHO',
    });

    const previa = await lerGeracao(dono, p.previaId);
    expect(previa).toMatchObject({
      estado: 'PREVIA',
      textoCifrado: 'TOMB-TEXTO-PREVIA',
      mapaCifrado: 'TOMB-MAPA-PREVIA',
    });
    const falhou = await lerGeracao(dono, p.falhouId);
    expect(falhou).toMatchObject({
      estado: 'FALHOU',
      motivo: 'ERRO_DA_IA',
      retentavel: true,
      textoCifrado: 'TOMB-TEXTO-FALHOU',
      mapaCifrado: 'TOMB-MAPA-FALHOU',
    });

    const convite = await tenant.runComoUsuario(dono, (tx) =>
      tx.conviteConsentimento.findFirstOrThrow({ where: { id: p.conviteId } }),
    );
    expect(convite.estado).toBe('CANCELADO');
    expect(convite.usadoEm).toBeInstanceOf(Date);

    const cons = await tenant.runComoUsuario(dono, (tx) =>
      tx.consentimento.findMany({ where: { pacienteId: p.pacienteId } }),
    );
    expect(cons).toHaveLength(1);
    expect(cons[0].evento).toBe('CONCEDIDO');

    // Outro paciente do mesmo dono nao foi tocado.
    expect((await lerPaciente(dono, outro.pacienteId)).excluidoEm).toBeNull();
    expect((await lerDocumento(dono, outro.rascunhoId)).conteudoCifrado).toBe(
      'cifra-rascunho-original',
    );
  });

  it('paciente ja excluido: segunda chamada e erro generico', async () => {
    const e = await excluido();
    await expect(
      anonimizar(
        e.dono,
        e.pacienteId,
        { [e.rascunhoId]: 'T', [e.aprovadoId]: 'T' },
        {
          [e.previaId]: { texto: 'T', mapa: 'T' },
          [e.falhouId]: { texto: 'T', mapa: 'T' },
        },
      ),
    ).rejects.toThrow(/Paciente nao encontrado/);
  });

  it('id faltando no tombstone de documento = erro e NADA muda (transacao inteira)', async () => {
    const dono = await novoPsicologo(A, 'dono-a4');
    const p = await novoPaciente(dono);
    await expect(
      anonimizar(
        dono,
        p.pacienteId,
        { [p.rascunhoId]: 'T' },
        {
          [p.previaId]: { texto: 'T', mapa: 'T' },
          [p.falhouId]: { texto: 'T', mapa: 'T' },
        },
      ),
    ).rejects.toThrow(/Tombstone de documento ausente/);
    expect((await lerPaciente(dono, p.pacienteId)).excluidoEm).toBeNull();
    expect((await lerDocumento(dono, p.aprovadoId)).conteudoCifrado).toBe(
      'cifra-aprovado-original',
    );
  });

  it('id faltando no tombstone de geracao = erro e NADA muda', async () => {
    const dono = await novoPsicologo(A, 'dono-a5');
    const p = await novoPaciente(dono);
    await expect(
      anonimizar(
        dono,
        p.pacienteId,
        { [p.rascunhoId]: 'T', [p.aprovadoId]: 'T' },
        {
          [p.previaId]: { texto: 'T', mapa: 'T' },
        },
      ),
    ).rejects.toThrow(/Tombstone de geracao ausente/);
    expect((await lerPaciente(dono, p.pacienteId)).excluidoEm).toBeNull();
    expect((await lerGeracao(dono, p.previaId)).textoCifrado).toBe(
      'cifra-texto-previa',
    );
  });
});

describe('notta_app nao consegue o que so a funcao pode', () => {
  it('ligar app.anonimizando como notta_app NAO destrava UPDATE em documento aprovado', async () => {
    const e = await excluido();
    await expect(
      tenant.runComoUsuario(e.dono, async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.anonimizando', '1', true)`;
        return tx.documento.updateMany({
          where: { id: e.aprovadoId },
          data: { conteudoCifrado: 'FORJADO' },
        });
      }),
    ).rejects.toThrow(/imutavel|permission denied/);
    expect((await lerDocumento(e.dono, e.aprovadoId)).conteudoCifrado).toBe(
      'TOMB-APROVADO',
    );
  });

  it('ligar a flag como notta_app NAO permite gravar excluidoEm', async () => {
    const dono = await novoPsicologo(A, 'dono-a6');
    const p = await novoPaciente(dono);
    await expect(
      tenant.runComoUsuario(dono, async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.anonimizando', '1', true)`;
        return tx.paciente.updateMany({
          where: { id: p.pacienteId },
          data: { excluidoEm: new Date() },
        });
      }),
    ).rejects.toThrow(/permission denied|excluidoEm/);
    expect((await lerPaciente(dono, p.pacienteId)).excluidoEm).toBeNull();
  });
});

describe('dono (notta_owner) fora da funcao', () => {
  it('SEM a flag, nao altera conteudo de documento aprovado', async () => {
    const e = await excluido();
    await expect(
      comoOwner(
        A,
        (tx) =>
          tx.documento.updateMany({
            where: { id: e.aprovadoId },
            data: { conteudoCifrado: 'FORJADO' },
          }),
        { psicologoId: e.dono.psicologoId },
      ),
    ).rejects.toThrow(/imutavel/);
  });

  it('COM a flag, nao altera coluna que nao e a listada (tipo) de documento aprovado', async () => {
    const e = await excluido();
    await expect(
      comFlagDono(e.dono, (tx) =>
        tx.documento.updateMany({
          where: { id: e.aprovadoId },
          data: { tipo: 'ANAMNESE' },
        }),
      ),
    ).rejects.toThrow(/imutavel/);
  });

  it('COM a flag, nao muda status do aprovado (volta a rascunho) nem aprovadoEm', async () => {
    const e = await excluido();
    await expect(
      comFlagDono(e.dono, (tx) =>
        tx.documento.updateMany({
          where: { id: e.aprovadoId },
          data: { status: 'RASCUNHO' },
        }),
      ),
    ).rejects.toThrow(/imutavel/);
    await expect(
      comFlagDono(e.dono, (tx) =>
        tx.documento.updateMany({
          where: { id: e.aprovadoId },
          data: { aprovadoEm: null },
        }),
      ),
    ).rejects.toThrow(/imutavel/);
  });

  it('COM a flag, geracao: mudar coluna que nao e texto/mapa (motivo) e barrado', async () => {
    const e = await excluido();
    await expect(
      comFlagDono(e.dono, (tx) =>
        tx.geracaoIa.updateMany({
          where: { id: e.falhouId },
          data: { motivo: 'TIMEOUT' },
        }),
      ),
    ).rejects.toThrow(/transicao|imutavel|identidade|texto/);
  });

  it('excluidoEm: nunca volta a NULL, nunca muda, e nao preenche sem a funcao', async () => {
    const e = await excluido();
    await expect(
      comFlagDono(e.dono, (tx) =>
        tx.paciente.updateMany({
          where: { id: e.pacienteId },
          data: { excluidoEm: null },
        }),
      ),
    ).rejects.toThrow(/excluidoEm/);
    await expect(
      comFlagDono(e.dono, (tx) =>
        tx.paciente.updateMany({
          where: { id: e.pacienteId },
          data: { excluidoEm: new Date('2001-01-01') },
        }),
      ),
    ).rejects.toThrow(/excluidoEm/);
    const dono = await novoPsicologo(A, 'dono-a7');
    const vivo = await novoPaciente(dono);
    await expect(
      comoOwner(
        A,
        (tx) =>
          tx.paciente.updateMany({
            where: { id: vivo.pacienteId },
            data: { excluidoEm: new Date() },
          }),
        { psicologoId: dono.psicologoId },
      ),
    ).rejects.toThrow(/exclusao so pela funcao/);
  });
});

describe('INSERT para paciente excluido e barrado', () => {
  it('documento, geracao, consentimento e convite: notta_app recebe erro (paciente excluido)', async () => {
    const e = await excluido();
    const base = {
      clinicaId: e.dono.clinicaId,
      psicologoId: e.dono.psicologoId,
      pacienteId: e.pacienteId,
    };
    await expect(
      tenant.runComoUsuario(e.dono, (tx) =>
        tx.documento.create({
          data: {
            ...base,
            id: randomUUID(),
            tipo: 'EVOLUCAO',
            conteudoCifrado: 'NOVO',
            dataSessao: new Date(),
          },
        }),
      ),
    ).rejects.toThrow(/Paciente excluido/);
    await expect(
      tenant.runComoUsuario(e.dono, (tx) =>
        tx.geracaoIa.create({
          data: {
            ...base,
            id: randomUUID(),
            origemId: e.rascunhoId,
            tipoDocumento: 'EVOLUCAO',
            abordagem: 'TCC',
            estado: 'PREVIA',
            textoCifrado: 'NOVO',
            mapaCifrado: 'NOVO',
            expiraEm: FUTURO,
          },
        }),
      ),
    ).rejects.toThrow(/Paciente excluido/);
    await expect(
      tenant.runComoUsuario(e.dono, (tx) =>
        tx.consentimento.create({
          data: {
            ...base,
            seq: 2,
            evento: 'REVOGADO',
            termoVersao: 'v1',
            termoTexto: 'x',
          },
        }),
      ),
    ).rejects.toThrow(/Paciente excluido/);
    await expect(
      tenant.runComoUsuario(e.dono, (tx) =>
        tx.conviteConsentimento.create({
          data: {
            ...base,
            tokenHash: hex64(),
            termoVersao: 'v1',
            expiraEm: FUTURO,
          },
        }),
      ),
    ).rejects.toThrow(/Paciente excluido/);
  });

  it('o dono (notta_owner) tambem e barrado no INSERT de documento de paciente excluido', async () => {
    const e = await excluido();
    await expect(
      comoOwner(
        A,
        (tx) =>
          tx.documento.create({
            data: {
              id: randomUUID(),
              clinicaId: e.dono.clinicaId,
              psicologoId: e.dono.psicologoId,
              pacienteId: e.pacienteId,
              tipo: 'EVOLUCAO',
              conteudoCifrado: 'NOVO',
              dataSessao: new Date(),
            },
          }),
        { psicologoId: e.dono.psicologoId },
      ),
    ).rejects.toThrow(/Paciente excluido/);
  });
});

describe('RLS basico apos a exclusao', () => {
  it('colega nao ve o paciente excluido de outro (0 linhas) e sem contexto a leitura e vazia', async () => {
    const e = await excluido();
    const dosColegas = await tenant.runComoUsuario(colegaA, (tx) =>
      tx.paciente.findMany({ where: { id: e.pacienteId } }),
    );
    expect(dosColegas).toHaveLength(0);
    const semContexto = await app.paciente.findMany({
      where: { id: e.pacienteId },
    });
    expect(semContexto).toHaveLength(0);
  });
});
