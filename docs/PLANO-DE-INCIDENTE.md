# Plano de resposta a incidentes de segurança (item 54)

**Estado: RASCUNHO, escrito em 2026-11-07. Não foi revisado por advogado nem testado em simulado.** Ele serve de base para o dono (e um advogado) adaptarem. Os trechos que citam a lei vêm de fontes secundárias (artigos de escritórios e notícias) e precisam ser conferidos no texto oficial antes de uso real (marcados com **[conferir]**). Os passos técnicos usam as ferramentas que existem no projeto; os que não foram executados de verdade estão marcados com **[testar em simulado]**.

Para quem lê: este documento diz **quem faz o quê, em que prazo e com quais comandos** quando houver (ou se suspeitar de) um incidente com dados do Notta.psi. O produto guarda dado de saúde mental, que é dado pessoal sensível: tratar qualquer suspeita com seriedade e rapidez.

## 1. Quando este plano vale

Incidente de segurança = qualquer evento que comprometa a confidencialidade, a integridade ou a disponibilidade de dados pessoais. Exemplos reais deste sistema:

| Situação | Gravidade inicial |
|---|---|
| Chave mestra (`NOTTA_MASTER_KEY`/`NOTTA_MASTER_KEYS`) exposta | Crítica |
| Credencial do dono do banco (`notta_owner`) ou do superuser exposta | Crítica |
| Backup ou dump do banco vazado | Crítica (depende da senha de backup, seção 5.5) |
| Psicólogo lendo prontuário de outro (falha de isolamento) | Alta |
| Sessão ou senha de um psicólogo roubada | Alta |
| Link de termo de consentimento vazado antes do uso | Média |
| Texto com dado identificável chegou à IA (filtro falhou) | Média a alta |
| Servidor ou aplicação indisponível (sem perda de dado) | Baixa a média |
| Suspeita sem confirmação | Tratar como incidente até descartar |

## 2. Quem é quem (decisões do dono, seção 9)

- **Responsável pelo incidente (comando):** o dono do produto. Decide, aciona os demais e assina as comunicações. **[definir um substituto para quando ele estiver indisponível]**
- **Controlador e operador:** pela LGPD, o psicólogo ou a clínica que decide o uso dos dados dos seus pacientes é, em regra, o **controlador**; o Notta.psi seria o **operador** (trata os dados em nome dele). Essa qualificação precisa ser confirmada com advogado, porque muda **quem** comunica a ANPD e os titulares: o operador comunica o controlador sem demora, e o controlador comunica a ANPD e os pacientes. **[conferir]**
- **Encarregado (DPO):** designar uma pessoa e um canal de contato público. **[decisão do dono]**
- **Provedor de hospedagem, e-mail (Resend) e IA (SelahIA, Google Gemini):** contatos de suporte e segurança de cada um, a levantar quando existirem em produção.

## 3. Linha do tempo (o que fazer, na ordem)

Marque o relógio assim que **alguém sabe** do incidente: os prazos legais contam do conhecimento, não da conclusão da investigação.

1. **0 a 1 hora, triagem.** Anote data e hora, quem descobriu e como, e abra a ficha de registro (seção 7). Classifique pela tabela da seção 1.
2. **0 a 4 horas, contenção.** Pare o dano antes de investigar a fundo: use o playbook do cenário (seção 5). Não apague nada que sirva de prova (logs, linhas do banco, arquivos).
3. **Até 24 horas, avaliação.** Descubra o que foi afetado: quais clínicas, quais psicólogos, quantos pacientes, quais tipos de dado, por quanto tempo. A trilha de auditoria (`Auditoria`) ajuda a responder "quem leu o quê, quando" (seção 6).
4. **Decisão de comunicar.** Há risco ou dano relevante aos titulares? Dado de saúde é sensível, então na dúvida a resposta tende a ser sim. **[conferir com advogado]**
5. **Comunicar o controlador (psicólogos e clínicas) sem demora**, dentro de horas, para que eles consigam cumprir os próprios prazos (modelo na seção 8.1).
6. **Comunicar a ANPD em até 3 dias úteis do conhecimento do incidente** (Resolução CD/ANPD nº 15/2024; o prazo é contado em dobro para agentes de tratamento de pequeno porte nos termos da Resolução CD/ANPD nº 2/2022; o dono precisa saber se se enquadra). **[conferir]**
7. **Comunicar os titulares** (pacientes) no mesmo prazo, por canal direto e em linguagem simples (modelo 8.3). Depois da comunicação à ANPD, há mais 3 dias úteis para declarar à ANPD que os titulares foram avisados e por quais meios. **[conferir]**
8. **Complementar as informações à ANPD** em até 20 dias úteis, se a comunicação inicial foi parcial. **[conferir]**
9. **Recuperação e lições.** Restaurar o serviço, corrigir a causa, escrever o relatório pós-incidente (seção 7) e atualizar este plano e a página `/seguranca`.
10. **Guardar o registro do incidente por no mínimo 5 anos.** **[conferir]**

