import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
  TestRequest,
} from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { IaCartaoComponent } from './ia-cartao.component';

const PID = '11111111-1111-4111-8111-111111111111';
const DID = '22222222-2222-4222-8222-222222222222';
const USO = { habilitada: true, limite: 20, usadas: 3, renovaEm: '2026-11-05T03:00:00.000Z' };
const CONSENT = (estado: string) => ({ estado, desde: null, historico: [] });

describe('IaCartaoComponent', () => {
  let fixture: ComponentFixture<IaCartaoComponent>;
  let ctrl: HttpTestingController;

  const montar = async () => {
    TestBed.configureTestingModule({
      imports: [IaCartaoComponent],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
    ctrl = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(IaCartaoComponent);
    fixture.componentRef.setInput('pacienteId', PID);
    fixture.componentRef.setInput('docId', DID);
    await fixture.whenStable();
  };
  afterEach(() => ctrl.verify());

  const el = () => fixture.nativeElement as HTMLElement;
  const texto = () => el().textContent?.replace(/\s+/g, ' ').trim() ?? '';
  const flush = async (r: TestRequest, corpo: object, status = 200) => {
    r.flush(corpo, { status, statusText: 'x' });
    await fixture.whenStable();
  };
  const uso = (corpo: object = USO) => flush(ctrl.expectOne('/api/ia/uso'), corpo);
  const consentimento = (estado: string) =>
    flush(ctrl.expectOne(`/api/pacientes/${PID}/consentimento`), CONSENT(estado));

  it('chamadas em sequencia: uso primeiro, consentimento so depois', async () => {
    await montar();
    expect(texto()).toContain('Verificando a IA…');
    ctrl.expectNone(`/api/pacientes/${PID}/consentimento`);
    await uso();
    expect(texto()).toContain('Verificando o consentimento…');
    await consentimento('CONCEDIDO');
  });

  it('IA desligada: aviso, sem botao e sem checar o consentimento', async () => {
    await montar();
    await uso({ ...USO, habilitada: false });
    expect(texto()).toContain('A IA está desligada neste ambiente.');
    expect(el().querySelector('a, button')).toBeNull();
    ctrl.expectNone(`/api/pacientes/${PID}/consentimento`);
  });

  for (const estado of ['NENHUM', 'REVOGADO']) {
    it(`consentimento ${estado}: botao desabilitado com a explicacao`, async () => {
      await montar();
      await uso();
      await consentimento(estado);
      expect(texto()).toContain('Registre o consentimento do paciente para usar a IA.');
      const b = el().querySelector('button') as HTMLButtonElement;
      expect(b.textContent?.trim()).toBe('Gerar com IA');
      expect(b.disabled).toBeTrue();
      expect(b.getAttribute('aria-describedby')).toBe('ia-bloqueio');
      expect(el().querySelector('a')).toBeNull();
    });
  }

  it('tudo certo: link para a rota de IA e contador', async () => {
    await montar();
    await uso();
    await consentimento('CONCEDIDO');
    const a = el().querySelector('a') as HTMLAnchorElement;
    expect(a.textContent?.trim()).toBe('Gerar com IA');
    expect(a.getAttribute('href')).toBe(`/pacientes/${PID}/documentos/${DID}/ia`);
    expect(el().querySelector('[data-teste="ia-contador"]')?.textContent?.trim()).toBe(
      '3 de 20 gerações hoje',
    );
  });

  it('limite do dia atingido: botao desabilitado e hora de renovar', async () => {
    await montar();
    await uso({ ...USO, usadas: 20 });
    await consentimento('CONCEDIDO');
    expect(el().querySelector('a')).toBeNull();
    expect((el().querySelector('button') as HTMLButtonElement).disabled).toBeTrue();
    expect(el().querySelector('[data-teste="ia-limite"]')?.textContent).toMatch(
      /Limite diário de gerações atingido; renova em 05\/11\/2026, \d{2}:\d{2}\./,
    );
    expect(el().querySelector('[data-teste="ia-contador"]')?.textContent?.trim()).toBe(
      '20 de 20 gerações hoje',
    );
  });

  it('erro de rede no uso: mensagem e Tentar de novo refaz', async () => {
    await montar();
    await flush(ctrl.expectOne('/api/ia/uso'), {}, 500);
    expect(el().querySelector('[role="alert"]')?.textContent).toContain(
      'Não foi possível verificar a IA agora',
    );
    (el().querySelector('[role="alert"] button') as HTMLElement).click();
    await fixture.whenStable();
    await uso();
    await consentimento('CONCEDIDO');
    expect(el().querySelector('a')).not.toBeNull();
  });

  it('erro no consentimento tambem oferece Tentar de novo', async () => {
    await montar();
    await uso();
    await flush(ctrl.expectOne(`/api/pacientes/${PID}/consentimento`), {}, 500);
    expect(el().querySelector('[role="alert"]')).not.toBeNull();
    expect(el().querySelector('a')).toBeNull();
  });
});
