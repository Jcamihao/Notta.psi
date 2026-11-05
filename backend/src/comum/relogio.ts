// Relogio do app, trocavel em teste (jest.spyOn(relogio, 'agora')). Prazos de convite usam ESTE
// relogio e nao o now() do banco: o Prisma grava timestamp sem fuso em UTC e o fuso do servidor de
// banco pode ser outro (o Postgres embutido usa America/Sao_Paulo).
export const relogio = { agora: (): Date => new Date() };
