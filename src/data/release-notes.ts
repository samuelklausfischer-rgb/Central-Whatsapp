export interface ReleaseNote {
  version: string
  date: string
  title: string
  details: string[]
}

export const releaseNotes: ReleaseNote[] = [
  {
    version: '0.0.139',
    date: '2026-06-10 14:07',
    title: 'Esc fecha conversa',
    details: [
      '⌨️ Pressionar Esc agora fecha a conversa aberta, igual WhatsApp Web',
      '🪟 Respeita modais e sheets abertos — fecha primeiro o overlay',
      '↩️ Botão voltar do mobile agora usa o mesmo fluxo centralizado',
    ],
  },
  {
    version: '0.0.139',
    date: '2026-06-10 13:48',
    title: 'Correção crash na aba Chat',
    details: [
      '🩹 `conversationDeviceId` movido antes de `isPendingReply` para evitar ReferenceError',
      '🔧 `isPendingReply` agora é extraída corretamente das props no menu de ações',
      '✅ Build e lint 100% ok',
    ],
  },
  {
    version: '0.0.139',
    date: '2026-06-10 13:37',
    title: 'Badge respondido por dispositivo + contato',
    details: [
      '🏷️ Estado "respondido" agora é por `user_id + device_id + remote_sender`',
      '🔄 Botão verde de marcar como respondido na lista de conversas',
      '📋 Menu de contexto com opção "Marcar como respondido" / "Desfazer respondido"',
      '📱 Feedback visual com bolinha azul pulsante em conversas pendentes',
    ],
  },
  {
    version: '0.0.139',
    date: '2026-06-10 13:19',
    title: 'Painel de filtros na ChatList',
    details: [
      '🔍 Filtros por Período (Hoje, Ontem, Últimos 3/7 dias)',
      '🏁 Filtros por Status (Não lidos, Fixados)',
      '📌 Checkboxes para "Não respondidas" e "Arquivadas"',
      '🧹 Botão "Remover" que reseta todos os filtros de uma vez',
    ],
  },
  {
    version: '0.0.139',
    date: '2026-06-10 12:03',
    title: 'Reset unread + filtros Todos/Não lidos/Fixados',
    details: [
      '📬 Reset geral de `manual_unread` no banco (8339 registros)',
      '🏷️ Filtros de visualização: Todos, Não lidos e Fixados',
      '⚡ Operação pontual via SQL, sem UI permanente',
    ],
  },
  {
    version: '0.0.139',
    date: '2026-06-10 10:37',
    title: 'Correção deadlock de autenticação',
    details: [
      '🔓 Callback `onAuthStateChange` síncrono + `setTimeout(0)` para evitar deadlock',
      '👤 `refreshProfile` ganhou `setLoading(false)` no ramo sem sessão',
      '🚫 Tela preta "Carregando..." após F5/alt+tab não acontece mais',
    ],
  },
  {
    version: '0.0.139',
    date: '2026-06-10 09:10',
    title: 'Otimização frontend em 7 fases',
    details: [
      '⚡ Lazy loading de rotas e componentes pesados',
      '🧠 `memo`, `useCallback` e `useMemo` nos pontos críticos',
      '🗺️ Map lookups em vez de arrays para estados de conversa',
      '⌨️ `useDeferredValue` na busca para manter fluidez',
      '🎨 Removido backdrop-blur pesado do layout',
    ],
  },
]
