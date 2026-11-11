import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Title } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { CONTEUDO_SEGURANCA } from './seguranca.conteudo';
import { SegurancaPage } from './seguranca.page';

describe('SegurancaPage', () => {
  let fixture: ComponentFixture<SegurancaPage>;
  let ctrl: HttpTestingController;
  const el = () => fixture.nativeElement as HTMLElement;
  const todosOsItens = CONTEUDO_SEGURANCA.secoes.flatMap((s) => s.itens);

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SegurancaPage],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    ctrl = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(SegurancaPage);
    fixture.detectChanges();
  });

  afterEach(() => ctrl.verify());

  it('tem h1 com o titulo da pagina e a data de atualizacao', () => {
    expect(el().querySelector('h1')?.textContent?.trim()).toBe('Como o Notta.psi protege os dados');
    expect(el().textContent).toContain('Atualizado em 11/11/2026');
  });

  it('usa titulo de aba "Segurança e privacidade"', () => {
    expect(TestBed.inject(Title).getTitle()).toBe('Segurança e privacidade');
  });

  it('nao tem noindex: a pagina e publica de proposito', () => {
    expect(document.querySelector('meta[name="robots"][content*="noindex"]')).toBeNull();
  });

  it('renderiza cada item com o pill de texto certo ("Já existe" ou "Ainda não")', () => {
    for (const item of todosOsItens) {
      const li = el().querySelector(`[data-id="${item.id}"]`);
      expect(li).withContext(item.id).not.toBeNull();
      const pill = li!.querySelector('app-pill');
      const esperado = item.status === 'feito' ? 'Já existe' : 'Ainda não';
      expect(pill?.textContent?.trim()).withContext(item.id).toBe(esperado);
      expect(li!.querySelector('h3')?.textContent?.trim()).withContext(item.id).toBe(item.titulo);
    }
    expect(el().querySelectorAll('[data-id]').length).toBe(todosOsItens.length);
  });

  it('tem as duas secoes com o titulo do conteudo', () => {
    const h2 = Array.from(el().querySelectorAll('h2')).map((h) => h.textContent?.trim());
    for (const secao of CONTEUDO_SEGURANCA.secoes) {
      expect(h2).toContain(secao.titulo);
    }
  });

  it('headings em ordem: h1, depois h2, depois h3, sem pular nivel', () => {
    const niveis = Array.from(el().querySelectorAll('h1, h2, h3')).map((h) =>
      Number(h.tagName.substring(1)),
    );
    expect(niveis[0]).toBe(1);
    expect(niveis.filter((n) => n === 1).length).toBe(1);
    for (let i = 1; i < niveis.length; i++) {
      expect(niveis[i]).toBeLessThanOrEqual(niveis[i - 1] + 1);
    }
  });

  it('nao esconde o que um paciente precisa saber: IA de terceiros, o que nao e cifrado e o limite do administrador do banco', () => {
    const texto = (id: string) => el().querySelector(`[data-id="${id}"]`)?.textContent ?? '';
    expect(texto('ia')).toContain('terceiros');
    expect(texto('ia')).toContain('Google Gemini');
    expect(texto('cifra')).toContain('Nem tudo é cifrado');
    expect(texto('aprovado')).toContain('administrador ao banco');
    expect(texto('dono-banco')).toContain('chave mestra');
  });

  it('mostra o rodape do conteudo', () => {
    expect(el().textContent).toContain(CONTEUDO_SEGURANCA.rodape);
  });

  it('nao faz nenhuma chamada HTTP', () => {
    expect(ctrl.match(() => true).length).toBe(0);
  });

  it('nao tem script, iframe, link externo nem innerHTML no DOM da pagina', () => {
    expect(el().querySelectorAll('script, iframe, style').length).toBe(0);
    for (const a of Array.from(el().querySelectorAll('a[href]'))) {
      expect(a.getAttribute('href')).not.toMatch(/^https?:/);
    }
  });
});
