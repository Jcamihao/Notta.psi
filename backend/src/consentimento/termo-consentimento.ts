// Termo de consentimento VIGENTE (item 22). NAO vem do cliente: o servidor grava este snapshot em
// cada evento CONCEDIDO (registro manual do psicologo ou aceite do paciente pelo link).
//
// RASCUNHO NAO REVISADO. O texto abaixo foi escrito pelo agente, NAO por advogado. Antes de uso
// real o dono precisa fazer a revisao juridica, trocar o texto, mudar a `versao` (cada convite e
// cada consentimento guardam a versao e o texto exibidos) e so entao ligar NOTTA_TERMO_REVISADO=1.
// Em producao o boot FALHA sem essa variavel (ver convite.config.ts).
//
// Versao nova = convites antigos (feitos com a versao anterior) deixam de valer: o paciente nunca
// aceita um texto que nao foi o que ele viu. O psicologo emite um convite novo.
export const TERMO_VIGENTE = {
  versao: 'v1-rascunho',
  texto: `[RASCUNHO NÃO REVISADO JURIDICAMENTE. Este texto ainda não pode ser usado com pacientes reais.]

Termo de consentimento para o uso de inteligência artificial no seu atendimento

1. O que é. O seu psicólogo(a) usa um sistema online para organizar o seu prontuário. O sistema pode usar inteligência artificial (IA) para escrever RASCUNHOS de documentos, como a evolução de uma sessão ou a anamnese. A IA não toma decisões sobre você e não substitui o profissional.

2. Como os seus dados são protegidos antes da IA. Antes de qualquer texto ser enviado à IA, o sistema troca por códigos o seu nome, CPF, telefone, e-mail e datas. Esse filtro reduz o risco, mas não é perfeito. Por isso o psicólogo confere o texto que será enviado antes de enviá-lo. O envio é feito a um serviço de IA de terceiros (hoje, o Google Gemini).

3. Quem revisa. Todo rascunho é lido, corrigido e aprovado pelo seu psicólogo(a) antes de valer como documento.

4. Sigilo e quem acessa. As informações do seu atendimento são sigilosas. Elas ficam guardadas de forma protegida (criptografadas) e separadas por clínica. Só o psicólogo responsável pelo seu atendimento lê o seu prontuário: colegas da mesma clínica, inclusive a administração, não leem. Cada acesso fica registrado.

5. Agenda e videochamada. Se a clínica usar o Google Agenda ou o Google Meet para marcar ou fazer as sessões, o Google receberá só o necessário para isso (por exemplo, data, horário e e-mail para o convite), nunca o conteúdo clínico.

6. Revogação. Você pode retirar este consentimento a qualquer momento, sem precisar explicar o motivo, falando com o seu psicólogo(a). Depois da revogação a IA não é mais usada em novos documentos seus. Os documentos já feitos continuam guardados, como a lei e a ética profissional exigem.

7. Dúvidas. Fale com o seu psicólogo(a): o nome dele aparece na página deste termo.

Ao aceitar, você declara que leu e entendeu este termo e concorda com o uso descrito acima. Você pode recusar, e isso não muda o seu atendimento.`,
} as const;
