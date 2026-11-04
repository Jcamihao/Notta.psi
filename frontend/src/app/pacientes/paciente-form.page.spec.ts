import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
  TestRequest,
} from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter, Router } from '@angular/router';
import { hojeLocal } from '../core/formulario';
import { PacienteFormPage } from './paciente-form.page';
import { Paciente } from './pacientes.service';

const ID = '11111111-1111-4111-8111-111111111111';
const P: Paciente = {
  id: ID,
  nome: 'Maria da Silva',
  nascimento: '1990-05-17',
  telefone: '+55 (11) 99999-0000',
  email: 'maria@exemplo.com',
  criadoEm: '2026-10-31T10:00:00.000Z',
};

const URL_DOCS = (id: string) => `/api/pacientes/${id}/documentos`;
// Prontuario (aprovados) e rascunhos: duas chamadas, uma depois da outra.
const listas = async (
  ctrl: HttpTestingController,
  espera: () => Promise<unknown>,
  id: string,
  aprovados: object[] = [],
  rascunhos: object[] = [],
) => {
  ctrl.expectOne(`${URL_DOCS(id)}?status=APROVADO`).flush(aprovados);
  await espera();
  ctrl.expectOne(`${URL_DOCS(id)}?status=RASCUNHO`).flush(rascunhos);
  await espera();
};

