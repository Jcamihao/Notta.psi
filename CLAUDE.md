## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).

## Regras de trabalho do praxis.psi

- Spec: `docs/superpowers/specs/2026-09-27-nucleo-clinico-design.md`. Plano (fonte da ordem das tarefas): `docs/superpowers/plans/2026-09-27-nucleo-clinico-plan.md`.
- Respostas em modo caveman (curtas, sem cerimônia).
- Graphify: ao terminar cada tarefa do plano, rodar `graphify update .` antes do commit. Nunca rodar dois `graphify update` em paralelo. Os hooks em `.claude/settings.json` só consultam o grafo antes de buscas e leituras; eles não reconstroem o grafo sozinhos.
- Design de tela: usar a skill `impeccable` para as telas do app (psicólogo). Usar `design-taste-frontend` só para landing page e site de marketing, porque a própria skill diz que não serve para dashboards e telas de app. Não usar `frontend-design`.
- Ponytail: aplicar a skill `ponytail` ao escrever código e rodar `ponytail-review` no diff de cada tarefa antes do commit. Ponytail não pode derrubar decisões já aprovadas no spec (RLS com FORCE, criptografia por clínica, anonimização antes da IA, aprovação humana obrigatória); ele vale para todo o resto.
- Fim de cada feature da lista (`docs/FEATURES.md`): ensinar ao dono como usar, o que foi adicionado e como funciona (passos curtos, comandos que rodei de verdade), antes do fechamento Lista, Recomendação, Próximo passo.
- Fase 1 em diante: subagentes implementam; ao voltarem, eu reviso tudo com `ponytail-review` e rodo `graphify update .` (nunca dois em paralelo). Atualizar os checkboxes de `docs/FEATURES.md` a cada item verificado.
- Banco de desenvolvimento e testes: `docker compose up -d` (Postgres 16, porta 5436, roles `praxis_owner`/`praxis_app` criados por `docker/initdb/01-roles.sql`); migrations: `DATABASE_URL_OWNER=... npx prisma migrate deploy` em `backend/`. O Postgres embutido em `~/.cache/praxis-pgtool` virou plano B (mesma porta: nao rodar os dois).
- Visual do front: `docs/DESIGN-SYSTEM.md` (design system "intelly" entregue pelo dono em 2026-10-31) e a fonte; substitui a identidade verde-petroleo da Fase 1. Fonte DM Sans auto-hospedada, icones Lucide por npm, nada de CDN.
- Modelos dos subagentes (pedido do dono, 2026-11-05, vale a partir daqui): o subagente que DESENVOLVE (escreve codigo e testes) usa `model: "haiku"`; o subagente de REVISAO E CORRECAO usa `model: "sonnet"`; opus so se o dono pedir. Fluxo por item: dev (haiku) -> revisao e correcao (sonnet: le o diff inteiro, roda todos os gates e os mutantes, CORRIGE o que achar e relata) -> minha conferencia por amostra. Um subagente por vez (sem paralelo, para nao estourar o limite de 5 h) e uma rodada de e2e por item; repetir so se falhar. Em item de seguranca (RLS, criptografia, auth, sessao) o revisor sonnet e obrigatorio e os mutantes do contrato sao dele. Cada agente recebe o brief completo e o contrato; nunca contexto implicito.
- Conferencia por amostra: leio o diff, rodo build/lint/testes uma vez; integracao real no navegador e mutantes so quando o item mexe em auth, RLS ou criptografia.
- Graphify primeiro, sempre: `graphify query`/`explain`/`path` antes de Glob/Grep/Read exploratorio, tanto eu quanto os subagentes (colocar isso em todo brief).
