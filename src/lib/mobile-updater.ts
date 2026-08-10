import { CapacitorUpdater } from '@capgo/capacitor-updater'
import { getAppPlatform } from '@/lib/app-info'

/**
 * Confirma para o plugin `@capgo/capacitor-updater` que o bundle JS atual
 * carregou e rodou. SEM esta chamada, dentro de `appReadyTimeout` (10s por
 * padrão) o plugin entende que o bundle está quebrado e faz ROLLBACK
 * automático para o anterior — o OTA nunca funciona e não sobra nenhum erro
 * óbvio para investigar, só um app que parece nunca atualizar.
 *
 * Só faz sentido no APK: o plugin não existe no Electron nem no navegador
 * (`getAppPlatform()` — ver `src/lib/app-info.ts` — já distingue os três
 * ambientes que este bundle atende). Chamar fora do Android nativo seria uma
 * chamada nativa que não tem para onde ir.
 *
 * Envolvido em try/catch e sem `await` no chamador de propósito: um erro
 * aqui (ou o próprio plugin ausente) não pode derrubar o boot do app em
 * nenhuma plataforma.
 *
 * O `.catch()` não é redundante com o `try/catch`: este último só pega o que
 * for lançado de forma síncrona na chamada. `notifyAppReady()` devolve uma
 * Promise, e uma rejeição dela escaparia como unhandled rejection — que no
 * WebView do Android aparece como erro solto no console e polui justamente o
 * diagnóstico do OTA, que é o que este arquivo existe para viabilizar.
 */
export function notifyMobileUpdaterReady(): void {
  if (getAppPlatform() !== 'android') return
  try {
    CapacitorUpdater.notifyAppReady().catch(() => {
      /* rejeição assíncrona: silenciosa, mesma razão do catch abaixo */
    })
  } catch {
    /* nunca deixar isto derrubar o boot do app */
  }
}
