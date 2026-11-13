import { randomUUID } from 'node:crypto';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CriarTransferenciaDto } from './transferencias.dto';

describe('CriarTransferenciaDto', () => {
  it('aceita origem e destino em UUID', async () => {
    const dto = plainToInstance(CriarTransferenciaDto, {
      origemId: randomUUID(),
      destinoId: randomUUID(),
    });
    expect(await validate(dto)).toEqual([]);
  });

  it('recusa id que nao e UUID (400 no pipe)', async () => {
    const dto = plainToInstance(CriarTransferenciaDto, {
      origemId: 'nao-uuid',
      destinoId: randomUUID(),
    });
    const erros = await validate(dto);
    expect(erros.map((e) => e.property)).toEqual(['origemId']);
  });

  it('recusa destino ausente ou vazio', async () => {
    const dto = plainToInstance(CriarTransferenciaDto, {
      origemId: randomUUID(),
    });
    const erros = await validate(dto);
    expect(erros.map((e) => e.property)).toEqual(['destinoId']);
  });
});
