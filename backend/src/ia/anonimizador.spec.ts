import {
  anonimizar,
  extrairDadosPessoais,
  LIMITE_TEXTO_IA,
  reidentificar,
  TextoIaInvalidoError,
  validarTamanho,
} from './anonimizador';

const paciente = { nomesPaciente: ['Maria da Silva Oliveira'] };
const an = (t: string, extra: string[] = []) =>
  anonimizar(t, { ...paciente, termosExtras: extra }).textoAnonimizado;

describe('anonimizar: nome do paciente', () => {
  it('troca nome completo e cada parte com 3+ letras', () => {
    expect(
      an('Maria da Silva Oliveira chegou. Maria falou. Oliveira calou.'),
    ).toBe('[PACIENTE] chegou. [PACIENTE] falou. [PACIENTE] calou.');
  });

  it('ignora caixa e acento', () => {
    expect(an('MARIA e silva e OLIVEIRA')).toBe(
      '[PACIENTE] e [PACIENTE] e [PACIENTE]',
    );
    const r = anonimizar('Jose chegou. JOSÉ saiu. José voltou.', {
      nomesPaciente: ['José Antônio'],
    });
    expect(r.textoAnonimizado).toBe(
      '[PACIENTE] chegou. [PACIENTE] saiu. [PACIENTE] voltou.',
    );
    expect(
      anonimizar('antonio e ANTÔNIO', { nomesPaciente: ['José Antônio'] })
        .textoAnonimizado,
    ).toBe('[PACIENTE] e [PACIENTE]');
  });

  it('so palavra inteira: "Ana" nao troca em banana, Ananias, Joana', () => {
    const r = anonimizar('banana, Ananias, Joana e Ana', {
      nomesPaciente: ['Ana'],
    });
    expect(r.textoAnonimizado).toBe('banana, Ananias, Joana e [PACIENTE]');
  });

  it('palavra inteira junto de pontuacao e apostrofo', () => {
    const r = anonimizar('"Ana", (Ana) Ana. D\'Ana-Lu', {
      nomesPaciente: ['Ana'],
    });
    expect(r.textoAnonimizado).toBe(
      '"[PACIENTE]", ([PACIENTE]) [PACIENTE]. D\'[PACIENTE]-Lu',
    );
  });

  it('nome com espacos extras e quebra de linha no meio ainda casa', () => {
    expect(an('Maria   da\nSilva Oliveira falou')).toBe('[PACIENTE] falou');
  });

  it('particulas curtas (da, de, dos) nao trocam: sao palavras comuns', () => {
    const r = anonimizar('o carro da casa dos pais das filhas', {
      nomesPaciente: ['Joao da Costa dos Santos das Dores'],
    });
    expect(r.textoAnonimizado).toBe('o carro da casa dos pais das filhas');
  });

  it('partes com menos de 3 letras nao trocam', () => {
    const r = anonimizar('Li e Jo conversaram com Lucas', {
      nomesPaciente: ['Jo Li Lucas'],
    });
    expect(r.textoAnonimizado).toBe('Li e Jo conversaram com [PACIENTE]');
  });

  it('aceita varios nomes (nome social) e forma NFD na entrada', () => {
    const r = anonimizar('Béa e Carla', {
      nomesPaciente: ['Carla Souza', 'Béa'],
    });
    expect(r.textoAnonimizado).toBe('[PACIENTE] e [PACIENTE]');
  });

  it('PACIENTE restaura o nome completo (primeiro da lista)', () => {
    const r = anonimizar('Silva chegou', paciente);
    expect(r.mapa).toContainEqual({
      codigo: '[PACIENTE]',
      original: 'Maria da Silva Oliveira',
    });
  });

  it('PACIENTE fica no mapa mesmo sem aparecer no texto (a IA pode usar)', () => {
    const r = anonimizar('nada aqui', paciente);
    expect(r.mapa).toEqual([
      { codigo: '[PACIENTE]', original: 'Maria da Silva Oliveira' },
    ]);
    expect(reidentificar('[PACIENTE] veio', r.mapa)).toBe(
      'Maria da Silva Oliveira veio',
    );
  });

  it('sem nomes, nao ha PACIENTE no mapa', () => {
    expect(anonimizar('oi', { nomesPaciente: [] }).mapa).toEqual([]);
    expect(anonimizar('oi', { nomesPaciente: ['  ', ''] }).mapa).toEqual([]);
  });
});

