import { useEffect, useRef } from 'react'
import { getAppPlatform, getAppVersion } from '@/lib/app-info'
import { sendHeartbeat } from '@/services/app_activity'

const HEARTBEAT_MS = 120_000
/** Sem interação por mais que isto, a batida vai como ociosa. */
const IDLE_MS = 5 * 60_000
/** Teto de escrita no ref de interação (mousemove dispara dezenas de vezes por segundo). */
const INPUT_THROTTLE_MS = 1_000

/**
 * Presença do usuário para o Relatório App (super-admin).
 *
 * Coleta apenas: tempo com o app aberto, tempo com interação recente,
 * plataforma e versão. Nunca o que foi feito, digitado ou visitado.
 *
 * Toda a aritmética de tempo acontece no servidor (RPC `app_heartbeat`): daqui
 * só sai "estou vivo" e "houve interação recente". O cliente não declara
 * duração, então relógio adiantado ou aba pendurada não inflam nada.
 */
export function useAppHeartbeat(enabled: boolean) {
  const lastInputRef = useRef<number>(Date.now())
  const lastInputWriteRef = useRef<number>(0)

  useEffect(() => {
    if (!enabled) return

    const platform = getAppPlatform()
    let versao: string | null = null
    let descartado = false

    const marcarInteracao = () => {
      const agora = Date.now()
      // O ref é barato, mas `mousemove` dispara em rajada. 1 escrita/s basta:
      // a janela de ociosidade é de 5 minutos.
      if (agora - lastInputWriteRef.current < INPUT_THROTTLE_MS) return
      lastInputWriteRef.current = agora
      lastInputRef.current = agora
    }

    const bater = () => {
      if (descartado) return
      // Aba oculta não conta como app em uso.
      if (document.visibilityState !== 'visible') return
      const ativo = Date.now() - lastInputRef.current < IDLE_MS
      // Falha de rede aqui é irrelevante para o usuário — a próxima batida
      // corrige, e o corte de 5 min no servidor cobre o buraco.
      sendHeartbeat(platform, versao, ativo).catch(() => {})
    }

    const eventos: (keyof WindowEventMap)[] = ['mousemove', 'mousedown', 'keydown', 'wheel', 'touchstart']
    eventos.forEach((evt) =>
      window.addEventListener(evt, marcarInteracao, { passive: true }),
    )

    getAppVersion()
      .then((v) => {
        versao = v
        bater()
      })
      .catch(() => bater())

    const intervalo = setInterval(bater, HEARTBEAT_MS)

    return () => {
      descartado = true
      clearInterval(intervalo)
      eventos.forEach((evt) => window.removeEventListener(evt, marcarInteracao))
    }
  }, [enabled])
}

export default useAppHeartbeat
