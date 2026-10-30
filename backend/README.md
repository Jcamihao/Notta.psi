# Notta.psi backend

NestJS 11 + Prisma 6 + Postgres.

## Pre-requisitos
- Node 20, npm 10
- Postgres 16 com os papeis `notta_owner` e `notta_app` (senhas SO de desenvolvimento)

## Banco local
- Docker: `docker compose up -d` na raiz do repo (porta 5436, roda `docker/initdb/01-roles.sql` no 1o start).
- Sem Docker: Postgres embutido em `~/.cache/notta-pgtool` (`./restart.sh`, ver `README.txt` la).

## Rodar
```bash
cd backend
npm install
cp .env.example .env            # e exporte as variaveis (o backend nao le .env sozinho)
export DATABASE_URL=postgresql://notta_app:notta_app@localhost:5436/notta_psi
export DATABASE_URL_OWNER=postgresql://notta_owner:notta_owner@localhost:5436/notta_psi
npm run db:generate
npm run db:migrate              # sem migrations ainda: "No migration found"
npm run start:dev
curl localhost:3000/saude       # {"status":"ok"}
```

## Testes
```bash
npm test                        # unitarios (sem banco)
npm run test:e2e                # exige DATABASE_URL, falha alto sem ela
npm run lint && npm run format:check && npm run build
```

## Variaveis
Ver `.env.example` (PORT, DATABASE_URL, DATABASE_URL_OWNER, NOTTA_TRUST_PROXY, NOTTA_MASTER_KEY, NOTTA_JWT_SECRET).
Obrigatoria no boot hoje: so `DATABASE_URL`. Cada modulo novo valida a propria env.
