import { TestBed } from '@angular/core/testing';
import { BAIXAR_ARQUIVO, baixarArquivo } from './download';

describe('baixarArquivo', () => {
  let cliques: HTMLAnchorElement[];

  beforeEach(() => {
    cliques = [];
    spyOn(URL, 'createObjectURL').and.returnValue('blob:teste-1');
    spyOn(URL, 'revokeObjectURL');
    spyOn(HTMLAnchorElement.prototype, 'click').and.callFake(function (this: HTMLAnchorElement) {
      cliques.push(this);
    });
  });

  it('cria a URL do blob, clica num <a download> com o nome dado e revoga a URL logo depois', () => {
    const blob = new Blob(['{}'], { type: 'application/json' });
    baixarArquivo(blob, 'paciente-abc.json');

    expect(URL.createObjectURL).toHaveBeenCalledOnceWith(blob);
    expect(cliques.length).toBe(1);
    expect(cliques[0].download).toBe('paciente-abc.json');
    expect(cliques[0].getAttribute('href')).toBe('blob:teste-1');
    expect(URL.revokeObjectURL).toHaveBeenCalledOnceWith('blob:teste-1');
  });

  it('revoga a URL mesmo quando o clique falha', () => {
    (HTMLAnchorElement.prototype.click as jasmine.Spy).and.throwError('falha');
    expect(() => baixarArquivo(new Blob(['x']), 'paciente-abc.json')).toThrowError('falha');
    expect(URL.revokeObjectURL).toHaveBeenCalledOnceWith('blob:teste-1');
    expect(document.querySelector('a[download]')).toBeNull();
  });

  it('nao deixa o <a> no DOM depois do clique', () => {
    const antes = document.querySelectorAll('a[download]').length;
    baixarArquivo(new Blob(['x']), 'paciente-abc.json');
    expect(document.querySelectorAll('a[download]').length).toBe(antes);
  });

  it('o token BAIXAR_ARQUIVO aponta para baixarArquivo por padrao', () => {
    const fn = TestBed.inject(BAIXAR_ARQUIVO);
    expect(fn).toBe(baixarArquivo);
  });
});
