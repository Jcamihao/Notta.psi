// Conteudo da pagina publica /seguranca, como dado tipado. Regra: nenhuma frase promete mais do
// que o sistema faz hoje. Cada item "feito" tem evidencia (arquivo e teste) em
// docs/SEGURANCA-AFIRMACOES.md; o teste de sincronia falha se as duas listas divergirem.

export type StatusItemSeguranca = 'feito' | 'pendente';

export interface ItemSeguranca {
  id: string;
  status: StatusItemSeguranca;
  titulo: string;
  texto: string;
}

export interface SecaoSeguranca {
  titulo: string;
  itens: ItemSeguranca[];
}

export interface ConteudoSeguranca {
  atualizadoEm: string;
  abertura: string;
  secoes: SecaoSeguranca[];
  rodape: string;
}

export const CONTEUDO_SEGURANCA: ConteudoSeguranca = {
  atualizadoEm: '2026-11-07',
  abertura:
    'Esta página mostra o que o Notta.psi faz hoje, com os limites de cada proteção, e o que ainda não está pronto.',
  secoes: [
    {
      titulo: 'O que já existe',
      itens: [
        {
          id: 'cifra',
          status: 'feito',
          titulo: 'Dados do paciente e texto clínico ficam cifrados.',
          texto:
            'Nome, nascimento, telefone e e-mail do paciente e o conteúdo dos documentos são cifrados no banco (AES-256-GCM), com uma chave própria de cada clínica derivada de uma chave mestra que não fica no banco. O texto enviado à IA e a tabela de códigos dele também ficam cifrados enquanto existem. Nem tudo é cifrado: nome e e-mail de quem entra no sistema, nome da clínica, tipo, situação e data de cada documento e a data de criação dos registros ficam em texto comum. O aplicativo decifra os dados para mostrá-los ao psicólogo; por isso quem controla o servidor e a chave mestra consegue lê-los.',
        },
        {
          id: 'isolamento',
          status: 'feito',
          titulo: 'Cada psicólogo lê só os próprios pacientes.',
          texto:
            'Colegas da mesma clínica, inclusive a administração, não leem o prontuário uns dos outros. O banco de dados impõe isso, não só o código do aplicativo. Quem administra o banco ou tem a chave mestra fica fora dessa regra (veja "Proteção contra quem administra o servidor", abaixo).',
        },
        {
          id: 'aprovado',
          status: 'feito',
          titulo: 'Documento aprovado não muda.',
          texto:
            'Depois de aprovado, o documento não pode ser editado nem apagado pelo aplicativo, e o banco de dados barra essas tentativas. Uma correção vira um novo documento ligado ao anterior. Quem tem acesso de administrador ao banco consegue contornar essa trava (veja abaixo); a única alteração prevista nele é a troca da chave de cifra, que não muda o conteúdo.',
        },
        {
          id: 'auditoria',
          status: 'feito',
          titulo: 'Quem acessou o quê fica registrado.',
          texto:
            'Criar, ler, listar e editar pacientes e documentos, aprovar documentos, registrar consentimento e usar a IA gravam quem fez, o quê e quando, sem guardar o conteúdo. O aplicativo só consegue acrescentar linhas a esse registro, não alterar nem apagar; o administrador do banco consegue (veja abaixo).',
        },
        {
          id: 'ia',
          status: 'feito',
          titulo:
            'Antes da IA, os dados de identificação são trocados por códigos, e o psicólogo confere.',
          texto:
            'Antes de qualquer texto ir à IA, o sistema troca por códigos o nome do paciente cadastrado, CPF, telefone, e-mail, CEP e endereço com número, datas completas (como 10/05/2026) e os termos que o psicólogo marcar. Nome de outras pessoas, endereço sem número e data por extenso não são trocados sozinhos: o filtro reduz o risco, mas não é perfeito. O psicólogo vê o texto exato que será enviado e só depois da confirmação dele o envio acontece. O texto já com códigos vai a um serviço de IA de terceiros (hoje, o Google Gemini, por meio do SelahIA); o que esse serviço faz com ele segue os termos dele. A IA só é usada para pacientes com consentimento concedido e vem desligada por padrão. O que ela escreve é só um rascunho: ele vira documento aprovado quando o psicólogo o aprova.',
        },
        {
          id: 'consentimento',
          status: 'feito',
          titulo: 'O consentimento do paciente é registrado.',
          texto:
            'Fica guardado com a versão do termo e a data, pode ser revogado, e o paciente pode aceitar por um link de uso único que vale por 7 dias.',
        },
        {
          id: 'sessao',
          status: 'feito',
          titulo: 'Sessão protegida.',
          texto:
            'O acesso fica em um cookie que o JavaScript da página não consegue ler, renova-se sozinho, expira depois de 30 minutos parado e em no máximo 7 dias, e você pode sair de todos os aparelhos de uma vez.',
        },
        {
          id: 'senha',
          status: 'feito',
          titulo: 'Senhas fortes e guardadas com segurança.',
          texto:
            'A senha precisa ter pelo menos 10 caracteres e não pode constar numa lista de senhas comuns; ela é guardada só como hash (bcrypt), nunca em texto.',
        },
        {
          id: 'tentativas',
          status: 'feito',
          titulo: 'Limite de tentativas.',
          texto:
            'Há limites para tentativas de login e de cadastro, e proteção contra pedidos forjados de outros sites (CSRF).',
        },
      ],
    },
    {
      titulo: 'O que ainda não está pronto',
      itens: [
        {
          id: 'mfa',
          status: 'pendente',
          titulo: 'Verificação em duas etapas.',
          texto: 'Planejada: ainda não existe.',
        },
        {
          id: 'recuperar-senha',
          status: 'pendente',
          titulo: 'Recuperar senha e confirmar e-mail.',
          texto: 'Planejados: ainda não existem.',
        },
        {
          id: 'backup',
          status: 'pendente',
          titulo: 'Backup automático.',
          texto:
            'Já existem as ferramentas de backup cifrado e de teste de restauração, mas o backup agendado em produção ainda não existe.',
        },
        {
          id: 'termo-juridico',
          status: 'pendente',
          titulo: 'Revisão jurídica do termo de consentimento.',
          texto: 'O texto atual é provisório e ainda não foi revisado por advogado.',
        },
        {
          id: 'pentest',
          status: 'pendente',
          titulo: 'Teste de invasão por terceiros.',
          texto: 'Ainda não foi feito.',
        },
        {
          id: 'lgpd',
          status: 'pendente',
          titulo: 'Exportar e excluir seus dados e prazos de retenção.',
          texto: 'Planejados: ainda não existem.',
        },
        {
          id: 'incidente',
          status: 'pendente',
          titulo: 'Plano de resposta a incidentes.',
          texto:
            'Existe um rascunho do plano, ainda não revisado por advogado nem ensaiado em simulado.',
        },
        {
          id: 'ia-real',
          status: 'pendente',
          titulo: 'IA com dados reais.',
          texto:
            'Ainda não liberada: a IA só foi testada com textos fictícios, e o plano pago do serviço de IA é exigido antes de qualquer dado real passar por ela.',
        },
        {
          id: 'dono-banco',
          status: 'pendente',
          titulo: 'Proteção contra quem administra o servidor.',
          texto:
            'As travas do banco valem contra o aplicativo. Quem tiver a credencial de administrador do banco consegue contorná-las, e quem tiver a chave mestra consegue decifrar os dados. Planejado: credencial de administrador fora do aplicativo, banco em rede privada, conexão cifrada com o banco e firewall.',
        },
        {
          id: 'auditoria-tela',
          status: 'pendente',
          titulo: 'Consultar o registro de acessos.',
          texto: 'O registro existe, mas ainda não há tela para consultá-lo.',
        },
        {
          id: 'estado',
          status: 'pendente',
          titulo: 'Estado do produto.',
          texto:
            'O Notta.psi ainda está em desenvolvimento e não foi publicado em produção. Quando for publicado, a hospedagem e o local onde os dados ficam serão informados aqui.',
        },
      ],
    },
  ],
  rodape: 'Dúvidas sobre os seus dados? Fale com o seu psicólogo(a).',
};
