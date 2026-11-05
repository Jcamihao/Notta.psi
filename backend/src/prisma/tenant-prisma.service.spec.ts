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

  it('runComoUsuario = run com clinicaId e psicologoId do usuario', async () => {
    const { tenant } = criar();
    const run = jest.spyOn(tenant, 'run').mockResolvedValue('ok');
    const fn = () => Promise.resolve(1);
    const psicologoId = '0b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d';
    await expect(
      tenant.runComoUsuario({ clinicaId: UUID, psicologoId }, fn),
    ).resolves.toBe('ok');
    expect(run).toHaveBeenCalledWith(UUID, fn, { psicologoId });
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

  describe('runConvite (fluxo publico do convite de consentimento)', () => {
    const HASH = 'a'.repeat(64);
    const OWNER = {
      clinicaId: UUID,
      psicologoId: '0b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d',
    };

    // tx falso que guarda cada set_config chamado.
    function comTx() {
      const { tenant, $transaction } = criar();
      const sets: unknown[][] = [];
      const tx = {
        $queryRaw: jest.fn((_s: TemplateStringsArray, ...v: unknown[]) => {
          sets.push([_s.join('?'), ...v]);
          return Promise.resolve([]);
        }),
      };
      $transaction.mockImplementation((f: (t: typeof tx) => unknown) => f(tx));
      return { tenant, $transaction, sets };
    }

    it.each([
      '',
      'nao-e-hash',
      'A'.repeat(64),
      'a'.repeat(63),
      `${'a'.repeat(63)}'`,
    ])('hash invalido %j lanca sem abrir transacao', async (hash) => {
      const { tenant, $transaction } = criar();
      await expect(
        tenant.runConvite(hash, () => Promise.resolve(1)),
      ).rejects.toThrow('tokenHash invalido');
      expect($transaction).not.toHaveBeenCalled();
    });

    it('poe so o hash no contexto (app.convite_hash) e usa os mesmos timeouts', async () => {
      const { tenant, $transaction, sets } = comTx();
      await tenant.runConvite(HASH, () => Promise.resolve('ok'));
      expect(sets).toEqual([
        [expect.stringContaining('app.convite_hash'), HASH],
      ]);
      expect($transaction).toHaveBeenCalledWith(expect.any(Function), {
        timeout: 5000,
        maxWait: 2000,
      });
    });

    it('assumirDono poe clinica e psicologo DEPOIS do hash; ids invalidos lancam sem set_config', async () => {
      const { tenant, sets } = comTx();
      await tenant.runConvite(HASH, async (_tx, assumirDono) => {
        await assumirDono(OWNER);
      });
      expect(sets.map((s) => s[1])).toEqual([
        HASH,
        OWNER.clinicaId,
        OWNER.psicologoId,
      ]);
      const outro = comTx();
      await expect(
        outro.tenant.runConvite(HASH, (_tx, assumirDono) =>
          assumirDono({ clinicaId: 'x', psicologoId: OWNER.psicologoId }),
        ),
      ).rejects.toThrow('dono do convite invalido');
      expect(outro.sets).toHaveLength(1);
    });
  });
});
