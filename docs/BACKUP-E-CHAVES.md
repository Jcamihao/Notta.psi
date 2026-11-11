# Backup e chaves mestras (item 25)

Este guia e para o dono. Ele diz o que guardar, como fazer backup, como provar que o backup restaura e como trocar a chave mestra sem parar o sistema.

## 1. O que e a chave mestra e por que ela importa

- A **chave mestra** (`NOTTA_MASTER_KEY`, ou o conjunto `NOTTA_MASTER_KEYS`) cifra todo o conteudo clinico: nome, contato, nascimento, texto dos documentos, previas da IA.
- **Perder a chave = perder todos os dados cifrados, para sempre.** Nao existe recuperacao. O banco sozinho nao serve de nada sem ela.
- A **senha de backup** (`NOTTA_BACKUP_SENHA`) e OUTRA coisa. Ela so abre o arquivo de backup. Nunca use uma no lugar da outra.

## 2. Onde guardar cada coisa

| Item | Onde guardar | Onde NUNCA guardar |
|---|---|---|
| Chave mestra | Gerenciador de senhas ou secret manager, e uma copia offline (papel ou pendrive guardado em outro lugar) | Repositorio, chat, servidor do banco, mesmo servidor do backup |
| Senha de backup | Gerenciador de senhas, em lugar diferente da chave | Mesmo arquivo da chave, mesmo arquivo do backup |
| Arquivo de backup (`.enc`) | Fora do servidor de producao (ex.: armazenamento de objetos), em lugar diferente das chaves | Repositorio |

Regra: **backup e chave nunca no mesmo lugar.** Quem so tem o backup nao le nada. Quem so tem a chave nao tem os dados.

## 3. Gerar uma chave mestra

Na raiz do backend:

```bash
npm run -s chave:gerar
```

- Imprime uma chave de 64 caracteres hex e nada mais. O `-s` evita que o npm imprima o cabecalho junto.
- Copie direto para o cofre. Nao cole em chat, nao salve em arquivo do repositorio, nao registre em log.

## 4. Fazer backup

Pre-requisitos: `pg_dump` (ou o comando que o acessa) e `openssl` 1.1.1 ou mais novo.

```bash
cd backend
export NOTTA_BACKUP_SENHA='<senha de backup, 24 caracteres ou mais>'
npm run backup -- /caminho/seguro/notta-AAAA-MM-DD
```

- Gera `notta-AAAA-MM-DD.enc` e `notta-AAAA-MM-DD.enc.sha256`. Os dois vao juntos.
- O dump e cifrado com AES-256 antes de tocar o disco. Nunca fica um dump em claro no disco.
- Falha se a senha tiver menos de 24 caracteres ou se o arquivo ja existir. Nunca sobrescreve.
- Para outro banco, `BACKUP_BANCO=<nome>`. Para acessar o banco por outro comando, `PGDUMP_CMD="<comando>"`. A credencial do banco vem de `PGUSER`/`PGPASSWORD`/`PGHOST` ou do `.pgpass`, nunca do comando.

Nesta maquina (banco no container Docker):

```bash
export PGDUMP_CMD="docker exec -i nottapsi-postgres-1 pg_dump -U postgres"
```

## 5. Verificar que o backup restaura (faca ao menos uma vez por mes)

Um backup que nunca foi restaurado e so uma esperanca. Este teste prova que o arquivo, a senha de backup e a chave mestra formam um par que funciona.

```bash
cd backend
export NOTTA_BACKUP_SENHA='<a mesma senha do backup>'
export NOTTA_MASTER_KEY='<a chave mestra atual>'    # ou NOTTA_MASTER_KEYS + NOTTA_MASTER_KEY_ATUAL
npm run verificar:backup -- /caminho/seguro/notta-AAAA-MM-DD.enc
```

O que ele faz, nesta ordem:

1. Confere o sha256 contra o `.enc.sha256`.
2. Decifra o arquivo com a senha de backup.
3. Restaura num banco temporario `notta_restore_<aleatorio>` (nunca no banco real).
4. Conta as linhas de cada tabela.
5. Decifra uma amostra de cada coluna cifrada com a chave do ambiente.
6. Apaga o banco temporario e o arquivo decifrado, mesmo se algo falhar (o arquivo decifrado fica numa pasta temporaria so sua, nunca no lugar do backup).

