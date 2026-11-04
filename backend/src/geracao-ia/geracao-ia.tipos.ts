import { aadDe } from '../criptografia/criptografia.service';

// Colunas cifradas de GeracaoIa: mesmo AAD na cifra e na decifra (cifrado nao troca de linha
// nem de coluna).
export const aadGeracao = (
  coluna: 'textoCifrado' | 'mapaCifrado',
  id: string,
  psicologoId: string,
) => aadDe('GeracaoIa', coluna, id, psicologoId);
