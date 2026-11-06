import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { EquipePage, MembroEquipe } from './equipe.page';

const LISTA: MembroEquipe[] = [
  {
    psicologoId: 'p1',
    nome: 'Ana Souza',
    email: 'ana@clinica.com',
    papel: 'ADMIN',
    abordagemPadrao: 'SISTEMICA',
    ativo: true,
    desativadoEm: null,
    criadoEm: '2026-03-12T14:00:00.000Z',
  },
  {
    psicologoId: 'p2',
    nome: 'Bruno Lima',
    email: 'bruno@clinica.com',
    papel: 'PSICOLOGO',
    abordagemPadrao: 'PSICANALISE',
    ativo: true,
    desativadoEm: null,
    criadoEm: '2026-10-01T14:00:00.000Z',
  },
];
const BIA: MembroEquipe = {
  psicologoId: 'p3',
  nome: 'Bia Campos',
  email: 'bia@clinica.com',
  papel: 'PSICOLOGO',
  abordagemPadrao: 'TCC',
  ativo: false,
  desativadoEm: '2026-10-20T15:00:00.000Z',
  criadoEm: '2026-09-01T14:00:00.000Z',
};

describe('EquipePage', () => {
  let fixture: ComponentFixture<EquipePage>;
  let ctrl: HttpTestingController;
  let navegar: jasmine.Spy;

  beforeEach(async () => {
    sessionStorage.clear();
    TestBed.configureTestingModule({
      imports: [EquipePage],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
    ctrl = TestBed.inject(HttpTestingController);
    navegar = spyOn(TestBed.inject(Router), 'navigateByUrl').and.resolveTo(true);
    fixture = TestBed.createComponent(EquipePage);
    await fixture.whenStable();
  });

  afterEach(() => {
    ctrl.verify();
    sessionStorage.clear();
  });

  const el = () => fixture.nativeElement as HTMLElement;
  const campo = (id: string) => el().querySelector(`#${id}`) as HTMLInputElement;
  const listar = async (lista = LISTA) => {
    const r = ctrl.expectOne('/api/psicologos');
    expect(r.request.method).toBe('GET');
    r.flush(lista);
    await fixture.whenStable();
  };
  const digitar = (id: string, valor: string, sair = true) => {
    const i = campo(id);
    i.value = valor;
    i.dispatchEvent(new Event(i.tagName === 'SELECT' ? 'change' : 'input'));
    if (sair) i.dispatchEvent(new Event('blur'));
  };
  // sair = false simula quem digita e envia com Enter sem tirar o foco do campo.
  const preencher = (senha = 'senha-inicial-1', sair = true) => {
    digitar('eq-nome', '  Carla Dias ', sair);
    digitar('eq-email', 'carla@clinica.com', sair);
    digitar('eq-senha', senha, sair);
    digitar('eq-abordagem', 'TCC', sair);
  };
  const enviar = async () => {
    el().querySelector('form')!.dispatchEvent(new Event('submit'));
    await fixture.whenStable();
  };
  const post = () => ctrl.expectOne((r) => r.method === 'POST' && r.url === '/api/psicologos');
  const falharPost = async (status: number, headers: Record<string, string> = {}) => {
    post().flush({ statusCode: status, message: ['x'] }, { status, statusText: 'Erro', headers });
    await fixture.whenStable();
  };
  const alerta = () => el().querySelector('[data-teste="erro-geral"]')?.textContent?.trim() ?? '';
  const botao = () => el().querySelector('button[type="submit"]') as HTMLButtonElement;
  const linhas = () => Array.from(el().querySelectorAll('tbody tr'));

  it('mostra carregando e depois a tabela com rotulos humanos', async () => {
    expect(el().textContent).toContain('Carregando a equipe…');
    await listar();
    const tabela = el().querySelector('table')!;
    expect(tabela.querySelector('caption')?.textContent).toContain('Equipe');
    const cabecalhos = Array.from(tabela.querySelectorAll('thead th'));
    expect(cabecalhos.map((t) => t.textContent?.trim())).toEqual([
      'Nome',
      'E-mail',
      'Papel',
      'Abordagem',
      'Desde',
      'Acesso',
    ]);
    cabecalhos.forEach((t) => expect(t.getAttribute('scope')).toBe('col'));
    expect(linhas().length).toBe(2);
    const [ana, bruno] = linhas();
    expect(ana.querySelector('th[scope="row"]')?.textContent?.trim()).toBe('Ana Souza');
    expect(ana.textContent).toContain('ana@clinica.com');
    expect(ana.textContent).toContain('Administrador');
    expect(ana.textContent).toContain('Sistêmica');
    expect(ana.querySelector('time')?.getAttribute('datetime')).toBe('2026-03-12T14:00:00.000Z');
    expect(ana.querySelector('time')?.textContent).toContain('2026');
    expect(bruno.textContent).toContain('Psicólogo');
    expect(bruno.textContent).toContain('Psicanálise');
    expect(el().textContent).not.toContain('Carregando a equipe…');
  });

  it('erro de rede mostra "Tentar de novo", que refaz a chamada', async () => {
    ctrl.expectOne('/api/psicologos').error(new ProgressEvent('error'));
    await fixture.whenStable();
    expect(el().textContent).toContain('Não foi possível carregar a equipe.');
    const tentar = Array.from(el().querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Tentar de novo',
    )!;
    expect(tentar).toBeDefined();
    tentar.click();
    await fixture.whenStable();
    await listar();
    expect(linhas().length).toBe(2);
    expect(el().textContent).not.toContain('Tentar de novo');
  });

  it('403 na lista volta para /', async () => {
    ctrl.expectOne('/api/psicologos').flush({}, { status: 403, statusText: 'Forbidden' });
    await fixture.whenStable();
    expect(navegar).toHaveBeenCalledWith('/');
  });

  describe('desativar psicologo', () => {
    const lista = [...LISTA, BIA];
    const botaoDesativar = (nome: string) =>
      el().querySelector(`button[aria-label="Desativar ${nome}"]`) as HTMLButtonElement | null;
    const grupo = () => el().querySelector('[data-teste="confirmacao-desativar"]');
    const botaoPorTexto = (texto: string) =>
      Array.from(el().querySelectorAll('button')).find(
        (b) => b.textContent?.trim() === texto,
      ) as HTMLButtonElement;
    const pedir = async (nome = 'Bruno Lima') => {
      botaoDesativar(nome)!.click();
      await fixture.whenStable();
    };
    const confirmar = async () => {
      botaoPorTexto('Confirmar desativação').click();
      await fixture.whenStable();
    };
    const postDesativar = (id = 'p2') =>
      ctrl.expectOne((r) => r.method === 'POST' && r.url === `/api/psicologos/${id}/desativar`);
    const falhar = async (status: number) => {
      postDesativar().flush({ statusCode: status, message: 'x' }, { status, statusText: 'Erro' });
      await fixture.whenStable();
    };
    const erroEquipe = () =>
      el().querySelector('[data-teste="erro-equipe"]')?.textContent?.trim() ?? '';
    const nenhumPostDesativar = () =>
      ctrl.expectNone((r) => r.method === 'POST' && r.url.endsWith('/desativar'));

    beforeEach(() => listar(lista));

    it('so colega ativo tem botao, com o nome do colega; admin (propria linha) nao tem', () => {
      expect(botaoDesativar('Bruno Lima')?.textContent?.trim()).toBe('Desativar');
      expect(botaoDesativar('Ana Souza')).toBeNull();
      const [ana, , bia] = linhas();
      expect(ana.querySelector('button')).toBeNull();
      expect(bia.querySelector('button')).toBeNull();
      expect(el().querySelectorAll('tbody button').length).toBe(1);
    });

    it('desativado mostra pill de texto "Desativado em <data>" e nenhum botao', () => {
      const bia = linhas()[2];
      expect(bia.textContent).toMatch(/Desativado em\s+\d{2}\/\d{2}\/2026/);
      expect(bia.querySelectorAll('time')[1]?.getAttribute('datetime')).toBe(BIA.desativadoEm);
      expect(bia.querySelector('button')).toBeNull();
      // innerText = o que a pessoa le: a pill e flex e engole o espaco antes do <time>.
      expect((bia.querySelector('.tabela-estado app-pill') as HTMLElement).innerText).toMatch(
        /^Desativado em \d{2}\/\d{2}\/2026$/,
      );
    });

    it('Desativar abre a confirmacao com o texto honesto e foco em Cancelar, sem chamar a API', async () => {
      await pedir();
      const g = grupo()!;
      expect(g.getAttribute('role')).toBe('group');
      const nome = document.getElementById(g.getAttribute('aria-labelledby')!)?.textContent;
      expect(nome).toContain('Desativar Bruno Lima?');
      const texto = document.getElementById(g.getAttribute('aria-describedby')!)?.textContent;
      expect(texto).toContain('perde o acesso na hora');
      expect(texto).toContain('Os dados ficam guardados');
      expect(texto).toContain('Nesta versão não dá para desfazer');
      expect(document.activeElement).toBe(botaoPorTexto('Cancelar'));
      expect(botaoDesativar('Bruno Lima')!.getAttribute('aria-expanded')).toBe('true');
      nenhumPostDesativar();
    });

    it('Escape cancela, devolve o foco ao botao Desativar e nao chama a API', async () => {
      await pedir();
      grupo()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await fixture.whenStable();
      expect(grupo()).toBeNull();
      expect(document.activeElement).toBe(botaoDesativar('Bruno Lima'));
      nenhumPostDesativar();
    });

    it('Cancelar fecha, devolve o foco e nao chama a API', async () => {
      await pedir();
      botaoPorTexto('Cancelar').click();
      await fixture.whenStable();
      expect(grupo()).toBeNull();
      expect(document.activeElement).toBe(botaoDesativar('Bruno Lima'));
      nenhumPostDesativar();
    });

    it('so uma confirmacao aberta por vez', async () => {
      const outra = { ...LISTA[1], psicologoId: 'p4', nome: 'Caio Reis' };
      ctrl.verify();
      fixture.componentInstance.lista.set([...lista, outra]);
      await fixture.whenStable();
      await pedir('Bruno Lima');
      await pedir('Caio Reis');
      expect(el().querySelectorAll('[data-teste="confirmacao-desativar"]').length).toBe(1);
      expect(grupo()?.textContent).toContain('Caio Reis');
    });

    it('confirmar chama POST sem corpo e atualiza so a linha, sem recarregar a lista', async () => {
      await pedir();
      await confirmar();
      const r = postDesativar();
      expect(r.request.body).toBeNull();
      r.flush({
        id: 'p2',
        nome: 'Bruno Lima',
        email: 'bruno@clinica.com',
        papel: 'PSICOLOGO',
        abordagemPadrao: 'PSICANALISE',
        ativo: false,
        desativadoEm: '2026-11-04T12:00:00.000Z',
      });
      await fixture.whenStable();
      const [ana, bruno] = linhas();
      expect(linhas().length).toBe(3);
      expect(bruno.textContent).toMatch(/Desativado em\s+04\/11\/2026/);
      expect(bruno.textContent).toContain('bruno@clinica.com');
      expect(bruno.querySelector('time')?.getAttribute('datetime')).toBe(LISTA[1].criadoEm);
      expect(bruno.querySelector('button')).toBeNull();
      expect(ana.textContent).toContain('Administrador');
      expect(grupo()).toBeNull();
      const aviso = el().querySelector('[data-teste="aviso-equipe"]')!;
      expect(aviso.closest('[aria-live]')).not.toBeNull();
      expect(aviso.textContent).toContain('O acesso de Bruno Lima foi desativado.');
      expect(document.activeElement?.id).toBe('eq-estado-p2');
      // ctrl.verify (afterEach) falha se houve um GET /api/psicologos extra.
    });

    it('sem duplo envio: botoes desabilitados durante a chamada', async () => {
      await pedir();
      await confirmar();
      expect(botaoPorTexto('Desativando…').disabled).toBeTrue();
      expect(botaoPorTexto('Cancelar').disabled).toBeTrue();
      fixture.componentInstance.desativar(LISTA[1]);
      postDesativar();
    });

    it('409 recarrega a lista, avisa e mostra o estado real', async () => {
      await pedir();
      await confirmar();
      await falhar(409);
      expect(erroEquipe()).toBe('O estado mudou, confira a lista e tente de novo.');
      expect(
        erroEquipe() && el().querySelector('[data-teste="erro-equipe"]')!.closest('[aria-live]'),
      ).not.toBeNull();
      await listar([LISTA[0], { ...LISTA[1], ativo: false, desativadoEm: BIA.desativadoEm }]);
      expect(linhas()[1].textContent).toContain('Desativado em');
      expect(linhas()[1].querySelector('button')).toBeNull();
      expect(navegar).not.toHaveBeenCalled();
    });

    it('404 recarrega a lista e avisa, sem sair da tela', async () => {
      await pedir();
      await confirmar();
      await falhar(404);
      expect(erroEquipe()).toBe('Essa pessoa não foi encontrada na equipe. Confira a lista.');
      await listar([LISTA[0]]);
      expect(linhas().length).toBe(1);
      expect(navegar).not.toHaveBeenCalled();
    });

    it('503 avisa, mantem o botao para tentar de novo e nao recarrega nem derruba a sessao', async () => {
      await pedir();
      await confirmar();
      await falhar(503);
      expect(erroEquipe()).toBe(
        'Não foi possível concluir agora. Confira sua conexão e tente de novo.',
      );
      expect(grupo()).toBeNull();
      expect(document.activeElement).toBe(botaoDesativar('Bruno Lima'));
      expect(linhas()[1].querySelector('button')).not.toBeNull();
      expect(navegar).not.toHaveBeenCalled();
    });

    it('erro de rede avisa e permite tentar de novo', async () => {
      await pedir();
      await confirmar();
      postDesativar().error(new ProgressEvent('error'));
      await fixture.whenStable();
      expect(erroEquipe()).toContain('Não foi possível concluir agora');
      await pedir();
      await confirmar();
      postDesativar();
    });

    it('403 avisa e volta para /', async () => {
      await pedir();
      await confirmar();
      await falhar(403);
      expect(erroEquipe()).toBe('Você não tem permissão para gerenciar a equipe.');
      expect(navegar).toHaveBeenCalledWith('/');
    });

    it('nova tentativa limpa o aviso anterior', async () => {
      await pedir();
      await confirmar();
      await falhar(503);
      await pedir();
      expect(erroEquipe()).toBe('');
    });
  });

  describe('adicionar psicologo', () => {
    beforeEach(() => listar());

    it('201 envia o corpo do contrato, limpa o form, recarrega a lista e confirma', async () => {
      preencher();
      await enviar();
      const r = post();
      expect(r.request.body).toEqual({
        nome: 'Carla Dias',
        email: 'carla@clinica.com',
        senha: 'senha-inicial-1',
        abordagemPadrao: 'TCC',
      });
      r.flush({ psicologoId: 'p3' }, { status: 201, statusText: 'Created' });
      await fixture.whenStable();
      await listar([
        ...LISTA,
        { ...LISTA[1], psicologoId: 'p3', nome: 'Carla Dias', email: 'carla@clinica.com' },
      ]);
      expect(linhas().length).toBe(3);
      expect(campo('eq-nome').value).toBe('');
      expect(campo('eq-email').value).toBe('');
      expect(campo('eq-senha').value).toBe('');
      expect(campo('eq-abordagem').value).toBe('');
      const ok = el().querySelector('[data-teste="confirmacao"]')!;
      expect(ok.closest('[aria-live]')).not.toBeNull();
      expect(ok.textContent).toContain('Carla Dias');
      expect(ok.textContent).toContain(
        'Combine a senha provisória com a pessoa por um canal seguro; ela escolherá a própria no primeiro acesso.',
      );
      expect(el().querySelector('#eq-senha-dica')?.textContent).toContain('provisória');
      expect(campo('eq-nome').getAttribute('aria-invalid')).toBeNull();
    });

    it('409 marca o campo e-mail, foca nele e limpa a senha', async () => {
      preencher();
      await enviar();
      await falharPost(409);
      const email = campo('eq-email');
      expect(email.getAttribute('aria-invalid')).toBe('true');
      const erroId = email
        .getAttribute('aria-describedby')!
        .split(' ')
        .find((id) => /erro/.test(id))!;
      expect(document.getElementById(erroId)?.textContent).toContain('já está cadastrado');
      expect(document.activeElement).toBe(email);
      expect(campo('eq-senha').value).toBe('');
      expect(alerta()).toBe('');
    });

    it('422 COM motivo vai no campo da senha, foca nele, limpa a senha e nao mostra alerta geral', async () => {
      const casos: [string, string][] = [
        ['COMUM', 'muito comum'],
        ['PESSOAL', 'nome nem o e-mail'],
        ['REPETIDA', 'repetições e sequências'],
        ['CURTA', 'pelo menos 10'],
      ];
      for (const [motivo, trecho] of casos) {
        preencher('tijolo-azul-lua-4821');
        await enviar();
        post().flush(
          { statusCode: 422, message: 'Senha fraca: x', motivo },
          { status: 422, statusText: 'Unprocessable Entity' },
        );
        await fixture.whenStable();
        const senha = campo('eq-senha');
        expect(senha.getAttribute('aria-invalid')).withContext(motivo).toBe('true');
        const erroId = senha
          .getAttribute('aria-describedby')!
          .split(' ')
          .find((id) => /erro/.test(id))!;
        expect(document.getElementById(erroId)?.textContent).withContext(motivo).toContain(trecho);
        expect(document.activeElement).withContext(motivo).toBe(senha);
        expect(senha.value).toBe('');
        expect(alerta()).toBe('');
        expect(campo('eq-email').getAttribute('aria-invalid')).toBeNull();
        // os outros campos continuam preenchidos para a pessoa so trocar a senha
        expect(campo('eq-nome').value).toBe('  Carla Dias ');
      }
    });

    it('dica de senha ao vivo com nome e e-mail do colega que esta sendo criado', async () => {
      const dica = el().querySelector('app-senha-dica')!;
      expect(campo('eq-senha').getAttribute('aria-describedby')).toContain('eq-senha-regras');
      expect(dica.id).toBe('eq-senha-regras');
      digitar('eq-nome', 'Carla Dias');
      digitar('eq-email', 'carla@clinica.com');
      digitar('eq-senha', 'x-carla-dias-4821', false);
      await fixture.whenStable();
      expect(dica.textContent).toContain('Não atende: Não contém seu nome nem seu e-mail');
      digitar('eq-senha', 'tijolo-azul-lua-4821', false);
      await fixture.whenStable();
      expect(dica.textContent).toContain('Senha boa nas regras abaixo.');
    });

    it('409 mostra o erro mesmo se enviou com Enter sem sair do campo', async () => {
      preencher('senha-inicial-1', false);
      await enviar();
      await falharPost(409);
      expect(campo('eq-email').getAttribute('aria-invalid')).toBe('true');
    });

    it('400 mostra mensagem generica e limpa a senha', async () => {
      preencher();
      await enviar();
      await falharPost(400);
      expect(alerta()).toBe('Alguns campos estão inválidos. Revise e tente de novo.');
      expect(campo('eq-senha').value).toBe('');
    });

    it('403 avisa que nao tem permissao e volta para /', async () => {
      preencher();
      await enviar();
      await falharPost(403);
      expect(alerta()).toBe('Você não tem permissão para gerenciar a equipe.');
      expect(navegar).toHaveBeenCalledWith('/');
    });

    it('429 com Retry-After mostra os segundos', async () => {
      preencher();
      await enviar();
      await falharPost(429, { 'Retry-After': '45' });
      expect(alerta()).toBe('Muitas tentativas. Tente de novo em 45 segundos.');
    });

    it('429 sem Retry-After mostra mensagem sem numero', async () => {
      preencher();
      await enviar();
      await falharPost(429);
      expect(alerta()).toBe('Muitas tentativas. Aguarde um pouco e tente de novo.');
    });

    it('5xx e rede mostram mensagem generica', async () => {
      preencher();
      await enviar();
      await falharPost(503);
      expect(alerta()).toBe(
        'Não foi possível concluir agora. Confira sua conexão e tente de novo.',
      );
      preencher();
      await enviar();
      post().error(new ProgressEvent('error'));
      await fixture.whenStable();
      expect(alerta()).toBe(
        'Não foi possível concluir agora. Confira sua conexão e tente de novo.',
      );
    });

    it('sem duplo envio: botao desabilitado com "Adicionando…"', async () => {
      preencher();
      await enviar();
      await enviar();
      expect(botao().disabled).toBeTrue();
      expect(botao().textContent?.trim()).toBe('Adicionando…');
      expect(campo('eq-senha').getAttribute('aria-invalid')).toBeNull();
      await falharPost(500);
      expect(botao().disabled).toBeFalse();
    });

    it('senha de 73 bytes e bloqueada no cliente', async () => {
      preencher('a'.repeat(73));
      await enviar();
      ctrl.expectNone((r) => r.method === 'POST');
      const senha = campo('eq-senha');
      expect(senha.getAttribute('aria-invalid')).toBe('true');
      expect(document.activeElement).toBe(senha);
    });

    it('formulario vazio foca o primeiro campo com erro e nao envia', async () => {
      await enviar();
      ctrl.expectNone((r) => r.method === 'POST');
      expect(document.activeElement).toBe(campo('eq-nome'));
    });

    it('labels, autocomplete new-password e aria-describedby validos', async () => {
      const campos = el().querySelectorAll('form input, form select');
      expect(campos.length).toBe(4);
      campos.forEach((i) =>
        expect(el().querySelector(`label[for="${i.id}"]`))
          .withContext(i.id)
          .not.toBeNull(),
      );
      expect(campo('eq-senha').type).toBe('password');
      expect(campo('eq-senha').autocomplete).toBe('new-password');
      await enviar();
      campos.forEach((i) => {
        expect(i.getAttribute('aria-invalid')).withContext(i.id).toBe('true');
        i.getAttribute('aria-describedby')!
          .split(' ')
          .forEach((id) =>
            expect(document.getElementById(id)?.textContent?.trim())
              .withContext(`${i.id} -> ${id}`)
              .toBeTruthy(),
          );
      });
    });
  });
});
