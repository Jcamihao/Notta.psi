# praxis.psi — Lista de features (fonte única da ordem de construção)

Aprovada pelo dono em 2026-10-30. Recomeço do zero. Fase 1 (itens 1-8), item 41 e Fase 1.5 (59-64, 57) feitos e verificados em 2026-10-30/31 e 11-01 (back 141 unit + 134 e2e, front 118, integração real no navegador 19/19; Postgres 16 do Docker na Fase 1, embutido 18 na 1.5 porque o Docker ficou desligado). Visual: design system em docs/DESIGN-SYSTEM.md aplicado.
Spec e plano antigos em `docs/superpowers/` são só referência (decisões e riscos), não a ordem.

Legenda: **[B]** só back · **[F]** só front · **[M]** misto (back e tela juntos, no mesmo módulo).
Status: `[ ]` a fazer · `[~]` em andamento · `[x]` feito e verificado.

## Fase 1 — Bases
- [x] 1. [B] Projeto base do back
- [x] 2. [B] Isolamento por clínica (RLS)
- [x] 3. [B] Criptografia por clínica
- [x] 4. [F] Base do front (pode andar junto com 2 e 3)
- [x] 5. [M] Cadastro de clínica
- [x] 6. [M] Login e sessão
- [x] 7. [B] Regras de acesso entre psicólogos (decisão do dono antes)
- [x] 8. [M] Adicionar psicólogos à clínica

## Fase 2 — Núcleo clínico
- [x] 9. [M] Cadastro de paciente
- [x] 10. [M] Consentimento: registrar, revogar, re-conceder
- [x] 11. [B] Trilha de auditoria (antes dos documentos)
- [x] 12. [M] Documento clínico: nota bruta, evolução e anamnese
- [x] 13. [F] Aviso na digitação sobre detalhes que identificam
- [x] 14. [M] Editar e retomar rascunho
- [x] 15. [M] Aprovação humana
- [x] 16. [M] Prontuário: lista de aprovados

## Fase 3 — IA
- [x] 17. [B] Anonimização antes da IA
- [x] 18. [B] Cliente do SelahIA (adapter `psicologia` já existe no SelahIA v2.7.9)
- [x] 19. [B] Limite de gerações por psicólogo (só gerações que deram certo gastam o limite; tentativa que falhou por erro da IA ou de conexão não conta)
- [x] 20. [M] Rascunho por IA na abordagem (a nota bruta é salva no servidor ANTES de chamar a IA; a geração é um pedido com estado PENDENTE, PRONTO ou FALHOU, e o resultado entra como rascunho do item 14)
- [x] 21. [M] Plano B quando a IA falha e "tentar de novo" sem limite de tentativas (pedido do dono, 2026-11-05): falha da IA, timeout ou queda de conexão (inclusive no celular) nunca perde a nota; o pedido fica salvo com o motivo (sem texto clínico no log), a tela mostra "Tentar de novo" quantas vezes precisar (a nota segue em rascunho para escrever à mão), retentativa é idempotente (não cria rascunho duplicado), e quem fechar o app e voltar vê o pedido onde parou

## Fase 4 — Confiança e segurança
- [x] 22. [M] Termo de consentimento do paciente (obrigatório antes de qualquer dado real)
- [x] 23. [F] Página de transparência de segurança
- [ ] 24. [M] Recuperar senha e confirmar e-mail (DECISÃO DO DONO 2026-11-05: provedor de e-mail = Resend; só começar depois que o dono comprar o domínio, porque o Resend exige domínio verificado; em desenvolvimento o e-mail é só gravado em log local. Destrava os itens 47, 48 e 65)
- [x] 25. [B] Backup e rotação da chave mestra
- [x] 26. [M] Exportar e excluir dados (LGPD) (feito e verificado em 2026-11-11: exclusão por anonimização irreversível e exportação em JSON não cifrado, só pelo psicólogo dono do paciente; limites e evidências em `docs/SEGURANCA-AFIRMACOES.md`, id `direitos-dados`. Fica para o item 52: descarte de backups antigos, que ainda guardam o dado anterior à exclusão)

