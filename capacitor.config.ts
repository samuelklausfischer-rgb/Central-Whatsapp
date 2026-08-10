import type { CapacitorConfig } from '@capacitor/cli'

/**
 * Central Whats no Android.
 *
 * O app é o MESMO do Windows: o Capacitor embala o build do Vite que já existe,
 * sem tela reescrita. Toda a dependência de Electron são 5 métodos de foco de
 * janela e auto-update, e eles já degradam sozinhos quando a ponte não existe
 * (ver `src/lib/app-info.ts`).
 *
 * `appId` é o MESMO do instalador do Windows (`central-whats-app/builder.json`),
 * de propósito: é o identificador da aplicação, não do binário, e mantê-los
 * iguais evita duas identidades para o mesmo produto.
 */
const config: CapacitorConfig = {
  appId: 'com.centralwhats.app',
  appName: 'Central Whats',

  /**
   * O build do Vite vai para `dist/`, o mesmo que o Electron consome. O
   * `build:mobile` usa `--base ./` — sem isso os assets viram caminho absoluto
   * e o WebView não acha nada.
   */
  webDir: 'dist',

  android: {
    /**
     * O WebView roda em `https://localhost`, que é CONTEXTO SEGURO. É disso que
     * dependem `getUserMedia` (gravar áudio) e as APIs de mídia — servir de
     * `http://` quebraria a gravação de áudio sem nenhum erro óbvio.
     */
    allowMixedContent: false,
    /**
     * Inspeção remota LIGADA.
     *
     * Sem isto, um app que abre em tela preta não tem como ser diagnosticado:
     * não há console no celular e o `chrome://inspect` do computador não
     * enxerga o WebView. O custo é que quem tiver o aparelho conectado por USB
     * consegue inspecionar o app — aceitável enquanto a distribuição é interna,
     * e a ser revisto antes de abrir para fora da clínica.
     */
    webContentsDebuggingEnabled: true,
  },

  plugins: {
    Keyboard: {
      /**
       * `native` faz o WebView encolher quando o teclado abre, em vez de o
       * teclado cobrir o conteúdo. É o que mantém o compositor do chat visível
       * enquanto se digita — sem isto o campo some atrás do teclado.
       */
      resize: 'native' as any,
      resizeOnFullScreen: true,
    },

    /**
     * OTA do bundle web via @capgo/capacitor-updater, AUTO-HOSPEDADO — sem a
     * nuvem do Capgo. Hoje o APK embala `dist/` dentro de si (`webDir` acima)
     * e nunca se atualiza sozinho; este plugin passa a baixar um novo `dist/`
     * de um endpoint nosso e trocar o bundle sem passar pela loja.
     *
     * Este arquivo roda em Node no momento do `cap sync`/build, não dentro do
     * app — por isso lê `process.env`, e não `import.meta.env` (que só existe
     * no bundle do Vite, em runtime, dentro do WebView).
     */
    CapacitorUpdater: {
      /**
       * `'atBackground'` já é o default do plugin: verifica a cada retomada
       * do app e só troca o bundle quando o app vai para segundo plano (nunca
       * no meio do uso). Deixado explícito de propósito — sem isso, a próxima
       * pessoa que ler este arquivo não sabe se o comportamento é intencional
       * ou só o default "de fábrica" do pacote.
       */
      autoUpdate: 'atBackground',

      /**
       * Endpoint próprio que responde ao protocolo de update do plugin. Não
       * existe carregamento de `.env.local` neste contexto Node (nenhum
       * dotenv é lido aqui) — `process.env.VITE_MOBILE_UPDATE_URL` só chega
       * preenchido se alguém exportar a variável no shell antes do `cap
       * sync`. Por isso o fallback é o valor hardcoded do Supabase
       * self-hosted (mesmo host de `VITE_SUPABASE_URL` em `.env.local`) em
       * vez de tentar montar a URL a partir de outra env var que também não
       * chegaria carregada — inventar um loader de dotenv aqui estaria fora
       * do escopo desta mudança.
       */
      updateUrl:
        process.env.VITE_MOBILE_UPDATE_URL ||
        'https://apps-supabase.srofjl.easypanel.host/functions/v1/mobile-update',

      /**
       * String vazia DESLIGA o envio de telemetria de update para a nuvem do
       * Capgo. Sem isto, o plugin manda estatísticas de cada update (mesmo
       * self-hospedado) para `plugin.capgo.app` por padrão — não é o que
       * queremos rodando sem conta na Capgo.
       */
      statsUrl: '',

      /**
       * Vazio porque não usamos canais (produção/beta etc.) — só um bundle
       * por vez, distribuído pelo `updateUrl` acima.
       */
      channelUrl: '',

      // `autoDeleteFailed`, `autoDeletePrevious` e `resetWhenUpdate` ficam no
      // default (`true`): não há motivo para acumular bundles antigos ou
      // falhos no armazenamento do aparelho.
    },
  },
}

export default config
