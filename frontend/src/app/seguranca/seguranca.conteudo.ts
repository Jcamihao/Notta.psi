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
    'Esta página mostra o que o Notta.psi faz hoje e o que ainda não está pronto. Nada aqui promete mais do que o sistema entrega.',
  secoes: [
    {
      titulo: 'O que já existe',
      itens: [
        {
          id: 'cifra',
          status: 'feito',
          titulo: 'Dados do paciente e texto clínico ficam cifrados.',
          texto:
            'Nome, nascimento, telefone e e-mail do paciente e o conteúdo dos documentos são cifrados no banco (AES-256-GCM), com uma chave própria de cada clínica derivada de uma chave mestra que não fica no banco.',
        },
        {
          id: 'isolamento',
          status: 'feito',
          titulo: 'Cada psicólogo lê só os próprios pacientes.',
          texto:
            'Colegas da mesma clínica, inclusive a administração, não leem o prontuário uns dos outros. O banco de dados impõe isso, não só o código do aplicativo.',
        },
        {
          id: 'aprovado',
          status: 'feito',
          titulo: 'Documento aprovado não muda.',
          texto:
            'Depois de aprovado, o documento não pode ser editado nem apagado. Uma correção vira um novo documento ligado ao anterior.',
        },
        {
          id: 'auditoria',
          status: 'feito',
          titulo: 'Quem acessou o quê fica registrado.',
          texto:
            'Criar, ler, listar e editar dados de pacientes grava quem fez, o quê e quando, sem guardar o conteúdo. Esse registro só aceita novas linhas.',
        },
        {
          id: 'ia',
          status: 'feito',
          titulo: 'A IA recebe o texto sem seus dados de identificação, e você confere antes.',
          texto:
            'Antes de qualquer texto ir à IA, o sistema troca nome, CPF, telefone, e-mail, endereço e datas por códigos, mostra ao psicólogo o texto exato que será enviado e só envia depois da confirmação. O filtro reduz o risco, mas não é perfeito. Todo rascunho feito pela IA precisa ser lido e aprovado pelo psicólogo. A IA vem desligada por padrão.',
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
            'A senha precisa ter pelo menos 10 caracteres e não pode ser uma senha comum; ela é guardada só como hash (bcrypt), nunca em texto.',
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
          texto: 'Ainda não foi escrito.',
        },
        {
          id: 'estado',
          status: 'pendente',
          titulo: 'Estado do produto.',
          texto: 'O Notta.psi ainda está em desenvolvimento.',
        },
      ],
    },
  ],
  rodape: 'Dúvidas sobre os seus dados? Fale com o seu psicólogo(a).',
};
