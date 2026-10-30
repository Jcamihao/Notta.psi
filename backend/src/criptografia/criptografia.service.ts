import { Injectable } from '@nestjs/common';
import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
} from 'node:crypto';

// Formato: v1.<kid>.<iv>.<tag>.<ct>, cada parte em base64url.
// kid = id da chave mestra atual (rotacao futura acrescenta outros kids).
const VERSAO = 'v1';
const KID = 'k1';
const IV_BYTES = 12;
const TAG_BYTES = 16;

// HKDF-SHA256: IKM = NOTTA_MASTER_KEY, salt vazio (RFC 5869: vira 32 bytes zero),
// info = notta-psi|clinica|<clinicaId>, 32 bytes de saida.
export function derivarChaveClinica(
  masterKey: Buffer,
  clinicaId: string,
): Buffer {
  return Buffer.from(
    hkdfSync(
      'sha256',
      masterKey,
      Buffer.alloc(0),
      `notta-psi|clinica|${clinicaId}`,
      32,
    ),
  );
}

function exigirClinicaId(clinicaId: unknown): asserts clinicaId is string {
  if (typeof clinicaId !== 'string' || clinicaId === '') {
    throw new Error('clinicaId invalido');
  }
}

// Base64url estrito: rejeita caracteres invalidos e codificacao nao canonica.
// Tamanho errado de iv/tag nao precisa de checagem: authTagLength e a
// autenticacao do GCM ja rejeitam.
function decodificar(parte: string): Buffer {
  const buf = Buffer.from(parte, 'base64url');
  if (buf.toString('base64url') !== parte) throw new Error();
  return buf;
}

@Injectable()
export class CriptografiaService {
  private readonly master: Buffer;
  private readonly chaves = new Map<string, Buffer>();

  constructor() {
    const hex = process.env.NOTTA_MASTER_KEY;
    if (!hex || !/^[0-9a-fA-F]{64}$/.test(hex)) {
      throw new Error(
        'NOTTA_MASTER_KEY invalida: precisa ser 32 bytes em hex (gere com: openssl rand -hex 32)',
      );
    }
    this.master = Buffer.from(hex, 'hex');
  }

  private chave(clinicaId: string): Buffer {
    let k = this.chaves.get(clinicaId);
    if (!k) {
      k = derivarChaveClinica(this.master, clinicaId);
      this.chaves.set(clinicaId, k);
    }
    return k;
  }

  cifrar(clinicaId: string, texto: string): string {
    exigirClinicaId(clinicaId);
    const iv = randomBytes(IV_BYTES);
    const c = createCipheriv('aes-256-gcm', this.chave(clinicaId), iv);
    const ct = Buffer.concat([c.update(texto, 'utf8'), c.final()]);
    return [
      VERSAO,
      KID,
      iv.toString('base64url'),
      c.getAuthTag().toString('base64url'),
      ct.toString('base64url'),
    ].join('.');
  }

  decifrar(clinicaId: string, valor: string): string {
    exigirClinicaId(clinicaId);
    try {
      const partes = valor.split('.');
      if (partes.length !== 5 || partes[0] !== VERSAO || partes[1] !== KID) {
        throw new Error();
      }
      const iv = decodificar(partes[2]);
      const tag = decodificar(partes[3]);
      const ct = decodificar(partes[4]);
      const d = createDecipheriv('aes-256-gcm', this.chave(clinicaId), iv, {
        authTagLength: TAG_BYTES,
      });
      d.setAuthTag(tag);
      return Buffer.concat([d.update(ct), d.final()]).toString('utf8');
    } catch {
      throw new Error('falha ao decifrar');
    }
  }
}