- [x] 79. [F] Tela de Início (feita e verificada em 2026-11-11, fora da lista original: saudação, resumo com total e pacientes sem consentimento concedido, atalhos, últimos 5 pacientes CADASTRADOS e passo a passo no estado vazio; uma só chamada a `GET /pacientes`; fora do escopo de propósito: rascunhos pendentes, agenda e indicadores, que dependem de rota nova ou das Fases 5 e 8)

## Fase 5 — Uso diário
- [x] 27. [M] Linha do tempo do paciente (feito e verificado em 2026-11-13, só no front: página `/pacientes/:id/linha-do-tempo` com cadastro, consentimento, termos enviados por link e documentos em ordem cronológica, por mês, com filtro; nunca mostra texto clínico; cartão na ficha. Escopo decidido pelo agente por falta de detalhe no plano: se o dono quiser outros eventos, é ajuste de `linha-do-tempo.service.ts`)
- [x] 28. [M] Busca e filtros (só metadados; o texto é cifrado) (FEITO e verificado em 2026-11-13, só no front, na lista de pacientes: busca por nome, e-mail e telefone sem acento e sem diferenciar caixa, filtro de consentimento, contagem e aviso quando a lista chega a 500. A busca por palavra-chave DENTRO do texto dos documentos NÃO foi feita, por decisão: ficou só por metadados; se o dono quiser, é um item novo e exige decifrar no app só os documentos do próprio psicólogo.) (pedido original: (a psicóloga pediu busca por palavra-chave nos registros; com o texto cifrado isso exige decifrar no app só os documentos do próprio psicólogo; decisão do dono, ver item 28 nas decisões abertas))
- [ ] 29. [M] Ajuste de linguagem técnica
- [ ] 30. [M] Exportar em PDF ou Word

## Fase 6 — Comercial
- [ ] 31. [F] Landing page
- [ ] 32. [M] Lista de early access (9 contatos do Forms)
- [ ] 33. [M] Planos e cobrança (proposta de uma psicóloga, 2026-11-04: 3 planos. Individual (1 profissional); Plus (alto fluxo, 2 a 3 psicólogos atuantes); Premium (clínicas e centros multidisciplinares). O que entra em cada plano é decisão do dono; ver itens 68 a 77)

## Fase 7 — Futuro (fora do escopo atual)
- [ ] 37. [M] Áudio e transcrição
- [ ] 38. [M] Documentos formais do CFP
- [ ] 39. [B] Bucket externo
- [ ] 40. [B] Mais de um provedor de IA

## Trilha de segurança e cybersecurity (itens 41-56, adicionada em 2026-10-30)
Numeração separada para não quebrar as referências da Fase 1 em andamento. A coluna "Entra em" diz em que fase construir. Já existentes e relacionados: 2, 3, 5, 11, 19, 22, 23, 24, 25, 26.

