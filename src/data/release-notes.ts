export interface ReleaseNote {
  version: string
  date: string
  title: string
  details: string[]
}

export const releaseNotes: ReleaseNote[] = [
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
