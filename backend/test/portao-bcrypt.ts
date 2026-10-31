import bcrypt from 'bcrypt';

// Teste deterministico dos tetos de hash: segura `bcrypt.compare` das senhas `presa` ate o
// teste mandar abrir. Quem passa pelos tetos fica preso dentro do compare (segurando vaga);
// quem e recusado responde na hora (503/429). Assim a contagem nao depende de quanto tempo o
// bcrypt leva nem de a maquina estar lenta. Senha diferente de `presa` usa o compare real.
export function portaoBcrypt(presa: string) {
  const real = bcrypt.compare.bind(bcrypt) as (
    s: string,
    h: string,
  ) => Promise<boolean>;
  let abrir!: () => void;
  const aberto = new Promise<void>((ok) => (abrir = ok));
  let presas = 0;
  const spy = jest.spyOn(bcrypt, 'compare').mockImplementation(((
    senha: string,
    hash: string,
  ) => {
    if (senha !== presa) return real(senha, hash);
    presas++;
    return aberto.then(() => false);
  }) as never);
  return {
    presas: () => presas,
    restaurar: () => spy.mockRestore(),
    // Espera as `semPortao` requisicoes que nao passam pelos tetos (nao dependem do portao),
    // abre o portao e devolve todas. Se mais ou menos requisicoes ficarem presas, o teste
    // trava e estoura o timeout (falha).
    async soltarDepoisDe<T>(promessas: Promise<T>[], semPortao: number) {
      let feitas = 0;
      let liberar!: () => void;
      const outras = new Promise<void>((ok) => (liberar = ok));
      if (semPortao === 0) liberar();
      for (const p of promessas) {
        void p.then(() => {
          if (++feitas === semPortao) liberar();
        });
      }
      await outras;
      abrir();
      return Promise.all(promessas);
    },
  };
}