describe('anonimizar: CPF', () => {
  it('formatado (com pontos e traco), valido ou nao', () => {
    expect(an('cpf 529.982.247-25 e 111.222.333-44.')).toBe(
      'cpf [CPF] e [CPF_2].',
    );
  });

  it('11 digitos so com digito verificador valido', () => {
    expect(an('cpf 52998224725 ok')).toBe('cpf [CPF] ok');
    expect(an('numero 52998224726 nao')).toBe('numero 52998224726 nao');
    expect(an('igual 11111111111 nao')).toBe('igual 11111111111 nao');
  });

  it('nao pega 11 digitos dentro de numero maior', () => {
    expect(an('protocolo 1529982247250')).toBe('protocolo 1529982247250');
  });
});

describe('anonimizar: telefone', () => {
  it.each([
    '(11) 91234-5678',
    '11 91234-5678',
    '11912345678',
    '+55 11 91234-5678',
    '(11) 3456-7890',
    '11-3456-7890',
    '91234-5678',
  ])('troca %s', (tel) => {
    expect(an(`liga ${tel} agora`)).toBe('liga [TELEFONE] agora');
  });

  it('nao troca idade, valor, horario, numero de sessao nem data parcial', () => {
    const t =
      'Tem 30 anos, pagou R$ 1.200,00 as 14:30 na sessao 12 de 20, 10/05 e 3.456.';
    expect(an(t)).toBe(t);
  });
});

describe('anonimizar: e-mail', () => {
  it('troca e-mail e preserva ponto final da frase', () => {
    expect(an('escreva para Ana.Lu+x@mail.com.br. Obrigada')).toBe(
      'escreva para [EMAIL]. Obrigada',
    );
  });

  it('e-mail que contem parte do nome vira um [EMAIL] so', () => {
    expect(an('maria.silva@exemplo.com')).toBe('[EMAIL]');
  });

  it('mesmo e-mail com caixa diferente = mesmo codigo', () => {
    expect(an('a@x.com e A@X.COM e b@x.com')).toBe(
      '[EMAIL] e [EMAIL] e [EMAIL_2]',
    );
  });
});

describe('anonimizar: CEP e endereco', () => {
  it('CEP com hifen ou com a palavra CEP', () => {
    expect(an('cep 01310-100')).toBe('[ENDERECO]');
    expect(an('CEP: 01310100')).toBe('[ENDERECO]');
  });

  it('nao troca numero de 8 digitos sem CEP nem hifen', () => {
    expect(an('codigo 01310100')).toBe('codigo 01310100');
  });

  it.each([
    'Rua das Flores, 123',
    'Avenida Paulista 1000',
    'Av. Brasil, n° 45',
    'Travessa Sao Jose, 7',
    'Alameda dos Anjos, 88',
    'R. Augusta, 2000',
    'rua das flores, no 15',
  ])('troca endereco %s', (e) => {
    expect(an(`mora na ${e} perto`)).toBe('mora na [ENDERECO] perto');
  });

  it('rua sem numero fica (limite conhecido)', () => {
    expect(an('mora na Rua Augusta')).toBe('mora na Rua Augusta');
  });
});

describe('anonimizar: datas', () => {
  it('dd/mm/aaaa, d/m/aa e aaaa-mm-dd', () => {
    expect(an('em 10/05/2024, 3/7/24 e 2024-01-15.')).toBe(
      'em [DATA], [DATA_2] e [DATA_3].',
    );
  });

  it('mesma data repetida = mesmo codigo', () => {
    expect(an('10/05/2024 e depois 10/05/2024')).toBe('[DATA] e depois [DATA]');
  });

  it('nao troca mes 13 nem versao/valor com pontos', () => {
    expect(an('31/13/2024 e 1.200,00')).toBe('31/13/2024 e 1.200,00');
  });
});

