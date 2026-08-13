/* Main entry point for the application - renders the root React component */
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import './main.css'
import { notifyMobileUpdaterReady } from './lib/mobile-updater'
import { getAppPlatform } from './lib/app-info'

/**
 * Chunk que sumiu do servidor porque saiu um deploy novo.
 *
 * O `index.html` é servido com `no-cache` e os bundles com hash são `immutable`
 * — a configuração certa. Mas uma aba JÁ CARREGADA nunca mais consulta o
 * `index.html`: ela segue com o grafo de módulos do build antigo. Como cada
 * deploy sobe uma imagem Docker nova e troca o `/assets/` inteiro
 * (`Dockerfile`: `COPY --from=build /app/dist /usr/share/nginx/html`), o
 * primeiro `import()` sob demanda depois do deploy pede um arquivo que não
 * existe mais e toma 404. Numa clínica a aba fica aberta o dia inteiro, então
 * isso acontece com frequência.
 *
 * REGISTRADO ANTES DO `render()` de propósito: é o único ponto que roda antes
 * do primeiro `lazy()` disparar durante a renderização.
 *
 * DUAS GUARDAS, as duas obrigatórias:
 *
 * 1. SÓ NA WEB. No Electron e no APK o bundle vem do disco ou do OTA, que troca
 *    de forma atômica entre execuções — não existe 404 possível ali, e
 *    recarregar serviria exatamente os mesmos arquivos. Seria um reload que
 *    nunca conserta, ou seja, um laço.
 *
 * 2. UMA TENTATIVA POR ABA. Sem a trava, um erro que a recarga não resolve vira
 *    reload infinito e o app fica inutilizável. A flag é de sessão (por aba),
 *    não por deploy: um deploy legítimo mais tarde abre uma sessão nova e volta
 *    a ter direito à sua tentativa.
 */
const CHAVE_RECARGA = 'preload-error-recarregado'

window.addEventListener('vite:preloadError', (event) => {
  if (getAppPlatform() !== 'web') return

  if (sessionStorage.getItem(CHAVE_RECARGA)) {
    // Já tentamos. Deixa o erro seguir para quem trata: o ErrorBoundary mostra
    // a tela de recarregar, e o toast do compositor mostra a mensagem traduzida.
    console.error('[preload] recarga já tentada nesta aba; erro segue', event)
    return
  }

  event.preventDefault()
  sessionStorage.setItem(CHAVE_RECARGA, '1')
  console.warn('[preload] chunk ausente após deploy — recarregando uma vez')
  window.location.reload()
})

// @skip-protected: Do not remove. Required for React rendering.
createRoot(document.getElementById('root')!).render(<App />)

// Chamado logo após o `render()`, sem esperar dados ou autenticação: o plugin
// de OTA (`@capgo/capacitor-updater`) só quer saber se o bundle JS carregou e
// executou, não se o app terminou de montar a tela. Ver `mobile-updater.ts`
// para o porquê disto ser obrigatório (sem isto, rollback automático do OTA).
notifyMobileUpdaterReady()
