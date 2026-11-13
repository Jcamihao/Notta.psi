import { Paciente } from './pacientes.service';
import { casaBusca, filtrarPacientes, normalizarTexto } from './busca-pacientes';

const base = (extra: Partial<Paciente>): Paciente => ({
  id: 'x',
  nome: 'Fulano',
  nascimento: null,
  telefone: null,
  email: null,
  criadoEm: '2026-10-01T10:00:00.000Z',
  ...extra,
});

const ANA = base({
  id: 'a1',
  nome: 'Ana Lima',
  email: 'ana@exemplo.com',
  telefone: '+55 (11) 99999-0000',
  consentimento: 'CONCEDIDO',
});
const JOSE = base({
  id: 'j2',
  nome: 'José Antônio da Silva',
  email: 'jose.silva@mail.com',
  telefone: '21 98888-1234',
  consentimento: 'NENHUM',
});
const CARLA = base({ id: 'c3', nome: 'Carla Dias', consentimento: 'REVOGADO' });

describe('normalizarTexto', () => {
  it('tira acentos, põe em minúsculas e apara as pontas', () => {
    expect(normalizarTexto('  José  ANTÔNIO  ')).toBe('jose  antonio');
    expect(normalizarTexto('Ação')).toBe('acao');
  });

  it('aceita null e undefined sem quebrar', () => {
    expect(normalizarTexto(null)).toBe('');
    expect(normalizarTexto(undefined)).toBe('');
  });
});

describe('casaBusca', () => {
  it('termo vazio ou só de espaços não filtra nada', () => {
    expect(casaBusca(ANA, '')).toBeTrue();
    expect(casaBusca(ANA, '   ')).toBeTrue();
    expect(casaBusca(CARLA, '\t ')).toBeTrue();
  });

  it('casa o nome sem diferenciar maiúsculas nem acentos', () => {
    expect(casaBusca(JOSE, 'JOSE')).toBeTrue();
    expect(casaBusca(JOSE, 'antonio')).toBeTrue();
    expect(casaBusca(JOSE, 'antônio')).toBeTrue();
    expect(casaBusca(ANA, 'bruno')).toBeFalse();
  });

  it('casa o e-mail', () => {
    expect(casaBusca(ANA, 'exemplo.com')).toBeTrue();
    expect(casaBusca(JOSE, 'mail.com')).toBeTrue();
  });

  it('todas as palavras precisam aparecer (AND), no nome ou no e-mail', () => {
    expect(casaBusca(JOSE, 'jose silva')).toBeTrue();
    expect(casaBusca(JOSE, 'silva antonio')).toBeTrue();
    expect(casaBusca(JOSE, 'jose carla')).toBeFalse();
    expect(casaBusca(ANA, 'ana lima')).toBeTrue();
  });

  it('ignora espaços extras entre e nas pontas do termo', () => {
    expect(casaBusca(ANA, '   ana    lima  ')).toBeTrue();
  });

  it('telefone: compara só dígitos, com e sem máscara', () => {
    expect(casaBusca(ANA, '99999-0000')).toBeTrue();
    expect(casaBusca(ANA, '(11) 99999 0000')).toBeTrue();
    expect(casaBusca(ANA, '11999990000')).toBeTrue();
    expect(casaBusca(JOSE, '98888.1234')).toBeTrue();
    expect(casaBusca(JOSE, '99999')).toBeFalse();
  });

  it('telefone com máscara colada em várias palavras (DDD e número) casa', () => {
    expect(casaBusca(ANA, '11 99999-0000')).toBeTrue();
    expect(casaBusca(ANA, '+55 11 99999-0000')).toBeTrue();
  });

  it('termo de 2 dígitos NÃO casa telefone', () => {
    expect(casaBusca(ANA, '99')).toBeFalse();
    expect(casaBusca(JOSE, '21')).toBeFalse();
  });

  it('número de 2 dígitos ainda casa nome ou e-mail, se estiver lá', () => {
    const com2 = base({ nome: 'Ana 22', email: null, telefone: null });
    expect(casaBusca(com2, '22')).toBeTrue();
  });

  it('telefone, nome e e-mail nulos não quebram a busca', () => {
    const nulo = base({ nome: 'Lia', email: null, telefone: null });
    expect(casaBusca(nulo, 'lia')).toBeTrue();
    expect(casaBusca(nulo, '99999')).toBeFalse();
    expect(casaBusca(nulo, 'exemplo')).toBeFalse();
  });

  it('palavra de texto e número juntas exigem as duas (AND)', () => {
    expect(casaBusca(ANA, 'ana 99999')).toBeTrue();
    expect(casaBusca(CARLA, 'ana 99999')).toBeFalse();
    expect(casaBusca(ANA, 'carla 99999')).toBeFalse();
  });
});

describe('filtrarPacientes', () => {
  const LISTA = [ANA, JOSE, CARLA];

  it('lista vazia devolve lista vazia', () => {
    expect(filtrarPacientes([], 'ana', 'TODOS')).toEqual([]);
    expect(filtrarPacientes([], '', 'CONCEDIDO')).toEqual([]);
  });

  it('sem busca e com TODOS devolve tudo, na mesma ordem', () => {
    expect(filtrarPacientes(LISTA, '', 'TODOS')).toEqual(LISTA);
    expect(filtrarPacientes(LISTA, '  ', 'TODOS')).toEqual(LISTA);
  });

  it('filtra por estado de consentimento; ausente conta como NENHUM', () => {
    const semCampo = base({ id: 'd4', nome: 'Davi' });
    const todos = [ANA, JOSE, CARLA, semCampo];
    expect(filtrarPacientes(todos, '', 'CONCEDIDO')).toEqual([ANA]);
    expect(filtrarPacientes(todos, '', 'NENHUM')).toEqual([JOSE, semCampo]);
    expect(filtrarPacientes(todos, '', 'REVOGADO')).toEqual([CARLA]);
  });

  it('combina busca e estado (os dois precisam valer)', () => {
    expect(filtrarPacientes(LISTA, 'a', 'CONCEDIDO')).toEqual([ANA]);
    expect(filtrarPacientes(LISTA, 'silva', 'CONCEDIDO')).toEqual([]);
    expect(filtrarPacientes(LISTA, 'silva', 'NENHUM')).toEqual([JOSE]);
  });

  it('não altera a lista original', () => {
    const copia = [...LISTA];
    filtrarPacientes(LISTA, 'ana', 'TODOS');
    expect(LISTA).toEqual(copia);
  });
});
