import { detectarDados } from './dados-identificaveis';

// 529.982.247-25 e 111.444.777-35 tem digito verificador valido; 123.456.789-00 nao tem.
describe('detectarDados', () => {
  describe('CPF', () => {
    for (const t of [
      'CPF 529.982.247-25 no cadastro',
      'o numero e 123.456.789-00',
      'cpf:52998224725.',
      'documento 11144477735',
    ]) {
      it(`avisa: ${t}`, () => expect(detectarDados(t)).toContain('CPF'));
    }

    for (const t of [
      '12345678900 foi o protocolo',
      '11111111111',
      '123456789012',
      'Sessao 02/11/2026, 50 minutos, R$ 350,00, 34 anos',
    ]) {
      it(`nao avisa: ${t}`, () => expect(detectarDados(t)).not.toContain('CPF'));
    }

    it('CPF valido sem pontuacao nao vira telefone', () => {
      expect(detectarDados('52998224725')).toEqual(['CPF']);
    });
  });

  describe('telefone', () => {
    for (const t of [
      'ligou do (11) 91234-5678',
      'fone (21) 3456-7890',
      '11 91234-5678',
      '11912345678',
      '+55 11 91234-5678',
      'whatsapp 91234-5678',
      '11 3456-7890',
    ]) {
      it(`avisa: ${t}`, () => expect(detectarDados(t)).toContain('telefone'));
    }

    for (const t of [
      'de 2019-2020 foi acompanhado',
      'protocolo 1234-5678',
      'em 02/11/2026 as 14:30',
      'pagou R$ 1.234,56 e 12345',
      'tem 34 anos, 3 filhos e 2 irmaos',
    ]) {
      it(`nao avisa: ${t}`, () => expect(detectarDados(t)).not.toContain('telefone'));
    }
  });

  describe('e-mail', () => {
    it('avisa e-mail', () => {
      expect(detectarDados('escreveu para maria.silva+x@exemplo.com.br ontem')).toEqual(['e-mail']);
    });
    it('nao avisa arroba solta nem sem dominio', () => {
      expect(detectarDados('usa @maria no app e ana@casa')).toEqual([]);
    });
  });

  describe('CEP e endereco', () => {
    it('CEP com hifen e com a palavra CEP', () => {
      expect(detectarDados('mora no 01310-100')).toContain('CEP');
      expect(detectarDados('CEP 01310100')).toContain('CEP');
    });
    it('nao avisa 8 digitos soltos', () => {
      expect(detectarDados('codigo 01310100')).not.toContain('CEP');
    });
    for (const t of [
      'Mora na Rua das Flores, 123',
      'av. Paulista 1578',
      'Praça da Sé, nº 10',
      'Travessa Dois, n. 45 apto 3',
    ]) {
      it(`endereco: ${t}`, () => expect(detectarDados(t)).toContain('endereço'));
    }
    for (const t of ['Ele mora na rua e se sente seguro', 'disse que dr. 3 vezes nao veio']) {
      it(`nao avisa: ${t}`, () => expect(detectarDados(t)).not.toContain('endereço'));
    }
  });

  describe('nome do paciente', () => {
    it('acha nome completo, so um nome, sem acento e sem diferenciar maiusculas', () => {
      expect(detectarDados('Maria da Silva chegou cedo', 'Maria da Silva')).toEqual([
        'nome do paciente',
      ]);
      expect(detectarDados('a maria chorou', 'Maria da Silva')).toContain('nome do paciente');
      expect(detectarDados('JOAO disse', 'João Pereira')).toContain('nome do paciente');
      expect(detectarDados('falou da Silva', 'Maria da Silva')).toContain('nome do paciente');
    });
    it('so palavra inteira, ignora conectores e nome curto', () => {
      expect(detectarDados('mariana chorou', 'Maria')).toEqual([]);
      expect(detectarDados('foi de carro e da escola', 'Maria da Silva')).toEqual([]);
      expect(detectarDados('ela falou', 'Zé Lu')).toEqual([]);
    });
    it('sem nome carregado, nao avisa nome', () => {
      expect(detectarDados('Maria da Silva chegou', '')).toEqual([]);
      expect(detectarDados('Maria da Silva chegou', '   ')).toEqual([]);
    });
    it('nome com caractere especial de regex nao quebra', () => {
      expect(() => detectarDados('texto', 'Ana (Nanda) +Souza')).not.toThrow();
    });
  });

  it('varios tipos juntos, em ordem fixa, sem repetir', () => {
    const t = 'Maria, CPF 529.982.247-25, (11) 91234-5678, maria@exemplo.com, CEP 01310-100';
    expect(detectarDados(t, 'Maria')).toEqual([
      'CPF',
      'telefone',
      'e-mail',
      'CEP',
      'nome do paciente',
    ]);
  });

  it('texto limpo e vazio nao avisam', () => {
    expect(detectarDados('Paciente relatou insonia e conflito com o pai na sessao.')).toEqual([]);
    expect(detectarDados('')).toEqual([]);
  });

  it('nao devolve o trecho: so rotulos fixos', () => {
    const r = detectarDados('CPF 529.982.247-25 e maria@exemplo.com');
    expect(JSON.stringify(r)).not.toContain('529');
    expect(JSON.stringify(r)).not.toContain('maria');
  });

  it('texto de 20.000 caracteres e processado rapido', () => {
    const t = 'rua ' + 'a '.repeat(10000);
    const ini = performance.now();
    detectarDados(t, 'Maria da Silva');
    expect(performance.now() - ini).toBeLessThan(500);
  });
});
