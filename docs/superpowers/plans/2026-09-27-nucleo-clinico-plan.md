# Notta.psi — Núcleo Clínico + Prontuário Assistido Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar o núcleo multi-clínica do Notta.psi: cadastro de clínica/psicólogo/paciente com consentimento, e o fluxo de rascunho de evolução/anamnese gerado por IA (via SelahIA), com isolamento entre clínicas, criptografia do conteúdo clínico e anonimização antes de qualquer chamada de IA.

**Architecture:** Backend único em NestJS + Prisma + PostgreSQL (monolito modular, sem microsserviços), em `Notta.psi/backend`. Isolamento entre clínicas via Row-Level Security no Postgres, ativado por uma variável de sessão (`app.current_clinica_id`) setada a cada transação através de um serviço `TenantPrismaService` — nenhuma consulta a dado de clínica roda fora desse mecanismo, nem mesmo a criação da própria clínica. A IA é acessada por um novo adapter `psicologia` no SelahIA existente, seguindo o padrão já usado pelos adapters `lumen`/`agilis`/`praiseapp` (controller com `InternalApiKeyGuard`, rota `v1/adapters/<app>/<feature>`). Autenticação: e-mail/senha com JWT por psicólogo (o spec não pede MFA; decisão de escopo mínimo, sem invenção além do spec).

**Tech Stack:** NestJS (versão atual do CLI, 11), Prisma 6 (fixo: o Prisma 7/8 muda a configuração do datasource e exige adapter; o plano usa o formato clássico), PostgreSQL 15+, `@nestjs/jwt`, `bcryptjs`, `class-validator`/`class-transformer`, Jest (testes), Node `crypto` nativo (HKDF + AES-256-GCM). SelahIA: mesma stack já usada pelos outros adapters.

**Spec:** `docs/superpowers/specs/2026-09-27-nucleo-clinico-design.md`

## Global Constraints

- Toda tabela de dado de clínica (`Psicologo`, `Paciente`, `Consentimento`, `DocumentoClinico`) tem `clinicaId` e Row-Level Security **com `FORCE ROW LEVEL SECURITY`** (spec §5) — sem o `FORCE`, o dono da tabela (o próprio usuário do banco da aplicação) ignora a política, e a proteção não existe de fato.
- Nenhuma consulta ou escrita a essas tabelas roda fora de `TenantPrismaService.run(clinicaId, fn)` — isso vale inclusive para a criação da primeira clínica/psicólogo (spec §5). **Exceções autorizadas (Tarefa 7), as únicas que usam o `PrismaService` global e chamam `set_config` fora de `TenantPrismaService`:** `ClinicasService.criarClinicaComPrimeiroPsicologo` (define `app.current_clinica_id` na mesma transação antes de escrever) e `AuthService.login` (define `app.login_email`, que só libera a leitura da linha com aquele e-mail pela política `login_lookup`). Qualquer outro uso deve ser tratado como defeito na revisão.
- Conteúdo clínico (`DocumentoClinico.conteudoCifrado`) é sempre cifrado com AES-256-GCM, com uma chave derivada por clínica a partir de `NOTTA_MASTER_KEY` via HKDF-SHA256 — a chave mestra nunca é gravada no banco (spec §6).
- Nenhum texto enviado ao SelahIA contém nome completo, CPF, telefone, e-mail ou endereço cadastrados do paciente, nem nomes de terceiros detectados (spec §7).
- Nenhum `DocumentoClinico` é criado com `status = APROVADO` sem uma chamada explícita do endpoint de aprovação (spec §8).
- O adapter novo no SelahIA segue exatamente o padrão dos adapters existentes: `@UseGuards(InternalApiKeyGuard)`, rota `v1/adapters/psicologia/rascunho`, chave de app própria em `SELAH_APP_KEYS` (spec §9).
- O usuário Postgres da aplicação (`notta_app`) nunca é superusuário nem `BYPASSRLS`: esses papéis ignoram RLS mesmo com `FORCE` (comportamento documentado do Postgres, não executado aqui). A Tarefa 5 tem um teste que trava isso.
- No Postgres, `id` e `clinicaId` são `text` (padrão do Prisma para `String`). As políticas de RLS comparam `text` com `text`, sem cast para `uuid`: `current_setting` pode devolver string vazia depois do `set_config` local, e `''::uuid` lança erro.
- Nome do app consumidor no SelahIA: `NottaPsiBack` (padrão `<App>Back` de `SELAH_APP_KEYS`), usado como nome da chave e em `X-Source-App`.
- Versionamento do SelahIA: todo commit bumpa a versão com `npm version <v> --no-git-tag-version`. Tarefa 1 → 2.6.1, Tarefa 2 → 2.6.2, Tarefa 3 → 2.7.0. A Tarefa 3 também cria `docs/releases/v2.7.0.md` no formato de `v2.6.0.md`.
- Dado real de paciente só depois de resolver o plano do Gemini. A nota da v2.6.0 do SelahIA diz que a chave gratuita pode ter o conteúdo usado pelo Google e lido por revisores humanos (fonte secundária), e que a cota é de 5 por minuto e 20 por dia, compartilhada por todos os apps. Com chave gratuita, só dado sintético. A decisão é do dono do projeto e fecha a pendência do spec §7 sobre os termos do provedor.
- Estado do SelahIA em 2026-10-28 (relatório do agente do SelahIA): master em 2.7.9, já no origin; **produção ainda roda 2.5.2, sem o adapter `psicologia`** (deploy parado, decisão do dono). A chave `NottaPsiBack` já existe, fora de qualquer repo (`~/.selah-keys/chaves-selah.env`, modo 0600); nunca copie por chat, peça ao dono. O limite por app do Selah é por **minuto**: não protege a cota diária (20) do Gemini gratuito, compartilhada com o Lumen; exija `NottaPsiBack:2` no deploy, sabendo que só reduz o risco. Contrato do adapter inalterado. O cliente não deve interpretar o texto das mensagens de erro do Selah, só o status HTTP.

## Review Focus

- **Consulta sem contexto de tenant:** uma leitura em `Paciente`/`DocumentoClinico` feita fora de `TenantPrismaService.run` deve retornar **zero linhas**, não um erro nem todas as linhas — é o que prova que o RLS protege mesmo se um desenvolvedor futuro esquecer o filtro de `clinicaId` no código. Teste na Tarefa 5.
- **Vazamento de identificador cadastrado para a IA:** a chamada HTTP feita ao SelahIA nunca deve conter, em bytes, o nome completo, CPF, telefone, e-mail ou endereço do paciente de teste. Teste na Tarefa 10.
- **Documento não aprovado exposto como aprovado:** um documento em `RASCUNHO_IA` não pode aparecer em uma listagem/consulta de documentos aprovados. Teste na Tarefa 11.
- **SelahIA indisponível não pode virar aprovação silenciosa:** se o SelahIA responder 429 ou erro de rede, o fluxo deve devolver um estado explícito de "IA indisponível" e nenhum `DocumentoClinico` pode ser criado ou alterado como se tivesse sido processado. Teste nas Tarefas 10 e 11.
- **Chave errada não decifra silenciosamente:** decifrar o conteúdo de uma clínica com a chave derivada de outra clínica deve lançar erro (falha de autenticação do AES-GCM), nunca devolver texto corrompido como se fosse válido. Teste na Tarefa 6.

---

## Parte A — SelahIA: novo adapter `psicologia`

### Task 1: Schemas e prompt do adapter `psicologia`

**Files:**
- Create: `SelahIA/src/adapters/psicologia/rascunho/rascunho-clinico.schemas.ts`
- Create: `SelahIA/src/adapters/psicologia/rascunho/rascunho-clinico.prompt.ts`
- Create: `SelahIA/src/adapters/psicologia/rascunho/dto/gerar-rascunho.dto.ts`
- Test: `SelahIA/src/adapters/psicologia/rascunho/rascunho-clinico.prompt.spec.ts`

**Interfaces:**
- Produces: `GerarRascunhoDto { tipoDocumento: 'evolucao' | 'anamnese'; abordagem: 'SISTEMICA'|'TCC'|'PSICANALISE'|'ACT'|'HUMANISTA'|'OUTRA'; textoAnonimizado: string }` (class-validator: `@IsIn` nas duas enums, `@IsString() @MaxLength(8000)` em `textoAnonimizado`).
- Produces: `interface RascunhoClinicoResponse { rascunho: string }`.
- Produces: `RASCUNHO_CLINICO_SCHEMA` (JSON Schema, `required: ['rascunho']`, `properties: { rascunho: { type: 'string' } }`, `additionalProperties: false`).
- Produces: `function validateRascunhoClinicoResponse(payload: unknown): RascunhoClinicoResponse` — lança `Error` se `payload.rascunho` não for string não vazia.
- Produces: `function buildRascunhoClinicoSystemInstruction(abordagem: GerarRascunhoDto['abordagem'], tipoDocumento: GerarRascunhoDto['tipoDocumento']): string` e `function buildRascunhoClinicoUserPrompt(dto: GerarRascunhoDto): string`.