Resultado: uma linha `VERIFICACAO OK` ou `FALHOU: <motivo>`. Nunca mostra dado clinico, nem chave.

Como ler o resultado:

- `FALHOU: sha256 nao confere`: arquivo alterado ou corrompido. Nao use este backup.
- `FALHOU: nao consegui decifrar`: senha de backup errada, ou arquivo corrompido.
- `FALHOU: amostra nao decifrou`: a chave do ambiente nao e a chave dos dados. **Confira a chave antes de qualquer outra coisa.** Sem ela, o backup nao serve.
- `FALHOU: nenhuma coluna cifrada com dado`: banco vazio. Nada foi provado.

Depois de uma rotacao, a chave do ambiente tem que ser a lista (`NOTTA_MASTER_KEYS` + `NOTTA_MASTER_KEY_ATUAL`), com todas as chaves que ainda cifram algo naquele backup. Um backup anterior a recifragem precisa da `k1`; um posterior, da `k2`.

Nesta maquina:

```bash
export PGRESTORE_CMD="docker exec -i nottapsi-postgres-1 pg_restore -U postgres"
export PSQL_CMD="docker exec -i nottapsi-postgres-1 psql -U postgres -v ON_ERROR_STOP=1"
```

Ja testado nesta maquina (2026-11-06): backup e verificacao OK com uma fixture de dados cifrados; corrupcao de um byte, senha errada e chave errada FALHARAM como deveriam.

### Restaurar de verdade (desastre)

A verificacao acima nao substitui a restauracao real. Passos (testados nesta maquina em 2026-11-06, num banco descartavel):

1. Decifre: `openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -pass env:NOTTA_BACKUP_SENHA -in notta-AAAA-MM-DD.enc -out notta.dump` (a senha vai pela variavel de ambiente, nunca pelo comando).
2. No servidor novo, antes de restaurar, os papeis `notta_owner` e `notta_app` e o banco vazio precisam existir (as policies e os donos das tabelas apontam para eles). Em desenvolvimento: `docker/initdb/01-roles.sql`.
3. Restaure: `pg_restore -d <banco vazio> notta.dump`.
4. Apague `notta.dump`: o dump decifrado tem tudo o que estava no banco e nao pode ficar no servidor.
5. Suba o sistema com as chaves mestras certas (`NOTTA_MASTER_KEYS`/`NOTTA_MASTER_KEY_ATUAL` ou `NOTTA_MASTER_KEY`). Sem elas o sistema nem sobe (o boot falha de proposito); com a chave errada, nada cifrado abre.

## 6. Rotacionar a chave mestra (sem parar o sistema)

Regra de ouro: **nunca remova uma chave antiga antes de recifrar tudo que ela cifrou.**

1. **Gere a nova chave**: `npm run -s chave:gerar`. Guarde no cofre. Use o nome `k2` (ou o proximo numero livre).
2. **Suba o sistema com as duas chaves** e a nova como atual:
   ```
   NOTTA_MASTER_KEYS=k1:<chave antiga>,k2:<chave nova>
   NOTTA_MASTER_KEY_ATUAL=k2
   ```
   Remova `NOTTA_MASTER_KEY` (as duas juntas derrubam o boot). A partir daqui, dado novo ja sai com `k2`; dado antigo continua legivel com `k1`.
3. **Recifre os dados antigos**. Rode em `backend/`, depois de `npm run build`, com `DATABASE_URL_OWNER` apontando para o `notta_owner` e as mesmas `NOTTA_MASTER_KEYS`/`NOTTA_MASTER_KEY_ATUAL` do passo 2:
   ```
   npm run recifrar -- --dry-run     # so conta, nao grava
   npm run recifrar                  # recifra em lotes, pode ser interrompido e retomado
   ```
   Cada linha da saida e uma coluna: `lidas`, `recifradas`, `conflitos` (o valor mudou no meio, a proxima rodada pega) e `falhas` (valor que nao decifrou ou nao passou na conferencia: nada e gravado nele). O comando sai com codigo 1 se houver falha. Use `--clinica <id>` para uma clinica so e `--lote <n>` para mudar o tamanho do lote (padrao 200).
