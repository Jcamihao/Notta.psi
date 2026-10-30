# Notta.psi — Núcleo Clínico + Prontuário Assistido por IA (Sub-projeto 1)

**Data:** 2026-09-27
**Status:** aguardando revisão do dono do projeto

## 1. Contexto e objetivo

Notta.psi é uma plataforma para **clínicas e psicólogos** que reduz o trabalho de
registro clínico e, em fases futuras, estende o cuidado para entre as sessões.

Este documento cobre **apenas o sub-projeto 1**: o núcleo multi-clínica e o
prontuário assistido por IA (evolução e anamnese), a partir de texto digitado
pelo psicólogo. Não cobre: link do paciente/check-ins (sub-projeto 2), áudio
(sub-projeto 3) ou migração de armazenamento para bucket externo (sub-projeto 4).

**Por quê agora:** é a base sem a qual nenhum outro sub-projeto existe (não há
paciente, consentimento nem prontuário sem isto), e já entrega valor testável
com um psicólogo real.

## 2. Escopo

**Dentro do sub-projeto 1:**
- Cadastro de clínica, psicólogos (com abordagem padrão) e pacientes
- Consentimento do paciente, registrado e revogável
- Dois tipos de documento clínico: **evolução** e **anamnese**
- Rascunho gerado por IA a partir do texto digitado pelo psicólogo, na
  abordagem escolhida (padrão do psicólogo, ajustável por paciente)
- Revisão e aprovação humana obrigatória antes de qualquer documento existir
- Isolamento multi-clínica, criptografia do conteúdo clínico e anonimização
  antes do envio à IA

**Fora do escopo (sub-projetos futuros ou não decidido):**
- App/link do paciente e check-ins entre sessões
- Alerta de risco ativo (o modelo de dados deixa espaço, mas o fluxo não é
  implementado aqui)
- Gravação e transcrição de áudio
- Bucket externo de armazenamento
- Documentos formais do CFP (declaração, atestado, laudo)
- Suporte a mais de um provedor de IA (usa o SelahIA como está hoje)

## 3. Diferenciais deste sub-projeto

1. **IA que escreve na abordagem do psicólogo** (sistêmica, TCC, psicanálise,
   ACT, humanista...), ajustável por paciente.
2. **Modelo de dados pronto para o protocolo de risco**, mesmo que o fluxo
   ativo venha no sub-projeto 2.
3. Nicho de entrada comercial: **TDAH adulto** (não afeta este spec
   tecnicamente; afeta textos, exemplos e priorização de UX mais tarde).

## 4. Modelo de dados (visão lógica)

```
Clinica
  └─ Psicologo (N)         — abordagem padrão
       └─ Paciente (N)
            ├─ Consentimento (1)         — concedido/revogado, com data
            └─ DocumentoClinico (N)
                 - tipo: evolucao | anamnese
                 - status: rascunho_bruto | rascunho_ia | aprovado
                 - abordagemUsada          — herda do psicólogo, editável por paciente
                 - conteudoCifrado         — sempre criptografado
                 - aprovadoPor / aprovadoEm
```

Toda tabela de dado clínico carrega `clinicaId`. Nenhuma tabela deste
sub-projeto é compartilhada entre clínicas.

## 5. Isolamento entre clínicas

**Decisão: banco único, com `clinicaId` em toda tabela de dado clínico, mais
Row-Level Security (RLS) no PostgreSQL como segunda camada.**

- O filtro por `clinicaId` é a primeira camada, no código (Prisma).
- O RLS é a segunda camada, no banco: mesmo que o filtro de código falhe por
  bug, o banco recusa a leitura de linhas de outra clínica.
- Alternativas descartadas: banco/schema por clínica (isolamento mais forte,
  mas custo de manutenção incompatível com um dev sozinho na fase atual).

## 6. Proteção do conteúdo clínico

**Decisão: criptografia do texto clínico na camada de aplicação, com uma
chave de criptografia por clínica.**

- Protege contra o cenário mais provável de vazamento: cópia do banco ou de
  backup. Quem lê o banco diretamente vê apenas texto cifrado.
- A chave por clínica reforça o isolamento do item 5: mesmo numa falha de
  filtro, o conteúdo de outra clínica permanece ilegível.
- **Limite conhecido:** não protege contra a invasão do próprio servidor da
  aplicação, onde a chave fica acessível em tempo de uso. Resolve o risco de
  dado em repouso, não o de comprometimento total do servidor.
- **Limite conhecido:** buscar texto livre dentro dos prontuários fica
  limitado enquanto o conteúdo estiver cifrado no banco. Não há requisito de
  busca textual neste sub-projeto; se surgir, exige desenho à parte.
