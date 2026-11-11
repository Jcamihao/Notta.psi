import type { Prisma } from '@prisma/client';
import { aadDe } from '../criptografia/criptografia.service';

// Geracao de paciente excluido (item 26) nao existe para o app: a geracao aponta para a origem
// (Documento), que aponta para o paciente.
export const SO_PACIENTE_VIVO: Prisma.GeracaoIaWhereInput = {
  origem: { paciente: { excluidoEm: null } },
};

// Colunas cifradas de GeracaoIa: mesmo AAD na cifra e na decifra (cifrado nao troca de linha
// nem de coluna).
export const aadGeracao = (
  coluna: 'textoCifrado' | 'mapaCifrado',
  id: string,
  psicologoId: string,
) => aadDe('GeracaoIa', coluna, id, psicologoId);
