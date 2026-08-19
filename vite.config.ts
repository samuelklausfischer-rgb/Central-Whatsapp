/* Vite config for building the frontend react app: https://vite.dev/config/ */
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { VitePWA } from 'vite-plugin-pwa'
// @ts-expect-error - uidPlugin is a custom plugin
import uidPlugin from './vite-plugin-react-uid'

/**
 * O plugin de PWA só entra quando `PWA=1` está explicitamente setado no
 * ambiente (ver `package.json`, script `build`). Desligado é o padrão
 * DELIBERADO: um engano futuro (esquecer a flag) produz "web sem PWA"
 * (irritante, mas inofensivo), nunca "APK ou Electron com service worker"
 * (quebrado — ver o comentário grande em `src/main.tsx` sobre o WebView do
 * Android rodar em `https://localhost`, contexto seguro onde um SW
 * registraria e brigaria com o OTA do `@capgo/capacitor-updater`).
 * `build:electron` e `build:mobile` nunca passam `PWA=1`, então nunca geram
 * `sw.js`/`manifest.webmanifest` — mesmo que este arquivo seja usado sem
 * alteração para as três variantes de build.
 */
const pwaAtivo = process.env.PWA === '1'

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: '::',
    port: 8080,
  },
  build: {
    outDir: mode === 'development' ? 'dev-dist' : 'dist',
    minify: mode !== 'development',
    sourcemap: mode === 'development',
    rolldownOptions: {
      onwarn(warning, warn) {
        if (warning.code === 'MODULE_LEVEL_DIRECTIVE') {
          return
        }
        warn(warning)
      },
      // `src/main.tsx` faz `import('virtual:pwa-register')` dentro de uma
      // guarda de plataforma. Com o plugin de PWA desligado (build:electron,
      // build:mobile, dev) esse módulo virtual não existe de verdade, e o
      // Rolldown recusa resolver import dinâmico de um especificador
      // inexistente — falha o build inteiro, não só um aviso. Externalizar
      // deixa o `import()` intocado no bundle: em runtime ele só é alcançado
      // na web (guarda de plataforma), e quando o plugin está ligado ele
      // nunca é externo, então resolve normalmente pelo plugin.
      external: pwaAtivo ? [] : ['virtual:pwa-register'],
    },
  },
  plugins: [
    mode === 'development' ? uidPlugin() : undefined,
    react(),
    pwaAtivo
      ? VitePWA({
          registerType: 'autoUpdate',
          injectRegister: false,
          workbox: {
            skipWaiting: true,
            clientsClaim: true,
            cleanupOutdatedCaches: true,
            // env-config.js é sobrescrito em disco pelo Dockerfile DEPOIS do
            // `npm run build`, com a URL real do Supabase. O conteúdo que o
            // Workbox veria durante o build é sempre o stub — a revisão no
            // precache manifest nunca mudaria, e uma troca futura de
            // configuração seria servida do cache antigo sem erro nenhum.
            globIgnores: ['env-config.js'],
            navigateFallback: '/index.html',
            navigateFallbackDenylist: [/^\/env-config\.js$/, /^\/api\//, /^\/rest\//, /^\/functions\//],
            runtimeCaching: [
              {
                // Nunca cachear a config em runtime pelo mesmo motivo do
                // globIgnores acima: precisa ir sempre para a rede.
                urlPattern: /\/env-config\.js$/,
                handler: 'NetworkOnly',
              },
            ],
          },
          manifest: {
            name: 'PRN Hub',
            short_name: 'PRN Hub',
            description: 'Central de atendimento WhatsApp integrada ao Supabase e Evolution API',
            start_url: '/',
            scope: '/',
            display: 'standalone',
            lang: 'pt-BR',
            background_color: '#0a0a0b',
            theme_color: '#0a0a0b',
            icons: [
              { src: '/pwa-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
              { src: '/pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
              { src: '/pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
              { src: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png', purpose: 'any' },
            ],
          },
        })
      : undefined,
  ].filter(Boolean),
  define: {
    'process.env.NODE_ENV': JSON.stringify(mode ?? process.env.NODE_ENV ?? 'production'),
  },
  resolve: {
    alias: [
      {
        find: '@',
        replacement: path.resolve(__dirname, './src'),
      },
      {
        find: /zod\/v4\/core/,
        replacement: path.resolve(__dirname, 'node_modules', 'zod', 'v4', 'core'),
      }
    ],
  },
}))