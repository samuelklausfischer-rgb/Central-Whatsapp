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
  },
}

export default config
