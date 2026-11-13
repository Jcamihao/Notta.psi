import { randomBytes } from 'node:crypto';
import {
  CriptografiaService,
  aadDe,
} from '../criptografia/criptografia.service';
import {
  ALVOS,
  Acesso,
  Alvo,
  Armazem,
  Linha,
  lerOpcoes,
  recifrarColuna,
  recifrarTudo,
} from './recifrar';

const K1 = randomBytes(32).toString('hex');
const K2 = randomBytes(32).toString('hex');
const CLINICA = 'clinica-a';
const DOC: Alvo = { tabela: 'Documento', coluna: 'conteudoCifrado' };

// Cria o servico com um ambiente explicito (nao vaza o do shell nem o de outros testes).
function servico(vars: Record<string, string>): CriptografiaService {
  const antes = { ...process.env };
  for (const k of [
    'PRAXIS_MASTER_KEY',
    'PRAXIS_MASTER_KEYS',
    'PRAXIS_MASTER_KEY_ATUAL',
  ]) {
    delete process.env[k];
  }
  Object.assign(process.env, vars);
  try {
    return new CriptografiaService();
  } finally {
    for (const k of Object.keys(process.env)) {
      if (!(k in antes)) delete process.env[k];
    }
    Object.assign(process.env, antes);
  }
}

const so1 = () => servico({ PRAXIS_MASTER_KEY: K1 });
const k1ComK2 = () =>
  servico({
    PRAXIS_MASTER_KEYS: `k1:${K1},k2:${K2}`,
    PRAXIS_MASTER_KEY_ATUAL: 'k2',
  });

function linhas(cripto: CriptografiaService, alvo: Alvo, n: number): Linha[] {
  return Array.from({ length: n }, (_, i) => {
    const id = `id-${i + 1}`;
    const psicologoId = 'psi-1';
    return {
      id,
      clinicaId: CLINICA,
      psicologoId,
      valor: cripto.cifrar(
        CLINICA,
        `texto ${i + 1}`,
        aadDe(alvo.tabela, alvo.coluna, id, psicologoId),
      ),
    };
  });
}

// Armazem em memoria com a mesma semantica do UPDATE otimista (WHERE valor = antigo).
function armazemFake(
  store: Map<string, Linha[]>,
  opcoes: { antesAtualizar?: (alvo: Alvo, id: string) => void } = {},
) {
  const escritas: string[] = [];
  const chave = (a: Alvo) => `${a.tabela}.${a.coluna}`;
  const acesso: Acesso = {
    buscar: (alvo, cursor, lote, filtro) =>
      Promise.resolve(
        (store.get(chave(alvo)) ?? [])
          .filter(
            (l) =>
              l.id > cursor &&
              !l.valor.startsWith(`v1.${filtro.atual}.`) &&
              (!filtro.clinicaId || l.clinicaId === filtro.clinicaId),
          )
          .sort((a, b) => (a.id < b.id ? -1 : 1))
          .slice(0, lote)
          .map((l) => ({ ...l })),
      ),
    atualizar: (alvo, id, novo, antigo) => {
      opcoes.antesAtualizar?.(alvo, id);
      const l = (store.get(chave(alvo)) ?? []).find((x) => x.id === id)!;
      if (l.valor !== antigo) return Promise.resolve(0);
      l.valor = novo;
      escritas.push(id);
      return Promise.resolve(1);
    },
  };
  const armazem: Armazem = { transacao: (fn) => fn(acesso) };
  return { armazem, escritas };
}

describe('recifrar: alvos', () => {
  it('cobre as 7 colunas cifradas do banco, e so elas', () => {
    expect(ALVOS.map((a) => `${a.tabela}.${a.coluna}`)).toEqual([
      'Paciente.nomeCifrado',
      'Paciente.nascimentoCifrado',
      'Paciente.telefoneCifrado',
      'Paciente.emailCifrado',
      'Documento.conteudoCifrado',
      'GeracaoIa.textoCifrado',
      'GeracaoIa.mapaCifrado',
    ]);
  });
});