4. **Confira**: rode `npm run recifrar -- --dry-run` de novo. Tem que mostrar `recifradas=0` e `falhas=0` em todas as colunas. `falhas` diferente de zero = nao aposente a chave antiga.
5. **So agora aposente a `k1`**: tire `k1` de `NOTTA_MASTER_KEYS` (continue com `NOTTA_MASTER_KEYS=k2:<chave nova>` e `NOTTA_MASTER_KEY_ATUAL=k2`; nao volte para `NOTTA_MASTER_KEY` sozinha, ela sempre conta como `k1`). Guarde a chave antiga no cofre por mais tempo: backups feitos antes da recifragem ainda estao em `k1` e so abrem com ela.

Se algo der errado no meio: a chave antiga continua na lista. O sistema segue funcionando; nada se perde.

## 7. Limites honestos

- O `openssl` com senha prova que o arquivo nao foi alterado (pelo sha256) e que a senha confere, mas nao tem autenticacao propria do conteudo. Em producao, prefira `age` ou um KMS. Isso e tratado no item 56.
- Este guia nao agenda backup. Backup automatico (cron, retencao, copia para fora) e o item 56.
- `pg_dump`, `pg_restore` e `psql` precisam ser da mesma versao do servidor (ou mais nova): o `pg_dump` 16 recusa um servidor 18 ("server version mismatch"). Use os binarios do proprio servidor, por exemplo via `PGDUMP_CMD`.
- A verificacao de restauracao prova uma amostra por coluna, nao o banco inteiro linha a linha.
- A verificacao precisa da chave certa do ambiente. Se a chave nao bate, o backup esta bom mas a verificacao falha: isso e de proposito, para nao dar falsa seguranca.

## 8. Quanto tempo guardar (30 dias)

**Regra (decisao do dono, LGPD):** backup e apagado 30 dias depois de gravado. Dado excluido no app (exclusao de paciente, descarte de rascunho aos 7 dias) continua nos backups feitos antes da exclusao; o prazo limita ate quando.

Comando (em `backend/`; use caminho absoluto):

```bash
npm run podar-backups -- /caminho/seguro/backups --dry-run   # so lista o que apagaria
npm run podar-backups -- /caminho/seguro/backups             # apaga de verdade
```

- Padrao 30 dias. Outro prazo: `--dias N`, ou `NOTTA_BACKUP_RETENCAO_DIAS` (inteiro de 1 a 36500). Valor invalido (inclusive vazio) = sai com codigo 2 e nao apaga nada.
- Apaga o par `<nome>.enc` + `<nome>.enc.sha256` pela data de modificacao do `.enc`. So mexe em arquivos com esse padrao, so no nivel da pasta: subpastas, links e outros arquivos ficam.
- **Nunca apaga o backup mais recente da pasta**, mesmo vencido: se o agendamento parar, o ultimo bom continua la. Pasta com um backup so nao perde nada.
- Recusa `/`, a sua pasta pessoal e a raiz do repositorio. Saida: so nomes de arquivo e contagens. Codigos: 0 ok, 1 erro de IO, 2 uso ou configuracao.

**Agendamento: ainda NAO instalado.** O agendamento entra no item 56. Exemplo de linha de cron para depois (todo dia, 03:17):

```
17 3 * * * cd /caminho/do/repo/backend && npm run -s podar-backups -- /caminho/seguro/backups >> /caminho/seguro/podar.log 2>&1
```

**Limites (leia):**

- Backup feito antes de uma exclusao guarda o dado antigo ate vencer. Com 30 dias, dado excluido pode continuar nos backups por ate 30 dias depois da exclusao.
- Nao ha arquivamento de WAL no projeto. Se ele for ligado no futuro, o WAL precisa do mesmo prazo de 30 dias.
- Copias fora do servidor (disco do dono, nuvem) nao sao podadas por este comando: precisam seguir o mesmo prazo na mao.
- A data usada e a de modificacao. Copia feita com `cp` sem `-p` ganha data nova e fica mais tempo do que deveria: use `cp -p`.
- A poda apaga arquivos de backup. Nao apaga nada de dentro do banco; o banco segue a regra de retencao de rascunhos (`docs/ACESSO.md`).
