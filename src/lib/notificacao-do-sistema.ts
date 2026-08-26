/**
 * O pop-up do sistema operacional — o mesmo para mensagem nova e para agenda.
 *
 * Estava privado dentro de `use-notificacoes-de-mensagem.ts`. Saiu para cá
 * quando as notificações de agenda passaram a precisar dele: copiar criaria a
 * segunda cópia de uma função com quatro casos de borda já documentados, e a
 * cópia envelheceria sozinha.
 */

/**
 * A janela está mesmo à frente?
 *
 * `visibilityState` sozinho não serve: no desktop ele continua 'visible' com a
 * janela atrás de outro programa — exatamente o caso em que o aviso é mais
 * necessário. `hasFocus()` é o que separa "estou olhando" de "está aberto em
 * algum lugar".
 */
export function janelaEmPrimeiroPlano(): boolean {
  return document.visibilityState === 'visible' && document.hasFocus()
}

/**
 * Mostra a notificação pelo service worker quando houver um, caindo para o
 * construtor da página quando não houver (dev, `build:dev` e Electron).
 *
 * `getRegistration()` e não `serviceWorker.ready`: o `ready` NUNCA resolve
 * quando não há service worker registrado — a promessa fica pendurada para
 * sempre e a notificação simplesmente não aconteceria nesses builds.
 *
 * O caminho do service worker não é preciosismo: é ele que dá `tag`,
 * `renotify` e `requireInteraction`, e é o único que funciona no PWA instalado
 * do Android, onde `new Notification()` é construtor ilegal e ainda por cima
 * lança (antes isso derrubava o resto do handler de Realtime junto).
 */
export async function mostrarNotificacao(
  titulo: string,
  opcoes: NotificationOptions & { url: string },
  aoClicarSemServiceWorker: (url: string) => void,
): Promise<void> {
  const { url, ...resto } = opcoes
  const comDados: NotificationOptions = { ...resto, data: { url } }

  if ('serviceWorker' in navigator) {
    try {
      const registro = await navigator.serviceWorker.getRegistration()
      if (registro) {
        await registro.showNotification(titulo, comDados)
        return
      }
    } catch {
      /* cai para o construtor da página */
    }
  }

  try {
    const notif = new Notification(titulo, comDados)
    notif.onclick = () => {
      window.focus()
      ;(window as unknown as { electronAPI?: { focusWindow?: () => void } }).electronAPI?.focusWindow?.()
      aoClicarSemServiceWorker(url)
      notif.close()
    }
  } catch {
    // Android com service worker registrado chega aqui ('Illegal constructor').
    // Engolir é o certo: um aviso perdido não pode derrubar quem chamou.
  }
}
