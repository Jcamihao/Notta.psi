import { execFileSync, spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Testa backup.sh e verificar-backup.sh de verdade (bash + openssl + sha256sum), com
// pg_dump/pg_restore/psql FALSOS no lugar do Postgres (via PGDUMP_CMD, PGRESTORE_CMD, PSQL_CMD).
// O ciclo contra o Postgres real esta no relatorio da task e em docs/BACKUP-E-CHAVES.md.
const SCRIPTS = join(__dirname, '../../scripts');
const BACKUP = join(SCRIPTS, 'backup.sh');
const VERIFICAR = join(SCRIPTS, 'verificar-backup.sh');
const SENHA = 'senha-de-backup-com-mais-de-24-caracteres';
// Chave so deste teste (aleatoria, sem uso fora dele).
const CHAVE =
  '4f9d2a7c81e36b05d8a4f1c97e2b60a3d5c8e1f4a79b3026d1e8c5f7a4b93e60';
const DUMP_FALSO = 'PGDMP-conteudo-falso-do-dump\n';

let dir: string;
let tmpScripts: string;

function falso(nome: string, corpo: string) {
  const f = join(dir, nome);
  writeFileSync(f, `#!/usr/bin/env bash\n${corpo}\n`);
  chmodSync(f, 0o700);
  return f;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'backup-spec-'));
  tmpScripts = join(dir, 'tmp');
  execFileSync('mkdir', [tmpScripts]);
  falso(
    'pg_dump',
    `echo "pg_dump $*" >> "${dir}/log"; printf '%s' "$FAKE_DUMP"`,
  );
  falso(
    'pg_restore',
    `echo "pg_restore $*" >> "${dir}/log"; cat > /dev/null; exit "\${FAKE_RESTORE_EXIT:-0}"`,
  );
  // psql falso: registra os comandos; lista uma tabela, conta 0 linhas e nao devolve amostra.
  falso(
    'psql',
    `echo "psql $*" >> "${dir}/log"
case "$*" in
  *table_name*) echo Paciente ;;
  *'count(*)'*) echo 0 ;;
esac`,
  );
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function rodar(script: string, args: string[], env: Record<string, string>) {
  const r = spawnSync('bash', [script, ...args], {
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH,
      TMPDIR: tmpScripts,
      PGDUMP_CMD: join(dir, 'pg_dump'),
      PGRESTORE_CMD: join(dir, 'pg_restore'),
      PSQL_CMD: join(dir, 'psql'),
      FAKE_DUMP: DUMP_FALSO,
      PRAXIS_MASTER_KEY: CHAVE,
      ...env,
    },
  });
  return { status: r.status, saida: `${r.stdout}${r.stderr}` };
}
const backup = (alvo: string, senha: string | null = SENHA) =>
  rodar(BACKUP, [alvo], senha === null ? {} : { PRAXIS_BACKUP_SENHA: senha });
const verificar = (arq: string, env: Record<string, string> = {}) =>
  rodar(VERIFICAR, [arq], { PRAXIS_BACKUP_SENHA: SENHA, ...env });
const log = () =>
  existsSync(join(dir, 'log')) ? readFileSync(join(dir, 'log'), 'utf8') : '';

describe('backup.sh (item 25, parte C)', () => {
  it('recusa senha ausente, vazia ou com menos de 24 caracteres e nao grava nada', () => {
    for (const senha of [null, '', 'a'.repeat(23)]) {
      const r = backup(join(dir, 'b1'), senha);
      expect(r.status).toBe(1);
      expect(r.saida).toContain('FALHOU');
    }
    expect(readdirSync(dir).filter((f) => f.startsWith('b1'))).toEqual([]);
    expect(log()).toBe(''); // nem chegou a rodar o pg_dump
  });

  it('aceita 24 caracteres, grava .enc e .sha256 cifrados, sem parcial e so para o dono', () => {
    const r = backup(join(dir, 'b2'), 'a'.repeat(24));
    expect(r.status).toBe(0);
    const arquivos = readdirSync(dir)
      .filter((f) => f.startsWith('b2'))
      .sort();
    expect(arquivos).toEqual(['b2.enc', 'b2.enc.sha256']);
    const enc = readFileSync(join(dir, 'b2.enc'));
    expect(enc.includes(Buffer.from('PGDMP'))).toBe(false); // nunca em claro
    expect(readFileSync(join(dir, 'b2.enc.sha256'), 'utf8')).toMatch(
      /^[0-9a-f]{64} {2}b2\.enc\n$/,
    );
    // Backup e sha so legiveis pelo dono (umask 077).
    expect(statSync(join(dir, 'b2.enc')).mode & 0o077).toBe(0);
    expect(statSync(join(dir, 'b2.enc.sha256')).mode & 0o077).toBe(0);
  });

  it('a senha nunca vai em argumento de linha de comando', () => {
    backup(join(dir, 'b3'));
    expect(log()).toContain('pg_dump -Fc');
    expect(log()).not.toContain(SENHA);
  });

  it('o arquivo decifra de volta com a senha certa e nao com a errada', () => {
    backup(join(dir, 'b4'));
    const abrir = (senha: string) =>
      spawnSync(
        'openssl',
        [
          'enc',
          '-d',
          '-aes-256-cbc',
          '-pbkdf2',
          '-iter',
          '600000',
          '-pass',
          'env:S',
          '-in',
          join(dir, 'b4.enc'),
        ],
        { env: { PATH: process.env.PATH, S: senha } },
      );
    expect(abrir(SENHA).stdout.toString()).toBe(DUMP_FALSO);
    expect(abrir(SENHA + 'x').status).not.toBe(0);
  });

  it('nao sobrescreve backup existente e nao deixa parcial quando o pg_dump falha', () => {
    writeFileSync(join(dir, 'b5.enc'), 'antigo');
    const r = backup(join(dir, 'b5'));
    expect(r.status).toBe(1);
    expect(readFileSync(join(dir, 'b5.enc'), 'utf8')).toBe('antigo');

    falso('pg_dump_ruim', 'echo parcial; exit 3');
    const ruim = rodar(BACKUP, [join(dir, 'b6')], {
      PRAXIS_BACKUP_SENHA: SENHA,
      PGDUMP_CMD: join(dir, 'pg_dump_ruim'),
    });
    expect(ruim.status).not.toBe(0);
    expect(readdirSync(dir).filter((f) => f.startsWith('b6'))).toEqual([]);
  });
});