describe('anonimizar: termos extras', () => {
  it('cada termo vira [TERMO_n] pela posicao na lista, palavra inteira, sem acento nem caixa', () => {
    const r = an('A irma Joana e o Pedro Álvares do colegio SAO JOSE. joanaa', [
      'joana',
      'pedro alvares',
      'São José',
    ]);
    expect(r).toBe(
      'A irma [TERMO_1] e o [TERMO_2] do colegio [TERMO_3]. joanaa',
    );
  });

  it('termo repetido ou vazio na lista nao quebra a numeracao', () => {
    const r = anonimizar('Joana e Lia', {
      nomesPaciente: [],
      termosExtras: ['Joana', ' ', 'JOANA', 'Lia'],
    });
    expect(r.textoAnonimizado).toBe('[TERMO_1] e [TERMO_2]');
  });

  it('termo com caracteres de regex e tratado como texto', () => {
    const r = anonimizar('o clube (A+B) e o clube AB', {
      nomesPaciente: [],
      termosExtras: ['(A+B)', '.*'],
    });
    expect(r.textoAnonimizado).toBe('o clube [TERMO_1] e o clube AB');
  });

  it('o mesmo original sempre recebe o mesmo codigo', () => {
    const r = anonimizar('Lia viu LIA e lia', {
      nomesPaciente: [],
      termosExtras: ['Lia'],
    });
    expect(r.textoAnonimizado).toBe('[TERMO_1] viu [TERMO_1] e [TERMO_1]');
    expect(r.mapa).toEqual([{ codigo: '[TERMO_1]', original: 'Lia' }]);
  });
});

describe('anonimizar: colchetes de entrada e conflitos', () => {
  it('colchetes da entrada viram parenteses (nao colidem com codigos)', () => {
    const r = anonimizar('escreveu [CPF] e [PACIENTE] e [x]', {
      nomesPaciente: ['Ana Lu'],
    });
    expect(r.textoAnonimizado).toBe('escreveu (CPF) e (PACIENTE) e (x)');
    expect(r.textoAnonimizado).not.toMatch(/[[\]]/);
  });

  it('termo extra com colchetes tambem e convertido', () => {
    const r = anonimizar('veja [Lia] aqui', {
      nomesPaciente: [],
      termosExtras: ['[Lia]'],
    });
    expect(r.textoAnonimizado).toBe('veja [TERMO_1] aqui');
  });

  it('CPF valido de 11 digitos vence telefone (mesmo trecho)', () => {
    const r = anonimizar('52998224725', { nomesPaciente: [] });
    expect(r.textoAnonimizado).toBe('[CPF]');
  });

  it('e deterministico', () => {
    const t = 'Maria 10/05/2024 a@x.com 52998224725';
    expect(anonimizar(t, paciente)).toEqual(anonimizar(t, paciente));
  });

  it('texto vazio e sem dado devolve igual', () => {
    expect(an('')).toBe('');
    expect(an('Sessao tranquila. Tem 30 anos.')).toBe(
      'Sessao tranquila. Tem 30 anos.',
    );
  });

  it('20000 letras seguidas (pior caso do e-mail) terminam rapido', () => {
    const ini = Date.now();
    anonimizar('a'.repeat(20000) + ' ' + 'a1'.repeat(10000), paciente);
    extrairDadosPessoais('a'.repeat(200000));
    expect(Date.now() - ini).toBeLessThan(1500);
  });

  it('entrada grande e patologica termina rapido', () => {
    const ruim =
      'Rua a '.repeat(3000) + '1'.repeat(5000) + ' ' + 'a.'.repeat(5000);
    const ini = Date.now();
    anonimizar(ruim, paciente);
    expect(Date.now() - ini).toBeLessThan(1500);
  });
});