describe('recifrar: recifrarColuna', () => {
  const op = { lote: 200, dryRun: false };

  it('troca todo valor do kid antigo pelo atual, e o texto decifrado e o mesmo', async () => {
    const c1 = so1();
    const c2 = k1ComK2();
    const store = new Map([
      [`${DOC.tabela}.${DOC.coluna}`, linhas(c1, DOC, 3)],
    ]);
    const { armazem, escritas } = armazemFake(store);
    const res = await recifrarColuna(armazem, c2, DOC, op);
    expect(res).toEqual({ lidas: 3, recifradas: 3, conflitos: 0, falhas: 0 });
    expect(escritas).toEqual(['id-1', 'id-2', 'id-3']);
    for (const l of store.get(`${DOC.tabela}.${DOC.coluna}`)!) {
      expect(l.valor.startsWith('v1.k2.')).toBe(true);
      const aad = aadDe(DOC.tabela, DOC.coluna, l.id, l.psicologoId);
      expect(c2.decifrar(CLINICA, l.valor, aad)).toBe(`texto ${l.id.slice(3)}`);
    }
  });

  it('paginacao por id com lote 1 chega ao mesmo resultado', async () => {
    const c1 = so1();
    const store = new Map([
      [`${DOC.tabela}.${DOC.coluna}`, linhas(c1, DOC, 3)],
    ]);
    const { armazem } = armazemFake(store);
    const res = await recifrarColuna(armazem, k1ComK2(), DOC, {
      lote: 1,
      dryRun: false,
    });
    expect(res).toEqual({ lidas: 3, recifradas: 3, conflitos: 0, falhas: 0 });
  });

  it('dry-run conta o que faria e nao grava nada', async () => {
    const store = new Map([
      [`${DOC.tabela}.${DOC.coluna}`, linhas(so1(), DOC, 3)],
    ]);
    const antes = JSON.stringify(store.get(`${DOC.tabela}.${DOC.coluna}`));
    const { armazem, escritas } = armazemFake(store);
    const res = await recifrarColuna(armazem, k1ComK2(), DOC, {
      lote: 200,
      dryRun: true,
    });
    expect(res).toEqual({ lidas: 3, recifradas: 3, conflitos: 0, falhas: 0 });
    expect(escritas).toEqual([]);
    expect(JSON.stringify(store.get(`${DOC.tabela}.${DOC.coluna}`))).toBe(
      antes,
    );
  });

  it('conflito otimista: valor mudou entre a leitura e o UPDATE, pula sem sobrescrever', async () => {
    const c1 = so1();
    const store = new Map([
      [`${DOC.tabela}.${DOC.coluna}`, linhas(c1, DOC, 3)],
    ]);
    const concorrente = c1.cifrar(
      CLINICA,
      'mudou antes',
      aadDe(DOC.tabela, DOC.coluna, 'id-2', 'psi-1'),
    );
    const { armazem } = armazemFake(store, {
      antesAtualizar: (_alvo, id) => {
        if (id === 'id-2') {
          store
            .get(`${DOC.tabela}.${DOC.coluna}`)!
            .find((l) => l.id === id)!.valor = concorrente;
        }
      },
    });
    const res = await recifrarColuna(armazem, k1ComK2(), DOC, op);
    expect(res).toEqual({ lidas: 3, recifradas: 2, conflitos: 1, falhas: 0 });
    expect(
      store.get(`${DOC.tabela}.${DOC.coluna}`)!.find((l) => l.id === 'id-2')!
        .valor,
    ).toBe(concorrente);
  });

  it('verificacao de ida e volta falha: nada e gravado', async () => {
    const c2 = k1ComK2();
    const store = new Map([
      [`${DOC.tabela}.${DOC.coluna}`, linhas(so1(), DOC, 3)],
    ]);
    const { armazem, escritas } = armazemFake(store);
    // Cifra OUTRO texto: a conferencia (decifrar o novo == texto antigo) tem que barrar.
    const errado = {
      kidAtual: () => c2.kidAtual(),
      decifrar: (c: string, v: string, a: string) => c2.decifrar(c, v, a),
      recifrarValor: (c: string, _v: string, a: string) =>
        c2.cifrar(c, 'OUTRO TEXTO', a),
    };
    const res = await recifrarColuna(armazem, errado, DOC, op);
    expect(res).toEqual({ lidas: 3, recifradas: 0, conflitos: 0, falhas: 3 });
    expect(escritas).toEqual([]);
  });

  it('kid desconhecido vira falha, nao derruba o lote e nao grava', async () => {
    const c1 = so1();
    const ls = linhas(c1, DOC, 2);
    ls.push({
      id: 'id-9',
      clinicaId: CLINICA,
      psicologoId: 'psi-1',
      valor: 'v1.k9.AAAA.AAAA.AAAA',
    });
    const store = new Map([[`${DOC.tabela}.${DOC.coluna}`, ls]]);
    const { armazem, escritas } = armazemFake(store);
    const res = await recifrarColuna(armazem, k1ComK2(), DOC, op);
    expect(res).toEqual({ lidas: 3, recifradas: 2, conflitos: 0, falhas: 1 });
    expect(escritas).toEqual(['id-1', 'id-2']);
  });

  it('segunda execucao nao muda nada (idempotente)', async () => {
    const store = new Map([
      [`${DOC.tabela}.${DOC.coluna}`, linhas(so1(), DOC, 3)],
    ]);
    const { armazem } = armazemFake(store);
    await recifrarColuna(armazem, k1ComK2(), DOC, op);
    const { armazem: outro, escritas } = armazemFake(store);
    const res = await recifrarColuna(outro, k1ComK2(), DOC, op);
    expect(res).toEqual({ lidas: 0, recifradas: 0, conflitos: 0, falhas: 0 });
    expect(escritas).toEqual([]);
  });

  it('filtro por clinica nao toca em outra clinica', async () => {
    const c1 = so1();
    const ls = linhas(c1, DOC, 2);
    ls.push({
      ...linhas(c1, DOC, 1)[0],
      id: 'id-outra',
      clinicaId: 'clinica-b',
    });
    const store = new Map([[`${DOC.tabela}.${DOC.coluna}`, ls]]);
    const { armazem } = armazemFake(store);
    const res = await recifrarColuna(armazem, k1ComK2(), DOC, {
      lote: 200,
      dryRun: false,
      clinicaId: CLINICA,
    });
    expect(res.recifradas).toBe(2);
    expect(
      store
        .get(`${DOC.tabela}.${DOC.coluna}`)!
        .find((l) => l.id === 'id-outra')!
        .valor.startsWith('v1.k1.'),
    ).toBe(true);
  });
});

