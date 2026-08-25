import { useEffect, useState } from 'react'
import supabase from '@/lib/supabase/client'

/**
 * Preferências de notificação por aparelho.
 *
 * ── Quem é a fonte da verdade ──
 *
 * O **perfil no servidor** (`profiles.notification_prefs`). O `localStorage`
 * continua existindo, mas rebaixado a ESPELHO — e por um motivo concreto:
 * `getRawDevicePrefs` é chamado de dentro do callback de Realtime, que é
 * síncrono e não pode esperar rede. O espelho é o que permite a leitura
 * instantânea sem abrir mão da configuração seguir a pessoa.
 *
 * ── Por que mudou ──
 *
 * Antes isto vivia SÓ no localStorage, que é por navegador/aplicativo. O app
 * Electron, o PWA instalado e cada aba do Chrome tinham configurações
 * independentes, e quem não tem registro cai no `PADRAO` abaixo — tudo ligado.
 * Resultado real: quem silenciou aparelhos no desktop e abriu o app na web
 * ouvia o aviso de TODOS eles de novo. O modo de falhar era sempre o barulhento,
 * que é o pior dos dois.
 */

const KEY_PREFIX = 'notif_prefs_'

export type DevicePrefs = { sound: boolean; background: boolean }
type AllPrefs = Record<string, DevicePrefs>

/**
 * Aparelho sem registro AVISA. É deliberado: aparelho novo que aparece calado
 * seria descoberto só quando alguém reclamasse de mensagem não respondida.
 * O preço desse padrão era o bug acima — que some agora que a configuração
 * atravessa navegadores.
 */
const PADRAO: DevicePrefs = { sound: true, background: true }

function load(userId: string): AllPrefs {
  try {
    return JSON.parse(localStorage.getItem(KEY_PREFIX + userId) || '{}')
  } catch {
    return {}
  }
}

function persistLocal(userId: string, prefs: AllPrefs) {
  localStorage.setItem(KEY_PREFIX + userId, JSON.stringify(prefs))
}

function persistServidor(userId: string, prefs: AllPrefs) {
  // Sem `await` e sem propagar erro: a escrita local já aconteceu, então a tela
  // responde na hora e o aviso continua correto neste aparelho mesmo se a rede
  // falhar. A próxima mudança reenvia o objeto INTEIRO, então uma falha isolada
  // se corrige sozinha na tentativa seguinte.
  void supabase
    .from('profiles')
    .update({ notification_prefs: prefs })
    .eq('id', userId)
    .then(undefined, () => {})
}

/** Leitura direta do espelho — usar em callbacks Realtime (fora do ciclo React). */
export function getRawDevicePrefs(userId: string, deviceId: string): DevicePrefs {
  return load(userId)[deviceId] ?? PADRAO
}

/** Só uma promoção por sessão, senão cada TOKEN_REFRESHED tentaria de novo. */
let jaPromoveu = false

/**
 * Alinha o espelho local com o perfil. Chamado no carregamento da sessão
 * (`use-auth`), onde o perfil já vem na mão — sem round trip extra.
 *
 * Servidor com dado vence, sempre. Servidor vazio + local com dado significa
 * "esta pessoa já tinha configurado antes desta mudança": o local sobe uma
 * única vez e vira a configuração de todos os aparelhos dela. É isso que faz o
 * ajuste feito no app desktop reaparecer sozinho na web, sem ninguém refazer.
 */
export function sincronizarPrefsDoPerfil(
  userId: string,
  doServidor: AllPrefs | null | undefined,
): void {
  const servidor = doServidor && typeof doServidor === 'object' ? doServidor : {}

  if (Object.keys(servidor).length > 0) {
    persistLocal(userId, servidor)
    jaPromoveu = true
    return
  }

  if (jaPromoveu) return
  jaPromoveu = true

  const local = load(userId)
  if (Object.keys(local).length > 0) persistServidor(userId, local)
}

/** Chamado no logout: a próxima pessoa a entrar precisa da própria promoção. */
export function esquecerPromocaoDePrefs(): void {
  jaPromoveu = false
}

export function useNotificationPrefs(userId: string | undefined) {
  const [prefs, setPrefs] = useState<AllPrefs>(() => (userId ? load(userId) : {}))

  /**
   * Recarrega quando o `userId` chega ou muda.
   *
   * O `useState` acima só roda o inicializador UMA vez. Se este hook montasse
   * antes de a sessão resolver, o estado ficaria preso em `{}` para sempre: a
   * tela mostraria tudo ligado (o padrão) e, pior, o primeiro toque salvaria
   * `{...{}, [aparelho]: ...}` — APAGANDO a configuração dos outros aparelhos.
   * Também é este efeito que traz o que a sincronização com o perfil acabou de
   * gravar no espelho.
   */
  useEffect(() => {
    setPrefs(userId ? load(userId) : {})
  }, [userId])

  function getPrefs(deviceId: string): DevicePrefs {
    return prefs[deviceId] ?? PADRAO
  }

  /**
   * Grava nos dois lados e no estado. Recebe o objeto pronto e é chamada FORA
   * de qualquer `setState((prev) => ...)`: no StrictMode o updater roda duas
   * vezes, e um efeito colateral lá dentro viraria duas escritas — mesma
   * cautela já anotada em `ChatHub.tsx` para os refs.
   */
  function aplicar(next: AllPrefs) {
    setPrefs(next)
    if (!userId) return
    persistLocal(userId, next)
    persistServidor(userId, next)
  }

  function update(deviceId: string, patch: Partial<DevicePrefs>) {
    aplicar({
      ...prefs,
      [deviceId]: { ...(prefs[deviceId] ?? PADRAO), ...patch },
    })
  }

  function toggleSound(deviceId: string) {
    update(deviceId, { sound: !getPrefs(deviceId).sound })
  }

  function toggleBackground(deviceId: string) {
    update(deviceId, { background: !getPrefs(deviceId).background })
  }

  function setAllSound(enabled: boolean, deviceIds: string[]) {
    const next: AllPrefs = { ...prefs }
    deviceIds.forEach((id) => {
      next[id] = { ...(next[id] ?? PADRAO), sound: enabled }
    })
    aplicar(next)
  }

  function setAllBackground(enabled: boolean, deviceIds: string[]) {
    const next: AllPrefs = { ...prefs }
    deviceIds.forEach((id) => {
      next[id] = { ...(next[id] ?? PADRAO), background: enabled }
    })
    aplicar(next)
  }

  return { getPrefs, toggleSound, toggleBackground, setAllSound, setAllBackground }
}