- Alternativa descartada: criptografia ponta-a-ponta (só o psicólogo teria a
  chave) — incompatível com o rascunho por IA, que precisa do texto em claro
  no momento do processamento.

## 7. Anonimização antes da IA

**Decisão: anonimização automática no backend do Notta.psi, antes de qualquer
chamada ao SelahIA.**

- Identificadores diretos (nome completo do paciente cadastrado, CPF,
  telefone, e-mail, endereço) são trocados por códigos antes do envio.
- **Nomes de terceiros citados na sessão** (validado como caso real por uma
  psicóloga formada, que hoje faz esse trabalho manualmente) também entram
  na anonimização automática, via detecção de nomes de pessoa. Esta parte
  tem taxa de erro conhecida — não é uma garantia absoluta — e por isso o
  psicólogo revisa o rascunho anonimizado antes da aprovação final.
- O mapa de correspondência entre código e identificador real vive apenas em
  memória durante o processamento da requisição, nunca é enviado ao SelahIA
  e nunca é persistido em texto plano.
- Depois que o SelahIA devolve o rascunho, o backend substitui os códigos
  pelos identificadores reais antes de mostrar ao psicólogo.
- **Risco residual, não resolvido neste sub-projeto:** detalhes indiretos que
  identificam sem citar nome (ex.: "a paciente que trabalha na padaria da
  esquina") não são detectáveis por regra automática. Mitigação: aviso na
  tela de digitação orientando o psicólogo a evitar esse tipo de detalhe.
- **Pendência de verificação antes da implementação:** confirmar nos termos
  do provedor de IA usado pelo SelahIA (Gemini) se o conteúdo enviado é
  retido ou usado para treinamento, e refletir isso no texto de consentimento
  do paciente.

## 8. Fluxo do rascunho assistido

1. Psicólogo digita a nota bruta (evolução ou anamnese).
2. Backend criptografa e salva a nota bruta imediatamente, como rascunho de
   trabalho (evita perda de texto).
3. Backend anonimiza o texto (seção 7).
4. Backend chama o adapter `psicologia` no SelahIA, enviando o texto
   anonimizado, o tipo de documento e a abordagem.
5. SelahIA devolve o rascunho, ainda com os códigos de anonimização.
6. Backend restitui os identificadores reais no rascunho.
7. Psicólogo revisa, edita livremente e aprova.
8. Só na aprovação o `DocumentoClinico` é gravado com status `aprovado`; a
   nota bruta original é descartada (minimização de dado), mantendo-se
   apenas o registro de quem aprovou e quando.

**Se o SelahIA falhar ou aplicar limite de uso (HTTP 429):** o psicólogo
escreve o documento manualmente, sem IA, seguindo o mesmo padrão de fallback
já usado pelo Lumen.

## 9. Integração com o SelahIA

- Novo adapter `psicologia`, seguindo o padrão já existente em
  `src/adapters/<app>/` (módulo, controller, service, prompt, schemas,
  sanitize), com chave de API própria do Notta.psi.
- O prompt varia por abordagem clínica e por tipo de documento (evolução vs.
  anamnese); ambos os eixos ficam explícitos na chamada, não implícitos no
  texto de entrada.
- Nenhum dado identificável trafega para o SelahIA (seção 7).

## 10. Critérios de sucesso

- Um psicólogo cadastra um paciente, registra o consentimento, digita notas
  de uma sessão e recebe um rascunho de evolução na abordagem configurada;
  revisa, edita e aprova.
- O mesmo fluxo funciona para anamnese.
- Existe teste automatizado provando que uma clínica não lê dado de outra,
  mesmo simulando uma falha de filtro no código (o RLS barra a leitura).
- Existe teste automatizado provando que nenhum identificador direto
  cadastrado (nome, CPF, telefone, e-mail, endereço) chega ao SelahIA.
- Nenhum `DocumentoClinico` é criado sem uma ação explícita de aprovação.

## 11. Riscos abertos (não resolvidos neste spec)

- Qualidade real do rascunho por abordagem ainda não foi validada com
  psicólogos de abordagens diferentes — recomenda-se validar com pelo menos
  uma psicóloga sistêmica antes de fechar o prompt final.
- Detecção de nomes de terceiros tem taxa de erro desconhecida até ser
  implementada e testada com texto real.
- Termos de retenção/treinamento do provedor de IA por trás do SelahIA ainda
  não foram verificados.
- Nome comercial "Notta.psi" ainda não teve domínio, marca ou redes sociais
  verificados.