describe('PacienteFormPage', () => {
  let fixture: ComponentFixture<PacienteFormPage>;
  let ctrl: HttpTestingController;
  let navegar: jasmine.Spy;

  const montar = async (id: string | null, aviso?: string) => {
    TestBed.configureTestingModule({
      imports: [PacienteFormPage],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: { get: () => id } } },
        },
      ],
    });
    ctrl = TestBed.inject(HttpTestingController);
    navegar = spyOn(TestBed.inject(Router), 'navigateByUrl').and.resolveTo(true);
    if (aviso)
      spyOn(TestBed.inject(Router), 'getCurrentNavigation').and.returnValue({
        extras: { state: { aviso } },
      } as never);
    fixture = TestBed.createComponent(PacienteFormPage);
    await fixture.whenStable();
  };

  afterEach(() => ctrl.verify());

  const el = () => fixture.nativeElement as HTMLElement;
  const campo = (nome: string) => el().querySelector(`#pc-${nome}`) as HTMLInputElement;
  const digitar = (nome: string, valor: string) => {
    const i = campo(nome);
    i.value = valor;
    i.dispatchEvent(new Event('input'));
    i.dispatchEvent(new Event('blur'));
    fixture.detectChanges();
  };
  const enviar = async () => {
    el().querySelector('form')!.dispatchEvent(new Event('submit'));
    await fixture.whenStable();
  };
  const alerta = () => el().querySelector('[data-teste="erro-geral"]')?.textContent?.trim() ?? '';
  const invalido = (nome: string) => campo(nome).getAttribute('aria-invalid') === 'true';
  const botao = () => el().querySelector('button[type="submit"]') as HTMLButtonElement;
  const falhar = async (req: TestRequest, status: number) => {
    req.flush({ statusCode: status, message: ['x'] }, { status, statusText: 'Erro' });
    await fixture.whenStable();
  };

  describe('novo', () => {
    beforeEach(() => montar(null));

    it('nao chama a API ao abrir e mostra o titulo de cadastro', () => {
      ctrl.expectNone('/api/pacientes');
      expect(el().querySelector('h1')?.textContent).toBe('Novo paciente');
      expect(botao().textContent?.trim()).toBe('Cadastrar paciente');
    });

    it('nao mostra o cartao de consentimento (paciente ainda nao existe)', () => {
      expect(el().querySelector('app-consentimento-card')).toBeNull();
    });

    it('so o nome basta: POST so com nome (trim), depois vai para a lista com aviso', async () => {
      digitar('nome', '  Maria da Silva ');
      await enviar();
      const r = ctrl.expectOne('/api/pacientes');
      expect(r.request.method).toBe('POST');
      expect(r.request.body).toEqual({ nome: 'Maria da Silva' });
      r.flush(P, { status: 201, statusText: 'Created' });
      await fixture.whenStable();
      expect(navegar).toHaveBeenCalledWith('/pacientes', { state: { aviso: 'criado' } });
    });

    it('envia os opcionais preenchidos', async () => {
      digitar('nome', 'Maria');
      digitar('nascimento', '1990-05-17');
      digitar('telefone', ' +55 (11) 99999-0000 ');
      digitar('email', ' maria@exemplo.com ');
      await enviar();
      const r = ctrl.expectOne('/api/pacientes');
      expect(r.request.body).toEqual({
        nome: 'Maria',
        nascimento: '1990-05-17',
        telefone: '+55 (11) 99999-0000',
        email: 'maria@exemplo.com',
      });
      r.flush(P);
    });

    it('nome vazio ou so espacos: bloqueia, foca o nome, nao envia', async () => {
      digitar('nome', '   ');
      await enviar();
      ctrl.expectNone('/api/pacientes');
      expect(invalido('nome')).toBeTrue();
      expect(document.activeElement).toBe(campo('nome'));
      expect(el().querySelector('#pc-nome-erro')?.textContent).toContain('Informe o nome');
    });

    it('nome com 121 caracteres e bloqueado (120 passa)', async () => {
      digitar('nome', 'a'.repeat(121));
      digitar('nome', 'a'.repeat(121));
      await enviar();
      ctrl.expectNone('/api/pacientes');
      expect(invalido('nome')).toBeTrue();
      digitar('nome', 'a'.repeat(120));
      await enviar();
      ctrl.expectOne('/api/pacientes').flush(P);
    });

    it('nascimento futuro e anterior a 1900 sao bloqueados; hoje e 1900-01-01 passam', async () => {
      digitar('nome', 'Maria');
      digitar('nascimento', '2999-01-01');
      await enviar();
      ctrl.expectNone('/api/pacientes');
      expect(invalido('nascimento')).toBeTrue();
      expect(el().querySelector('#pc-nascimento-erro')?.textContent).toContain('futuro');
      digitar('nascimento', '1899-12-31');
      await enviar();
      ctrl.expectNone('/api/pacientes');
      expect(el().querySelector('#pc-nascimento-erro')?.textContent).toContain('1900');
      digitar('nascimento', '1900-01-01');
      expect(invalido('nascimento')).toBeFalse();
      digitar('nascimento', hojeLocal());
      expect(invalido('nascimento')).toBeFalse();
    });

    it('telefone: 7 e 21 caracteres e letras bloqueiam; 8 e 20 com pontuacao passam', async () => {
      digitar('nome', 'Maria');
      for (const ruim of ['1234567', '1'.repeat(21), '11 9999-abcd']) {
        digitar('telefone', ruim);
        expect(invalido('telefone')).withContext(ruim).toBeTrue();
      }
      for (const bom of ['12345678', '+55 (11) 9999-0000', '1'.repeat(20)]) {
        digitar('telefone', bom);
        expect(invalido('telefone')).withContext(bom).toBeFalse();
      }
    });

    it('e-mail invalido bloqueia; vazio passa', async () => {
      digitar('nome', 'Maria');
      digitar('email', 'sem-arroba');
      await enviar();
      ctrl.expectNone('/api/pacientes');
      expect(invalido('email')).toBeTrue();
      expect(el().querySelector('#pc-email-erro')?.textContent).toContain('e-mail válido');
      digitar('email', '');
      expect(invalido('email')).toBeFalse();
    });

    it('limpar data esvazia o campo e some com o botao', async () => {
      digitar('nascimento', '1990-05-17');
      await fixture.whenStable();
      const limpar = Array.from(el().querySelectorAll('button')).find(
        (b) => b.textContent?.trim() === 'Limpar data',
      ) as HTMLButtonElement;
      expect(limpar).toBeDefined();
      limpar.click();
      await fixture.whenStable();
      expect(campo('nascimento').value).toBe('');
      expect(document.activeElement).toBe(campo('nascimento'));
      expect(el().textContent).not.toContain('Limpar data');
    });

    it('400 mostra mensagem de campos invalidos e libera o botao', async () => {
      digitar('nome', 'Maria');
      await enviar();
      expect(botao().disabled).toBeTrue();
      expect(botao().textContent?.trim()).toBe('Salvando…');
      await falhar(ctrl.expectOne('/api/pacientes'), 400);
      expect(alerta()).toBe('Alguns campos estão inválidos. Revise e tente de novo.');
      expect(botao().disabled).toBeFalse();
      expect(navegar).not.toHaveBeenCalled();
    });

    it('401, 503 e rede mostram mensagem sem navegar e sem perder o que foi digitado', async () => {
      digitar('nome', 'Maria');
      await enviar();
      await falhar(ctrl.expectOne('/api/pacientes'), 503);
      expect(alerta()).toBe(
        'Não foi possível concluir agora. Confira sua conexão e tente de novo.',
      );
      await enviar();
      await falhar(ctrl.expectOne('/api/pacientes'), 401);
      expect(alerta()).not.toBe('');
      await enviar();
      ctrl.expectOne('/api/pacientes').error(new ProgressEvent('error'));
      await fixture.whenStable();
      expect(alerta()).toContain('Confira sua conexão');
      expect(campo('nome').value).toBe('Maria');
      expect(navegar).not.toHaveBeenCalled();
    });

    it('sem duplo envio', async () => {
      digitar('nome', 'Maria');
      await enviar();
      await enviar();
      ctrl.expectOne('/api/pacientes').flush(P);
    });

    it('labels ligados aos campos e aria-describedby apontando para texto', async () => {
      const campos = el().querySelectorAll('form input');
      expect(campos.length).toBe(4);
      campos.forEach((i) =>
        expect(el().querySelector(`label[for="${i.id}"]`))
          .withContext(i.id)
          .not.toBeNull(),
      );
      digitar('nome', '');
      digitar('email', 'x');
      expect(campo('nome').getAttribute('aria-describedby')).toBe('pc-nome-erro');
      expect(el().querySelector('#pc-nome-erro')?.textContent?.trim()).toBeTruthy();
      expect(el().querySelector('#pc-email-erro')?.textContent?.trim()).toBeTruthy();
    });

    it('nao guarda nada em localStorage nem sessionStorage', async () => {
      localStorage.clear();
      sessionStorage.clear();
      digitar('nome', 'Maria');
      digitar('email', 'maria@exemplo.com');
      await enviar();
      ctrl.expectOne('/api/pacientes').flush(P);
      expect(localStorage.length).toBe(0);
      expect(sessionStorage.length).toBe(0);
    });
  });

  describe('ver e editar', () => {
    beforeEach(() => montar(ID));

    const carregar = async (p: Paciente = P, consentimento = 'NENHUM') => {
      const r = ctrl.expectOne(`/api/pacientes/${ID}`);
      expect(r.request.method).toBe('GET');
      r.flush(p);
      await fixture.whenStable();
      // O cartao de consentimento so nasce depois do paciente: nunca 2 GET ao mesmo tempo.
      ctrl
        .expectOne(`/api/pacientes/${ID}/consentimento`)
        .flush({ estado: consentimento, desde: null, historico: [] });
      await fixture.whenStable();
      // A secao Documentos so nasce depois do consentimento: 4 chamadas, em sequencia.
      await listas(ctrl, () => fixture.whenStable(), ID);
    };

    it('mostra carregando, depois o formulario preenchido', async () => {
      expect(el().textContent).toContain('Carregando o paciente…');
      expect(el().querySelector('form')).toBeNull();
      await carregar();
      expect(campo('nome').value).toBe('Maria da Silva');
      expect(campo('nascimento').value).toBe('1990-05-17');
      expect(campo('telefone').value).toBe('+55 (11) 99999-0000');
      expect(campo('email').value).toBe('maria@exemplo.com');
      expect(botao().textContent?.trim()).toBe('Salvar alterações');
    });

    it('cartao de consentimento: aparece so no detalhe, apos o paciente, e salvar nao o recarrega', async () => {
      expect(el().querySelector('app-consentimento-card')).toBeNull();
      ctrl.expectNone(`/api/pacientes/${ID}/consentimento`);
      await carregar();
      expect(el().querySelector('app-consentimento-card h2')?.textContent).toBe('Consentimento');
      await enviar();
      ctrl.expectOne(`/api/pacientes/${ID}`).flush(P);
      await fixture.whenStable();
      ctrl.expectNone(`/api/pacientes/${ID}/consentimento`);
    });

    it('salvar: PATCH com os 4 campos e confirmacao', async () => {
      await carregar();
      digitar('nome', 'Maria S. Silva');
      await enviar();
      const r = ctrl.expectOne(`/api/pacientes/${ID}`);
      expect(r.request.method).toBe('PATCH');
      expect(r.request.body).toEqual({
        nome: 'Maria S. Silva',
        nascimento: '1990-05-17',
        telefone: '+55 (11) 99999-0000',
        email: 'maria@exemplo.com',
      });
      r.flush({ ...P, nome: 'Maria S. Silva' });
      await fixture.whenStable();
      expect(el().querySelector('[data-teste="confirmacao"]')?.textContent).toContain(
        'Alterações salvas.',
      );
      expect(campo('nome').value).toBe('Maria S. Silva');
      expect(navegar).not.toHaveBeenCalled();
    });

    it('limpar telefone, e-mail e nascimento manda null', async () => {
      await carregar();
      digitar('telefone', '');
      digitar('email', '  ');
      (
        Array.from(el().querySelectorAll('button')).find(
          (b) => b.textContent?.trim() === 'Limpar data',
        ) as HTMLButtonElement
      ).click();
      await fixture.whenStable();
      await enviar();
      const r = ctrl.expectOne(`/api/pacientes/${ID}`);
      expect(r.request.body).toEqual({
        nome: 'Maria da Silva',
        nascimento: null,
        telefone: null,
        email: null,
      });
      r.flush({ ...P, nascimento: null, telefone: null, email: null });
      await fixture.whenStable();
      expect(campo('telefone').value).toBe('');
      expect(campo('email').value).toBe('');
      expect(campo('nascimento').value).toBe('');
    });

    it('paciente sem opcionais abre com campos vazios', async () => {
      await carregar({ ...P, nascimento: null, telefone: null, email: null });
      expect(campo('nascimento').value).toBe('');
      expect(campo('telefone').value).toBe('');
      expect(campo('email').value).toBe('');
    });

    it('404 ao carregar volta para a lista com aviso', async () => {
      ctrl
        .expectOne(`/api/pacientes/${ID}`)
        .flush({ message: 'Paciente nao encontrado' }, { status: 404, statusText: 'Not Found' });
      await fixture.whenStable();
      expect(navegar).toHaveBeenCalledWith('/pacientes', { state: { aviso: 'nao-encontrado' } });
    });

    it('404 ao salvar volta para a lista com aviso', async () => {
      await carregar();
      await enviar();
      await falhar(ctrl.expectOne(`/api/pacientes/${ID}`), 404);
      expect(navegar).toHaveBeenCalledWith('/pacientes', { state: { aviso: 'nao-encontrado' } });
    });

    it('falha ao carregar (rede/503) mostra "Tentar de novo", que refaz a chamada', async () => {
      ctrl.expectOne(`/api/pacientes/${ID}`).flush({}, { status: 503, statusText: 'Unavailable' });
      await fixture.whenStable();
      expect(el().querySelector('[role="alert"]')?.textContent).toContain(
        'Não foi possível carregar o paciente.',
      );
      expect(navegar).not.toHaveBeenCalled();
      (
        Array.from(el().querySelectorAll('button')).find(
          (b) => b.textContent?.trim() === 'Tentar de novo',
        ) as HTMLButtonElement
      ).click();
      await fixture.whenStable();
      await carregar();
      expect(campo('nome').value).toBe('Maria da Silva');
    });

    it('400 ao salvar mostra o erro e mantem o formulario', async () => {
      await carregar();
      await enviar();
      await falhar(ctrl.expectOne(`/api/pacientes/${ID}`), 400);
      expect(alerta()).toContain('inválidos');
      expect(el().querySelector('[data-teste="confirmacao"]')).toBeNull();
    });

    describe('secao Documentos', () => {
      const secao = () => el().querySelector('app-documentos-secao');
      const novoDoc = () =>
        Array.from(
          el().querySelectorAll('app-documentos-secao a, app-documentos-secao button'),
        ).find((e) => e.textContent?.trim() === 'Novo documento') as HTMLElement;
      const clicar = async (rotulo: string) => {
        (
          Array.from(el().querySelectorAll('app-consentimento-card button')).find(
            (b) => b.textContent?.trim() === rotulo,
          ) as HTMLButtonElement
        ).click();
        await fixture.whenStable();
      };
      const registrar = async (evento: string) => {
        const r = ctrl.expectOne(`/api/pacientes/${ID}/consentimento`);
        expect(r.request.body).toEqual({ evento });
        r.flush({ estado: evento, desde: null, historico: [] }, { status: 201, statusText: 'x' });
        await fixture.whenStable();
      };

      it('nasce so depois do consentimento: paciente, consentimento, aprovados e rascunhos, nessa ordem (4 chamadas)', async () => {
        expect(secao()).toBeNull();
        ctrl.expectOne(`/api/pacientes/${ID}`).flush(P);
        await fixture.whenStable();
        ctrl.expectNone((r) => r.url === URL_DOCS(ID));
        expect(secao()).toBeNull();
        ctrl
          .expectOne(`/api/pacientes/${ID}/consentimento`)
          .flush({ estado: 'NENHUM', desde: null, historico: [] });
        await fixture.whenStable();
        expect(secao()).not.toBeNull();
        const aprovados = ctrl.expectOne(`${URL_DOCS(ID)}?status=APROVADO`);
        ctrl.expectNone(`${URL_DOCS(ID)}?status=RASCUNHO`);
        aprovados.flush([]);
        await fixture.whenStable();
        ctrl.expectOne(`${URL_DOCS(ID)}?status=RASCUNHO`).flush([]);
        await fixture.whenStable();
      });

      it('sem consentimento: botao desabilitado com o motivo', async () => {
        await carregar();
        expect((novoDoc() as HTMLButtonElement).disabled).toBeTrue();
        expect(secao()?.textContent).toContain('Registre o consentimento para criar documentos.');
      });

      it('registrar habilita e revogar desabilita, sem recarregar a pagina nem a lista', async () => {
        await carregar();
        await clicar('Registrar consentimento');
        await registrar('CONCEDIDO');
        expect(novoDoc().tagName).toBe('A');
        expect(novoDoc().getAttribute('href')).toBe(`/pacientes/${ID}/documentos/novo`);
        await clicar('Revogar consentimento');
        await clicar('Confirmar revogação');
        await registrar('REVOGADO');
        expect((novoDoc() as HTMLButtonElement).disabled).toBeTrue();
        ctrl.expectNone(`/api/pacientes/${ID}`);
        ctrl.expectNone((r) => r.url === URL_DOCS(ID));
      });

      it('consentimento ja concedido ao abrir: botao ativo', async () => {
        await carregar(P, 'CONCEDIDO');
        expect(novoDoc().tagName).toBe('A');
      });
    });
  });

  describe('aviso vindo das telas de documento', () => {
    const casos: [string, string, string][] = [
      ['sem-consentimento', 'aviso-erro', 'O consentimento deste paciente não está concedido'],
      ['documento-nao-encontrado', 'aviso-erro', 'Documento não encontrado.'],
      ['documento-criado', 'aviso-ok', 'Documento criado como rascunho.'],
    ];
    for (const [codigo, classe, texto] of casos) {
      it(`${codigo}: mostra o texto fixo`, async () => {
        await montar(ID, codigo);
        const a = el().querySelector('[data-teste="aviso"]')!;
        expect(a.classList).toContain(classe);
        expect(a.textContent).toContain(texto);
        ctrl.expectOne(`/api/pacientes/${ID}`).flush(P);
        await fixture.whenStable();
        ctrl
          .expectOne(`/api/pacientes/${ID}/consentimento`)
          .flush({ estado: 'NENHUM', desde: null, historico: [] });
        await fixture.whenStable();
        await listas(ctrl, () => fixture.whenStable(), ID);
      });
    }

    it('sem recado ou com codigo desconhecido: nenhum aviso', async () => {
      await montar(ID, 'qualquer-coisa');
      expect(el().querySelector('[data-teste="aviso"]')).toBeNull();
      ctrl.expectOne(`/api/pacientes/${ID}`).flush(P);
      await fixture.whenStable();
      ctrl
        .expectOne(`/api/pacientes/${ID}/consentimento`)
        .flush({ estado: 'NENHUM', desde: null, historico: [] });
      await fixture.whenStable();
      await listas(ctrl, () => fixture.whenStable(), ID);
    });
  });
});