## 4. O que a comunicação à ANPD precisa trazer

O regulamento define o formulário e os campos; usar o formulário oficial da ANPD. Reunir de antemão, sem inventar: descrição da natureza do incidente e das categorias de dados afetados; número de titulares afetados (ou estimativa e por que não há número exato); riscos e impactos possíveis aos titulares; medidas de contenção e mitigação já tomadas e previstas; motivos de eventual demora; dados do encarregado ou de quem responde pelo contato. **[conferir o anexo oficial]**

## 5. Playbooks técnicos por cenário

Ferramentas que existem: encerrar sessões (`Sair de todos os aparelhos`, troca de senha, desativação de psicólogo), rotação da chave mestra (`npm run -s chave:gerar`, `NOTTA_MASTER_KEYS`, `npm run recifrar`), backup e restauração (`backend/scripts/backup.sh`, `verificar-backup.sh`, guia `docs/BACKUP-E-CHAVES.md`), cancelamento de convite de termo, desligar a IA (`NOTTA_IA_HABILITADA`), rotação do segredo do JWT (`NOTTA_JWT_SECRET`, que invalida os tokens de acesso de 15 minutos mas, em princípio, não as renovações guardadas no banco **[testar em simulado]**).

### 5.1 Sessão ou senha de um psicólogo roubada
1. Peça que ele use **Sair de todos os aparelhos** e troque a senha (a troca derruba as outras sessões). Se ele não consegue, o ADMIN da clínica pode **desativar** a conta (a sessão cai na hora; os dados ficam guardados).
2. Consulte a trilha (seção 6) para ver o que aquela conta fez no período.
3. Se o acesso envolveu pacientes, siga a seção 3 a partir do passo 3.
4. Hoje **não existe** ferramenta para forçar a troca de senha de todos de uma vez nem aviso automático de login novo (itens 47 e 48 e o domínio de e-mail dependem disso). **[lacuna]**

### 5.2 Chave mestra exposta
1. `npm run -s chave:gerar` para uma chave nova, guardada fora do servidor do banco e do backup.
2. Deploy com `NOTTA_MASTER_KEYS=k1:<antiga>,k2:<nova>` e `NOTTA_MASTER_KEY_ATUAL=k2`.
3. `npm run recifrar -- --dry-run` e depois `npm run recifrar` (como `notta_owner`); conferir que as contagens zeram.
4. Só depois aposentar a `k1`.
5. **Limite importante:** backups feitos antes continuam cifrados (por dentro) com a chave antiga. Quem tem a `k1` e um backup antigo lê os dados daquele momento. Trate esses backups como comprometidos e apague os que não forem necessários. **[lacuna]**
6. Rode o ciclo de verificação do backup depois da rotação (`npm run verificar:backup`).

### 5.3 Credencial do dono do banco (`notta_owner`) ou do superuser exposta
1. Como superuser, troque as senhas: `ALTER ROLE notta_owner PASSWORD '<nova>'` e `ALTER ROLE notta_app PASSWORD '<nova>'`; atualize `DATABASE_URL` e `DATABASE_URL_OWNER` e reinicie o aplicativo (nunca em chat nem em repositório).
2. Quem tem essa credencial pode contornar as travas de imutabilidade. Confira se algum gatilho foi desligado: `SELECT tgrelid::regclass, tgname, tgenabled FROM pg_trigger WHERE NOT tgisinternal AND tgenabled <> 'O';` (o resultado esperado é vazio; qualquer linha é suspeita).
3. Compare a trilha e os documentos aprovados com o último backup verificado para achar alterações. **[testar em simulado]**
4. Se houve acesso a dados, trate como vazamento (seção 3). A chave mestra é outra coisa: se ela também vazou, junte o playbook 5.2.

