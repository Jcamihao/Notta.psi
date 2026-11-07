import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { Eu, SessaoStore } from '../core/sessao.store';
import { ShellComponent } from './shell.component';

const EU: Eu = {
  psicologoId: 'p1',
  nome: 'Ana Souza',
  email: 'ana@clinica.com',
  papel: 'PSICOLOGO',
  abordagemPadrao: 'TCC',
  clinica: { id: 'c1', nome: 'Clinica Horizonte' },
  senhaProvisoria: false,
};

const tick = () => new Promise((r) => setTimeout(r));

describe('ShellComponent', () => {
  let fixture: ComponentFixture<ShellComponent>;
  let sessao: SessaoStore;
  let ctrl: HttpTestingController;
  let navegar: jasmine.Spy;

  beforeEach(async () => {
    sessionStorage.clear();
    await TestBed.configureTestingModule({
      imports: [ShellComponent],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    sessao = TestBed.inject(SessaoStore);
    ctrl = TestBed.inject(HttpTestingController);
    navegar = spyOn(TestBed.inject(Router), 'navigateByUrl').and.resolveTo(true);
    sessao.entrar(EU);
    fixture = TestBed.createComponent(ShellComponent);
    await fixture.whenStable();
  });

  afterEach(() => {
    ctrl.verify();
    sessionStorage.clear();
  });

  const el = () => fixture.nativeElement as HTMLElement;

  it('tem landmarks header e main e o nome do app', () => {
    expect(el().querySelector('header')?.textContent).toContain('Notta.psi');
    expect(el().querySelector('main router-outlet')).not.toBeNull();
  });

  it('menu tem o item Segurança para /seguranca (desktop e mobile usam o mesmo menu)', () => {
    const a = el().querySelector('header nav a[href="/seguranca"]');
    expect(a?.textContent?.trim()).toBe('Segurança');
  });

  it('mostra o nome da clinica e do psicologo no cabecalho', () => {
    const topo = el().querySelector('header')!.textContent!;
    expect(topo).toContain('Clinica Horizonte');
    expect(topo).toContain('Ana Souza');
  });

  it('botao Sair chama POST /api/auth/sair, limpa a sessao e navega para /login', async () => {
    const botao = el().querySelector('header [data-teste="sair"]') as HTMLButtonElement;
    expect(botao.textContent?.trim()).toBe('Sair');
    botao.click();
    const r = ctrl.expectOne('/api/auth/sair');
    expect(r.request.method).toBe('POST');
    expect(sessao.autenticado()).toBeTrue(); // so limpa depois da resposta
    r.flush({ ok: true });
    await tick();
    expect(sessao.autenticado()).toBeFalse();
    expect(sessao.usuario()).toBeNull();
    expect(navegar).toHaveBeenCalledWith('/login');
  });

  it('Sair limpa e vai ao login mesmo se o servidor nao responder', async () => {
    (el().querySelector('header [data-teste="sair"]') as HTMLButtonElement).click();
    ctrl.expectOne('/api/auth/sair').error(new ProgressEvent('error'));
    await tick();
    expect(sessao.autenticado()).toBeFalse();
    expect(navegar).toHaveBeenCalledWith('/login');
  });

  describe('sair de todos os aparelhos', () => {
    const pedir = () => el().querySelector('header [data-teste="sair-todos"]') as HTMLButtonElement;
    const confirmar = () =>
      el().querySelector('[data-teste="confirmar-sair-todos"]') as HTMLButtonElement | null;
    const cancelar = () =>
      el().querySelector('[data-teste="cancelar-sair-todos"]') as HTMLButtonElement | null;
    // Karma roda estreito (barra do celular): o menu precisa estar aberto para o foco pegar.
    const abrir = async () => {
      (el().querySelector('button[aria-controls="lateral-corpo"]') as HTMLButtonElement).click();
      await fixture.whenStable();
      pedir().click();
      await fixture.whenStable();
      await tick();
    };

    it('o item existe no menu da conta, com texto claro', () => {
      expect(pedir().textContent?.trim()).toBe('Sair de todos os aparelhos');
      expect(confirmar()).toBeNull();
    });

    it('clicar NAO sai: abre a confirmacao inline com o foco em Cancelar', async () => {
      await abrir();
      ctrl.expectNone('/api/auth/sair-de-todos');
      expect(sessao.autenticado()).toBeTrue();
      expect(confirmar()?.textContent?.trim()).toBe('Sair de todos');
      expect(cancelar()?.textContent?.trim()).toBe('Cancelar');
      expect(el().querySelector('[role="group"]')?.textContent).toContain(
        'Você precisará entrar de novo em cada um.',
      );
      expect(document.activeElement).toBe(cancelar());
    });

    it('Cancelar fecha a confirmacao, nao chama o servidor e devolve o foco ao item', async () => {
      await abrir();
      cancelar()!.click();
      await fixture.whenStable();
      await tick();
      expect(confirmar()).toBeNull();
      ctrl.expectNone('/api/auth/sair-de-todos');
      expect(sessao.autenticado()).toBeTrue();
      expect(document.activeElement).toBe(pedir());
    });

    it('Escape cancela a confirmacao (e nao so fecha o menu)', async () => {
      await abrir();
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      await fixture.whenStable();
      await tick();
      expect(confirmar()).toBeNull();
      ctrl.expectNone('/api/auth/sair-de-todos');
      expect(document.activeElement).toBe(pedir());
      // primeiro Esc so cancela a confirmacao: o menu segue aberto
      expect(
        el().querySelector('button[aria-controls="lateral-corpo"]')?.getAttribute('aria-expanded'),
      ).toBe('true');
    });

    it('confirmar: POST /api/auth/sair-de-todos, limpa a sessao e vai ao login', async () => {
      await abrir();
      confirmar()!.click();
      await fixture.whenStable();
      expect(confirmar()!.disabled).toBeTrue();
      expect(confirmar()!.textContent?.trim()).toBe('Saindo…');
      const r = ctrl.expectOne('/api/auth/sair-de-todos');
      expect(r.request.method).toBe('POST');
      r.flush({ ok: true });
      await tick();
      expect(sessao.autenticado()).toBeFalse();
      expect(navegar).toHaveBeenCalledWith('/login');
    });

    it('clique duplo no confirmar envia uma vez so', async () => {
      await abrir();
      const c = confirmar()!;
      c.click();
      c.click();
      ctrl.expectOne('/api/auth/sair-de-todos').flush({ ok: true });
      await fixture.whenStable();
    });

    it('se falhar, avisa, mantem a sessao e deixa tentar de novo', async () => {
      await abrir();
      confirmar()!.click();
      await fixture.whenStable();
      ctrl.expectOne('/api/auth/sair-de-todos').flush({}, { status: 503, statusText: 'x' });
      await tick();
      await fixture.whenStable();
      expect(sessao.autenticado()).toBeTrue();
      expect(navegar).not.toHaveBeenCalled();
      expect(el().querySelector('[data-teste="erro-sair-todos"]')?.textContent?.trim()).toBe(
        'Não deu para sair agora. Tente de novo.',
      );
      expect(confirmar()!.disabled).toBeFalse();
      confirmar()!.click();
      ctrl.expectOne('/api/auth/sair-de-todos').flush({ ok: true });
      await tick();
      expect(sessao.autenticado()).toBeFalse();
    });
  });

  it('PSICOLOGO ve o link Pacientes', () => {
    const link = el().querySelector('header a[href="/pacientes"]');
    expect(link?.textContent?.trim()).toBe('Pacientes');
  });

  it('PSICOLOGO nao ve o link Equipe', () => {
    expect(el().querySelector('a[href="/equipe"]')).toBeNull();
  });

  it('botao Menu (barra do celular) alterna aria-expanded; Esc fecha e devolve o foco', async () => {
    const menu = el().querySelector('button[aria-controls="lateral-corpo"]') as HTMLButtonElement;
    expect(menu.getAttribute('aria-label')).toBe('Menu');
    expect(el().querySelector('#lateral-corpo')).not.toBeNull();
    expect(menu.getAttribute('aria-expanded')).toBe('false');
    menu.click();
    await fixture.whenStable();
    expect(menu.getAttribute('aria-expanded')).toBe('true');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await fixture.whenStable();
    expect(menu.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(menu);
  });
});

describe('ShellComponent (ADMIN)', () => {
  let ctrl: HttpTestingController;

  afterEach(() => {
    ctrl.verify();
    sessionStorage.clear();
  });

  it('ADMIN ve o link Equipe com aria-current na rota ativa', async () => {
    sessionStorage.clear();
    await TestBed.configureTestingModule({
      imports: [ShellComponent],
      providers: [
        provideRouter([{ path: 'equipe', children: [] }]),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    }).compileComponents();
    ctrl = TestBed.inject(HttpTestingController);
    TestBed.inject(SessaoStore).entrar({ ...EU, papel: 'ADMIN' });
    const fixture = TestBed.createComponent(ShellComponent);
    await fixture.whenStable();
    const link = () =>
      (fixture.nativeElement as HTMLElement).querySelector('header a[href="/equipe"]');
    expect(
      (fixture.nativeElement as HTMLElement).querySelector('header a[href="/pacientes"]'),
    ).not.toBeNull();
    expect(link()?.textContent?.trim()).toBe('Equipe');
    expect(link()?.getAttribute('aria-current')).toBeNull();
    await TestBed.inject(Router).navigateByUrl('/equipe');
    await fixture.whenStable();
    expect(link()?.getAttribute('aria-current')).toBe('page');
  });
});

describe('ShellComponent (troca de senha)', () => {
  let ctrl: HttpTestingController;
  let fixture: ComponentFixture<ShellComponent>;

  const montar = async (senhaProvisoria: boolean, papel = 'ADMIN') => {
    sessionStorage.clear();
    await TestBed.configureTestingModule({
      imports: [ShellComponent],
      providers: [
        provideRouter([{ path: 'trocar-senha', children: [] }]),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    }).compileComponents();
    ctrl = TestBed.inject(HttpTestingController);
    TestBed.inject(SessaoStore).entrar({ ...EU, papel: papel as Eu['papel'], senhaProvisoria });
    fixture = TestBed.createComponent(ShellComponent);
    await fixture.whenStable();
  };
  const el = () => fixture.nativeElement as HTMLElement;

  afterEach(() => {
    ctrl.verify();
    sessionStorage.clear();
  });

  it('modo voluntario mostra o link Trocar senha', async () => {
    await montar(false, 'PSICOLOGO');
    expect(el().querySelector('header a[href="/trocar-senha"]')?.textContent?.trim()).toBe(
      'Trocar senha',
    );
  });

  it('modo obrigatorio esconde a navegacao: sobram Sair de todos e Sair', async () => {
    await montar(true);
    const topo = el().querySelector('header')!;
    expect(topo.querySelectorAll('a').length).toBe(0);
    expect(topo.querySelector('nav')).toBeNull();
    const botoes = Array.from(topo.querySelectorAll('button')).map((b) => b.textContent?.trim());
    expect(botoes).toEqual(['Sair de todos os aparelhos', 'Sair']);
    expect(topo.textContent).toContain('Notta.psi');
  });

  it('depois da troca mostra uma confirmacao leve, que some na proxima navegacao', async () => {
    await montar(false);
    const router = TestBed.inject(Router);
    await router.navigateByUrl('/', { state: { senhaTrocada: true } });
    await fixture.whenStable();
    const aviso = () => el().querySelector('[data-teste="senha-trocada"]');
    expect(aviso()?.textContent).toContain('Senha alterada');
    expect(aviso()?.closest('[aria-live]')).not.toBeNull();
    await router.navigateByUrl('/trocar-senha');
    await fixture.whenStable();
    expect(aviso()).toBeNull();
  });
});
