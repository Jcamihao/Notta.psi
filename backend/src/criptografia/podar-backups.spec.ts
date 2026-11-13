import { spawnSync } from 'node:child_process';
import {
  existsSync,
  lutimesSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Testa podar-backups.sh de verdade (bash + stat + rm), em pasta temporaria.
// Envelhecimento via fs.utimesSync (mtime). Nada aqui toca o banco nem o backup real.
const PODAR = join(__dirname, '../../scripts/podar-backups.sh');
const RAIZ_REPO = join(__dirname, '../../..');
const DIA = 86400;
const CONTEUDO = 'CONTEUDO-SECRETO-DE-TESTE-nao-pode-aparecer';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'podar-spec-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

// Cria um arquivo com conteudo fixo e data de modificacao `diasAtras` atras.
function arquivo(nome: string, diasAtras: number, conteudo = CONTEUDO) {
  const f = join(dir, nome);
  writeFileSync(f, conteudo);
  const t = (Date.now() - diasAtras * DIA * 1000) / 1000;
  utimesSync(f, t, t);
  return f;
}

// Par de backup: .enc e .enc.sha256 com a mesma idade.
function par(nome: string, diasAtras: number) {
  arquivo(`${nome}.enc`, diasAtras);
  arquivo(`${nome}.enc.sha256`, diasAtras, `hash  ${nome}.enc\n`);
}

function rodar(args: string[], env: Record<string, string> = {}, cwd = dir) {
  const r = spawnSync('bash', [PODAR, ...args], {
    cwd,
    encoding: 'utf8',
    env: { PATH: process.env.PATH, HOME: join(dir, 'home'), ...env },
  });
  return { status: r.status, saida: `${r.stdout}${r.stderr}` };
}

const existe = (nome: string) => existsSync(join(dir, nome));
const nomes = () => readdirSync(dir).sort();

describe('podar-backups.sh (item 52B)', () => {
  it('apaga o par vencido (.enc + .sha256 juntos) e mantem o recente', () => {
    par('velho', 40);
    par('novo', 1);
    const r = rodar([dir]);
    expect(r.status).toBe(0);
    expect(nomes()).toEqual(['novo.enc', 'novo.enc.sha256']);
    expect(r.saida).toContain('apagado: velho.enc');
    expect(r.saida).toContain('apagado: velho.enc.sha256');
  });

  it('padrao de 30 dias: 29 dias fica, 31 dias sai', () => {
    par('quase', 29);
    par('vencido', 31);
    par('novo', 1);
    rodar([dir]);
    expect(nomes()).toEqual([
      'novo.enc',
      'novo.enc.sha256',
      'quase.enc',
      'quase.enc.sha256',
    ]);
  });

  it('mantem o backup mais recente mesmo vencido, e apaga os outros vencidos', () => {
    par('mais-velho', 90);
    par('mais-recente-vencido', 40);
    const r = rodar([dir]);
    expect(r.status).toBe(0);
    expect(nomes()).toEqual([
      'mais-recente-vencido.enc',
      'mais-recente-vencido.enc.sha256',
    ]);
    expect(r.saida).toContain(
      'mantido (mais recente, nunca apagado): mais-recente-vencido.enc',
    );
  });

  it('pasta com um unico backup vencido nao apaga nada', () => {
    par('unico', 400);
    const r = rodar([dir]);
    expect(r.status).toBe(0);
    expect(nomes()).toEqual(['unico.enc', 'unico.enc.sha256']);
  });

  it('nao apaga .sha256 orfao (sem .enc) e nao apaga .enc recente so por ter .sha256 velho', () => {
    arquivo('sobra.enc.sha256', 40, 'hash  sobra.enc\n'); // orfao vencido: fica
    par('novo', 1);
    arquivo('novo-sem-hash.enc', 1); // recente sem .sha256: fica
    rodar([dir]);
    expect(existe('sobra.enc.sha256')).toBe(true);
    expect(existe('novo.enc')).toBe(true);
    expect(existe('novo-sem-hash.enc')).toBe(true);
  });

  it('apaga .enc vencido mesmo sem .sha256 ao lado (o dado sai)', () => {
    arquivo('velho-sem-hash.enc', 40);
    par('novo', 1);
    rodar([dir]);
    expect(existe('velho-sem-hash.enc')).toBe(false);
    expect(existe('novo.enc')).toBe(true);
  });

  it('ignora o que nao casa o padrao: txt, .partial, subpasta, link simbolico e pasta com nome .enc', () => {
    par('novo', 1);
    arquivo('notas.txt', 100);
    arquivo('x.enc.partial', 100);
    arquivo('x.enc.sha256.bak', 100);
    const sub = join(dir, 'sub');
    mkdirSync(sub);
    const dentro = join(sub, 'dentro.enc');
    writeFileSync(dentro, CONTEUDO);
    utimesSync(
      dentro,
      Date.now() / 1000 - 100 * DIA,
      Date.now() / 1000 - 100 * DIA,
    );
    mkdirSync(join(dir, 'pasta.enc'));
    const alvo = join(dir, 'alvo-externo.dat');
    writeFileSync(alvo, CONTEUDO);
    utimesSync(
      alvo,
      Date.now() / 1000 - 100 * DIA,
      Date.now() / 1000 - 100 * DIA,
    );
    symlinkSync(alvo, join(dir, 'link.enc'));

    const r = rodar([dir]);
    expect(r.status).toBe(0);
    expect(existe('notas.txt')).toBe(true);
    expect(existe('x.enc.partial')).toBe(true);
    expect(existe('x.enc.sha256.bak')).toBe(true);
    expect(existsSync(dentro)).toBe(true);
    expect(existe('pasta.enc')).toBe(true);
    expect(lstatSync(join(dir, 'link.enc')).isSymbolicLink()).toBe(true);
    expect(existsSync(alvo)).toBe(true);
  });

  it('--dry-run lista o que apagaria e nao apaga nada', () => {
    par('velho', 40);
    par('novo', 1);
    const antes = nomes();
    const r = rodar([dir, '--dry-run']);
    expect(r.status).toBe(0);
    expect(nomes()).toEqual(antes);
    expect(r.saida).toContain('apagaria: velho.enc e velho.enc.sha256');
    expect(r.saida).toContain('Nada foi apagado');
  });

  it('--dias sobrepoe a env, e a env vale sem --dias', () => {
    par('velho', 40);
    par('novo', 1);
    // env 60: 40 dias ainda nao venceu
    rodar([dir], { PRAXIS_BACKUP_RETENCAO_DIAS: '60' });
    expect(existe('velho.enc')).toBe(true);
    // env 60 mas --dias 30: venceu
    rodar([dir, '--dias', '30'], { PRAXIS_BACKUP_RETENCAO_DIAS: '60' });
    expect(existe('velho.enc')).toBe(false);
  });

  it('aceita --dias=N e a env sozinha', () => {
    par('velho', 10);
    par('novo', 1);
    rodar([dir, '--dias=5']);
    expect(existe('velho.enc')).toBe(false);
    par('velho2', 10);
    rodar([dir], { PRAXIS_BACKUP_RETENCAO_DIAS: '15' });
    expect(existe('velho2.enc')).toBe(true);
  });

  it.each(['0', '-1', 'abc', '', '1.5', '36501', '+5', ' 5'])(
    'valor de retencao invalido (%p) na env: exit 2 e nada apagado',
    (valor) => {
      par('velho', 400);
      par('novo', 1);
      const r = rodar([dir], { PRAXIS_BACKUP_RETENCAO_DIAS: valor });
      expect(r.status).toBe(2);
      expect(r.saida).toContain('FALHOU');
      expect(existe('velho.enc')).toBe(true);
    },
  );

  it.each(['0', '-1', 'abc', '', '1.5'])(
    '--dias invalido (%p): exit 2 e nada apagado',
    (valor) => {
      par('velho', 400);
      par('novo', 1);
      const r = rodar([dir, '--dias', valor]);
      expect(r.status).toBe(2);
      expect(existe('velho.enc')).toBe(true);
    },
  );

  it('--dias sem valor e opcao desconhecida: exit 2', () => {
    par('velho', 400);
    par('novo', 1);
    expect(rodar([dir, '--dias']).status).toBe(2);
    expect(rodar([dir, '--apagar-tudo']).status).toBe(2);
    expect(existe('velho.enc')).toBe(true);
  });

  it('sem pasta, duas pastas, pasta inexistente, arquivo no lugar de pasta: exit 2', () => {
    par('velho', 400);
    par('novo', 1);
    expect(rodar([]).status).toBe(2);
    expect(rodar([dir, dir]).status).toBe(2);
    expect(rodar([join(dir, 'nao-existe')]).status).toBe(2);
    expect(rodar([join(dir, 'novo.enc')]).status).toBe(2);
    expect(existe('velho.enc')).toBe(true);
  });

  it('recusa `/`, a pasta pessoal (HOME) e a raiz do repositorio: exit 2', () => {
    par('velho', 400);
    par('novo', 1);
    mkdirSync(join(dir, 'home'));
    expect(rodar(['/']).status).toBe(2);
    expect(rodar([join(dir, 'home')]).status).toBe(2);
    expect(rodar([RAIZ_REPO]).status).toBe(2);
    // a pasta de teste continua intacta
    expect(existe('velho.enc')).toBe(true);
  });

  it('aceita caminho relativo existente', () => {
    par('velho', 40);
    par('novo', 1);
    const r = rodar(['.'], {}, dir);
    expect(r.status).toBe(0);
    expect(existe('velho.enc')).toBe(false);
  });

  it('a saida mostra nomes e contagens, nunca o conteudo', () => {
    par('velho', 40);
    par('novo', 1);
    const real = rodar([dir]);
    expect(real.saida).not.toContain(CONTEUDO);
    par('velho2', 40);
    const simulado = rodar([dir, '--dry-run']);
    expect(simulado.saida).not.toContain(CONTEUDO);
    expect(readFileSync(join(dir, 'novo.enc'), 'utf8')).toBe(CONTEUDO);
  });

  it('e idempotente: segunda rodada nao apaga mais nada', () => {
    par('velho', 40);
    par('novo', 1);
    rodar([dir]);
    const depois = nomes();
    const r = rodar([dir]);
    expect(r.status).toBe(0);
    expect(nomes()).toEqual(depois);
    expect(r.saida).toContain('0 backup(s) vencido(s) apagado(s)');
  });

  it('nome com espaco, aspas, -inicial e curinga: apaga so o vencido certo', () => {
    par('com espaco', 40);
    par('-rf', 40);
    par('aspa\'dupla"', 40);
    par('estrela*', 40);
    par('interroga?', 40);
    par('novo', 1);
    arquivo('notas.txt', 100);
    const r = rodar([dir]);
    expect(r.status).toBe(0);
    expect(nomes()).toEqual(['notas.txt', 'novo.enc', 'novo.enc.sha256']);
  });

  it('pasta com espaco no caminho e caminho relativo com ..', () => {
    const base = join(dir, 'minha pasta');
    mkdirSync(base);
    const f = join(base, 'v.enc');
    writeFileSync(f, CONTEUDO);
    utimesSync(f, Date.now() / 1000 - 40 * DIA, Date.now() / 1000 - 40 * DIA);
    const n = join(base, 'n.enc');
    writeFileSync(n, CONTEUDO);
    const r = rodar(['./minha pasta/../minha pasta'], {}, dir);
    expect(r.status).toBe(0);
    expect(existsSync(f)).toBe(false);
    expect(existsSync(n)).toBe(true);
  });

  it('empate de mtime: nenhum dos empatados no topo e apagado', () => {
    par('a', 40);
    par('b', 40);
    const antes = nomes();
    const r = rodar([dir]);
    expect(r.status).toBe(0);
    expect(nomes()).toEqual(antes);
  });

  it('mtime no futuro: nao conta como o mais recente e nao e apagado', () => {
    par('futuro', -5);
    par('real-vencido', 40);
    par('mais-velho', 90);
    const r = rodar([dir]);
    expect(r.status).toBe(0);
    expect(nomes()).toEqual([
      'futuro.enc',
      'futuro.enc.sha256',
      'real-vencido.enc',
      'real-vencido.enc.sha256',
    ]);
  });

  it('so arquivos no futuro: nada e apagado', () => {
    par('f1', -5);
    par('f2', -9);
    const antes = nomes();
    expect(rodar([dir]).status).toBe(0);
    expect(nomes()).toEqual(antes);
  });

  it.each(['/', 'HOME'])(
    'link simbolico para %s e recusado depois de resolvido',
    (alvo) => {
      par('velho', 400);
      par('novo', 1);
      mkdirSync(join(dir, 'home'));
      const link = join(dir, 'atalho');
      symlinkSync(alvo === 'HOME' ? join(dir, 'home') : '/', link);
      const r = rodar([link]);
      expect(r.status).toBe(2);
      expect(r.saida).toContain('recusada');
      expect(existe('velho.enc')).toBe(true);
    },
  );

  it('link simbolico para a raiz do repositorio e recusado', () => {
    const link = join(dir, 'atalho-repo');
    symlinkSync(RAIZ_REPO, link);
    const r = rodar([link]);
    expect(r.status).toBe(2);
    expect(r.saida).toContain('recusada');
  });

  it('link simbolico para uma pasta de backups valida poda a pasta real', () => {
    const real = join(dir, 'real');
    mkdirSync(real);
    const v = join(real, 'v.enc');
    const n = join(real, 'n.enc');
    writeFileSync(v, CONTEUDO);
    writeFileSync(n, CONTEUDO);
    utimesSync(v, Date.now() / 1000 - 40 * DIA, Date.now() / 1000 - 40 * DIA);
    symlinkSync(real, join(dir, 'atalho'));
    expect(rodar([join(dir, 'atalho')]).status).toBe(0);
    expect(existsSync(v)).toBe(false);
    expect(existsSync(n)).toBe(true);
  });

  it('--dias repetido vale o ultimo; --dias sem valor antes de outra opcao e exit 2', () => {
    par('velho', 10);
    par('novo', 1);
    expect(rodar([dir, '--dias', '30', '--dias', '5']).status).toBe(0);
    expect(existe('velho.enc')).toBe(false);
    par('velho2', 10);
    expect(rodar([dir, '--dias', '--dry-run']).status).toBe(2);
    expect(existe('velho2.enc')).toBe(true);
  });

  it('opcoes antes da pasta funcionam; nada fora da pasta alvo e tocado', () => {
    const alvo = join(dir, 'alvo');
    const vizinha = join(dir, 'vizinha');
    mkdirSync(alvo);
    mkdirSync(vizinha);
    for (const p of [alvo, vizinha]) {
      for (const [n, d] of [
        ['v.enc', 40],
        ['n.enc', 1],
      ] as const) {
        const f = join(p, n);
        writeFileSync(f, CONTEUDO);
        const t = Date.now() / 1000 - d * DIA;
        utimesSync(f, t, t);
      }
    }
    const r = rodar(['--dry-run', '--dias', '30', alvo]);
    expect(r.status).toBe(0);
    expect(rodar(['--dias', '30', alvo]).status).toBe(0);
    expect(readdirSync(alvo).sort()).toEqual(['n.enc']);
    expect(readdirSync(vizinha).sort()).toEqual(['n.enc', 'v.enc']);
  });

  it('link simbolico .enc, velho ou novo, nao e apagado e nao rouba o lugar do mais recente', () => {
    par('vencido', 40);
    par('mais-velho', 90);
    const alvo = join(dir, 'alvo-externo.dat');
    writeFileSync(alvo, CONTEUDO);
    symlinkSync(alvo, join(dir, 'novo-link.enc')); // data do proprio link: agora
    symlinkSync(alvo, join(dir, 'velho-link.enc'));
    const t = Date.now() / 1000 - 100 * DIA;
    lutimesSync(join(dir, 'velho-link.enc'), t, t);
    const r = rodar([dir]);
    expect(r.status).toBe(0);
    expect(lstatSync(join(dir, 'novo-link.enc')).isSymbolicLink()).toBe(true);
    expect(lstatSync(join(dir, 'velho-link.enc')).isSymbolicLink()).toBe(true);
    expect(existsSync(alvo)).toBe(true);
    // o mais recente REAL (vencido) continua protegido; o mais velho sai
    expect(existe('vencido.enc')).toBe(true);
    expect(existe('mais-velho.enc')).toBe(false);
  });

  it('unidade da idade e dia (nao hora): 30 dias menos 1 hora fica, mais 1 hora sai', () => {
    arquivo('dentro.enc', 30 - 1 / 24);
    arquivo('fora.enc', 30 + 1 / 24);
    arquivo('novo.enc', 1);
    rodar([dir]);
    expect(existe('dentro.enc')).toBe(true);
    expect(existe('fora.enc')).toBe(false);
  });
});
