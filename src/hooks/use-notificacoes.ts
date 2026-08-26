import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '@/hooks/use-auth'
import { useRealtime } from '@/hooks/use-realtime'
import { getRawDevicePrefs } from '@/hooks/use-notification-prefs'
import { janelaEmPrimeiroPlano, mostrarNotificacao } from '@/lib/notificacao-do-sistema'
import { tocarSomDeNotificacao } from '@/lib/som-de-notificacao'
import {
  definirCarregando,
  definirNotificacoes,
  empilharNotificacao,
  lerNotificacoes,
  limparNotificacoes,
  marcarLidaLocal,
  subscreverNotificacoes,
} from '@/stores/notificacoes'
import {
  contarNaoLidas,
  getNotificacoes,
  limparLidas,
  marcarLida,
  marcarTodasLidas,
  type Notificacao,
} from '@/services/notificacoes'

/**
 * A chave de preferência da Agenda.
 *
 * `useNotificationPrefs` é indexado por APARELHO do WhatsApp, e agenda não tem
 * aparelho — mas o mapa é `Record<string, DevicePrefs>`, livre. O prefixo
 * `app:` deixa claro que não é aparelho; os ids de device são UUID, então não
 * há colisão possível. Assim a preferência ganha de graça a persistência no
 * perfil e o espelho local, sem tabela nem migration.
 */
export const PREF_AGENDA = 'app:agenda'

async function buscarTudo() {
  const [lista, naoLidas] = await Promise.all([getNotificacoes(), contarNaoLidas()])
  definirNotificacoes(lista, naoLidas)
  return lista
}

/** Só leitura e ações — para o sino desenhar. Pode ser usado em vários lugares. */
export function useCaixaDeNotificacoes() {
  const estado = useSyncExternalStore(subscreverNotificacoes, lerNotificacoes)

  const recarregar = useCallback(async () => {
    try {
      await buscarTudo()
    } catch {
      /* silencioso: sino vazio é melhor que tela quebrada */
    }
  }, [])

  const lerUma = useCallback(
    async (id: string) => {
      marcarLidaLocal(id)
      try {
        await marcarLida(id)
      } catch {
        void recarregar()
      }
    },
    [recarregar],
  )

  const lerTodas = useCallback(async () => {
    try {
      await marcarTodasLidas()
    } finally {
      await recarregar()
    }
  }, [recarregar])

  const limpar = useCallback(async () => {
    try {
      await limparLidas()
    } finally {
      await recarregar()
    }
  }, [recarregar])

  return { ...estado, recarregar, lerUma, lerTodas, limpar }
}

/**
 * Carrega, escuta o realtime e dispara o pop-up do sistema.
 *
 * MONTAR NO `Layout`, uma vez só. Se morasse numa rota, desmontaria ao navegar
 * — foi assim que a notificação de mensagem sumiu fora do /chat antes.
 */
export function useNotificacoes() {
  const { user, isAuthenticated } = useAuth()
  const navigate = useNavigate()

  /**
   * O que já foi avisado. Existe por dois motivos: o canal do realtime pode
   * reconectar e reentregar, e — mais importante — tudo que veio no
   * carregamento inicial entra aqui SEM virar pop-up. Sem isso, quem abre o app
   * depois de um dia fora levaria uma saraivada de avisos de coisa velha.
   */
  const jaAvisadas = useRef<Set<string>>(new Set())

  const carregar = useCallback(async () => {
    if (!isAuthenticated || !user?.id) return
    definirCarregando(true)
    try {
      const lista = await buscarTudo()
      lista.forEach((n) => jaAvisadas.current.add(n.id))
    } catch {
      /* silencioso */
    } finally {
      definirCarregando(false)
    }
  }, [isAuthenticated, user?.id])

  useEffect(() => {
    void carregar()
  }, [carregar])

  /** Trocar de conta não pode deixar a caixa da anterior na tela. */
  useEffect(() => {
    if (!isAuthenticated) {
      limparNotificacoes()
      jaAvisadas.current.clear()
    }
  }, [isAuthenticated])

  useRealtime<Record<string, unknown>>(
    'notificacoes',
    (evento) => {
      if (evento.action !== 'create') {
        void carregar()
        return
      }
      const nova = evento.record as unknown as Notificacao
      // O realtime respeita RLS, então só chega o que é meu — mas conferir é
      // barato e protege de qualquer mudança futura de policy.
      if (!user?.id || nova.user_id !== user.id) return
      if (jaAvisadas.current.has(nova.id)) return
      jaAvisadas.current.add(nova.id)

      empilharNotificacao(nova)

      // As MESMAS preferências de mensagem nova, na chave da agenda: quem
      // desligou o som não passa a ouvir por causa da agenda.
      const prefs = getRawDevicePrefs(user.id, PREF_AGENDA)

      const somSaiu = prefs.sound ? tocarSomDeNotificacao() : false
      if (!prefs.background) return
      // Com a janela à frente, o sino e a bolinha já dizem tudo — um pop-up do
      // sistema por cima do app aberto é só estorvo.
      if (janelaEmPrimeiroPlano()) return
      if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return

      void mostrarNotificacao(
        nova.titulo,
        {
          body: nova.corpo ?? '',
          icon: '/pwa-192.png',
          tag: `notificacao-${nova.id}`,
          // Áudio bloqueado ⇒ quem apita é o sistema. Nunca ficar mudo.
          silent: !prefs.sound || somSaiu,
          url: nova.link ?? '/agenda',
        },
        (url) => navigate(url),
      )
    },
    Boolean(user?.id),
    undefined,
    () => void carregar(),
  )
}
