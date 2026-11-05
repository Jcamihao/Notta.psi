import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Eu, SessaoStore, WEB_LOCKS } from './sessao.store';

const EU: Eu = {
  psicologoId: 'p1',
  nome: 'Ana Souza',
  email: 'ana@clinica.com',
  papel: 'ADMIN',
  abordagemPadrao: 'TCC',
  clinica: { id: 'c1', nome: 'Clinica Horizonte' },
  senhaProvisoria: false,
};

describe('SessaoStore', () => {
  let ctrl: HttpTestingController;

  const configurar = (locks: LockManager | null = null) => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: WEB_LOCKS, useValue: locks },
      ],
    });
    ctrl = TestBed.inject(HttpTestingController);
    return TestBed.inject(SessaoStore);
  };
  const flushEu = (corpo: object | null = EU) => ctrl.expectOne('/api/eu').flush(corpo);
  const erro401 = () => ({ status: 401, statusText: 'Unauthorized' });
  const tick = () => new Promise((r) => setTimeout(r));

  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
  });
  afterEach(() => {
    ctrl.verify();
    sessionStorage.clear();
    localStorage.clear();
  });

  describe('estado vindo do /eu', () => {
    it('comeca sem usuario e nao chama o servidor sozinho', () => {
      const s = configurar();
      ctrl.expectNone('/api/eu');
      expect(s.usuario()).toBeNull();
      expect(s.autenticado()).toBeFalse();
      expect(s.ehAdmin()).toBeFalse();
      expect(s.senhaProvisoria()).toBeFalse();
      expect(s.expirada()).toBeFalse();
    });

    it('garantir consulta GET /api/eu UMA vez, mesmo chamado varias vezes', async () => {
      const s = configurar();
      const a = s.garantir();
      const b = s.garantir();
      flushEu();
      await Promise.all([a, b]);
      await s.garantir();
      ctrl.expectNone('/api/eu');
      expect(s.usuario()?.nome).toBe('Ana Souza');
      expect(s.autenticado()).toBeTrue();
      expect(s.ehAdmin()).toBeTrue();
    });

    it('401 no /eu = visitante, sem erro, e nao consulta de novo', async () => {
      const s = configurar();
      const p = s.garantir();
      ctrl.expectOne('/api/eu').flush({}, erro401());
      await p;
      expect(s.autenticado()).toBeFalse();
      await s.garantir();
      ctrl.expectNone('/api/eu');
    });

    it('senhaProvisoria e ehAdmin seguem o /eu', async () => {
      const s = configurar();
      const p = s.garantir();
      flushEu({ ...EU, papel: 'PSICOLOGO', senhaProvisoria: true });
      await p;
      expect(s.ehAdmin()).toBeFalse();
      expect(s.senhaProvisoria()).toBeTrue();
    });

    it('carregar de novo atualiza o usuario; erro de rede mantem o que se sabia', async () => {
      const s = configurar();
      s.entrar(EU);
      const p = s.carregar();
      flushEu({ ...EU, senhaProvisoria: true });
      await p;
      expect(s.senhaProvisoria()).toBeTrue();
      const q = s.carregar();
      ctrl.expectOne('/api/eu').error(new ProgressEvent('error'));
      await q;
      expect(s.autenticado()).toBeTrue();
      const r = s.carregar();
      ctrl.expectOne('/api/eu').flush({}, erro401());
      await r;
      expect(s.autenticado()).toBeFalse();
    });

    it('resposta de /eu que chega depois de sair nao ressuscita a sessao', async () => {
      const s = configurar();
      const p = s.carregar();
      s.limpar();
      flushEu();
      await p;
      expect(s.autenticado()).toBeFalse();
    });
  });

  describe('entrar, limpar, expirou', () => {
    it('entrar guarda o usuario sem consultar o servidor e sem tocar em storage', async () => {
      const s = configurar();
      s.entrar(EU);
      await s.garantir();
      ctrl.expectNone('/api/eu');
      expect(s.autenticado()).toBeTrue();
      expect(sessionStorage.length).toBe(0);
      expect(localStorage.length).toBe(0);
    });

    it('expirou limpa o usuario e liga o aviso; entrar de novo desliga', () => {
      const s = configurar();
      s.entrar(EU);
      s.expirou();
      expect(s.autenticado()).toBeFalse();
      expect(s.expirada()).toBeTrue();
      s.entrar(EU);
      expect(s.expirada()).toBeFalse();
    });

    it('senhaTrocada tira a marca de senha provisoria e mantem o resto', () => {
      const s = configurar();
      s.entrar({ ...EU, senhaProvisoria: true });
      s.senhaTrocada();
      expect(s.senhaProvisoria()).toBeFalse();
      expect(s.usuario()?.nome).toBe('Ana Souza');
    });

    it('limpar nao deixa o garantir consultar de novo', async () => {
      const s = configurar();
      s.entrar(EU);
      s.limpar();
      await s.garantir();
      ctrl.expectNone('/api/eu');
      expect(s.autenticado()).toBeFalse();
    });
  });

  describe('sair', () => {
    it('POST /api/auth/sair e limpa o estado', async () => {
      const s = configurar();
      s.entrar(EU);
      const p = s.sair();
      const r = ctrl.expectOne('/api/auth/sair');
      expect(r.request.method).toBe('POST');
      r.flush({ ok: true });
      await p;
      expect(s.autenticado()).toBeFalse();
      expect(s.expirada()).toBeFalse();
    });

    it('limpa o estado local mesmo se o servidor falhar', async () => {
      const s = configurar();
      s.entrar(EU);
      const p = s.sair();
      ctrl.expectOne('/api/auth/sair').flush({}, { status: 503, statusText: 'Indisponivel' });
      await p;
      expect(s.autenticado()).toBeFalse();
    });
  });

  describe('renovar', () => {
    it('acesso ja valido (outra aba renovou): confere pelo /eu e NAO chama renovar', async () => {
      const s = configurar();
      const p = s.renovar();
      flushEu();
      expect(await p).toBe('ok');
      ctrl.expectNone('/api/auth/renovar');
    });

    it('acesso vencido: confere, renova uma vez e responde ok', async () => {
      const s = configurar();
      const p = s.renovar();
      ctrl.expectOne('/api/eu').flush({}, erro401());
      await tick();
      const r = ctrl.expectOne('/api/auth/renovar');
      expect(r.request.method).toBe('POST');
      r.flush({ ok: true });
      expect(await p).toBe('ok');
    });

    it('renovar 401 = expirou', async () => {
      const s = configurar();
      const p = s.renovar();
      ctrl.expectOne('/api/eu').flush({}, erro401());
      await tick();
      ctrl.expectOne('/api/auth/renovar').flush({}, erro401());
      expect(await p).toBe('expirou');
    });

    for (const status of [503, 429, 0]) {
      it(`renovar ${status} = indisponivel (nao derruba a sessao)`, async () => {
        const s = configurar();
        s.entrar(EU);
        const p = s.renovar();
        ctrl.expectOne('/api/eu').flush({}, erro401());
        await tick();
        const r = ctrl.expectOne('/api/auth/renovar');
        if (status === 0) r.error(new ProgressEvent('error'));
        else r.flush({}, { status, statusText: 'x' });
        expect(await p).toBe('indisponivel');
        expect(s.autenticado()).toBeTrue();
      });
    }

    it('chamadas concorrentes da mesma aba dividem UMA renovacao', async () => {
      const s = configurar();
      const a = s.renovar();
      const b = s.renovar();
      const c = s.renovar();
      expect(b).toBe(a);
      expect(c).toBe(a);
      ctrl.expectOne('/api/eu').flush({}, erro401());
      await tick();
      ctrl.expectOne('/api/auth/renovar').flush({ ok: true });
      expect(await Promise.all([a, b, c])).toEqual(['ok', 'ok', 'ok']);
    });

    it('depois de terminar, uma nova renovacao e possivel', async () => {
      const s = configurar();
      const a = s.renovar();
      flushEu();
      await a;
      const b = s.renovar();
      expect(b).not.toBe(a);
      flushEu();
      await b;
    });

    describe('Web Locks entre abas', () => {
      // Trava falsa: executa em fila, uma de cada vez, como o navegador faz entre abas.
      const travaFalsa = () => {
        const nomes: string[] = [];
        let fila: Promise<unknown> = Promise.resolve();
        const gerenciador = {
          request: (nome: string, cb: () => Promise<unknown>) => {
            nomes.push(nome);
            const r = fila.then(cb);
            fila = r.catch(() => undefined);
            return r;
          },
        } as unknown as LockManager;
        return { nomes, gerenciador };
      };

      it('a renovacao roda dentro da trava, com nome fixo', async () => {
        const { nomes, gerenciador } = travaFalsa();
        const s = configurar(gerenciador);
        const p = s.renovar();
        await tick();
        expect(nomes).toEqual(['notta-renovar-sessao']);
        flushEu();
        await p;
      });

      it('o /eu de conferencia so sai quando a trava e concedida', async () => {
        let liberar!: () => void;
        const concedida = new Promise<void>((r) => (liberar = r));
        const gerenciador = {
          request: async (_n: string, cb: () => Promise<unknown>) => {
            await concedida;
            return cb();
          },
        } as unknown as LockManager;
        const s = configurar(gerenciador);
        const p = s.renovar();
        await tick();
        ctrl.expectNone('/api/eu');
        liberar();
        await tick();
        flushEu();
        expect(await p).toBe('ok');
      });

      it('duas abas renovando juntas: a 2a, ja dentro da trava, ve o acesso renovado e nao rotaciona', async () => {
        const { gerenciador } = travaFalsa();
        // Cada "aba" tem o seu store, as duas na mesma fila de trava.
        const abaA = configurar(gerenciador);
        const a = abaA.renovar();
        const b = TestBed.runInInjectionContext(() => new SessaoStore()).renovar();
        await tick();
        // aba A: acesso vencido, renova
        ctrl.expectOne('/api/eu').flush({}, erro401());
        await tick();
        ctrl.expectOne('/api/auth/renovar').flush({ ok: true });
        expect(await a).toBe('ok');
        // aba B entra na trava depois: o /eu ja passa (cookie novo), sem segundo renovar
        await tick();
        flushEu();
        expect(await b).toBe('ok');
        ctrl.expectNone('/api/auth/renovar');
      });
    });
  });
});