describe('anonimizar + reidentificar', () => {
  it('ida e volta restaura os dados (exceto variantes do nome)', () => {
    const t =
      'Maria da Silva Oliveira, CPF 529.982.247-25, tel (11) 91234-5678, e-mail m@x.com, mora na Rua A, 10, CEP 01310-100, consulta em 10/05/2024 e 17/05/2024. Irma Joana.';
    const r = anonimizar(t, { ...paciente, termosExtras: ['Joana'] });
    expect(r.textoAnonimizado).toBe(
      '[PACIENTE], CPF [CPF], tel [TELEFONE], e-mail [EMAIL], mora na [ENDERECO], [ENDERECO_2], consulta em [DATA] e [DATA_2]. Irma [TERMO_1].',
    );
    expect(reidentificar(r.textoAnonimizado, r.mapa)).toBe(t);
  });
});

describe('reidentificar', () => {
  it('codigo desconhecido fica como esta', () => {
    expect(
      reidentificar('[CPF] e [XYZ] e [PACIENTE_9]', [
        { codigo: '[CPF]', original: '123' },
      ]),
    ).toBe('123 e [XYZ] e [PACIENTE_9]');
  });

  it('sem recursao: original que contem codigo nao vira outra troca', () => {
    const mapa = [
      { codigo: '[TERMO_1]', original: 'ver [CPF] aqui' },
      { codigo: '[CPF]', original: '999' },
    ];
    expect(reidentificar('a [TERMO_1] b [CPF]', mapa)).toBe(
      'a ver [CPF] aqui b 999',
    );
  });

  it('original com $& ou $1 entra literal', () => {
    expect(
      reidentificar('x [TERMO_1] y', [
        { codigo: '[TERMO_1]', original: '$& $1 $$' },
      ]),
    ).toBe('x $& $1 $$ y');
  });

  it('mapa vazio e texto vazio', () => {
    expect(reidentificar('[CPF]', [])).toBe('[CPF]');
    expect(reidentificar('', [{ codigo: '[CPF]', original: '1' }])).toBe('');
  });

  it('codigo nao e achado dentro de outro (ex.: [DATA] x [DATA_2])', () => {
    const mapa = [
      { codigo: '[DATA]', original: 'A' },
      { codigo: '[DATA_2]', original: 'B' },
    ];
    expect(reidentificar('[DATA] [DATA_2]', mapa)).toBe('A B');
  });
});

describe('validarTamanho', () => {
  it('limite e 8000', () => {
    expect(LIMITE_TEXTO_IA).toBe(8000);
  });

  it('aceita 1..8000 e recusa vazio, so espacos e acima', () => {
    expect(() => validarTamanho('a')).not.toThrow();
    expect(() => validarTamanho('a'.repeat(8000))).not.toThrow();
    for (const [t, motivo] of [
      ['', 'VAZIO'],
      [' \n\t ', 'VAZIO'],
      ['a'.repeat(8001), 'GRANDE_DEMAIS'],
    ] as const) {
      try {
        validarTamanho(t);
        throw new Error('deveria lancar');
      } catch (e) {
        expect(e).toBeInstanceOf(TextoIaInvalidoError);
        expect((e as TextoIaInvalidoError).motivo).toBe(motivo);
      }
    }
  });

  it('recusa nao string', () => {
    expect(() => validarTamanho(undefined as unknown as string)).toThrow(
      TextoIaInvalidoError,
    );
  });
});

describe('extrairDadosPessoais', () => {
  it('acha CPF, e-mail e telefone com chave normalizada', () => {
    const s = extrairDadosPessoais(
      'a 529.982.247-25, B@X.com, (11) 91234-5678, 52998224725',
    );
    expect([...s].sort()).toEqual([
      'CPF:52998224725',
      'EMAIL:b@x.com',
      'TELEFONE:11912345678',
    ]);
  });

  it('nada em texto limpo', () => {
    expect(extrairDadosPessoais('Tem 30 anos e pagou R$ 1.200,00').size).toBe(
      0,
    );
  });
});
