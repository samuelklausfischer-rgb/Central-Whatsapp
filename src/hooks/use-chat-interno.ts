import { useCallback, useEffect } from 'react'
import { useAuth } from '@/hooks/use-auth'
import { useRealtime } from '@/hooks/use-realtime'
import type { MensagemInterna } from '@/lib/supabase/chat-interno-types'
import {
  aplicarAtualizacaoDeMensagem,
  carregarResumo,
  incorporarMensagem,
  marcarConversasDesatualizadas,
  reiniciarStore,
} from '@/stores/chatInterno'

/**
 * O Chat interno que vive o app inteiro: carrega a lista de conversas e escuta
 * o Realtime. MONTAR NO `Layout`, uma vez só.
 *
 * ── Por que no Layout e não no ChatHub ──
 * O `ChatHub` é rota `lazy()` e desmonta ao navegar. Sem um dono permanente, o
 * selo de "não lidas" ficaria parado e o som nunca tocaria fora de `/chat` — a
 * mesma razão pela qual `use-notificacoes-de-mensagem.ts` mora lá.
 *
 * ── UM canal, sem filtro ──
 * Só `chat_interno_mensagens` está publicada, e a RLS entrega a cada pessoa
 * apenas as conversas dela. Filtrar por conversa exigiria um canal por conversa
 * — exatamente o padrão que derrubou o Postgres compartilhado em 02/09.
 * O que o canal NÃO diz (entrar num grupo, ser removido, mudar o nome) o app
 * descobre pela mensagem de sistema que cada uma dessas ações gera, ou relendo
 * o resumo.
 *
 * ── Sem replay ──
 * `postgres_changes` não reentrega o que passou com o socket fora do ar. Toda
 * (re)assinatura relê o resumo, e na reconexão as conversas já carregadas ficam
 * marcadas para reler o fim.
 *
 * @param ativo `false` para quem não pode usar o Whats (o Chat interno mora lá):
 *   não assina nada, não carrega nada e descarta o que houver em memória.
 */
export function useChatInterno(ativo = true) {
  const { user } = useAuth()
  const usuarioId = user?.id ?? null
  const ligado = ativo && !!usuarioId

  useEffect(() => {
    reiniciarStore(ligado ? usuarioId : null)
    if (ligado) void carregarResumo()
    // Sair (ou trocar de conta) descarta tudo: nome, texto e anexo são privados e
    // não podem sobreviver na memória para a próxima pessoa que entrar.
    return () => reiniciarStore(null)
  }, [ligado, usuarioId])

  // O app pode ter ficado minimizado por horas: ao voltar, relê a lista. Cobre o
  // que o canal não avisa (fui removido de um grupo, mudaram o nome) e o que se
  // perdeu com o socket caído. O intervalo evita uma leitura por Alt-Tab.
  useEffect(() => {
    if (!ligado) return
    const aoVoltar = () => {
      if (document.visibilityState === 'visible') void carregarResumo({ ignorarSeRecenteMs: 30_000 })
    }
    document.addEventListener('visibilitychange', aoVoltar)
    window.addEventListener('online', aoVoltar)
    return () => {
      document.removeEventListener('visibilitychange', aoVoltar)
      window.removeEventListener('online', aoVoltar)
    }
  }, [ligado])

  const aoEvento = useCallback((e: { action: 'create' | 'update' | 'delete'; record: Record<string, unknown> }) => {
    const registro = e.record as unknown as MensagemInterna
    if (!registro?.id || !registro.conversa_id) return
    if (e.action === 'create') incorporarMensagem(registro)
    else if (e.action === 'update') aplicarAtualizacaoDeMensagem(registro)
    // DELETE: ignorado de propósito. Apagar é soft (`apagada_em`), e o evento de
    // DELETE só leva a chave primária e chega a todo assinante sem passar pela RLS.
  }, [])

  useRealtime<Record<string, unknown>>(
    'chat_interno_mensagens',
    aoEvento,
    ligado,
    undefined,
    // Toda assinatura, inclusive a primeira: fecha a janela entre a leitura
    // inicial e o handshake do websocket. A leitura recente da primeira
    // vez não é repetida.
    () => void carregarResumo({ ignorarSeRecenteMs: 3_000 }),
    () => {
      marcarConversasDesatualizadas()
      void carregarResumo({ forcar: true })
    },
  )
}

export default useChatInterno
