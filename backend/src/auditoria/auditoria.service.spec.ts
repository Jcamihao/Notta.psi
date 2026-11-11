import { randomUUID } from 'node:crypto';
import { AuditoriaService } from './auditoria.service';

const user = { clinicaId: randomUUID(), psicologoId: randomUUID() };

function montar() {
  const create = jest.fn<Promise<object>, [object]>(() => Promise.resolve({}));
  const tx = { auditoria: { create } };
  return { create, tx: tx as never, service: new AuditoriaService() };
}

describe('AuditoriaService.registrar', () => {
  it('grava clinica e psicologo do user, acao, recurso e recursoId, e mais nada', async () => {
    const { create, tx, service } = montar();
    const id = randomUUID();
    await service.registrar(tx, user, 'EDITOU', 'Paciente', id);
    expect(create).toHaveBeenCalledWith({
      data: {
        clinicaId: user.clinicaId,
        psicologoId: user.psicologoId,
        acao: 'EDITOU',
        recurso: 'Paciente',
        recursoId: id,
      },
    });
  });

  it('EXCLUIU (exclusao por anonimizacao, item 26) e acao valida, gravada com o id do paciente', async () => {
    const { create, tx, service } = montar();
    const id = randomUUID();
    await service.registrar(tx, user, 'EXCLUIU', 'Paciente', id);
    expect(create).toHaveBeenCalledWith({
      data: {
        clinicaId: user.clinicaId,
        psicologoId: user.psicologoId,
        acao: 'EXCLUIU',
        recurso: 'Paciente',
        recursoId: id,
      },
    });
  });

  it('sem recursoId grava null (LISTOU)', async () => {
    const { create, tx, service } = montar();
    await service.registrar(tx, user, 'LISTOU', 'Paciente');
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        acao: 'LISTOU',
        recursoId: null,
      }) as object,
    });
  });

  it('acao ou recurso fora da lista: erro e nada gravado', async () => {
    const { create, tx, service } = montar();
    await expect(
      service.registrar(tx, user, 'APAGOU' as never, 'Paciente'),
    ).rejects.toThrow('invalido');
    await expect(
      service.registrar(tx, user, 'LEU', 'Inexistente' as never),
    ).rejects.toThrow('invalido');
    expect(create).not.toHaveBeenCalled();
  });

  it('erro do banco sobe (falha fechada, a transacao da acao desfaz)', async () => {
    const { create, tx, service } = montar();
    create.mockRejectedValueOnce(new Error('banco caiu'));
    await expect(
      service.registrar(tx, user, 'LEU', 'Paciente', randomUUID()),
    ).rejects.toThrow('banco caiu');
  });
});
