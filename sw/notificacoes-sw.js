/* eslint-disable no-undef */
/**
 * Clique na notificação — roda DENTRO do service worker.
 *
 * Este arquivo é colado no topo do `sw.js` gerado pelo Workbox, via
 * `workbox.importScripts` em `vite.config.ts`. É a única forma de ter um
 * `notificationclick`: esse evento só existe no service worker, e o SW do
 * projeto é gerado (`generateSW`), não escrito à mão.
 *
 * POR QUE NÃO TROCAR PARA `injectManifest`: seria preciso reescrever à mão o
 * `navigateFallback`, o `navigateFallbackDenylist` e a rota `NetworkOnly` do
 * `env-config.js` — a parte mais delicada da configuração de PWA, e a que
 * congela a URL do Supabase se sair errada (ver o comentário no `vite.config.ts`).
 * `importScripts` acrescenta este handler sem encostar em nada disso.
 *
 * O clique NÃO recarrega o app. Se já houver uma janela aberta, ela é focada e
 * recebe um `postMessage` com o destino; quem navega é o roteador do React
 * (ver `hooks/use-notificacoes-de-mensagem.ts`). Um `client.navigate()` aqui
 * faria carga completa e reiniciaria a sessão da pessoa só por ela ter clicado
 * num aviso. Só quando não existe janela nenhuma é que abrimos uma.
 *
 * Como só existe no build web com `PWA=1`, nada disto chega ao APK nem ao
 * Electron.
 */

const CANAL_DE_NOTIFICACAO = 'abrir-conversa'

self.addEventListener('notificationclick', (event) => {
  event.notification.close()

  const destino = (event.notification.data && event.notification.data.url) || '/chat'

  event.waitUntil(
    (async () => {
      const alvo = new URL(destino, self.location.origin)

      const janelas = await self.clients.matchAll({
        type: 'window',
        // Sem isto, uma aba que ainda não foi assumida por este SW (primeira
        // carga depois de um deploy) não apareceria na lista, e o clique abriria
        // uma segunda janela do app em cima da que já estava aberta.
        includeUncontrolled: true,
      })

      const nossa = janelas.find((janela) => {
        try {
          return new URL(janela.url).origin === alvo.origin
        } catch {
          return false
        }
      })

      if (nossa) {
        await nossa.focus()
        nossa.postMessage({ tipo: CANAL_DE_NOTIFICACAO, url: alvo.pathname + alvo.search })
        return
      }

      await self.clients.openWindow(alvo.href)
    })(),
  )
})
