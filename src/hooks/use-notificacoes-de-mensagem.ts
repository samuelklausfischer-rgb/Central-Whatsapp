import { useCallback, useEffect, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import supabase from '@/lib/supabase/client'
import { useAuth } from '@/hooks/use-auth'
import { useRealtime } from '@/hooks/use-realtime'
import { getRawDevicePrefs, type DevicePrefs } from '@/hooks/use-notification-prefs'
import { getDeviceSnapshot } from '@/stores/conversationSummaries'
import { chaveDaConversa } from '@/stores/conversationMessages'
import { registrarDestravamentoDeAudio, tocarSomDeNotificacao } from '@/lib/som-de-notificacao'
import { janelaEmPrimeiroPlano, mostrarNotificacao } from '@/lib/notificacao-do-sistema'

/**
 * Aviso de mensagem nova — som e notificação do sistema.
 *
 * ── Por que isto saiu do ChatHub ──
 *
 * Estava dentro de `pages/ChatHub.tsx`, que é uma rota `lazy()`. Sair do
 * WhatsApp para o Painel, o CRM, a Agenda ou qualquer ferramenta DESMONTAVA o
 * componente, o `useRealtime` removia o canal, e a partir dali não chegava mais
 * nenhum aviso — nem som, nem notificação. Era a maior causa de "não fui
 * avisado": bastava não estar com a tela de Conversas aberta.
 *
 * Agora mora no `Layout`, que é montado dentro do `ProtectedRoute` e não
 * desmonta na navegação interna — mesmo lugar e mesmo motivo do
 * `BroadcastListener`.
 *
 * ── O que este hook garante ──
 *
 * 1. Aviso em qualquer tela do app, não só em `/chat`.
 * 2. Nunca ficar mudo: se a política de autoplay bloqueou o nosso som, a
 *    notificação vai com `silent: false` e quem apita é o sistema operacional.
 * 3. Um aviso por CONVERSA (via `tag`), não um por mensagem.
 * 4. Com a janela fora de foco, o aviso não some sozinho (`requireInteraction`).
 * 5. Mensagem que chegou enquanto o socket estava caído não some em silêncio —
 *    ver `recuperarPerdidas`.
 *
 * O que ele NÃO faz: avisar com o app fechado. Isso exige Web Push (chaves
 * VAPID, tabela de inscrições e disparo dentro da edge function
 * `evolution-webhook`), que ficou fora desta rodada. Com o app fechado não há
 * JavaScript rodando e nenhuma notificação é possível.
 */

const PADRAO: DevicePrefs = { sound: true, background: true }

/** Acima disto, um aviso agregado em vez de uma enxurrada de toasts. */
const MAX_AVISOS_NA_RECUPERACAO = 5
/** Teto do que a recuperação lê de uma vez. */
const MAX_MENSAGENS_NA_RECUPERACAO = 50

const RECADO_ABRIR_CONVERSA = 'abrir-conversa'

interface MensagemRecuperada {
  device_id: string
  remote_sender: string
  sender_name: string | null
  content: string | null
  created_at: string
}

function previaDaMensagem(content: string | null | undefined): string {
  return content?.slice(0, 80) || '📎 Mídia'
}

function nomeDoRemetente(senderName: string | null | undefined, remoteSender: string): string {
  return senderName || remoteSender.split('@')[0] || 'Contato'
}

function enderecoDaConversa(deviceId: string, remoteSender: string): string {
  return `/chat?device=${encodeURIComponent(deviceId)}&jid=${encodeURIComponent(remoteSender)}`
}

/**
 * Comparação de carimbos por VALOR, não por texto.
 *
 * Os dois lados não têm o mesmo formato: o Postgres devolve
 * `2026-08-25T14:22:33.123456+00:00` e o JavaScript escreve
 * `2026-08-25T14:22:33.123Z`. Comparado como string, o `Z` (0x5A) vence
 * qualquer dígito, então um carimbo mais NOVO do banco seria julgado mais
 * antigo — e a marca d'água travaria ou daria saltos. `Date.parse` resolve os
 * dois formatos.
 *
 * Carimbo ilegível conta como mais recente: avisar de novo é melhor do que
 * silenciar para sempre por causa de um valor estranho.
 */
function maisRecente(candidato: string, atual: string | null): boolean {
  if (!atual) return true
  const a = Date.parse(candidato)
  const b = Date.parse(atual)
  if (Number.isNaN(a) || Number.isNaN(b)) return true
  return a > b
}

export function useNotificacoesDeMensagem() {
  const { user, allowedDevices } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  /**
   * Carimbo da mensagem mais recente já avisada — a marca d'água da recuperação.
   *
   * Só em ref, de propósito: numa carga nova nasce vazio e é semeado pela
   * primeira assinatura, então ninguém é notificado de histórico. Persistir isto
   * faria a sessão reabrir disparando avisos de mensagens antigas.
   */
  const ultimoAvisadoRef = useRef<string | null>(null)

  const irPara = useCallback((url: string) => {
    // Só caminho interno. O destino vem do nosso próprio service worker, mas
    // navegar com o que chega por `postMessage` sem conferir é o tipo de porta
    // que não vale a pena deixar aberta.
    if (!url.startsWith('/') || url.startsWith('//')) return
    navigate(url)
  }, [navigate])

  // ── Destravar o áudio no primeiro gesto, em qualquer tela ──────────────────
  useEffect(() => registrarDestravamentoDeAudio(), [])

  // ── Clique na notificação vindo do service worker ─────────────────────────
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    const aoRecado = (evento: MessageEvent) => {
      const dado = evento.data as { tipo?: string; url?: string } | null
      if (dado?.tipo !== RECADO_ABRIR_CONVERSA || typeof dado.url !== 'string') return
      irPara(dado.url)
    }
    navigator.serviceWorker.addEventListener('message', aoRecado)
    return () => navigator.serviceWorker.removeEventListener('message', aoRecado)
  }, [irPara])

  const nomeDoAparelho = useCallback(
    (deviceId: string) => allowedDevices.find((d) => d.id === deviceId)?.name || 'WhatsApp',
    [allowedDevices],
  )

  /**
   * A conversa já é de outra pessoa?
   *
   * Lê do store de escopo de módulo (`conversationSummaries`), que sobrevive ao
   * desmonte do ChatHub. Antes esta checagem usava o estado React do ChatHub e
   * por isso só valia para o aparelho ABERTO — mensagem de outra instância
   * consultava o dono errado. Agora cobre todo aparelho já visitado na sessão.
   *
   * Sem informação, o padrão continua sendo AVISAR: perder aviso de mensagem é
   * pior do que um aviso a mais.
   */
  const deOutraPessoa = useCallback(
    (deviceId: string, remoteSender: string) => {
      const atribuicao = getDeviceSnapshot(deviceId)?.assignments.get(
        chaveDaConversa(deviceId, remoteSender),
      )
      return atribuicao?.assigned_to != null && atribuicao.assigned_to !== user?.id
    },
    [user?.id],
  )

  /**
   * A conversa está aberta na tela e a pessoa está olhando para ela? Então não
   * há o que avisar.
   *
   * O `startsWith('/chat')` não é redundante: o ChatHub grava `activeContactJid`
   * no sessionStorage mas não limpa ao desmontar, então o valor sobrevive à
   * navegação para o Painel. Sem conferir a rota, mensagem da última conversa
   * aberta ficaria silenciada em todas as outras telas.
   */
  const conversaEmFoco = useCallback(
    (deviceId: string, remoteSender: string) => {
      if (!location.pathname.startsWith('/chat')) return false
      if (!janelaEmPrimeiroPlano()) return false
      return (
        sessionStorage.getItem('activeDeviceId') === deviceId &&
        sessionStorage.getItem('activeContactJid') === remoteSender
      )
    },
    [location.pathname],
  )

  const avisar = useCallback(
    (
      deviceId: string,
      remoteSender: string,
      prefs: DevicePrefs,
      titulo: string,
      corpo: string,
    ) => {
      const somSaiu = prefs.sound ? tocarSomDeNotificacao() : false

      if (!prefs.background) return
      if (!('Notification' in window) || Notification.permission !== 'granted') return

      void mostrarNotificacao(
        titulo,
        {
          body: corpo,
          icon: '/pwa-192.png',
          badge: '/favicon-96.png',
          // `silent: false` quando o nosso som não saiu — é o que impede a
          // notificação de ser completamente muda com o áudio bloqueado pela
          // política de autoplay. Ver `lib/som-de-notificacao.ts`.
          silent: !prefs.sound || somSaiu,
          // Um aviso por conversa: uma rajada de 10 mensagens atualiza o mesmo
          // toast em vez de empilhar 10 no canto da tela.
          tag: `msg-${deviceId}-${remoteSender}`,
          renotify: true,
          // Com a janela fora de foco o aviso fica até alguém mexer nele. Era o
          // caso do pedido: "estou em outro programa e o aviso some antes de eu
          // ver". Com a janela na frente, comportamento normal.
          requireInteraction: !janelaEmPrimeiroPlano(),
          url: enderecoDaConversa(deviceId, remoteSender),
        } as NotificationOptions & { url: string },
        irPara,
      )
    },
    [irPara],
  )

  /**
   * Mensagens que chegaram enquanto o socket estava caído.
   *
   * Com a janela minimizada o navegador estrangula os timers da página; se o
   * heartbeat do Realtime cair nessa faixa, o socket morre. E `postgres_changes`
   * NÃO tem replay: tudo que chegou no intervalo nunca vira evento. O
   * `reconnectIfStale` do `use-realtime` reassina, mas não recupera o passado —
   * é este trecho que fecha esse buraco, no gancho `onSubscribed` que o próprio
   * hook já expõe justamente para isso.
   */
  const recuperarPerdidas = useCallback(async () => {
    const desde = ultimoAvisadoRef.current
    const uid = user?.id
    if (!desde || !uid) return

    const { data, error } = await supabase
      .from('messages')
      .select('device_id, remote_sender, sender_name, content, created_at')
      .eq('direction', 'inbound')
      .gt('created_at', desde)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(MAX_MENSAGENS_NA_RECUPERACAO)

    if (error || !data?.length) return

    const mensagens = data as MensagemRecuperada[]
    ultimoAvisadoRef.current = mensagens[0].created_at

    // Uma entrada por conversa, já com a mensagem mais recente dela (a consulta
    // vem em ordem decrescente, então a primeira que aparece é a mais nova).
    const porConversa = new Map<string, MensagemRecuperada>()
    for (const msg of mensagens) {
      const prefs = getRawDevicePrefs(uid, msg.device_id) ?? PADRAO
      if (!prefs.sound && !prefs.background) continue
      if (deOutraPessoa(msg.device_id, msg.remote_sender)) continue
      if (conversaEmFoco(msg.device_id, msg.remote_sender)) continue
      const chave = chaveDaConversa(msg.device_id, msg.remote_sender)
      if (!porConversa.has(chave)) porConversa.set(chave, msg)
    }

    if (porConversa.size === 0) return

    if (porConversa.size <= MAX_AVISOS_NA_RECUPERACAO) {
      for (const msg of porConversa.values()) {
        avisar(
          msg.device_id,
          msg.remote_sender,
          getRawDevicePrefs(uid, msg.device_id) ?? PADRAO,
          nomeDoAparelho(msg.device_id),
          `${nomeDoRemetente(msg.sender_name, msg.remote_sender)}: ${previaDaMensagem(msg.content)}`,
        )
      }
      return
    }

    // Acima do teto, um aviso só. Abrir leva para o WhatsApp, sem escolher
    // conversa — nenhuma delas é mais "a certa" que as outras.
    const primeira = porConversa.values().next().value as MensagemRecuperada
    const somSaiu = tocarSomDeNotificacao()
    if (!('Notification' in window) || Notification.permission !== 'granted') return
    void mostrarNotificacao(
      'Mensagens novas',
      {
        body: `${mensagens.length} mensagens em ${porConversa.size} conversas enquanto você esteve fora`,
        icon: '/pwa-192.png',
        badge: '/favicon-96.png',
        silent: somSaiu,
        tag: 'msg-recuperacao',
        renotify: true,
        requireInteraction: !janelaEmPrimeiroPlano(),
        url: enderecoDaConversa(primeira.device_id, primeira.remote_sender),
      } as NotificationOptions & { url: string },
      irPara,
    )
  }, [user?.id, deOutraPessoa, conversaEmFoco, avisar, nomeDoAparelho, irPara])

  /**
   * Semeia a marca d'água com a mensagem mais nova QUE JÁ EXISTE NO BANCO.
   *
   * Não com o relógio do cliente: se ele estiver atrasado em relação ao
   * servidor, a primeira reconexão varreria esse intervalo e despejaria um
   * punhado de avisos de mensagens velhas — o app "explodindo notificações do
   * nada". O relógio do banco é o mesmo que carimba `created_at`, então é o
   * único que compara certo consigo mesmo.
   *
   * Se falhar, a marca fica vazia e a recuperação simplesmente não roda até a
   * próxima assinatura tentar de novo. Degradar para "sem recuperação" é seguro;
   * degradar para "avisos antigos" não é.
   */
  const semear = useCallback(async () => {
    const { data } = await supabase
      .from('messages')
      .select('created_at')
      .eq('direction', 'inbound')
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(1)
    const topo = (data as { created_at: string }[] | null)?.[0]?.created_at
    if (topo) ultimoAvisadoRef.current = topo
  }, [])

  const aoAssinar = useCallback(() => {
    if (!user?.id) return
    // Sem marca d'água ainda? Então esta é a primeira assinatura desta sessão:
    // semeia e não avisa nada. Com marca, é reconexão: recupera o intervalo.
    if (!ultimoAvisadoRef.current) {
      void semear()
      return
    }
    void recuperarPerdidas()
  }, [user?.id, semear, recuperarPerdidas])

  useRealtime(
    'messages',
    (e) => {
      if (e.action !== 'create' || e.record.direction !== 'inbound') return

      const uid = user?.id
      const deviceId = e.record.device_id as string
      const remoteSender = e.record.remote_sender as string
      if (!deviceId || !remoteSender) return

      // A marca d'água sobe ANTES das supressões abaixo, de propósito: mensagem
      // que decidimos não anunciar (conversa em foco, conversa de outra pessoa)
      // também já foi "vista". Sem isto, a recuperação da próxima reconexão a
      // traria de volta como novidade.
      const criadaEm = e.record.created_at as string | undefined
      if (criadaEm && maisRecente(criadaEm, ultimoAvisadoRef.current)) {
        ultimoAvisadoRef.current = criadaEm
      }

      const prefs = uid ? getRawDevicePrefs(uid, deviceId) : PADRAO
      if (!prefs.sound && !prefs.background) return
      if (deOutraPessoa(deviceId, remoteSender)) return
      if (conversaEmFoco(deviceId, remoteSender)) return

      avisar(
        deviceId,
        remoteSender,
        prefs,
        nomeDoAparelho(deviceId),
        `${nomeDoRemetente(e.record.sender_name as string | null, remoteSender)}: ${previaDaMensagem(e.record.content as string | null)}`,
      )
    },
    !!user?.id,
    undefined,
    aoAssinar,
  )
}

export default useNotificacoesDeMensagem
