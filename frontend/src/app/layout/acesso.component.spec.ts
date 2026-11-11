import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AcessoComponent } from './acesso.component';

describe('AcessoComponent (painel de sigilo)', () => {
  let fixture: ComponentFixture<AcessoComponent>;
  const el = () => fixture.nativeElement as HTMLElement;
  const painel = () => el().querySelector('aside.acesso-sigilo') as HTMLElement;
  const titulos = () =>
    Array.from(painel().querySelectorAll('dt')).map((d) =>
      d.textContent!.replace(/\s+/g, ' ').trim(),
    );

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [AcessoComponent],
      providers: [provideRouter([])],
    });
    fixture = TestBed.createComponent(AcessoComponent);
    fixture.detectChanges();
  });

  it('tem os tres itens com os titulos do sigilo', () => {
    expect(titulos()).toEqual([
      'Dados cifrados, com chave por clínica',
      'Cada um vê o que é seu',
      'Você aprova, sempre',
    ]);
  });

  it('o item de dados diz o que fica cifrado, sem prometer acesso exclusivo', () => {
    const texto = painel().querySelectorAll('dd')[0].textContent!.replace(/\s+/g, ' ').trim();
    expect(texto).toBe(
      'Nome, nascimento, telefone e e-mail do paciente e o texto dos documentos ficam cifrados no banco, com uma chave própria de cada clínica.',
    );
  });

  it('o item de IA diz o que acontece antes do envio e que o texto vai a terceiros', () => {
    const texto = painel().querySelectorAll('dd')[2].textContent!.replace(/\s+/g, ' ').trim();
    expect(texto).toContain(
      'A IA só propõe rascunhos e só é usada para pacientes com consentimento.',
    );
    expect(texto).toContain('o filtro reduz o risco, mas não é perfeito');
    expect(texto).toContain(
      'troca o nome do paciente, CPF, telefone, e-mail e endereço com número',
    );
    expect(texto).toContain('Nada entra no prontuário sem a sua aprovação.');
    expect(texto).toContain(
      'O texto vai a um serviço de IA de terceiros, só depois da sua confirmação.',
    );
  });

  it('tem link discreto para /seguranca', () => {
    const a = painel().querySelector('a[href="/seguranca"]');
    expect(a).not.toBeNull();
    expect(a!.textContent!.trim()).toBe('Veja o que protegemos e o que ainda não está pronto');
  });

  it('nao promete o que o sistema nao garante', () => {
    const texto = painel().textContent!;
    for (const proibida of [/exclusiv/i, /100%/, /totalmente/i, /inviol[aá]vel/i, /ninguém/i]) {
      expect(texto).not.toMatch(proibida);
    }
  });
});
