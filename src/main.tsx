/* Main entry point for the application - renders the root React component */
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import './main.css'
import { notifyMobileUpdaterReady } from './lib/mobile-updater'
import { getAppPlatform } from './lib/app-info'
import {
  CHAVE_RECARGA,
  EVENTO_VERSAO_NOVA,
  avisoAtendido,
  registrarRastro,
} from './lib/recarga-forcada'

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
 *
 * Com o precache do PWA ativo (build web), o Workbox mantém os chunks da
 * versão instalada no cache e os serve mesmo se o `/assets/` já tiver sido
 * trocado no servidor — então este evento passa a quase nunca disparar na
 * prática. A trava "uma tentativa por aba" acima segue valendo do mesmo jeito
 * para os casos em que ainda dispara (ex.: SW desatualizando em background).
 */
/**
 * ITEM 3 — a recarga deixou de ser às escondidas.
 *
 * Antes isto chamava `window.location.reload()` direto. Funcionava, mas era
 * vivido do lado de cá como "abri uma conversa e o app voltou para o início":
 * a pessoa clica num contato, o pedaço da tela de Conversas toma 404 (é o
 * primeiro `import()` sob demanda depois do deploy, exatamente como o
 * comentário acima descreve), e a tela inteira reinicia sem explicação nenhuma.
 *
 * Agora o app AVISA e deixa a pessoa mandar recarregar. A recarga continua
 * sendo o conserto certo — o que muda é ela deixar de ser um susto.
 *
 * A rede de segurança segue existindo: se o pedaço que falhou for justamente o
 * que desenharia o aviso, ninguém atende e a recarga acontece sozinha, senão a
 * pessoa ficaria olhando uma tela quebrada. Nos dois caminhos fica um rastro,
 * que é o que permite confirmar ou descartar este diagnóstico na próxima vez —
 * ver `lib/recarga-forcada.ts`.
 */
const ESPERA_PELO_AVISO_MS = 5000

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
  registrarRastro('preload')
  console.warn('[preload] chunk ausente após deploy — oferecendo recarga')

  window.dispatchEvent(new CustomEvent(EVENTO_VERSAO_NOVA))

  setTimeout(() => {
    if (avisoAtendido()) return
    console.warn('[preload] ninguém desenhou o aviso — recarregando sozinho')
    window.location.reload()
  }, ESPERA_PELO_AVISO_MS)
})

// @skip-protected: Do not remove. Required for React rendering.
createRoot(document.getElementById('root')!).render(<App />)

// Chamado logo após o `render()`, sem esperar dados ou autenticação: o plugin
// de OTA (`@capgo/capacitor-updater`) só quer saber se o bundle JS carregou e
// executou, não se o app terminou de montar a tela. Ver `mobile-updater.ts`
// para o porquê disto ser obrigatório (sem isto, rollback automático do OTA).
notifyMobileUpdaterReady()

/**
 * Registro do service worker — SÓ na web.
 *
 * O import de `virtual:pwa-register` é dinâmico de propósito: o módulo só
 * existe quando `VitePWA` está ativo (`PWA=1`, só no script `build`). Em
 * `build:electron`/`build:mobile` (sem a flag) e em `npm run dev` o módulo não
 * existe — o `import()` rejeita em tempo de execução e o `.catch()` engole o
 * erro silenciosamente, sem quebrar o app. O guard de plataforma abaixo é a
 * defesa principal (Electron e o WebView do Android, que roda em
 * `https://localhost` — contexto seguro — nunca devem registrar um SW, que
 * brigaria com o OTA do `@capgo/capacitor-updater`); o `.catch()` é só para
 * não estourar em builds web sem a flag (dev, `build:dev`).
 *
 * Sobre o `@ts-expect-error` abaixo: os tipos de `virtual:pwa-register` vêm
 * de `vite-plugin-pwa/client`, referenciado normalmente via triple-slash em
 * `src/vite-env.d.ts` — arquivo que esta tarefa não autoriza editar. Uma
 * `declare module 'virtual:pwa-register' {...}` direto aqui em `main.tsx` não
 * funciona: como este arquivo já é um módulo ES (tem imports no topo), o
 * compilador trata `declare module` como AUGMENTATION de um módulo existente
 * (erro TS2664 "Invalid module name in augmentation"), não como declaração de
 * um módulo novo — isso só é válido dentro de um arquivo `.d.ts`. O
 * `@ts-expect-error` é o jeito de suprimir o TS2307 ("Cannot find module")
 * sem inventar tipos incorretos; `registerSW` fica com tipo implícito, o que
 * o `tsconfig` já permite (`noImplicitAny: false`).
 */
if (getAppPlatform() === 'web') {
  // @ts-expect-error - módulo virtual só existe com VitePWA ativo (PWA=1); ver comentário acima
  import('virtual:pwa-register')
    .then(({ registerSW }) => {
      registerSW({ immediate: true })
    })
    .catch(() => {
      // Plugin de PWA desligado neste build (dev local ou build:dev) — sem
      // service worker é o comportamento esperado.
    })
}
