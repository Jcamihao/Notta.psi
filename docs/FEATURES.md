# Notta.psi — Lista de features (fonte única da ordem de construção)

Aprovada pelo dono em 2026-10-30. Recomeço do zero: nada abaixo está feito.
Spec e plano antigos em `docs/superpowers/` são só referência (decisões e riscos), não a ordem.

Legenda: **[B]** só back · **[F]** só front · **[M]** misto (back e tela juntos, no mesmo módulo).
Status: `[ ]` a fazer · `[~]` em andamento · `[x]` feito e verificado.

## Fase 1 — Bases
- [ ] 1. [B] Projeto base do back
- [ ] 2. [B] Isolamento por clínica (RLS)
- [ ] 3. [B] Criptografia por clínica
- [ ] 4. [F] Base do front (pode andar junto com 2 e 3)
- [ ] 5. [M] Cadastro de clínica
- [ ] 6. [M] Login e sessão
- [ ] 7. [B] Regras de acesso entre psicólogos (decisão do dono antes)
- [ ] 8. [M] Adicionar psicólogos à clínica

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
