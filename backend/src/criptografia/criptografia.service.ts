import { Injectable } from '@nestjs/common';
import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
} from 'node:crypto';
import {
  normalizarSegredo,
  permiteSegredoDeTeste,
  SEGREDOS_CONHECIDOS,
} from '../comum/segredos-conhecidos';

// Formato: v1.<kid>.<iv>.<tag>.<ct>, cada parte em base64url.
// kid = id da chave mestra que cifrou o valor. Sem rotacao, e sempre k1.
const VERSAO = 'v1';
const KID_UNICO = 'k1';
const KID_RE = /^k[0-9]+$/;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const HEX_RE = /^[0-9a-fA-F]{64}$/;

// HKDF-SHA256: IKM = a chave mestra do kid, salt vazio (RFC 5869: vira 32 bytes zero),
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

// AAD canonico de um campo cifrado: tabela|coluna|id|psicologoId. Vai para o GCM:
// cifrado copiado para outra linha, coluna ou dono nao decifra. Parte vazia ou com
// '|' quebraria a forma canonica (duas listas diferentes, mesma string): recusa.
export function aadDe(
  tabela: string,
  coluna: string,
  id: string,
  psicologoId?: string,
): string {
  const partes = [tabela, coluna, id];
  if (psicologoId !== undefined) partes.push(psicologoId);
  for (const p of partes) {
    if (typeof p !== 'string' || p === '' || p.includes('|')) {
      throw new Error('aad invalido');
    }
  }
  return partes.join('|');
}

function exigirAad(aad: unknown): asserts aad is string {
  if (typeof aad !== 'string' || aad === '') throw new Error('aad invalido');
}

// O GCM autentica tambem versao e kid: 'v1.<kid>|' + aad.
function aadGcm(kid: string, aad: string): Buffer {
  return Buffer.from(`${VERSAO}.${kid}|${aad}`, 'utf8');
}

// Le o kid do proprio valor (sem decifrar). Formato ruim = erro generico.
export function kidDe(valor: unknown): string {
  if (typeof valor !== 'string') throw new Error('falha ao decifrar');
  const partes = valor.split('.');
  if (partes.length !== 5 || partes[0] !== VERSAO || !KID_RE.test(partes[1])) {
    throw new Error('falha ao decifrar');
  }
  return partes[1];
}

// Env vazia conta como ausente (o .env.example traz as variaveis vazias).
function lerEnv(nome: string): string | undefined {
  const v = process.env[nome];
  return v === undefined || v.trim() === '' ? undefined : v;
}