- [x] 41. [B] Cabeçalhos HTTP de segurança (helmet), CORS só para a origem do front, limite de corpo e de tempo — entra na Fase 1 (junto do item 5)
- [x] 42. [B] Segredos e ambiente: nenhum segredo no repo, scan de segredos antes do commit, validação de env no boot, https obrigatório para o SelahIA — Fase 1 e 3
- [ ] 43. [B] CI: testes, lint, `npm audit`, atualização de dependências e testes de RLS obrigatórios antes de merge — Fase 2
- [x] 44. [B] Trigger no banco: documento APROVADO imutável — Fase 2 (com o item 15)
- [x] 51. [B] Defesa contra prompt injection e saída insegura da IA (o texto da sessão vira instrução; validar o rascunho) — Fase 3
- [x] 45. [M] Senha forte, checagem de senha vazada e anti-enumeração de e-mail — Fase 4
- [x] 46. [M] Sessões revogáveis: refresh token rotativo, expiração curta, "sair de todos os aparelhos" — Fase 4
- [ ] 47. [M] MFA para psicólogos (TOTP ou código por e-mail; decisão do dono) — Fase 4
- [ ] 48. [B] Bloqueio de conta após falhas e aviso por e-mail de novo login — Fase 4
- [x] 49. [F] Sessão em cookie httpOnly com proteção CSRF, CSP e nada de innerHTML — Fase 4
- [ ] 50. [B] Cifrar identificadores do paciente em repouso (nome, CPF, telefone, e-mail, endereço; decisão do dono) — Fase 4, antes de dado real
- [x] 52. [B] Retenção e descarte (feito e verificado em 2026-11-11, como comandos: `npm run descartar` apaga rascunho sem edição há 7 dias, nunca aprovado; `npm run podar-backups` apaga backup com mais de 30 dias e nunca o mais recente; a tela avisa o prazo do rascunho. DECISÃO DO DONO 2026-11-11: 7 dias desde a última edição, 30 dias de backup. NÃO RODAM SOZINHOS: o agendamento fica no item 56. Sem arquivamento de WAL no projeto: se ligarem, o WAL precisa do mesmo prazo)
- [~] 54. [processo] Plano de incidente e notificação de vazamento (LGPD/ANPD) — antes de dado real
- [ ] 53. [B] Monitoramento e alertas de segurança (falhas de login, picos, erros 5xx; logs sem dado clínico) — Fase 6
- [ ] 56. [B] Hardening de infraestrutura: TLS no banco, banco em rede privada, firewall, backups cifrados com restauração testada — antes do deploy
- [ ] 55. [processo] Teste de invasão externo e checklist OWASP ASVS — antes do lançamento

## Lacunas descobertas durante a Fase 1 (adicionadas em 2026-10-30)
- [x] 57. [M] Trocar a própria senha (o admin define a senha inicial do colega; o colega precisa poder trocá-la) — Fase 4, junto do item 24
- [x] 58. [M] Desativar psicólogo da equipe (hoje não há como remover quem saiu da clínica) — Fase 2, antes de haver pacientes reais

## Fase 1.5 — Endurecimento (revisão independente da Fase 1, 2026-10-31; antes da Fase 2)
Relatório completo em `.superpowers/sdd/fase-1/review-fase-1.md`. 0 críticos, 5 importantes.
- [x] 59. [B] Guard devolve 503 (não 401) em erro de infraestrutura e rotas autenticadas ganham limite por psicólogo (sob carga o pool esgota e o front desloga todo mundo). Nota: a degradação ENTRE clínicas (um usuário em rajada atrasando as outras) só fechou na Fase 1.6/H3 (limite e teto de simultâneas contados antes do banco, com tarpit na recusa); antes disso o item cobria só o 503
- [x] 60. [B] CPU do login: hash fora da thread principal (bcrypt nativo ou argon2), teto de logins simultâneos, IPv6 agrupado por /64
- [x] 61. [B] Boot recusa segredos de exemplo e de baixa entropia, e recusa papel de runtime superuser ou com BYPASSRLS
- [x] 62. [M] Senha inicial do colega: troca obrigatória no primeiro acesso (o ADMIN hoje consegue entrar como o colega; usa o item 57)
- [x] 63. [B] Padrão `psicologo_proprio`: FK filha inclui `psicologoId` (hoje um colega pendura linha no paciente do outro) e colega não grava `papel`/`senhaHash` de ninguém
- [x] 64. [B] AAD no AES-GCM (antes de existir dado cifrado; depois exige recifrar tudo)
- [ ] 65. [M] Convite por e-mail de uso único para o colega (fecha o I-1 da 2ª revisão: o ADMIN nunca tem a credencial; depende do item 24)
- [x] 66. [F] Antes de abrir para clínicas: ajustar o texto do painel de sigilo ao que o código já garante (cifra em uso, IA) e mensagem de 503 ("muita demanda, tente de novo") no login (feito e verificado em 2026-11-11: painel só afirma o que `seguranca.conteudo.ts` sustenta, inclui consentimento, filtro imperfeito, IA de terceiros e link para /seguranca; 503 mostra "muita demanda" com o Retry-After quando válido. Pendência pequena: as telas de IA mostram "IA desligada" para qualquer 503, inclusive o do banco ocupado)

