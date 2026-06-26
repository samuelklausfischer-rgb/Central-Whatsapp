export interface ReleaseNote {
  version: string
  date: string
  title: string
  details: string[]
}

export const releaseNotes: ReleaseNote[] = [
  {
    version: '0.0.155',
    date: '2026-06-26 14:00',
    title: 'Análise PRN no menu Ferramentas (admin)',
    details: [
      '📊 "Análise PRN" agora aparece no dropdown Ferramentas — visível apenas para admins',
      '🔧 Correção: na versão anterior o botão estava no menu lateral, não no menu superior',
    ],
  },
  {
    version: '0.0.154',
    date: '2026-06-26 12:00',
    title: 'Ferramenta Análise PRN integrada (admin)',
    details: [
      '🔍 Nova seção "Ferramentas" no menu lateral — visível apenas para admins',
      '📊 Análise PRN Engine V2 integrada: cruzamento histórico, cockpit financeiro por unidade',
      '🧾 Análise de duplicidade automática ao enviar arquivos diários',
      '💾 Histórico de execuções, exportação PDF/Excel e observações por lançamento',
    ],
  },
  {
    version: '0.0.153',
    date: '2026-06-25 18:30',
    title: 'Correção: mensagem aparecia duplicada ao enviar',
    details: [
      '✅ A mensagem enviada agora aparece uma única vez, já com a assinatura',
      '🧹 Eliminada a duplicata que surgia e depois sumia ao enviar',
      '⚡ O envio continua instantâneo na tela, sem esperar o servidor',
    ],
  },
  {
    version: '0.0.152',
    date: '2026-06-25 12:00',
    title: 'Chat em tempo real e envio instantâneo',
    details: [
      '⚡ Mensagens enviadas aparecem na hora, sem esperar a confirmação do servidor',
      '🔄 Conversa e lista de contatos atualizam sozinhas — sem precisar sair e entrar',
      '📶 Reconexão automática quando a internet cai ou o computador volta do repouso',
      '🟢 Indicador de "enviando" e aviso quando uma mensagem falha',
    ],
  },
  {
    version: '0.0.151',
    date: '2026-06-18 14:00',
    title: 'Envio de arquivos grandes (até 200 MB)',
    details: [
      '📁 Limite de upload aumentado de 10 MB para 200 MB por arquivo',
      '📊 Barra de progresso exibida durante o envio de arquivos grandes',
      '☁️ Bucket de armazenamento atualizado para aceitar arquivos de até 200 MB',
    ],
  },
  {
    version: '0.0.150',
    date: '2026-06-18 12:00',
    title: 'Dashboard melhorado + Indicador de finalização redesenhado',
    details: [
      '📊 "Não lidas agora" agora mostra o número real por usuário (não mais o contador global)',
      '⏳ Novo card "Não respondidas" — conversas aguardando resposta, usando lógica de finalização real',
      '✅ Indicador de finalização de conversa redesenhado: círculo verde sólido com pulsação e ícone de badge',
      '🔄 Os dois cards do dashboard atualizam automaticamente ao marcar conversas como finalizadas',
    ],
  },
  {
    version: '0.0.149',
    date: '2026-06-17 17:00',
    title: 'Novo ícone do aplicativo',
    details: [
      '🎨 Ícone do app atualizado — novo visual azul com blocos e badge IA',
      '🖥️ O novo ícone aparece no atalho da Área de Trabalho, na barra de tarefas e no instalador',
      '🔄 Reinstale o app (caso já tenha instalado) para ver o ícone atualizado na barra de tarefas',
    ],
  },
  {
    version: '0.0.139',
    date: '2026-06-10 18:00',
    title: 'Autores de grupo com nome certo',
    details: [
      '👥 Conversas de grupo agora mostram o nome de quem enviou cada mensagem',
      '🏷️ O nome aparece em um selo destacado no começo do bloco de mensagens',
      '🔄 Quando muda de pessoa, o selo aparece de novo pra ficar claro quem falou',
      '🧹 Mensagens antigas com numeros foram limpas e agora mostram o nome correto',
      '📲 Mensagens agendadas ganharam botao Reenviar e erro mais detalhado',
    ],
  },
  {
    version: '0.0.139',
    date: '2026-06-10 14:07',
    title: 'Fechar conversa com Esc',
    details: [
      '⌨️ Agora você pode fechar a conversa apertando a tecla Esc, igual ao WhatsApp Web',
      '🪟 Se tiver uma janela aberta dentro do chat, o Esc fecha ela primeiro',
      '↩️ O botão de voltar no celular também ficou mais rápido',
    ],
  },
  {
    version: '0.0.139',
    date: '2026-06-10 13:48',
    title: 'A aba Chat ficou estável',
    details: [
      '🩹 Corrigimos um problema que fazia a conversa sumir do nada',
      '🔧 Pequenos ajustes para o menu de opções funcionar certinho',
      '✅ Tudo testado e aprovado',
    ],
  },
  {
    version: '0.0.139',
    date: '2026-06-10 13:37',
    title: 'Controle de conversas respondidas',
    details: [
      '🏷️ Cada conversa agora guarda se você já respondeu ou não',
      '🔄 Aparece um botão verde para marcar que você já respondeu',
      '📋 Também dá para marcar ou desmarcar pelo menu de opções',
      '📱 Uma bolinha azul pisca para lembrar que ainda precisa responder',
    ],
  },
  {
    version: '0.0.139',
    date: '2026-06-10 13:19',
    title: 'Filtros para organizar conversas',
    details: [
      '🔍 Filtre por período: Hoje, Ontem, Últimos 3 ou 7 dias',
      '🏁 Veja só conversas Não lidas ou Fixadas',
      '📌 Mostre ou oculte conversas Arquivadas e Não respondidas',
      '🧹 Botão "Remover" para limpar todos os filtros de uma vez',
    ],
  },
  {
    version: '0.0.139',
    date: '2026-06-10 12:03',
    title: 'Conversas não lidas organizadas',
    details: [
      '📬 Ajustamos a contagem de conversas não lidas para ficar correta',
      '🏷️ Agora você pode ver só as conversas Não lidas ou Fixadas',
      '⚡ Tudo isso sem precisar de configuração extra',
    ],
  },
  {
    version: '0.0.139',
    date: '2026-06-10 10:37',
    title: 'Login mais rápido e sem travamentos',
    details: [
      '🔓 Corrigimos um problema que fazia a tela ficar preta depois do login',
      '🚫 Aquela mensagem "Carregando..." que não sumia não aparece mais',
      '👤 Recarregar a página ou voltar de outra aba ficou muito mais suave',
    ],
  },
  {
    version: '0.0.139',
    date: '2026-06-10 09:10',
    title: 'Sistema mais rápido no dia a dia',
    details: [
      '⚡ As páginas agora carregam só quando você precisa delas',
      '🧠 A busca de conversas ficou mais rápida e fluida',
      '📱 Melhorias no consumo de bateria e desempenho geral',
      '🎨 A experiência no celular também ficou mais leve',
    ],
  },
]
