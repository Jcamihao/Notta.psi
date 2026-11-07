import { CONTEUDO_SEGURANCA } from './seguranca.conteudo';

// Le docs/SEGURANCA-AFIRMACOES.md (copiado para a raiz do Karma pelo angular.json, so no teste).
// Regra: todo item "feito" tem linha na tabela, e toda linha da tabela e um item "feito".
describe('sincronia: seguranca.conteudo.ts x docs/SEGURANCA-AFIRMACOES.md', () => {
  let markdown = '';

  beforeAll(async () => {
    const resposta = await fetch('/SEGURANCA-AFIRMACOES.md');
    markdown = await resposta.text();
  });

  const idsDaTabela = (): string[] =>
    markdown
      .split('\n')
      .map((linha) => /^\|\s*`([a-z-]+)`\s*\|/.exec(linha))
      .filter((m): m is RegExpExecArray => m !== null)
      .map((m) => m[1]);

  const todos = CONTEUDO_SEGURANCA.secoes.flatMap((s) => s.itens);
  const feitos = todos.filter((i) => i.status === 'feito').map((i) => i.id);
  const pendentes = todos.filter((i) => i.status === 'pendente').map((i) => i.id);

  it('carregou o markdown com a tabela', () => {
    expect(markdown).toContain('| id | afirmacao | evidencia');
    expect(idsDaTabela().length).toBeGreaterThan(0);
  });

  it('todo item feito tem linha na tabela', () => {
    for (const id of feitos) {
      expect(idsDaTabela()).withContext(id).toContain(id);
    }
  });

  it('toda linha da tabela corresponde a um item feito', () => {
    for (const id of idsDaTabela()) {
      expect(feitos).withContext(id).toContain(id);
    }
  });

  it('nenhum item pendente aparece na tabela', () => {
    for (const id of pendentes) {
      expect(idsDaTabela()).withContext(id).not.toContain(id);
    }
  });

  it('ids sao unicos na tabela', () => {
    const ids = idsDaTabela();
    expect(new Set(ids).size).toBe(ids.length);
  });
});