## Fase 1.6 — Correções da 2ª revisão (feita e verificada em 2026-10-31)
Commits ef7836a (app), 20c4860 e 8b3f537 (banco e testes). Back: 191 unit + 159 e2e verdes. Risco I-1 aceito e documentado em docs/ACESSO.md; o item 65 o fecha. A migration nova exige rodar `backend/prisma/bootstrap/endurecer-banco.sql` uma vez por banco como superuser (revoke de lo_create).
- [ ] 67. [M] Transferir pacientes de um psicólogo desativado para outro da clínica (sem isso o prontuário de quem sai fica preso; decisão do dono: quem autoriza e como fica o registro) — antes de abrir para clínicas

## Fase 8 — Pedidos de uma psicóloga (feedback de 2026-11-04; só a decisão do Google Agenda e Meet foi tomada pelo dono)
Reúne tudo o que uma psicóloga pediu. O que já existe ou já tem lugar em outra fase fica só referenciado aqui; o que é novo ganhou item. Os itens 34, 35 e 36 saíram da Fase 7 para cá, com o mesmo número.

### Registro e IA (o núcleo que ela descreveu)
Já existe: registro rápido da nota pós-sessão, rascunho por IA com linguagem técnica e abordagem do psicólogo, revisão, edição e aprovação, e a regra de não inventar informação, interpretação, sintoma nem hipótese (prompt do SelahIA e saneamento da saída). Em outras fases: histórico cronológico (27), busca por palavra-chave (28), ajuste de linguagem técnica (29), documentos formais (38).
- [ ] 68. [M] Estilo de escrita do psicólogo: preferências (tom, tamanho, termos) e, opcionalmente, exemplos de registros anteriores para a IA imitar. Atenção: exemplo é texto clínico; só pode ir à IA anonimizado pelo mesmo caminho do item 17 e com prévia, e exige mudança no adapter do SelahIA
- [ ] 69. [M] Comparar registros anteriores e atuais do mesmo paciente (só entre documentos aprovados do próprio psicólogo)
- [ ] 70. [M] Resumo pré-sessão: o que ficou combinado e o que mudou desde a última sessão, a partir dos documentos aprovados (sempre com revisão humana)

### Acompanhamento entre sessões e alertas
- [ ] 34. [M] Link do paciente e check-ins (movido da Fase 7 por pedido de uma psicóloga, que o chamou de diferencial)
- [ ] 35. [M] Resumo semanal
- [ ] 36. [M] Alerta de risco