// Mensagens nunca repetem o valor da chave: so o nome da variavel (e o kid).
function validarChave(hex: string, nome: string): Buffer {
  if (!HEX_RE.test(hex)) {
    throw new Error(
      `${nome} invalida: precisa ser 32 bytes em hex (gere com: openssl rand -hex 32)`,
    );
  }
  const master = Buffer.from(hex, 'hex');
  // Fraca: menos de 16 bytes distintos (cobre bytes todos iguais, 64 zeros do exemplo antigo e
  // `00..01`) ou chave que esta nas suites de teste (so passa com NOTTA_PERMITE_SEGREDO_DE_TESTE=1).
  const deTeste = SEGREDOS_CONHECIDOS.masterDeTeste.some(
    (k) => k === normalizarSegredo(hex),
  );
  if (deTeste ? !permiteSegredoDeTeste() : new Set(master).size < 16) {
    throw new Error(
      `${nome} fraca (poucos bytes distintos, valor de exemplo ou de teste): gere com openssl rand -hex 32`,
    );
  }
  return master;
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
  // kid -> chave mestra (so as que estao no ambiente).
  private readonly mestras = new Map<string, Buffer>();
  // kid do que CIFRA. Os demais kids so decifram.
  private readonly atual: string;
  // `${kid}|${clinicaId}` -> chave derivada por clinica (cache).
  private readonly derivadas = new Map<string, Buffer>();

  constructor() {
    const unica = lerEnv('NOTTA_MASTER_KEY');
    const lista = lerEnv('NOTTA_MASTER_KEYS');
    const atual = lerEnv('NOTTA_MASTER_KEY_ATUAL');
    if (lista === undefined) {
      if (atual !== undefined) {
        throw new Error(
          'NOTTA_MASTER_KEY_ATUAL so vale junto com NOTTA_MASTER_KEYS',
        );
      }
      this.mestras.set(
        KID_UNICO,
        validarChave(unica ?? '', 'NOTTA_MASTER_KEY'),
      );
      this.atual = KID_UNICO;
      return;
    }
    if (unica !== undefined) {
      throw new Error(
        'NOTTA_MASTER_KEY e NOTTA_MASTER_KEYS definidas juntas: deixe so NOTTA_MASTER_KEYS',
      );
    }
    if (atual === undefined) {
      throw new Error(
        'NOTTA_MASTER_KEY_ATUAL obrigatoria quando NOTTA_MASTER_KEYS existir',
      );
    }
    for (const item of lista.split(',').map((s) => s.trim())) {
      const i = item.indexOf(':');
      const kid = i < 0 ? '' : item.slice(0, i);
      if (!KID_RE.test(kid)) {
        throw new Error(
          'NOTTA_MASTER_KEYS invalida: use kid:hex separados por virgula, com kid no formato k<numero>',
        );
      }
      if (this.mestras.has(kid)) {
        throw new Error(`NOTTA_MASTER_KEYS: kid ${kid} repetido`);
      }
      this.mestras.set(
        kid,
        validarChave(item.slice(i + 1), `NOTTA_MASTER_KEYS (kid ${kid})`),
      );
    }
    const atualAparada = atual.trim();
    if (!KID_RE.test(atualAparada) || !this.mestras.has(atualAparada)) {
      throw new Error('NOTTA_MASTER_KEY_ATUAL nao existe em NOTTA_MASTER_KEYS');
    }
    this.atual = atualAparada;
  }

  private chave(kid: string, mestra: Buffer, clinicaId: string): Buffer {
    const id = `${kid}|${clinicaId}`;
    let k = this.derivadas.get(id);
    if (!k) {
      k = derivarChaveClinica(mestra, clinicaId);
      this.derivadas.set(id, k);
    }
    return k;
  }

  // aad: use aadDe(tabela, coluna, id, psicologoId). O mesmo valor no decifrar.
  cifrar(clinicaId: string, texto: string, aad: string): string {
    exigirClinicaId(clinicaId);
    exigirAad(aad);
    const kid = this.atual;
    const mestra = this.mestras.get(kid) as Buffer;
    const iv = randomBytes(IV_BYTES);
    const c = createCipheriv(
      'aes-256-gcm',
      this.chave(kid, mestra, clinicaId),
      iv,
    );
    c.setAAD(aadGcm(kid, aad));
    const ct = Buffer.concat([c.update(texto, 'utf8'), c.final()]);
    return [
      VERSAO,
      kid,
      iv.toString('base64url'),
      c.getAuthTag().toString('base64url'),
      ct.toString('base64url'),
    ].join('.');
  }

  decifrar(clinicaId: string, valor: string, aad: string): string {
    exigirClinicaId(clinicaId);
    exigirAad(aad);
    try {
      const kid = kidDe(valor);
      // Kid que nao esta no ambiente: erro generico. Nunca cai para a atual.
      const mestra = this.mestras.get(kid);
      if (!mestra) throw new Error();
      const partes = valor.split('.');
      const iv = decodificar(partes[2]);
      const tag = decodificar(partes[3]);
      const ct = decodificar(partes[4]);
      const d = createDecipheriv(
        'aes-256-gcm',
        this.chave(kid, mestra, clinicaId),
        iv,
        { authTagLength: TAG_BYTES },
      );
      d.setAuthTag(tag);
      d.setAAD(aadGcm(kid, aad));
      return Buffer.concat([d.update(ct), d.final()]).toString('utf8');
    } catch {
      throw new Error('falha ao decifrar');
    }
  }

  // Kid que cifra agora: destino da recifragem (item 25, B).
  kidAtual(): string {
    return this.atual;
  }

  // Migra um valor para a chave atual: decifra com o kid do proprio valor e cifra com a atual.
  // Ja na atual, devolve igual.
  recifrarValor(clinicaId: string, valor: string, aad: string): string {
    exigirClinicaId(clinicaId);
    exigirAad(aad);
    if (kidDe(valor) === this.atual) return valor;
    return this.cifrar(clinicaId, this.decifrar(clinicaId, valor, aad), aad);
  }
}