### 5.4 Falha de isolamento (um psicólogo leu dado de outro)
1. Desative a conta suspeita se for caso de abuso; se for falha de código, retire a funcionalidade do ar (versão anterior) até a correção.
2. Use a trilha para listar o que aquela conta leu (seção 6) e identificar os pacientes afetados.
3. Corrija com teste que reproduz a falha (RLS) antes de reabrir.

### 5.5 Backup ou dump vazado
1. O arquivo gerado por `backup.sh` é cifrado com a senha de backup (`openssl`, AES-256-CBC com PBKDF2). Se a senha de backup **não** vazou e tem 24 ou mais caracteres, o conteúdo está protegido, mas a cifra por senha não detecta adulteração (veja o guia).
2. Troque a senha de backup para os próximos e gere um backup novo.
3. Se a senha de backup também vazou: dentro do dump os textos clínicos ainda estão cifrados com a chave mestra, mas hashes de senha, e-mails de login, nomes de clínica, tipos e datas de documentos e a trilha ficam legíveis. Trate como vazamento de dados pessoais e siga a seção 3. Faça também o playbook 5.2 se a chave mestra puder ter sido exposta junto.

### 5.6 Link de termo de consentimento vazado
1. No cartão de consentimento do paciente, gere um novo convite: o anterior é cancelado na hora. O link vale por 7 dias e é de uso único.
2. Se alguém aceitou ou recusou em nome do paciente, o histórico do consentimento mostra a origem; registre e corrija com o paciente.

### 5.7 Texto com dado identificável chegou à IA
1. Pare a IA: remova `NOTTA_IA_HABILITADA` (ou ponha `0`) e reinicie. A funcionalidade volta ao rascunho manual.
2. Liste os envios na trilha: `acao = 'ENVIOU_IA'` (seção 6) e identifique pacientes e períodos.
3. Avalie com o dono o que o provedor (Google Gemini, via SelahIA) recebeu e quais são os termos dele. **[lacuna: o que o provedor faz com o texto não foi verificado]**
4. Corrija a regra do anonimizador com teste e reative.

### 5.8 Indisponibilidade
Restaure pelo último backup verificado (guia `docs/BACKUP-E-CHAVES.md`). Hoje **não existe backup agendado** nem ambiente de produção; o plano de restauração precisa ser ensaiado quando ele existir (itens 56 e 25).

## 6. Consultas úteis na trilha de auditoria

Rode como superuser do banco, só leitura. A trilha guarda quem fez, o quê e quando, nunca o conteúdo. Ajuste o período.

```sql
-- o que uma conta fez no período
SELECT "criadoEm", "acao", "recurso", "recursoId"
FROM "Auditoria"
WHERE "psicologoId" = '<id do psicólogo>' AND "criadoEm" BETWEEN '<início>' AND '<fim>'
ORDER BY "criadoEm";

-- quem leu um paciente ou um documento
SELECT "criadoEm", "psicologoId", "acao"
FROM "Auditoria"
WHERE "recurso" IN ('Paciente', 'Documento') AND "recursoId" = '<id>'
ORDER BY "criadoEm";

-- envios para a IA no período
SELECT "criadoEm", "psicologoId", "recursoId"
FROM "Auditoria"
WHERE "acao" = 'ENVIOU_IA' AND "criadoEm" BETWEEN '<início>' AND '<fim>';
```

Limites: ainda **não há tela** para consultar a trilha, e uma listagem de pacientes grava um evento de listagem (sem o id de cada paciente), então "quem pode ter visto um paciente" pode exigir juntar com a lista de pacientes do psicólogo no período. **[lacuna]**

## 7. Ficha de registro do incidente (guardar por no mínimo 5 anos)

