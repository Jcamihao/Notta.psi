import { randomUUID } from 'node:crypto';
import {
  Armazem,
  descartarVencidos,
  formatar,
  lerOpcoes,
  Totais,
  verificarPapel,
} from './descartar';

const A = randomUUID();
const B = randomUUID();
const AGORA = new Date('2026-11-11T12:00:00.000Z');

type Chamada = {
  clinicaId: string;
  corte: Date;
  lote: number;
  simular: boolean;
};

// Armazem falso: cada clinica tem uma fila de respostas de lote. Sem fila = nada vencido.
function falso(opcoes: {
  clinicas?: string[];
  filas?: Record<string, Totais[]>;
}) {
  const chamadas: Chamada[] = [];
  const filas: Record<string, Totais[]> = {};
  for (const [k, v] of Object.entries(opcoes.filas ?? {})) filas[k] = [...v];
  const clinicas = jest.fn(() => Promise.resolve(opcoes.clinicas ?? []));
  const armazem: Armazem = {
    clinicas,
    lote: jest.fn((clinicaId, corte, lote, simular) => {
      chamadas.push({ clinicaId, corte, lote, simular });
      const fila = filas[clinicaId] ?? [];
      return Promise.resolve(
        fila.shift() ?? { selecionados: 0, documentos: 0, geracoes: 0 },
      );
    }),
  };
  return { armazem, chamadas, clinicas };
}

const op = (
  o: Partial<{ clinicaId: string; lote: number; dryRun: boolean }>,
) => ({
  lote: 500,
  dryRun: false,
  ...o,
});

describe('lerOpcoes', () => {
  it('padroes: lote 500, sem dry-run, sem clinica', () => {
    expect(lerOpcoes([])).toEqual({ lote: 500, dryRun: false });
  });

  it('aceita --dry-run, --clinica <uuid> e --lote N', () => {
    expect(lerOpcoes(['--dry-run', '--clinica', A, '--lote', '50'])).toEqual({
      dryRun: true,
      clinicaId: A,
      lote: 50,
    });
  });

  it.each([
    [['--clinica'], /--clinica/],
    [['--clinica', '--dry-run'], /--clinica/],
    [['--clinica', 'x; DROP TABLE'], /--clinica/],
    [['--lote', '0'], /--lote/],
    [['--lote', '5001'], /--lote/],
    [['--lote', 'abc'], /--lote/],
    [['--lote', '1.5'], /--lote/],
    [['--apagar-tudo'], /opcao desconhecida/],
  ])('rejeita %p', (argv, msg) => {
    expect(() => lerOpcoes(argv)).toThrow(msg);
  });
});

describe('verificarPapel', () => {
  it('recusa praxis_app (o runtime nunca descarta)', () => {
    expect(() => verificarPapel('praxis_app')).toThrow(/praxis_owner/);
  });

  it('aceita praxis_owner', () => {
    expect(() => verificarPapel('praxis_owner')).not.toThrow();
  });
});

describe('descartarVencidos', () => {
  it('sem --clinica percorre todas as clinicas, na ordem devolvida', async () => {
    const { armazem, chamadas } = falso({ clinicas: [A, B] });
    await descartarVencidos(armazem, op({}), { agora: AGORA, dias: 7 });
    expect(chamadas.map((c) => c.clinicaId)).toEqual([A, B]);
  });

  it('com --clinica nao lista clinicas e so toca nela', async () => {
    const { armazem, chamadas, clinicas } = falso({ clinicas: [A, B] });
    await descartarVencidos(armazem, op({ clinicaId: B }), {
      agora: AGORA,
      dias: 7,
    });
    expect(clinicas).not.toHaveBeenCalled();
    expect(chamadas.map((c) => c.clinicaId)).toEqual([B]);
  });

  it('corte = agora - dias, passado ao armazem', async () => {
    const { armazem, chamadas } = falso({ clinicas: [A] });
    await descartarVencidos(armazem, op({}), { agora: AGORA, dias: 7 });
    expect(chamadas[0].corte).toEqual(new Date('2026-11-04T12:00:00.000Z'));
  });

  it('repete enquanto o lote vem cheio e ha progresso; para no lote parcial', async () => {
    const { armazem, chamadas } = falso({
      clinicas: [A],
      filas: {
        [A]: [
          { selecionados: 2, documentos: 2, geracoes: 1 },
          { selecionados: 2, documentos: 2, geracoes: 0 },
          { selecionados: 1, documentos: 1, geracoes: 0 },
        ],
      },
    });
    const r = await descartarVencidos(armazem, op({ lote: 2 }), {
      agora: AGORA,
      dias: 7,
    });
    expect(chamadas).toHaveLength(3);
    expect(chamadas.every((c) => c.lote === 2 && !c.simular)).toBe(true);
    expect(r.total).toEqual({
      clinicas: 1,
      selecionados: 5,
      documentos: 5,
      geracoes: 1,
    });
  });

  it('sem progresso (lote cheio mas nada apagado) para: nao gira em falso', async () => {
    const { armazem, chamadas } = falso({
      clinicas: [A],
      filas: {
        [A]: [{ selecionados: 2, documentos: 0, geracoes: 0 }],
      },
    });
    await descartarVencidos(armazem, op({ lote: 2 }), {
      agora: AGORA,
      dias: 7,
    });
    expect(chamadas).toHaveLength(1);
  });

  it('dry-run chama UMA vez com simular = true e nao repete', async () => {
    const { armazem, chamadas } = falso({
      clinicas: [A],
      filas: {
        [A]: [{ selecionados: 9, documentos: 9, geracoes: 3 }],
      },
    });
    const r = await descartarVencidos(armazem, op({ dryRun: true, lote: 2 }), {
      agora: AGORA,
      dias: 7,
    });
    expect(chamadas).toEqual([
      {
        clinicaId: A,
        corte: new Date('2026-11-04T12:00:00.000Z'),
        lote: 2,
        simular: true,
      },
    ]);
    expect(r.dryRun).toBe(true);
  });
});

describe('formatar', () => {
  it('so numeros e ids de clinica; nunca texto', async () => {
    const { armazem } = falso({
      clinicas: [A],
      filas: { [A]: [{ selecionados: 3, documentos: 3, geracoes: 1 }] },
    });
    const res = await descartarVencidos(armazem, op({}), {
      agora: AGORA,
      dias: 7,
    });
    const linhas = formatar(res);
    const permitida =
      /^(prazo=\d+ dias corte=\S+|clinica [0-9a-f-]{36}: selecionados=\d+ documentos=\d+ geracoes=\d+|total: clinicas=\d+ selecionados=\d+ documentos=\d+ geracoes=\d+|gravado: .*)$/;
    for (const l of linhas) expect(l).toMatch(permitida);
    expect(linhas.join('\n')).toContain(`clinica ${A}`);
  });

  it('dry-run diz que nada foi gravado', async () => {
    const { armazem } = falso({ clinicas: [A] });
    const res = await descartarVencidos(armazem, op({ dryRun: true }), {
      agora: AGORA,
      dias: 7,
    });
    expect(formatar(res).at(-1)).toBe('dry-run: nada foi gravado');
  });
});