describe('verificar-backup.sh (item 25, parte C)', () => {
  const novoBackup = (nome: string) => {
    expect(backup(join(dir, nome)).status).toBe(0);
    return join(dir, `${nome}.enc`);
  };
  const tmpVazio = () => readdirSync(tmpScripts);
  const nomesCriados = () =>
    [...log().matchAll(/CREATE DATABASE "(praxis_restore_[0-9a-f]+)"/g)].map(
      (m) => m[1],
    );
  const nomesApagados = () =>
    [
      ...log().matchAll(
        /DROP DATABASE IF EXISTS "(praxis_restore_[0-9a-f]+)"/g,
      ),
    ].map((m) => m[1]);

  it('confere sha, decifra, restaura em banco temporario e APAGA o banco e o arquivo decifrado', () => {
    const arq = novoBackup('v1');
    const r = verificar(arq);
    // Sem amostra cifrada (psql falso) nada foi provado: FALHOU, de proposito.
    expect(r.status).toBe(1);
    expect(r.saida).not.toContain('VERIFICACAO OK');
    expect(r.saida).toContain('sha256: OK');
    expect(r.saida).toContain('decifrar: OK');
    expect(r.saida).toContain('restaurar em banco temporario: OK');
    expect(r.saida).toContain('FALHOU');
    expect(nomesCriados()).toHaveLength(1);
    expect(nomesApagados()).toEqual(nomesCriados());
    expect(nomesCriados()[0]).not.toBe('praxis_psi');
    expect(tmpVazio()).toEqual([]);
  });

  it('pg_restore com erro: FALHOU e ainda assim apaga o banco temporario e o arquivo decifrado', () => {
    const arq = novoBackup('v2');
    const r = verificar(arq, { FAKE_RESTORE_EXIT: '1' });
    expect(r.status).toBe(1);
    expect(r.saida).toContain('FALHOU: pg_restore terminou com erro');
    expect(nomesApagados()).toEqual(nomesCriados());
    expect(nomesCriados()).toHaveLength(1);
    expect(tmpVazio()).toEqual([]);
  });

  it('um byte corrompido (sha antigo): FALHOU no sha256 e nem toca no banco', () => {
    const arq = novoBackup('v3');
    const b = readFileSync(arq);
    b[b.length - 1] ^= 0xff;
    writeFileSync(arq, b);
    const r = verificar(arq);
    expect(r.status).toBe(1);
    expect(r.saida).toContain('FALHOU: sha256 nao confere');
    expect(log()).not.toContain('CREATE DATABASE');
  });

  it('um byte corrompido com sha recalculado: FALHOU ao decifrar e nada fica para tras', () => {
    const arq = novoBackup('v4');
    const b = readFileSync(arq);
    b[b.length - 1] ^= 0xff;
    writeFileSync(arq, b);
    const hash = execFileSync('sha256sum', [arq], { encoding: 'utf8' }).split(
      ' ',
    )[0];
    writeFileSync(`${arq}.sha256`, `${hash}  v4.enc\n`);
    const r = verificar(arq);
    expect(r.status).toBe(1);
    expect(r.saida).toContain('FALHOU');
    expect(r.saida).not.toContain('VERIFICACAO OK');
    expect(nomesApagados()).toEqual(nomesCriados());
    expect(tmpVazio()).toEqual([]);
  });

  it('senha de backup errada ou curta: FALHOU', () => {
    const arq = novoBackup('v5');
    const errada = verificar(arq, { PRAXIS_BACKUP_SENHA: SENHA + 'x' });
    expect(errada.status).toBe(1);
    expect(errada.saida).toContain('FALHOU: nao consegui decifrar');
    const curta = verificar(arq, { PRAXIS_BACKUP_SENHA: 'curta' });
    expect(curta.status).toBe(1);
    expect(curta.saida).toContain('FALHOU');
    expect(log()).not.toContain('CREATE DATABASE');
  });

  it('sem .sha256 ao lado: FALHOU', () => {
    const arq = novoBackup('v6');
    rmSync(`${arq}.sha256`);
    const r = verificar(arq);
    expect(r.status).toBe(1);
    expect(r.saida).toContain('FALHOU: sha256 ausente');
  });
});