Preencher e arquivar fora do banco do produto:
- Identificador, data e hora do conhecimento, quem descobriu, como.
- Natureza do incidente e cenário (seção 1 e 5); gravidade.
- Dados e titulares afetados (clínicas, psicólogos, quantidade estimada de pacientes, categorias de dado).
- Linha do tempo de cada ação (hora, quem, o quê).
- Decisão de comunicar ou não, com a justificativa; cópias das comunicações enviadas (controladores, ANPD, titulares) e as datas.
- Causa raiz, correção aplicada, teste que prova a correção.
- Lições e mudanças no plano, e atualização da página `/seguranca` se uma proteção mudou.

## 8. Modelos de comunicação (rascunhos para o advogado revisar)

### 8.1 Aviso ao psicólogo ou à clínica (controlador)
Assunto: Incidente de segurança no Notta.psi que pode afetar dados dos seus pacientes.
Corpo: Em `<data e hora>` identificamos `<descrição curta do que aconteceu>`. Os dados possivelmente afetados são `<categorias>`, de `<número ou estimativa>` pacientes seus. Já tomamos `<medidas de contenção>`. Recomendamos que você `<ações para o controlador, por exemplo trocar a senha e avisar os pacientes>`. Nós voltaremos a escrever em até `<prazo>` com a investigação. Contato direto: `<pessoa e canal>`.

### 8.2 Comunicação à ANPD
Usar o formulário oficial e os campos da seção 4. Guardar o protocolo.

### 8.3 Aviso ao paciente (titular)
Escrever em linguagem simples, sem jargão: o que aconteceu, quando, quais dados seus podem ter sido afetados, o que isso pode significar para você, o que já foi feito, o que você pode fazer (por exemplo, desconfiar de contatos inesperados) e como falar com `<encarregado ou psicólogo>`. Não culpar ninguém e não minimizar.

## 9. Lacunas e decisões do dono

Lacunas honestas de hoje (ficam abertas até os itens correspondentes):
- **Detecção é manual.** Não há monitoramento nem alertas de segurança (item 53). Um incidente só é percebido se alguém olhar.
- **Não há produção**, portanto nenhum backup agendado, nenhum ensaio de restauração em produção e nenhum contato de provedor (itens 25 e 56).
- **Sem MFA, sem aviso de login novo, sem recuperação de senha por e-mail** (itens 24, 47 e 48): o domínio e o Resend ainda não existem.
- **Sem ferramenta para forçar troca de senha ou encerrar todas as sessões de uma clínica de uma vez.**
- **Sem tela da trilha de auditoria.**
- **O que o Google (Gemini) faz com o texto enviado à IA não foi verificado.**

Decisões que são do dono (não decidi):
1. Quem é o responsável substituto e quem é o encarregado (DPO), com canal público.
2. A qualificação jurídica: o Notta.psi é operador, controlador ou controlador conjunto, e o enquadramento como agente de pequeno porte.
3. Contrato de tratamento de dados (operador) entre o Notta.psi e cada psicólogo ou clínica.
4. Se vale contratar um seguro cibernético ou assessoria jurídica de plantão.
5. Quando fazer o primeiro simulado (sugestão: antes do primeiro dado real e depois a cada 6 meses): reunir o responsável, simular um cenário da seção 1, cronometrar as etapas da seção 3 e anotar o que não funcionou.

## 10. Manutenção

Revisar este plano a cada mudança relevante de infraestrutura, a cada incidente e a cada 6 meses. Quando o plano for revisado por advogado e ensaiado, trocar o aviso do topo e atualizar o item "Plano de resposta a incidentes" na página `/seguranca` (`frontend/src/app/seguranca/seguranca.conteudo.ts`) e na tabela `docs/SEGURANCA-AFIRMACOES.md`.

## Fontes consultadas (secundárias; conferir no texto oficial)

- Resolução CD/ANPD nº 15, de 24 de abril de 2024 (Regulamento de Comunicação de Incidente de Segurança), via resumos de [Mattos Filho](https://www.mattosfilho.com.br/unico/regulamento-incidente-seguranca/), [Lefosse](https://lefosse.com/noticias/alerta/client-alert-anpd-aprova-regulamento-de-comunicacao-de-incidente-de-seguranca/) e [Cescon Barrieu](https://cesconbarrieu.com.br/anpd-aprova-o-regulamento-de-comunicacao-de-incidente-de-seguranca/).
- Lei nº 13.709/2018 (LGPD), art. 48 (comunicação de incidente), art. 5º, II (dado sensível) e art. 41 (encarregado).