### Gestão do consultório (psicólogo solo que faz tudo)
- [ ] 71. [M] Agenda: marcar, confirmação automática e lembretes ao paciente (WhatsApp ou e-mail), controle de falta, cancelamento e reagendamento (o Hora H, outro app do dono, já tem agenda, lembretes e WhatsApp: avaliar reaproveitar). DECISÃO DO DONO (2026-11-04): integrar com Google Agenda (espelho de mão única, praxis -> Google; evento com título genérico, paciente fora do evento) e gerar o link do Google Meet no evento; o link é enviado ao paciente pelo próprio praxis.psi. Pontos a verificar: escopo OAuth e verificação do app no Google, tokens expiram em 7 dias enquanto o app está em modo de teste, e o vídeo passa a ficar sob o Google (contar no termo do item 22 e na página do item 23)
- [ ] 72. [M] Teleatendimento (DECISÃO DO DONO 2026-11-04: adotar Google Agenda e Google Meet; vídeo próprio fica como opção futura): fase 1 = link do Google Meet criado no evento do Google Agenda, enviado ao paciente pelo praxis.psi (ver item 71); fase 2 chamada de vídeo e voz DENTRO do app (viabilidade analisada em 2026-11-04: viável com SDK gerenciado ou LiveKit; custo por minuto, sem gravação por padrão, sala com link de uso único para o paciente sem login, depende dos itens 71, 34 e 22). Sobre a regra do CFP: fontes secundárias dizem que a Resolução CFP 9/2024 revogou a 11/2018 e que o cadastro no e-Psi deixou de ser exigido; conferir o texto oficial antes de decidir. Se for hospedado por nós (tudo centralizado no praxis.psi): recomendação inicial P2P 1:1 com TURN próprio (coturn) em servidor separado, sem SFU e sem gravação; LiveKit próprio só se houver terapia de grupo. Fazer uma prova de conceito de 1 semana antes de comprometer (2 navegadores em Wi-Fi e 4G, medir qualidade e taxa de uso do relay)
- [ ] 73. [M] Financeiro do psicólogo: pagamentos e recebimentos, mensalidade, pacote ou sessão avulsa, sessões realizadas ou pendentes, inadimplência (o Hora H já integra Asaas: avaliar reaproveitar)
- [ ] 74. [M] Recibos, atestados e encaminhamentos emitidos pelo app (junto do item 38; regras do CFP a conferir)
- [ ] 75. [M] Relatório financeiro simples e indicadores (pacientes ativos, atendimentos, taxa de faltas e cancelamentos, receita mensal, inadimplentes)
- [ ] 76. [M] Repasse a profissionais (clínica com vários psicólogos)

### Planos
- [ ] 77. [processo] Planos: a proposta abaixo veio de uma psicóloga e foi organizada em 2026-11-04. Preços, limites e a lista final de cada plano são decisão do dono; nada aqui está implementado
- [ ] 78. [B] Aplicar o plano no sistema: limite de psicólogos ativos por clínica, limite diário de gerações de IA por plano (hoje `PRAXIS_IA_LIMITE_DIARIO` vale para todos) e liberação de funcionalidades por plano (depende do item 33)

### Proposta dos 3 planos (rascunho para o dono decidir)
Cada clínica é um cliente; o plano Individual é uma clínica de um psicólogo só. Funcionalidades não existentes ainda ficam marcadas com o número do item.

| | Individual | Plus | Premium |
|---|---|---|---|
| Para quem | 1 profissional | alto fluxo, 2 a 3 psicólogos atuantes | clínicas e centros multidisciplinares |
| Psicólogos ativos | 1 | até 3 | acima de 3 (limite a definir) |
| Núcleo clínico (pacientes, consentimento, notas, documentos, aprovação, prontuário, histórico 27, busca 28) | sim | sim | sim |
| Rascunho por IA com prévia e retentativa | sim, limite diário menor | limite diário maior | limite diário maior, por psicólogo |
| Agenda com Google Agenda e Meet (71, 72), lembretes ao paciente | sim | sim | sim |
| Estilo de escrita personalizado (68), comparar registros (69), resumo pré-sessão (70) | não | sim | sim |
| Acompanhamento entre sessões por link (34), alerta de risco com revisão humana (36) | não | sim | sim |
| Financeiro: pagamentos e recibos (73, 74) | básico | completo (mensalidade e pacotes, indicadores 75) | completo |
| Gestão da equipe: adicionar e desativar psicólogos, transferir pacientes (67) | n/a | sim | sim |
| Repasse a profissionais (76), relatório consolidado da clínica (sem ler prontuário), trilha de auditoria consultável pelo ADMIN | não | não | sim |
| Outras profissões na mesma clínica (psiquiatria, nutrição, etc.) | não | não | a decidir: o produto hoje é só para psicologia (a IA e os documentos são clínicos de psicologia) |
| Suporte | padrão | padrão | prioritário |

Pontos para o dono decidir: preços; limite diário de IA de cada plano (cada geração custa e o Gemini precisa do plano pago); se "multidisciplinar" significa outras profissões (muda o produto); se o financeiro básico do Individual inclui recibo; se o acompanhamento entre sessões é recurso Plus ou vai para todos (a psicóloga o chamou de diferencial).