describe('recifrar: recifrarTudo', () => {
  it('passa por todas as colunas e devolve uma contagem por coluna', async () => {
    const { armazem } = armazemFake(new Map());
    const res = await recifrarTudo(armazem, k1ComK2(), {
      lote: 200,
      dryRun: true,
    });
    expect(res.map((r) => `${r.alvo.tabela}.${r.alvo.coluna}`)).toEqual(
      ALVOS.map((a) => `${a.tabela}.${a.coluna}`),
    );
  });
});

describe('recifrar: lerOpcoes', () => {
  it('padroes: lote 200, sem filtro, gravando', () => {
    expect(lerOpcoes([])).toEqual({ lote: 200, dryRun: false });
  });

  it('le --clinica, --lote e --dry-run', () => {
    expect(
      lerOpcoes(['--clinica', 'clinica-a', '--lote', '50', '--dry-run']),
    ).toEqual({
      clinicaId: 'clinica-a',
      lote: 50,
      dryRun: true,
    });
  });

  it('recusa lote invalido, clinica sem valor e opcao desconhecida', () => {
    expect(() => lerOpcoes(['--lote', '0'])).toThrow(/--lote/);
    expect(() => lerOpcoes(['--lote', 'abc'])).toThrow(/--lote/);
    expect(() => lerOpcoes(['--clinica'])).toThrow(/--clinica/);
    expect(() => lerOpcoes(['--clinica', '--dry-run'])).toThrow(/--clinica/);
    expect(() => lerOpcoes(['--tudo'])).toThrow(/desconhecida/);
  });
});
