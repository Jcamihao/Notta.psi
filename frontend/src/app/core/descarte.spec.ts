import { TestBed } from '@angular/core/testing';
import { AGORA, descarteUrgente, diasAteDescarte, textoDescarte } from './descarte';

const AGORA_FIXO = new Date('2026-11-11T12:00:00.000Z');
const MS_DIA = 24 * 60 * 60 * 1000;
const em = (ms: number) => new Date(AGORA_FIXO.getTime() + ms).toISOString();

describe('descarte de rascunho', () => {
  describe('textoDescarte', () => {
    it('sem prazo (null) devolve null', () => {
      expect(textoDescarte(null, AGORA_FIXO)).toBeNull();
    });

    it('data invalida devolve null sem lancar', () => {
      expect(() => textoDescarte('nao-e-data', AGORA_FIXO)).not.toThrow();
      expect(textoDescarte('nao-e-data', AGORA_FIXO)).toBeNull();
      expect(textoDescarte('', AGORA_FIXO)).toBeNull();
    });

    it('exatamente 24h = 1 dia: "amanha"', () => {
      expect(textoDescarte(em(MS_DIA), AGORA_FIXO)).toBe('Será apagado amanhã se não for editado.');
    });

    it('24h + 1 ms = 2 dias (teto)', () => {
      expect(textoDescarte(em(MS_DIA + 1), AGORA_FIXO)).toBe(
        'Será apagado em 2 dias se não for editado.',
      );
    });

    it('prazo longo: conta em dias inteiros por teto', () => {
      expect(textoDescarte(em(6 * MS_DIA + 1000), AGORA_FIXO)).toBe(
        'Será apagado em 7 dias se não for editado.',
      );
    });

    it('zero e negativo: prazo acabou', () => {
      const vencido =
        'O prazo acabou. Será apagado na próxima limpeza. Edite ou aprove para guardar.';
      expect(textoDescarte(em(0), AGORA_FIXO)).toBe(vencido);
      expect(textoDescarte(em(-1), AGORA_FIXO)).toBe(vencido);
      expect(textoDescarte(em(-5 * MS_DIA), AGORA_FIXO)).toBe(vencido);
    });

    it('nenhum texto de descarte contem o numero 7 solto (prazo e configuravel no servidor)', () => {
      const textos = [
        textoDescarte(em(MS_DIA), AGORA_FIXO),
        textoDescarte(em(MS_DIA + 1), AGORA_FIXO),
        textoDescarte(em(3 * MS_DIA), AGORA_FIXO),
        textoDescarte(em(0), AGORA_FIXO),
      ];
      for (const t of textos) expect(t).not.toMatch(/\b7\b/);
    });
  });

  describe('diasAteDescarte', () => {
    it('conta por teto e devolve null sem prazo', () => {
      expect(diasAteDescarte(null, AGORA_FIXO)).toBeNull();
      expect(diasAteDescarte(em(MS_DIA + 1), AGORA_FIXO)).toBe(2);
      expect(diasAteDescarte(em(MS_DIA), AGORA_FIXO)).toBe(1);
    });
  });

  describe('descarteUrgente (dias <= 2)', () => {
    it('sem prazo nao e urgente', () => {
      expect(descarteUrgente(null, AGORA_FIXO)).toBeFalse();
    });

    it('2 dias e urgente; 3 dias nao', () => {
      expect(descarteUrgente(em(2 * MS_DIA), AGORA_FIXO)).toBeTrue();
      expect(descarteUrgente(em(2 * MS_DIA + 1), AGORA_FIXO)).toBeFalse();
    });

    it('vencido tambem e urgente', () => {
      expect(descarteUrgente(em(0), AGORA_FIXO)).toBeTrue();
    });
  });

  describe('AGORA (relogio injetavel)', () => {
    it('por padrao devolve a data atual', () => {
      const padrao = TestBed.inject(AGORA)();
      expect(Math.abs(padrao.getTime() - Date.now())).toBeLessThan(5000);
    });

    it('pode ser trocado nos testes', () => {
      TestBed.configureTestingModule({
        providers: [{ provide: AGORA, useValue: () => AGORA_FIXO }],
      });
      expect(TestBed.inject(AGORA)()).toBe(AGORA_FIXO);
    });
  });
});
