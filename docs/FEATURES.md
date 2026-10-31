# Notta.psi — Lista de features (fonte única da ordem de construção)

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
- [ ] 9. [M] Cadastro de paciente
- [ ] 10. [M] Consentimento: registrar, revogar, re-conceder
- [ ] 11. [B] Trilha de auditoria (antes dos documentos)
- [ ] 12. [M] Documento clínico: nota bruta, evolução e anamnese
- [ ] 13. [F] Aviso na digitação sobre detalhes que identificam
- [ ] 14. [M] Editar e retomar rascunho
- [ ] 15. [M] Aprovação humana
- [ ] 16. [M] Prontuário: lista de aprovados

## Fase 3 — IA
- [ ] 17. [B] Anonimização antes da IA
- [ ] 18. [B] Cliente do SelahIA (adapter `psicologia` já existe no SelahIA v2.7.9)
- [ ] 19. [B] Limite de gerações por psicólogo
- [ ] 20. [M] Rascunho por IA na abordagem
- [ ] 21. [M] Plano B quando a IA falha

## Fase 4 — Confiança e segurança
- [ ] 22. [M] Termo de consentimento do paciente (obrigatório antes de qualquer dado real)
- [ ] 23. [F] Página de transparência de segurança
- [ ] 24. [M] Recuperar senha e confirmar e-mail
- [ ] 25. [B] Backup e rotação da chave mestra
- [ ] 26. [M] Exportar e excluir dados (LGPD)

## Fase 5 — Uso diário
- [ ] 27. [M] Linha do tempo do paciente
- [ ] 28. [M] Busca e filtros (só metadados; o texto é cifrado)
- [ ] 29. [M] Ajuste de linguagem técnica
- [ ] 30. [M] Exportar em PDF ou Word

## Fase 6 — Comercial
- [ ] 31. [F] Landing page
- [ ] 32. [M] Lista de early access (9 contatos do Forms)
- [ ] 33. [M] Planos e cobrança

## Fase 7 — Futuro (fora do escopo atual)
- [ ] 34. [M] Link do paciente e check-ins
- [ ] 35. [M] Resumo semanal
- [ ] 36. [M] Alerta de risco
- [ ] 37. [M] Áudio e transcrição
- [ ] 38. [M] Documentos formais do CFP
- [ ] 39. [B] Bucket externo
- [ ] 40. [B] Mais de um provedor de IA

## Trilha de segurança e cybersecurity (itens 41-56, adicionada em 2026-10-30)
Numeração separada para não quebrar as referências da Fase 1 em andamento. A coluna "Entra em" diz em que fase construir. Já existentes e relacionados: 2, 3, 5, 11, 19, 22, 23, 24, 25, 26.

- [x] 41. [B] Cabeçalhos HTTP de segurança (helmet), CORS só para a origem do front, limite de corpo e de tempo — entra na Fase 1 (junto do item 5)
- [ ] 42. [B] Segredos e ambiente: nenhum segredo no repo, scan de segredos antes do commit, validação de env no boot, https obrigatório para o SelahIA — Fase 1 e 3
- [ ] 43. [B] CI: testes, lint, `npm audit`, atualização de dependências e testes de RLS obrigatórios antes de merge — Fase 2
- [ ] 44. [B] Trigger no banco: documento APROVADO imutável — Fase 2 (com o item 15)
- [ ] 51. [B] Defesa contra prompt injection e saída insegura da IA (o texto da sessão vira instrução; validar o rascunho) — Fase 3
- [ ] 45. [M] Senha forte, checagem de senha vazada e anti-enumeração de e-mail — Fase 4
- [ ] 46. [M] Sessões revogáveis: refresh token rotativo, expiração curta, "sair de todos os aparelhos" — Fase 4
- [ ] 47. [M] MFA para psicólogos (TOTP ou código por e-mail; decisão do dono) — Fase 4
- [ ] 48. [B] Bloqueio de conta após falhas e aviso por e-mail de novo login — Fase 4
- [ ] 49. [F] Sessão em cookie httpOnly com proteção CSRF, CSP e nada de innerHTML — Fase 4
- [ ] 50. [B] Cifrar identificadores do paciente em repouso (nome, CPF, telefone, e-mail, endereço; decisão do dono) — Fase 4, antes de dado real
- [ ] 52. [B] Retenção e descarte: expirar rascunhos antigos, apagar nota bruta, limpar backup e WAL — Fase 4
- [ ] 54. [processo] Plano de incidente e notificação de vazamento (LGPD/ANPD) — antes de dado real
- [ ] 53. [B] Monitoramento e alertas de segurança (falhas de login, picos, erros 5xx; logs sem dado clínico) — Fase 6
- [ ] 56. [B] Hardening de infraestrutura: TLS no banco, banco em rede privada, firewall, backups cifrados com restauração testada — antes do deploy
- [ ] 55. [processo] Teste de invasão externo e checklist OWASP ASVS — antes do lançamento

## Lacunas descobertas durante a Fase 1 (adicionadas em 2026-10-30)
- [x] 57. [M] Trocar a própria senha (o admin define a senha inicial do colega; o colega precisa poder trocá-la) — Fase 4, junto do item 24
- [ ] 58. [M] Desativar psicólogo da equipe (hoje não há como remover quem saiu da clínica) — Fase 2, antes de haver pacientes reais

## Fase 1.5 — Endurecimento (revisão independente da Fase 1, 2026-10-31; antes da Fase 2)
Relatório completo em `.superpowers/sdd/fase-1/review-fase-1.md`. 0 críticos, 5 importantes.
- [x] 59. [B] Guard devolve 503 (não 401) em erro de infraestrutura e rotas autenticadas ganham limite por psicólogo (sob carga o pool esgota e o front desloga todo mundo). Nota: a degradação ENTRE clínicas (um usuário em rajada atrasando as outras) só fechou na Fase 1.6/H3 (limite e teto de simultâneas contados antes do banco, com tarpit na recusa); antes disso o item cobria só o 503
- [x] 60. [B] CPU do login: hash fora da thread principal (bcrypt nativo ou argon2), teto de logins simultâneos, IPv6 agrupado por /64
- [x] 61. [B] Boot recusa segredos de exemplo e de baixa entropia, e recusa papel de runtime superuser ou com BYPASSRLS
- [x] 62. [M] Senha inicial do colega: troca obrigatória no primeiro acesso (o ADMIN hoje consegue entrar como o colega; usa o item 57)
- [x] 63. [B] Padrão `psicologo_proprio`: FK filha inclui `psicologoId` (hoje um colega pendura linha no paciente do outro) e colega não grava `papel`/`senhaHash` de ninguém
- [x] 64. [B] AAD no AES-GCM (antes de existir dado cifrado; depois exige recifrar tudo)
- [ ] 65. [M] Convite por e-mail de uso único para o colega (fecha o I-1 da 2ª revisão: o ADMIN nunca tem a credencial; depende do item 24)
- [ ] 66. [F] Antes de abrir para clínicas: ajustar o texto do painel de sigilo ao que o código já garante (cifra em uso, IA) e mensagem de 503 ("muita demanda, tente de novo") no login
