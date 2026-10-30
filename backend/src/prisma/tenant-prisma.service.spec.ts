import { PrismaService } from './prisma.service';
import { TenantPrismaService } from './tenant-prisma.service';

const UUID = '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b';

function criar() {
  const $transaction = jest.fn();
  const tenant = new TenantPrismaService({
    $transaction,
  } as unknown as PrismaService);
  return { tenant, $transaction };
}

describe('TenantPrismaService (sem banco)', () => {
  it.each(['nao-e-uuid', '', `${UUID}' OR '1'='1`])(
    'run(%j) lanca sem abrir transacao',
    async (clinicaId) => {
      const { tenant, $transaction } = criar();
      await expect(
        tenant.run(clinicaId, () => Promise.resolve(1)),
      ).rejects.toThrow('clinicaId invalido');
      expect($transaction).not.toHaveBeenCalled();
    },
  );

  it('psicologoId invalido lanca sem abrir transacao', async () => {
    const { tenant, $transaction } = criar();
    await expect(
      tenant.run(UUID, () => Promise.resolve(1), { psicologoId: 'x' }),
    ).rejects.toThrow('psicologoId invalido');
    expect($transaction).not.toHaveBeenCalled();
  });

  it('usa timeout 5 s e maxWait 2 s', async () => {
    const { tenant, $transaction } = criar();
    $transaction.mockResolvedValue('ok');
    await expect(tenant.run(UUID, () => Promise.resolve(1))).resolves.toBe(
      'ok',
    );
    expect($transaction).toHaveBeenCalledWith(expect.any(Function), {
      timeout: 5000,
      maxWait: 2000,
    });
  });
});
