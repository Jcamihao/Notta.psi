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
6. Apaga o banco temporario e o arquivo decifrado, mesmo se algo falhar.

Resultado: uma linha `VERIFICACAO OK` ou `FALHOU: <motivo>`. Nunca mostra dado clinico, nem chave.

Como ler o resultado:

- `FALHOU: sha256 nao confere`: arquivo alterado ou corrompido. Nao use este backup.
- `FALHOU: nao consegui decifrar`: senha de backup errada, ou arquivo corrompido.
- `FALHOU: amostra nao decifrou`: a chave do ambiente nao e a chave dos dados. **Confira a chave antes de qualquer outra coisa.** Sem ela, o backup nao serve.
- `FALHOU: nenhuma coluna cifrada com dado`: banco vazio. Nada foi provado.

Nesta maquina:

```bash
export PGRESTORE_CMD="docker exec -i nottapsi-postgres-1 pg_restore -U postgres"
export PSQL_CMD="docker exec -i nottapsi-postgres-1 psql -U postgres -v ON_ERROR_STOP=1"
```

Ja testado nesta maquina (2026-11-06): backup e verificacao OK com uma fixture de dados cifrados; corrupcao de um byte, senha errada e chave errada FALHARAM como deveriam.

## 6. Rotacionar a chave mestra (sem parar o sistema)

Regra de ouro: **nunca remova uma chave antiga antes de recifrar tudo que ela cifrou.**

1. **Gere a nova chave**: `npm run -s chave:gerar`. Guarde no cofre. Use o nome `k2` (ou o proximo numero livre).
2. **Suba o sistema com as duas chaves** e a nova como atual:
   ```
   NOTTA_MASTER_KEYS=k1:<chave antiga>,k2:<chave nova>
   NOTTA_MASTER_KEY_ATUAL=k2
   ```
   Remova `NOTTA_MASTER_KEY` (as duas juntas derrubam o boot). A partir daqui, dado novo ja sai com `k2`; dado antigo continua legivel com `k1`.
3. **Recifre os dados antigos** (quando o comando `npm run recifrar` existir; ainda nao existe, e o proximo item da task):
   ```
   npm run recifrar -- --dry-run     # so conta, nao grava
   npm run recifrar                  # recifra em lotes, pode ser interrompido e retomado
   ```
4. **Confira**: o dry-run seguinte tem que mostrar zero linhas a recifrar.
5. **So agora aposente a `k1`**: tire `k1` de `NOTTA_MASTER_KEYS`. Guarde a chave antiga no cofre por mais tempo (backups antigos ainda dependem dela).

Se algo der errado no meio: a chave antiga continua na lista. O sistema segue funcionando; nada se perde.

## 7. Limites honestos

- O `openssl` com senha prova que o arquivo nao foi alterado (pelo sha256) e que a senha confere, mas nao tem autenticacao propria do conteudo. Em producao, prefira `age` ou um KMS. Isso e tratado no item 56.
- Este guia nao agenda backup. Backup automatico (cron, retencao, copia para fora) e o item 56.
- A verificacao de restauracao prova uma amostra por coluna, nao o banco inteiro linha a linha.
- A verificacao precisa da chave certa do ambiente. Se a chave nao bate, o backup esta bom mas a verificacao falha: isso e de proposito, para nao dar falsa seguranca.