- [ ] **Step 1: Write the failing test**

```typescript
describe('buildRascunhoClinicoSystemInstruction', () => {
  it('menciona a abordagem e o tipo de documento na instrução', () => {
    const instrucao = buildRascunhoClinicoSystemInstruction('TCC', 'evolucao');
    expect(instrucao).toContain('TCC');
    expect(instrucao).toContain('evolução');
  });
});

describe('validateRascunhoClinicoResponse', () => {
  it('aceita payload valido', () => {
    expect(validateRascunhoClinicoResponse({ rascunho: 'texto' })).toEqual({ rascunho: 'texto' });
  });

  it('rejeita rascunho vazio', () => {
    expect(() => validateRascunhoClinicoResponse({ rascunho: '' })).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest rascunho-clinico.prompt.spec.ts`
Expected: FAIL — módulos ainda não existem

- [ ] **Step 3: Implement the DTO, schema and prompt builders**

`buildRascunhoClinicoSystemInstruction` monta uma instrução em português orientando: "Você é Selah IA, apoio de registro clínico. Escreva **apenas** o rascunho de [evolução|anamnese], no estilo da abordagem [nome da abordagem por extenso]. Baseie-se só no texto fornecido, nunca invente fatos, e preserve os códigos entre colchetes exatamente como aparecem (ex.: [PACIENTE], [PESSOA_1]) — eles serão substituídos depois." A tabela de nome por extenso de cada abordagem (`SISTEMICA` → "terapia sistêmica", `TCC` → "terapia cognitivo-comportamental", `PSICANALISE` → "psicanálise", `ACT` → "terapia de aceitação e compromisso", `HUMANISTA` → "abordagem humanista", `OUTRA` → "abordagem geral") vive nesse arquivo. `buildRascunhoClinicoUserPrompt` retorna o `textoAnonimizado` do dto, com um cabeçalho curto indicando o tipo de documento.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest rascunho-clinico.prompt.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
npm version 2.6.1 --no-git-tag-version
git add package.json package-lock.json src/adapters/psicologia/rascunho/rascunho-clinico.schemas.ts src/adapters/psicologia/rascunho/rascunho-clinico.prompt.ts src/adapters/psicologia/rascunho/dto/gerar-rascunho.dto.ts src/adapters/psicologia/rascunho/rascunho-clinico.prompt.spec.ts
git commit -m "feat(psicologia): schemas e prompt do rascunho clinico"
```

---

### Task 2: Service do adapter `psicologia`

**Files:**
- Create: `SelahIA/src/adapters/psicologia/rascunho/rascunho-clinico.service.ts`
- Test: `SelahIA/src/adapters/psicologia/rascunho/rascunho-clinico.service.spec.ts`

**Interfaces:**
- Consumes: `LLM_PROVIDER_TOKEN` / `LlmProvider.generateStructured<T>` (`SelahIA/src/providers/llm-provider.interface.ts`), `RequestContextService` (`SelahIA/src/common/logging/request-context.service.ts`), tudo de Tarefa 1.
- Produces: `class RascunhoClinicoService { gerar(dto: GerarRascunhoDto): Promise<{ provider: string; version: string; model: string; generatedAt: string } & RascunhoClinicoResponse> }`.

- [ ] **Step 1: Write the failing test**

```typescript
describe('RascunhoClinicoService.gerar', () => {
  it('chama generateStructured com a instrucao da abordagem e valida a resposta', async () => {
    const llmProvider = { generateStructured: jest.fn().mockResolvedValue({
      data: { rascunho: 'Paciente relatou...' }, text: '{"rascunho":"Paciente relatou..."}', model: 'gemini-test', raw: {},
    }) };
    const service = new RascunhoClinicoService(llmProvider as any, { getRequestId: () => 'req-1' } as any);

    const result = await service.gerar({ tipoDocumento: 'evolucao', abordagem: 'TCC', textoAnonimizado: '[PACIENTE] relatou...' });

    expect(llmProvider.generateStructured).toHaveBeenCalledTimes(1);
    expect(result.rascunho).toBe('Paciente relatou...');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest rascunho-clinico.service.spec.ts`
Expected: FAIL — `RascunhoClinicoService` not defined

- [ ] **Step 3: Implement `RascunhoClinicoService`**

Segue o mesmo formato de `responseMeta` visto em `meal-photo.service.ts` (`provider`, `version` de `SELAH_PUBLIC_VERSION`, `model`, `generatedAt`). Chama `llmProvider.generateStructured({ systemInstruction: buildRascunhoClinicoSystemInstruction(...), userPrompt: buildRascunhoClinicoUserPrompt(dto), responseSchema: RASCUNHO_CLINICO_SCHEMA, validate: validateRascunhoClinicoResponse, temperature: 0.2, maxOutputTokens: 1500 })`. Loga início/fim com `requestId`, sem logar `dto.textoAnonimizado` nem trecho dele: só metadados (tamanho em caracteres, abordagem, tipo de documento), como `meal-photo.service.ts`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest rascunho-clinico.service.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
npm version 2.6.2 --no-git-tag-version
git add package.json package-lock.json src/adapters/psicologia/rascunho/rascunho-clinico.service.ts src/adapters/psicologia/rascunho/rascunho-clinico.service.spec.ts
git commit -m "feat(psicologia): service do rascunho clinico"
```

---

### Task 3: Controller, módulo e registro do adapter

**Files:**
- Create: `SelahIA/src/adapters/psicologia/rascunho/rascunho-clinico.controller.ts`
- Create: `SelahIA/src/adapters/psicologia/psicologia.module.ts`
- Modify: `SelahIA/src/app.module.ts` — importar `PsicologiaModule` (mesma linha em que `LumenModule`/`PraiseAppModule`/`AgilisModule` são importados)
- Modify: `SelahIA/.env.example` — acrescentar `NottaPsiBack:<chave>` à linha de exemplo de `SELAH_APP_KEYS`
- Modify: `SelahIA/package.json` e `SelahIA/package-lock.json` — versão 2.7.0
- Create: `SelahIA/docs/releases/v2.7.0.md` — nota de versão no formato de `v2.6.0.md`, com os passos de ativação (gerar chave com `openssl rand -hex 32`, acrescentar `NottaPsiBack:<chave>` em `SELAH_APP_KEYS`) e o aviso sobre o plano gratuito do Gemini
- Test: `SelahIA/test/psicologia-rascunho.e2e-spec.ts` (config `test/jest-e2e.json`, regex `.e2e-spec.ts$`, mesmo bootstrap de `test/app.e2e-spec.ts`)

**Interfaces:**
- Consumes: `RascunhoClinicoService` (Tarefa 2), `InternalApiKeyGuard` (`SelahIA/src/common/auth/internal-api-key.guard.ts`), `ProvidersModule`.
- Produces: rota `POST /v1/adapters/psicologia/rascunho/gerar`, protegida por `InternalApiKeyGuard`, corpo = `GerarRascunhoDto`, resposta = `RascunhoClinicoResponse` com metadados.

- [ ] **Step 1: Write the failing test**

```typescript
describe('POST /v1/adapters/psicologia/rascunho/gerar (e2e)', () => {
  const CHAVE = 'a'.repeat(32);
  const corpo = { tipoDocumento: 'evolucao', abordagem: 'TCC', textoAnonimizado: 'texto' };
  let app: INestApplication;

  beforeAll(async () => {
    process.env.SELAH_APP_KEYS = `NottaPsiBack:${CHAVE}`; // sem chaves configuradas o guard libera tudo fora de producao
    const moduleFixture = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(LLM_PROVIDER_TOKEN)
      .useValue({ generateStructured: jest.fn().mockResolvedValue({ data: { rascunho: 'ok' }, text: '{}', model: 'fake', raw: {} }) })
      .compile();
    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => { delete process.env.SELAH_APP_KEYS; await app.close(); });

  it('rejeita chamada sem x-selah-api-key valida', async () => {
    const response = await request(app.getHttpServer()).post('/v1/adapters/psicologia/rascunho/gerar').send(corpo);
    expect(response.status).toBe(401);
  });

  it('aceita a chave NottaPsiBack e devolve o rascunho', async () => {
    const response = await request(app.getHttpServer()).post('/v1/adapters/psicologia/rascunho/gerar')
      .set('x-selah-api-key', CHAVE).send(corpo);
    expect(response.status).toBe(200);
    expect(response.body.rascunho).toBe('ok');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:e2e -- psicologia-rascunho`
Expected: FAIL — rota não existe (404 em vez de 401)

- [ ] **Step 3: Implement `RascunhoClinicoController` e `PsicologiaModule`**

`RascunhoClinicoController`: `@UseGuards(InternalApiKeyGuard) @Controller('v1/adapters/psicologia/rascunho')`, método `@Post('gerar') @HttpCode(200) gerar(@Body() dto: GerarRascunhoDto)`, idêntico em forma a `MealPhotoController` (`SelahIA/src/adapters/balancogordura/meal-photo/meal-photo.controller.ts`). `PsicologiaModule`: `imports: [ProvidersModule], controllers: [RascunhoClinicoController], providers: [RascunhoClinicoService, InternalApiKeyGuard]`, no mesmo formato de `BalancoGorduraModule` (`SelahIA/src/adapters/balancogordura/balancogordura.module.ts`; a camada `capabilities/` não existe mais no SelahIA). Registrar `PsicologiaModule` em `app.module.ts`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:e2e -- psicologia-rascunho`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/adapters/psicologia src/app.module.ts .env.example test/psicologia-rascunho.e2e-spec.ts docs/releases/v2.7.0.md package.json package-lock.json
git commit -m "feat(psicologia): expor rota do adapter e registrar no modulo raiz"
```

---

## Parte B — Notta.psi: scaffold e núcleo do backend

### Task 4: Scaffold do backend, schema Prisma e primeira migração

**Files:**
- Create: `Notta.psi/backend/` (projeto NestJS via `nest new backend --package-manager npm --skip-git`)
- Create: `Notta.psi/backend/prisma/schema.prisma`
- Create: `Notta.psi/docker-compose.yml` (serviço `postgres:15` local, porta `5433:5432`, para não colidir com outros projetos da VPS; `POSTGRES_USER=postgres` é só o administrador do container; monta `./docker/initdb` em `/docker-entrypoint-initdb.d`)
- Create: `Notta.psi/docker/initdb/01-roles.sql` (cria o papel da aplicação, abaixo)
- Create: `Notta.psi/backend/.env.example`
- Test: `Notta.psi/backend/prisma/schema.prisma` validado por `npx prisma validate` (não é um teste de código; é a verificação deste passo)

**Interfaces:**
- Produces: modelos Prisma `Clinica`, `Psicologo`, `Paciente`, `Consentimento`, `DocumentoClinico` e enums `Abordagem`, `TipoDocumento`, `StatusDocumento`, exatamente como abaixo — todas as tarefas seguintes dependem destes nomes de campo.

- [ ] **Step 1: Scaffold e configuração**

```bash
cd Notta.psi
npx @nestjs/cli new backend --package-manager npm --skip-git
cd backend
npm install prisma@6 @prisma/client@6 @nestjs/jwt @nestjs/passport passport passport-jwt bcryptjs class-validator class-transformer
npm install -D @types/passport-jwt @types/bcryptjs
npx prisma init --datasource-provider postgresql
```

`.env.example` traz `DATABASE_URL="postgresql://notta_app:notta_app@localhost:5433/notta_psi"`, `NOTTA_MASTER_KEY=` (comentário: gerar com `openssl rand -hex 32`), `NOTTA_JWT_SECRET=`, `SELAH_BASE_URL=http://localhost:3010` (porta padrão do SelahIA, `main.ts`), `SELAH_API_KEY=`, `SELAH_SOURCE_APP=NottaPsiBack`.

`docker/initdb/01-roles.sql` (a imagem do Postgres cria `POSTGRES_USER` como superusuário, e superusuário ignora RLS; por isso a aplicação conecta com um papel próprio):

```sql
CREATE ROLE notta_app LOGIN PASSWORD 'notta_app' NOSUPERUSER NOBYPASSRLS CREATEDB;
CREATE DATABASE notta_psi OWNER notta_app;
```

`CREATEDB` existe só porque `prisma migrate dev` cria um shadow database. Como `notta_app` é dono das tabelas, o `FORCE ROW LEVEL SECURITY` da Tarefa 5 vale também para ele.

- [ ] **Step 2: Escrever `schema.prisma`**

```prisma
enum Abordagem {
  SISTEMICA
  TCC
  PSICANALISE
  ACT
  HUMANISTA
  OUTRA
}

enum TipoDocumento {
  EVOLUCAO
  ANAMNESE
}

enum StatusDocumento {
  RASCUNHO_BRUTO
  RASCUNHO_IA
  APROVADO
}

model Clinica {
  id         String      @id @default(uuid())
  nome       String
  createdAt  DateTime    @default(now())
  psicologos Psicologo[]
}

model Psicologo {
  id                  String             @id @default(uuid())
  clinicaId           String
  clinica             Clinica            @relation(fields: [clinicaId], references: [id])
  nome                String
  email               String             @unique
  senhaHash           String
  abordagemPadrao     Abordagem
  createdAt           DateTime           @default(now())
  pacientes           Paciente[]
  documentosAprovados DocumentoClinico[]

  @@unique([id, clinicaId])
}

model Paciente {
  id                String             @id @default(uuid())
  clinicaId         String
  psicologoId       String
  psicologo         Psicologo          @relation(fields: [psicologoId, clinicaId], references: [id, clinicaId], onDelete: Restrict, onUpdate: Restrict)
  nomeCompleto      String
  telefone          String?
  email             String?
  endereco          String?
  cpf               String?
  abordagemOverride Abordagem?
  createdAt         DateTime           @default(now())
  consentimento     Consentimento?
  documentos        DocumentoClinico[]

  @@unique([id, clinicaId])
}

model Consentimento {
  id          String    @id @default(uuid())
  clinicaId   String
  pacienteId  String    @unique
  paciente    Paciente  @relation(fields: [pacienteId, clinicaId], references: [id, clinicaId], onDelete: Restrict, onUpdate: Restrict)
  concedidoEm DateTime  @default(now())
  revogadoEm  DateTime?

  @@unique([pacienteId, clinicaId])
}

model DocumentoClinico {
  id              String          @id @default(uuid())
  clinicaId       String
  pacienteId      String
  paciente        Paciente        @relation(fields: [pacienteId, clinicaId], references: [id, clinicaId], onDelete: Restrict, onUpdate: Restrict)
  tipo            TipoDocumento
  status          StatusDocumento @default(RASCUNHO_BRUTO)
  abordagemUsada  Abordagem
  conteudoCifrado String
  aprovadoPorId   String?
  aprovadoPor     Psicologo?      @relation(fields: [aprovadoPorId, clinicaId], references: [id, clinicaId], onDelete: Restrict, onUpdate: Restrict)
  aprovadoEm      DateTime?
  createdAt       DateTime        @default(now())
  updatedAt       DateTime        @updatedAt
}
```

**Atualização (Tarefa 5b, 2026-10-28):** o bloco acima já reflete as **FKs compostas por clínica**. Como a checagem de chave estrangeira ignora o RLS, `Paciente(psicologoId, clinicaId)`, `Consentimento(pacienteId, clinicaId)`, `DocumentoClinico(pacienteId, clinicaId)` e `DocumentoClinico(aprovadoPorId, clinicaId)` referenciam `(id, clinicaId)` da tabela pai, com `@@unique([id, clinicaId])` em `Psicologo` e `Paciente`; o banco recusa (erro `P2003`) ligar linhas de clínicas diferentes. Consequências para as tarefas seguintes: (1) os nomes de campo não mudaram; (2) use `create` com os escalares (`clinicaId`, `pacienteId`, `psicologoId`), nunca `connect`; (3) `clinicaId` do filho tem de ser o mesmo do pai, senão o insert falha; (4) apagar clínica, psicólogo ou paciente exige apagar os filhos antes (`Restrict`); (5) o Prisma exigiu `@@unique([pacienteId, clinicaId])` em `Consentimento`, redundante com `pacienteId @unique`; (6) o schema real também traz os blocos `generator`/`datasource` (omitidos acima) e os campos de relação inversa `documentosAprovados`. O arquivo `backend/prisma/schema.prisma` é a fonte da verdade; a migração é `fk_composta_por_clinica`.

- [ ] **Step 3: Rodar Postgres local e a primeira migração**

Run: `docker compose up -d postgres` (a partir de `Notta.psi/`)
Se `docker` não existir (WSL sem integração com o Docker Desktop), suba um Postgres 15+ com o pacote `embedded-postgres` numa pasta fora do repositório (porta própria, sem usar 5433 se estiver ocupada), rode `docker/initdb/01-roles.sql` como administrador desse Postgres e aponte `DATABASE_URL` para ele. Nesse caso `docker-compose.yml` fica sem teste local — diga isso no relatório.
Run: `cd backend && npx prisma migrate dev --name init`
Expected: migração aplicada sem erro, tabelas criadas

- [ ] **Step 4: Verificar**

Run: `npx prisma validate`
Expected: `The schema at prisma/schema.prisma is valid`

- [ ] **Step 5: Commit**

```bash
git add backend docker-compose.yml
git commit -m "feat: scaffold do backend NestJS com schema Prisma inicial"
```

---

### Task 5: Row-Level Security e `TenantPrismaService`

**Files:**
- Create: `backend/prisma/migrations/<timestamp>_enable_rls/migration.sql` (via `prisma migrate dev --create-only`)
- Create: `backend/src/prisma/prisma.service.ts`
- Create: `backend/src/prisma/tenant-prisma.service.ts`
- Test: `backend/src/prisma/tenant-prisma.service.spec.ts` (teste de integração, banco real de teste)

**Interfaces:**
- Consumes: schema da Tarefa 4.
- Produces: `class PrismaService extends PrismaClient implements OnModuleInit` (client global, só para bootstrap e para o próprio `TenantPrismaService`).
- Produces: `class TenantPrismaService { run<T>(clinicaId: string, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> }` — toda tarefa seguinte usa esta assinatura para acessar dado de clínica.

- [ ] **Step 1: Write the failing test**

```typescript
describe('TenantPrismaService', () => {
  it('so enxerga pacientes da clinica informada', async () => {
    const clinicaA = await criarClinicaDeTeste('Clinica A');
    const clinicaB = await criarClinicaDeTeste('Clinica B');
    await tenantPrisma.run(clinicaA.id, (tx) => tx.paciente.create({ data: pacienteFixture(clinicaA) }));

    const vistosPorB = await tenantPrisma.run(clinicaB.id, (tx) => tx.paciente.findMany());

    expect(vistosPorB).toHaveLength(0);
  });

  it('bloqueia leitura fora do TenantPrismaService.run mesmo sem filtro de clinicaId', async () => {
    const clinicaA = await criarClinicaDeTeste('Clinica C');
    await tenantPrisma.run(clinicaA.id, (tx) => tx.paciente.create({ data: pacienteFixture(clinicaA) }));

    const semContexto = await prisma.paciente.findMany();

    expect(semContexto).toHaveLength(0);
  });

  it('conecta com um papel sem superusuario nem bypassrls', async () => {
    const [papel] = await prisma.$queryRaw<{ rolsuper: boolean; rolbypassrls: boolean }[]>`
      SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`;
    expect(papel).toEqual({ rolsuper: false, rolbypassrls: false });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tenant-prisma.service.spec.ts`
Expected: FAIL — `TenantPrismaService` não existe; sem RLS, o segundo teste veria as linhas

- [ ] **Step 3: Escrever a migração de RLS**

```sql
ALTER TABLE "Psicologo" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Psicologo" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Psicologo"
  USING ("clinicaId" = current_setting('app.current_clinica_id', true));

ALTER TABLE "Paciente" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Paciente" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Paciente"
  USING ("clinicaId" = current_setting('app.current_clinica_id', true));

ALTER TABLE "Consentimento" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Consentimento" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Consentimento"
  USING ("clinicaId" = current_setting('app.current_clinica_id', true));

ALTER TABLE "DocumentoClinico" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DocumentoClinico" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "DocumentoClinico"
  USING ("clinicaId" = current_setting('app.current_clinica_id', true));
```

`current_setting(..., true)` com o segundo argumento `true` devolve `NULL` (nunca erro) quando a variável de sessão não foi setada, e `NULL = qualquer coisa` é sempre falso no Postgres — é isso que faz a política falhar fechada.

- [ ] **Step 4: Implementar `PrismaService` e `TenantPrismaService`**

`PrismaService` é o `PrismaClient` padrão, injetável, conectado em `onModuleInit`. `TenantPrismaService.run` abre `this.prisma.$transaction(async (tx) => { await tx.$executeRaw\`SELECT set_config('app.current_clinica_id', ${clinicaId}, true)\`; return fn(tx); })` — o uso do template tagged do Prisma parametriza `clinicaId`, sem concatenar string na query.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx prisma migrate dev` (aplica a migração de RLS) `&& npx jest tenant-prisma.service.spec.ts`
Expected: PASS nos dois testes

- [ ] **Step 6: Commit**

```bash
git add backend/prisma backend/src/prisma
git commit -m "feat: row-level security por clinica e TenantPrismaService"
```

---

### Task 6: `CriptografiaService`

**Files:**
- Create: `backend/src/criptografia/criptografia.service.ts`
- Test: `backend/src/criptografia/criptografia.service.spec.ts`

**Interfaces:**
- Consumes: `process.env.NOTTA_MASTER_KEY` (hex de 32 bytes).
- Produces: `class CriptografiaService { cifrar(clinicaId: string, textoPlano: string): string; decifrar(clinicaId: string, valorCifrado: string): string }`.

- [ ] **Step 1: Write the failing test**

```typescript
describe('CriptografiaService', () => {
  it('cifra e decifra o mesmo texto para a mesma clinica', () => {
    const cifrado = service.cifrar('clinica-a', 'texto sensivel');
    expect(service.decifrar('clinica-a', cifrado)).toBe('texto sensivel');
  });

  it('nao decifra com a chave derivada de outra clinica', () => {
    const cifrado = service.cifrar('clinica-a', 'texto sensivel');
    expect(() => service.decifrar('clinica-b', cifrado)).toThrow();
  });

  it('nao grava o texto original no valor cifrado', () => {
    const cifrado = service.cifrar('clinica-a', 'texto sensivel');
    expect(cifrado).not.toContain('texto sensivel');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest criptografia.service.spec.ts`
Expected: FAIL — `CriptografiaService` not defined

- [ ] **Step 3: Implement `CriptografiaService`**

Deriva a chave por clínica com `crypto.hkdfSync('sha256', Buffer.from(process.env.NOTTA_MASTER_KEY, 'hex'), Buffer.alloc(0), Buffer.from(clinicaId), 32)`. `cifrar` gera `iv = randomBytes(12)`, cifra com `createCipheriv('aes-256-gcm', chave, iv)`, monta `authTag`, e retorna a string `v1.<iv base64>.<authTag base64>.<ciphertext base64>`. `decifrar` faz o inverso com `createDecipheriv`; se a assinatura (`authTag`) não bater — inclusive por vir de outra clínica — `decipher.final()` lança, e o método deixa o erro propagar.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest criptografia.service.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/criptografia
git commit -m "feat: criptografia do conteudo clinico com chave por clinica"
```

---

### Task 7: Clínicas, psicólogos e autenticação

**Files:**
- Create: `backend/src/clinicas/clinicas.service.ts`
- Create: `backend/src/clinicas/clinicas.controller.ts`
- Create: `backend/prisma/migrations/<timestamp>_login_lookup/migration.sql` (via `prisma migrate dev --create-only`)
- Create: `backend/src/auth/auth.service.ts`
- Create: `backend/src/auth/auth.controller.ts`
- Create: `backend/src/auth/jwt-auth.guard.ts`
- Create: `backend/src/auth/jwt.strategy.ts`
- Test: `backend/src/clinicas/clinicas.service.spec.ts`
- Test: `backend/src/auth/auth.service.spec.ts`

**Interfaces:**
- Consumes: `TenantPrismaService`, `PrismaService` (Tarefa 5), `bcryptjs`, `@nestjs/jwt`.
- Produces: `ClinicasService.criarClinicaComPrimeiroPsicologo({ nomeClinica, nomePsicologo, email, senha, abordagemPadrao }): Promise<{ clinicaId: string; psicologoId: string }>`.
- Produces: `AuthService.login(email: string, senha: string): Promise<{ token: string } | null>`; payload do JWT `{ sub: psicologoId, clinicaId }`.
- Produces: `JwtAuthGuard` que popula `request.user = { psicologoId, clinicaId }` — todas as tarefas seguintes leem `clinicaId` daqui, nunca do corpo da requisição.

- [ ] **Step 1: Write the failing test**

```typescript
describe('ClinicasService.criarClinicaComPrimeiroPsicologo', () => {
  it('cria a clinica e o psicologo dentro do mesmo contexto de tenant', async () => {
    const { clinicaId, psicologoId } = await service.criarClinicaComPrimeiroPsicologo({
      nomeClinica: 'Clinica Teste', nomePsicologo: 'Ana', email: 'ana@example.com',
      senha: 'senha-forte-123', abordagemPadrao: 'SISTEMICA',
    });

    const psicologo = await tenantPrisma.run(clinicaId, (tx) => tx.psicologo.findUnique({ where: { id: psicologoId } }));
    expect(psicologo?.clinicaId).toBe(clinicaId);
  });
});

describe('AuthService.login', () => {
  it('retorna token para credenciais corretas e null para senha errada', async () => {
    await criarPsicologoDeTeste({ email: 'ana@example.com', senha: 'senha-forte-123' });
    expect(await authService.login('ana@example.com', 'senha-forte-123')).toHaveProperty('token');
    expect(await authService.login('ana@example.com', 'errada')).toBeNull();
    expect(await authService.login('nao-existe@example.com', 'x')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest clinicas.service.spec.ts auth.service.spec.ts`
Expected: FAIL — serviços não existem

- [ ] **Step 3: Implement `ClinicasService`, `AuthService`, guard e strategy**

`criarClinicaComPrimeiroPsicologo` usa o `PrismaService` global dentro de um único `$transaction`: cria a `Clinica`, chama `tx.$executeRaw\`SELECT set_config('app.current_clinica_id', ${clinicaId}, true)\`` com o id recém-criado, e só então insere o `Psicologo` com `senhaHash = bcrypt.hashSync(senha, 12)` — a política de RLS (a da Tarefa 5 já declara `WITH CHECK` explícito, igual ao `USING`) passa porque a variável de sessão já aponta para a clínica nova. Esta é a única rotina do sistema que usa `PrismaService` diretamente em vez de `TenantPrismaService.run`, e só porque ela mesma estabelece o contexto do tenant antes de escrever. `AuthService.login` ainda não tem `clinicaId` e `Psicologo` tem `FORCE ROW LEVEL SECURITY`, então uma busca sem contexto retorna zero linhas. A migração desta tarefa (SQL abaixo) acrescenta uma segunda política, `login_lookup`, que libera `SELECT` só na linha cujo `email` é igual à variável de sessão `app.login_email`. `login` abre um `$transaction` do `PrismaService`, chama `set_config('app.login_email', ${email}, true)` e então `tx.psicologo.findFirst({ where: { email } })`. Só `AuthService` seta essa variável, e a política não vale para escrita. (Uma função `SECURITY DEFINER` não resolve: com `FORCE`, o dono da tabela continua sujeito ao RLS, e a função roda com os privilégios dele.) Compara com `bcrypt.compareSync`, assina o JWT com `NOTTA_JWT_SECRET`.

```sql
CREATE POLICY login_lookup ON "Psicologo" FOR SELECT
  USING ("email" = NULLIF(current_setting('app.login_email', true), ''));
```

`NULLIF(..., '')` é obrigatório: depois de um `set_config(..., true)` a conexão do pool devolve `''` (não `NULL`) fora da transação, e sem o `NULLIF` a política passaria a casar linhas com `email = ''`. Esta tarefa também (a) cria o `PrismaModule` como módulo `@Global` que exporta `PrismaService` e `TenantPrismaService` (um único pool; vários módulos provendo o `PrismaService` criam vários pools), e (b) atualiza o teste de `pg_policies` da Tarefa 5, que hoje espera só `tenant_isolation` em `Psicologo`: o conjunto esperado passa a incluir `login_lookup` de propósito. Só `TenantPrismaService`, `ClinicasService` e `AuthService` podem chamar `set_config` (confira com grep na revisão das tarefas seguintes).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest clinicas.service.spec.ts auth.service.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/clinicas backend/src/auth
git commit -m "feat: cadastro de clinica/psicologo e login com JWT"
```

---

### Task 7b: Limite de tentativas em `/auth/login` e `/clinicas`

Acrescentada pelo controlador a pedido do dono (2026-10-28); executa depois da Tarefa 7 e antes da Tarefa 8. Motivo: os dois endpoints são públicos, e `bcrypt` com custo 12 faz cada tentativa gastar ~250 ms de CPU (força bruta de senha e negação de serviço).

**Files:**
- Modify: `backend/package.json`, `backend/package-lock.json` (dependência `@nestjs/throttler`, ver abaixo)
- Modify: `backend/src/auth/auth.controller.ts`, `backend/src/clinicas/clinicas.controller.ts`, `backend/src/main.ts`, `backend/src/app.module.ts` (ou o módulo onde a Tarefa 7 registrou os controllers), `backend/.env.example`
- Create: `backend/src/auth/login-throttler.guard.ts` (guard com a chave por IP + e-mail)
- Test: `backend/src/auth/limite-tentativas.e2e-spec.ts` ou `.spec.ts` (app Nest de teste com `supertest`)

**Interfaces:**
- Produces: `POST /auth/login` e `POST /clinicas` devolvem `429 Too Many Requests` com header `Retry-After` (segundos) quando o limite é excedido; corpo genérico, sem dizer se o e-mail existe.

**Regras (decisões do controlador, ver ledger):**
- Dependência: `@nestjs/throttler` na versão compatível com Nest 11 **e CommonJS sob o Jest** (a Tarefa 4 mostrou que `@nestjs/jwt@12` é ESM-only e quebra o Jest: confira `node_modules/@nestjs/throttler/package.json` sem `"type":"module"` e importe o módulo dentro de um teste do Jest antes de seguir; se a última versão for ESM, fixe a major anterior).
- `/auth/login`: no máximo **5 tentativas por minuto** para a mesma chave `IP + e-mail normalizado` (trim + minúsculas) **e** no máximo **20 por minuto por IP** (dois throttlers nomeados). Contam sucesso e falha. A 6ª tentativa da mesma chave responde 429; outro e-mail do mesmo IP continua valendo até o teto de 20.
- `/clinicas`: no máximo **5 por hora por IP**.
- Armazenamento em memória (instância única). Reinicia zera; várias instâncias exigiriam Redis. Registre isso num comentário e no relatório.
- IP real: atrás de proxy, `req.ip` seria o IP do proxy e **todos os usuários dividiriam o mesmo limite**. `main.ts` lê `NOTTA_TRUST_PROXY` (número de saltos de proxy, inteiro; ausente = desligado) e chama `app.set('trust proxy', n)`; documente em `.env.example`. Nunca confie em `X-Forwarded-For` direto.
- O guard de login normaliza o e-mail da mesma forma que o `AuthService` e, se o corpo não tiver e-mail em texto, usa só o IP.
- Os limites são constantes no código (YAGNI: nada de configuração por env além do trust proxy).

- [ ] **Step 1: Write the failing tests** — (a) 5 logins errados seguidos para `a@x.com` respondem 401 e o 6º responde 429 com `Retry-After`; (b) outro e-mail do mesmo IP ainda responde 401 (não 429) logo depois; (c) caixa e espaços no e-mail contam para a mesma chave (`A@X.com ` e `a@x.com`); (d) depois de 20 tentativas do mesmo IP com e-mails diferentes, a 21ª responde 429; (e) `/clinicas`: a 6ª requisição da hora responde 429; (f) o corpo do 429 não contém o e-mail enviado; (g) com `NOTTA_TRUST_PROXY=1`, o IP vem de `X-Forwarded-For` (dois IPs diferentes têm limites separados) e sem a variável o header é ignorado.
- [ ] **Step 2: Run test to verify it fails**
- [ ] **Step 3: Implement** (throttler nomeados no módulo, guard de login, `@Throttle` em `/clinicas`, trust proxy)
- [ ] **Step 4: Run test to verify it passes** (suíte completa com `DATABASE_URL` e `NOTTA_JWT_SECRET`)
- [ ] **Step 5: Commit** — `feat: limite de tentativas em login e cadastro de clinica`

---

### Task 8: Pacientes e consentimento

**Files:**
- Create: `backend/src/pacientes/pacientes.service.ts`
- Create: `backend/src/pacientes/pacientes.controller.ts`
- Create: `backend/src/pacientes/dto/criar-paciente.dto.ts`
- Test: `backend/src/pacientes/pacientes.service.spec.ts`

**Interfaces:**
- Consumes: `TenantPrismaService` (Tarefa 5), `JwtAuthGuard` (Tarefa 7).
- Produces: `PacientesService.criar(clinicaId: string, psicologoId: string, dto: CriarPacienteDto): Promise<{ pacienteId: string }>` — cria `Paciente` e `Consentimento` (`concedidoEm = now`) na mesma chamada de `TenantPrismaService.run`. Use `create` com escalares; se usar `create` aninhado do `Consentimento` dentro do `Paciente`, não passe `clinicaId` no filho (ele herda do pai).
- Produces: `PacientesService.revogarConsentimento(clinicaId: string, pacienteId: string): Promise<void>`.
- Consentimento explícito (decisão do dono, 2026-10-28, opção C do Ruling O): `CriarPacienteDto` tem o campo obrigatório `consentimentoObtido: boolean`, validado com `@Equals(true)` (mensagem: o consentimento do paciente deve ser confirmado pelo psicólogo). Sem `true`, o cadastro é recusado (400) e **nenhum** `Paciente` nem `Consentimento` é criado. `criar` também confere `dto.consentimentoObtido === true` e lança `BadRequestException` se não for (defesa em profundidade, já que o serviço pode ser chamado sem o pipe).
- Fora do código (spec §7, pendência aberta): o texto do termo que o psicólogo apresenta ao paciente precisa dizer que o texto anonimizado das notas é enviado a um provedor externo de IA (Gemini via SelahIA) e, na chave gratuita, pode ser retido ou lido por revisores. Esta tarefa só registra o consentimento; o texto do termo entra com a tela (sub-projeto de front) e deve ser revisado antes de qualquer paciente real.
- Produces: `function resolverAbordagem(psicologoAbordagemPadrao: Abordagem, pacienteAbordagemOverride: Abordagem | null): Abordagem` (função pura, usada por esta e pela Tarefa 11).

- [ ] **Step 1: Write the failing test**

```typescript
describe('PacientesService.criar', () => {
  it('cria paciente com consentimento concedido', async () => {
    const { pacienteId } = await service.criar(clinicaId, psicologoId, {
      nomeCompleto: 'Maria Teste', telefone: '11999999999', abordagemOverride: null, consentimentoObtido: true,
    });
    const paciente = await tenantPrisma.run(clinicaId, (tx) =>
      tx.paciente.findUnique({ where: { id: pacienteId }, include: { consentimento: true } }));
    expect(paciente?.consentimento?.revogadoEm).toBeNull();
  });
});

describe('PacientesService.criar sem consentimento', () => {
  it.each([false, undefined])('recusa o cadastro quando consentimentoObtido e %p e nao cria nada', async (valor) => {
    await expect(service.criar(clinicaId, psicologoId, {
      nomeCompleto: 'Joana Teste', telefone: null, abordagemOverride: null, consentimentoObtido: valor as unknown as boolean,
    })).rejects.toThrow(BadRequestException);

    const pacientes = await tenantPrisma.run(clinicaId, (tx) => tx.paciente.findMany({ where: { nomeCompleto: 'Joana Teste' } }));
    expect(pacientes).toHaveLength(0);
  });

  it('o DTO rejeita consentimentoObtido ausente ou diferente de true', async () => {
    const dto = plainToInstance(CriarPacienteDto, { nomeCompleto: 'X' });
    expect((await validate(dto)).map((e) => e.property)).toContain('consentimentoObtido');
    expect(await validate(plainToInstance(CriarPacienteDto, { nomeCompleto: 'X', consentimentoObtido: false }))).not.toHaveLength(0);
  });
});

describe('resolverAbordagem', () => {
  it('usa o override do paciente quando presente', () => {
    expect(resolverAbordagem('TCC', 'SISTEMICA')).toBe('SISTEMICA');
  });
  it('usa o padrao do psicologo quando nao ha override', () => {
    expect(resolverAbordagem('TCC', null)).toBe('TCC');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest pacientes.service.spec.ts`
Expected: FAIL — serviço não existe

- [ ] **Step 3: Implement `PacientesService` e `resolverAbordagem`**

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest pacientes.service.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/pacientes
git commit -m "feat: cadastro de paciente com consentimento"
```

---

### Task 9: `AnonimizacaoService`

**Files:**
- Create: `backend/src/anonimizacao/anonimizacao.service.ts`
- Test: `backend/src/anonimizacao/anonimizacao.service.spec.ts`

**Interfaces:**
- Produces: `interface IdentificadoresPaciente { nomeCompleto: string; telefone?: string | null; email?: string | null; cpf?: string | null }`.
- Produces: `class AnonimizacaoService { anonimizar(texto: string, identificadores: IdentificadoresPaciente): { textoAnonimizado: string; mapa: Record<string, string> }; restituir(texto: string, mapa: Record<string, string>): string }`.

- [ ] **Step 1: Write the failing test**

```typescript
describe('AnonimizacaoService', () => {
  it('remove nome do paciente, cpf, telefone e email, e restitui depois', () => {
    const texto = 'Maria Teste, cpf 123.456.789-00, tel 11999999999, email maria@teste.com, chegou cansada.';
    const { textoAnonimizado, mapa } = service.anonimizar(texto, {
      nomeCompleto: 'Maria Teste', telefone: '11999999999', email: 'maria@teste.com', cpf: '123.456.789-00',
    });

    expect(textoAnonimizado).not.toContain('Maria Teste');
    expect(textoAnonimizado).not.toContain('123.456.789-00');
    expect(textoAnonimizado).not.toContain('11999999999');
    expect(textoAnonimizado).not.toContain('maria@teste.com');
    expect(service.restituir(textoAnonimizado, mapa)).toBe(texto);
  });

  it('detecta nome de terceiro citado no meio da frase e o restitui', () => {
    const texto = 'Falou muito da mae, Joana Alves, durante a sessao.';
    const { textoAnonimizado, mapa } = service.anonimizar(texto, { nomeCompleto: 'Paciente X' });

    expect(textoAnonimizado).not.toContain('Joana Alves');
    expect(service.restituir(textoAnonimizado, mapa)).toBe(texto);
  });

  it('mapa nunca inclui a chave em texto plano fora dos placeholders', () => {
    const { mapa } = service.anonimizar('texto qualquer', { nomeCompleto: 'Alguem' });
    Object.keys(mapa).forEach((chave) => expect(chave).toMatch(/^\[[A-Z0-9_]+\]$/));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest anonimizacao.service.spec.ts`
Expected: FAIL — serviço não existe

- [ ] **Step 3: Implement `AnonimizacaoService`**

Ordem de substituição, cada uma gerando uma entrada no `mapa` com chave `[PACIENTE]`, `[CPF]`, `[TELEFONE]`, `[EMAIL]`: (1) nome completo do paciente (case-insensitive, `\b` nos limites); (2) CPF via o mesmo padrão de `SelahIA/src/adapters/agilis/workspace/workspace-ai.sanitize.ts` (`sanitizeFreeText`); (3) telefone, mesmo padrão; (4) e-mail, mesmo padrão. Depois, detecção de terceiros: regex `/\b([A-ZÀ-Ú][a-zà-ú]+(?:\s[A-ZÀ-Ú][a-zà-ú]+){1,2})\b/g` sobre o texto já com os identificadores do paciente removidos, ignorando sequências que batem com uma lista de palavras comuns capitalizadas por estarem no início de frase (lista curta fixa: `['O','A','Os','As','Ele','Ela','Depois','Durante','Quando']` como primeira palavra da sequência) — cada ocorrência nova vira `[PESSOA_1]`, `[PESSOA_2]`, etc. `restituir` substitui cada chave do `mapa` pelo valor original, na ordem inversa em que foram inseridas (para não substituir `[PACIENTE]` dentro de um valor que por acaso contenha colchetes).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest anonimizacao.service.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/anonimizacao
git commit -m "feat: anonimizacao reversivel antes do envio a IA"
```

---

### Task 10: Cliente do SelahIA

**Files:**
- Create: `backend/src/selah/selah-client.service.ts`
- Test: `backend/src/selah/selah-client.service.spec.ts`

**Interfaces:**
- Consumes: `process.env.SELAH_BASE_URL`, `SELAH_API_KEY`, `SELAH_SOURCE_APP`; contrato HTTP da Tarefa 3.
- Produces: `type ResultadoRascunho = { disponivel: true; rascunho: string } | { disponivel: false; motivo: string; retryAfterSegundos?: number }`.
- Contrato do adapter (SelahIA v2.7.1, `docs/releases/v2.7.0.md`): corpo valido = `tipoDocumento` em `evolucao|anamnese`, `abordagem` em `SISTEMICA|TCC|PSICANALISE|ACT|HUMANISTA|OUTRA`, `textoAnonimizado` nao vazio, nao so espacos e com **no maximo 8000 caracteres** (campo extra tambem da 400). Resposta 200 = `{ provider, version, model, generatedAt, rascunho }`. Qualquer falha do modelo e 502; chave errada/ausente 401; limite por app 429.
- Produces: `class SelahClientService { gerarRascunho(input: { tipoDocumento: 'evolucao'|'anamnese'; abordagem: Abordagem; textoAnonimizado: string }): Promise<ResultadoRascunho> }`.

- [ ] **Step 1: Write the failing test**

```typescript
describe('SelahClientService.gerarRascunho', () => {
  const entradaValida = { tipoDocumento: 'evolucao' as const, abordagem: 'TCC' as const, textoAnonimizado: '[PACIENTE] chegou cansada' };

  beforeEach(() => fetchMock.mockReset());

  it('retorna disponivel=true com o rascunho em caso de sucesso', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { rascunho: 'texto gerado' }));
    const resultado = await service.gerarRascunho({ tipoDocumento: 'evolucao', abordagem: 'TCC', textoAnonimizado: '[PACIENTE] ...' });
    expect(resultado).toEqual({ disponivel: true, rascunho: 'texto gerado' });
  });

  it('retorna disponivel=false em 429, sem lancar excecao', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(429, { message: 'Rate limit exceeded' }));
    const resultado = await service.gerarRascunho({ tipoDocumento: 'evolucao', abordagem: 'TCC', textoAnonimizado: 'texto' });
    expect(resultado.disponivel).toBe(false);
  });

  it.each([400, 401, 502, 503])('retorna disponivel=false em %i, sem lancar e sem repassar o corpo da resposta', async (status) => {
    fetchMock.mockResolvedValueOnce(jsonResponse(status, { message: 'TEXTO_DO_UPSTREAM_SECRETO' }));
    const resultado = await service.gerarRascunho({ tipoDocumento: 'evolucao', abordagem: 'TCC', textoAnonimizado: 'texto' });
    expect(resultado.disponivel).toBe(false);
    expect(JSON.stringify(resultado)).not.toContain('TEXTO_DO_UPSTREAM_SECRETO');
  });

  it('em 429 devolve retryAfterSegundos quando o Selah manda Retry-After numerico', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(429, { message: 'Rate limit exceeded' }, { 'retry-after': '30' }));
    expect(await service.gerarRascunho(entradaValida)).toEqual({ disponivel: false, motivo: 'http_429', retryAfterSegundos: 30 });
    fetchMock.mockResolvedValueOnce(jsonResponse(429, {}, { 'retry-after': 'amanha' }));
    expect(await service.gerarRascunho(entradaValida)).toEqual({ disponivel: false, motivo: 'http_429' });
  });

  it('retorna disponivel=false em erro de rede e em timeout, sem lancar', async () => {
    fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    expect((await service.gerarRascunho(entradaValida)).disponivel).toBe(false);
    fetchMock.mockRejectedValueOnce(Object.assign(new Error('timeout'), { name: 'TimeoutError' }));
    expect((await service.gerarRascunho(entradaValida)).disponivel).toBe(false);
  });

  it('envia a requisicao com timeout (AbortSignal)', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { rascunho: 'ok' }));
    await service.gerarRascunho(entradaValida);
    expect(fetchMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });

  it('nao chama o SelahIA quando o texto anonimizado passa de 8000 caracteres ou e vazio', async () => {
    const longo = await service.gerarRascunho({ ...entradaValida, textoAnonimizado: 'a'.repeat(8001) });
    const vazio = await service.gerarRascunho({ ...entradaValida, textoAnonimizado: '   ' });
    expect(longo).toEqual({ disponivel: false, motivo: 'texto_acima_do_limite' });
    expect(vazio).toEqual({ disponivel: false, motivo: 'texto_vazio' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('retorna disponivel=false quando o 200 vem sem rascunho em texto', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { rascunho: 42 }));
    expect((await service.gerarRascunho(entradaValida)).disponivel).toBe(false);
  });

  it('nao envia identificadores do paciente no corpo da requisicao', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { rascunho: 'ok' }));
    await service.gerarRascunho({ tipoDocumento: 'evolucao', abordagem: 'TCC', textoAnonimizado: '[PACIENTE] chegou cansada' });
    const corpoEnviado = fetchMock.mock.calls[0][1].body as string;
    expect(corpoEnviado).not.toContain('Maria Teste');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest selah-client.service.spec.ts`
Expected: FAIL — serviço não existe

- [ ] **Step 3: Implement `SelahClientService`**

`fetch(`${SELAH_BASE_URL}/v1/adapters/psicologia/rascunho/gerar`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-selah-api-key': SELAH_API_KEY, 'x-source-app': SELAH_SOURCE_APP }, body: JSON.stringify({ tipoDocumento, abordagem, textoAnonimizado }) })`. Passe `signal: AbortSignal.timeout(50_000)` (o SelahIA pode levar ate ~45 s com retries; sem timeout o request do psicologo fica preso). Antes do `fetch`, valide o texto: so espacos/vazio -> `{ disponivel: false, motivo: 'texto_vazio' }`; mais de 8000 caracteres **depois da anonimizacao** -> `{ disponivel: false, motivo: 'texto_acima_do_limite' }` (os codigos `[PESSOA_1]` mudam o tamanho, entao um texto bruto abaixo de 8000 pode passar do limite depois de anonimizado; sem essa checagem o SelahIA devolveria 400). Em `response.ok` com `typeof body.rascunho === 'string'`, devolve `{ disponivel: true, rascunho: body.rascunho }`. **Todo o resto** (qualquer status nao-ok — 400, 401, 429, 5xx —, 200 sem `rascunho` em texto, erro de rede, timeout) devolve `{ disponivel: false, motivo }` — nunca lança. `motivo` e um codigo curto fixo (ex.: `http_<status>`, `rede`, `timeout`, `resposta_invalida`); **nunca** copie o corpo da resposta nem `error.message` para o `motivo` nem para logs (o corpo de erro do upstream pode ecoar conteudo clinico). No `429`, se o header `Retry-After` for um inteiro, devolva tambem `retryAfterSegundos` (o chamador mostra "tente em N s" e cai no fluxo manual); qualquer outro valor do header e ignorado. Uma 401/400 indica configuracao ou contrato quebrado: registre so o codigo de status em nivel `error` para o operador ver, sem texto. O teste de identificadores passa porque `textoAnonimizado` já chega anonimizado (responsabilidade da Tarefa 9, chamada por quem invoca este serviço).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest selah-client.service.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/selah
git commit -m "feat: cliente HTTP do adapter psicologia no SelahIA"
```

---

### Task 11: Fluxo completo de `DocumentoClinico`

**Files:**
- Create: `backend/src/documentos/documentos.service.ts`
- Create: `backend/src/documentos/documentos.controller.ts`
- Create: `backend/src/documentos/dto/criar-documento.dto.ts`
- Test: `backend/src/documentos/documentos.service.spec.ts`

**Interfaces:**
- Consumes: `TenantPrismaService` (5), `CriptografiaService` (6), `AnonimizacaoService` (9), `SelahClientService` (10), `resolverAbordagem` (8).
- Produces: `DocumentosService.criarRascunhoBruto(clinicaId, pacienteId, dto: { tipo: 'evolucao'|'anamnese'; textoBruto: string }): Promise<{ documentoId: string }>` — status inicial `RASCUNHO_BRUTO`.
- Produces: `DocumentosService.gerarRascunhoIa(clinicaId, documentoId): Promise<{ status: 'RASCUNHO_IA'; rascunho: string } | { status: 'IA_INDISPONIVEL'; retryAfterSegundos?: number } | { status: 'SEM_CONSENTIMENTO' }>`. Sem `Consentimento` do paciente, ou com `revogadoEm` preenchido, devolve `SEM_CONSENTIMENTO` **antes** de anonimizar ou chamar o Selah (o spec é omisso aqui; acrescentado pelo controlador porque o consentimento seria letra morta se a IA pudesse ser chamada sem ele).
- Produces: `DocumentosService.aprovar(clinicaId, documentoId, psicologoId, textoFinal: string): Promise<void>` — só aceita transição de `RASCUNHO_IA` (ou `RASCUNHO_BRUTO`, se o psicólogo optou por escrever manualmente) para `APROVADO`.
- Produces: `DocumentosService.listarAprovados(clinicaId, pacienteId): Promise<DocumentoAprovado[]>`.

- [ ] **Step 1: Write the failing test**

```typescript
describe('DocumentosService', () => {
  it('fluxo completo: bruto -> rascunho IA -> aprovado', async () => {
    const { documentoId } = await service.criarRascunhoBruto(clinicaId, pacienteId, {
      tipo: 'evolucao', textoBruto: 'Maria Teste chegou cansada, falou da mae Joana.',
    });
    selahClientMock.gerarRascunho.mockResolvedValue({ disponivel: true, rascunho: '[PACIENTE] chegou cansada e mencionou [PESSOA_1].' });

    const gerado = await service.gerarRascunhoIa(clinicaId, documentoId);
    expect(gerado.status).toBe('RASCUNHO_IA');
    expect(gerado.rascunho).toContain('Maria Teste');
    expect(gerado.rascunho).toContain('Joana');

    await service.aprovar(clinicaId, documentoId, psicologoId, gerado.rascunho);
    const aprovados = await service.listarAprovados(clinicaId, pacienteId);
    expect(aprovados).toHaveLength(1);
  });

  it('quando a IA fica indisponivel, nao aprova nada sozinho', async () => {
    const { documentoId } = await service.criarRascunhoBruto(clinicaId, pacienteId, { tipo: 'evolucao', textoBruto: 'texto' });
    selahClientMock.gerarRascunho.mockResolvedValue({ disponivel: false, motivo: 'rate limit' });

    const resultado = await service.gerarRascunhoIa(clinicaId, documentoId);
    expect(resultado.status).toBe('IA_INDISPONIVEL');
    expect(await service.listarAprovados(clinicaId, pacienteId)).toHaveLength(0);
  });

  it('sem consentimento ou com consentimento revogado, nao chama o Selah', async () => {
    const { documentoId } = await service.criarRascunhoBruto(clinicaId, pacienteId, { tipo: 'evolucao', textoBruto: 'texto' });
    await pacientesService.revogarConsentimento(clinicaId, pacienteId);

    const resultado = await service.gerarRascunhoIa(clinicaId, documentoId);

    expect(resultado).toEqual({ status: 'SEM_CONSENTIMENTO' });
    expect(selahClientMock.gerarRascunho).not.toHaveBeenCalled();
  });

  it('documento em RASCUNHO_IA nao aparece como aprovado', async () => {
    const { documentoId } = await service.criarRascunhoBruto(clinicaId, pacienteId, { tipo: 'anamnese', textoBruto: 'texto' });
    selahClientMock.gerarRascunho.mockResolvedValue({ disponivel: true, rascunho: 'rascunho' });
    await service.gerarRascunhoIa(clinicaId, documentoId);

    expect(await service.listarAprovados(clinicaId, pacienteId)).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest documentos.service.spec.ts`
Expected: FAIL — serviço não existe

- [ ] **Step 3: Implement `DocumentosService`**

`criarRascunhoBruto`: dentro de `tenantPrisma.run(clinicaId, ...)`, cifra `textoBruto` com `criptografiaService.cifrar(clinicaId, textoBruto)` e cria o `DocumentoClinico` com `status: 'RASCUNHO_BRUTO'` e `abordagemUsada = resolverAbordagem(...)` (busca psicólogo/paciente na mesma transação); se o paciente não existir na clínica (o RLS devolve `null` para paciente de outra clínica), lança `NotFoundException` **antes** do `create`, senão a FK composta falharia com `P2003` e viraria 500). `gerarRascunhoIa` roda em **duas** chamadas curtas de `tenantPrisma.run` com a chamada ao Selah **fora** de qualquer `run` (a transação interativa tem timeout de 5 s e prende uma conexão do pool; o Selah pode levar até ~45 s, e `run` aninhado pega uma segunda conexão): (1) `run` de leitura: confere o consentimento (ver Interfaces), lê o documento e decifra o texto bruto; depois, fora do `run`, `anonimizacaoService.anonimizar` e `selahClientService.gerarRascunho`; (2) `run` de escrita só se houve rascunho. Detalhes: se `disponivel: false`, retorna `{ status: 'IA_INDISPONIVEL' }` (repassando `retryAfterSegundos` quando houver) **sem alterar o documento**; se `disponivel: true`, chama `anonimizacaoService.restituir`, grava o rascunho cifrado com `status: 'RASCUNHO_IA'` e devolve o texto já restituído. `aprovar`: exige que o documento esteja em `RASCUNHO_IA` ou `RASCUNHO_BRUTO` (lança se já `APROVADO` — aprovar duas vezes não é permitido), cifra `textoFinal`, seta `status: 'APROVADO'`, `aprovadoPorId = psicologoId`, `aprovadoEm = new Date()`. `listarAprovados` filtra explicitamente `where: { status: 'APROVADO' }` — nunca lista por ausência de filtro.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest documentos.service.spec.ts`
Expected: PASS

- [ ] **Step 5: Implement `DocumentosController`** com as quatro rotas (`POST /pacientes/:id/documentos`, `POST /documentos/:id/rascunho-ia`, `POST /documentos/:id/aprovar`, `GET /pacientes/:id/documentos`), todas atrás de `JwtAuthGuard`, lendo `clinicaId` de `request.user` (nunca do corpo ou da URL).

- [ ] **Step 6: Commit**

```bash
git add backend/src/documentos
git commit -m "feat: fluxo completo de rascunho e aprovacao de documento clinico"
```

---

## Self-Review (feito pelo autor do plano)

1. **Cobertura do spec:** §4 (modelo de dados) → Tarefa 4; §5 (isolamento) → Tarefa 5; §6 (criptografia) → Tarefa 6; §7 (anonimização) → Tarefa 9; §8 (fluxo do rascunho) → Tarefas 10–11; §9 (integração SelahIA) → Tarefas 1–3 e 10; §10 (critérios de sucesso) → cobertos pelos testes das Tarefas 5, 9, 11. Nenhuma seção do spec ficou sem tarefa correspondente.
2. **Consistência de tipos:** `Abordagem`, `TipoDocumento`, `StatusDocumento` são definidos uma única vez (Tarefa 4) e reutilizados literalmente nas Tarefas 1, 7, 8, 10, 11 — conferido que os valores de enum batem em todas as menções (`SISTEMICA`, `TCC`, `PSICANALISE`, `ACT`, `HUMANISTA`, `OUTRA`; `EVOLUCAO`/`evolucao`, `ANAMNESE`/`anamnese` — nota: o Prisma usa maiúsculas, o DTO do adapter usa minúsculas por serem strings livres de API; isso é intencional, não inconsistência, mas fica registrado aqui para quem implementar não estranhar).
3. **Review Focus:** as 5 entradas têm teste nomeado em tarefa específica (ver seção acima), nenhuma ficou solta sem dono.
4. **Proporção:** o spec tem ~2.000 palavras; este plano é mais longo porque cobre 2 repositórios com 11 tarefas — mas cada corpo de função foi deixado como assinatura + descrição de uma linha, não como código pronto, exceto SQL de RLS e schema Prisma (valores fixos que o spec e as decisões de arquitetura determinam, não algoritmo livre do implementador).

---

## Execution Handoff

Plano completo e salvo em `docs/superpowers/plans/2026-09-27-nucleo-clinico-plan.md`. Por favor revise e confirme se ele captura o que você quer. Qual abordagem de execução você prefere?

- **Subagent-driven** — um subagent novo implementa cada tarefa e um revisor novo confere antes da próxima começar, mais uma revisão de branch inteira no fim. Mais demorado e mais caro em contexto.
- **Native** — eu implemento as 11 tarefas nesta sessão, e um revisor novo confere o branch inteiro só no fim. Mais rápido e mais barato.

**Recomendo Subagent-driven**, porque este plano mexe em isolamento entre clínicas (RLS) e criptografia de dado de saúde mental — as duas coisas em que um erro só aparece quando já é tarde (um vazamento), e não em um teste óbvio de funcionalidade. Vale o custo extra de um revisor a cada tarefa, em vez de descobrir um problema de segurança só no fim.

Este plano captura o que você quer? E qual das duas abordagens seguimos?
