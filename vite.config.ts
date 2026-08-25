/* Vite config for building the frontend react app: https://vite.dev/config/ */
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'node:fs'
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

/**
 * Copia `sw/notificacoes-sw.js` para a raiz do build. É o trecho que o `sw.js`
 * gerado carrega por `importScripts` (ver a opção `workbox` abaixo).
 *
 * POR QUE NÃO DEIXAR EM `public/`: o Vite copia `public/` inteiro em TODAS as
 * variantes de build. O arquivo iria parar dentro do instalador do Electron e
 * do APK — nunca carregado, mas quebrando a invariante "Electron/APK não têm
 * artefato nenhum de PWA", que é justamente o que se confere ao publicar. Este
 * plugin só entra quando `PWA=1`, então o arquivo existe exatamente onde faz
 * sentido: na web.
 *
 * `writeBundle` roda depois dos assets e antes do `closeBundle` onde o
 * vite-plugin-pwa gera o `sw.js` — o arquivo já está no lugar quando o Workbox
 * olha para o diretório.
 */
function copiarScriptDeNotificacao() {
  return {
    name: 'notificacoes-sw',
    apply: 'build' as const,
    writeBundle(opcoes: { dir?: string }) {
      const destino = opcoes.dir ?? 'dist'
      fs.copyFileSync(
        path.resolve(__dirname, 'sw/notificacoes-sw.js'),
        path.resolve(destino, 'notificacoes-sw.js'),
      )
    },
  }
}

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
    pwaAtivo ? copiarScriptDeNotificacao() : undefined,
    pwaAtivo
      ? VitePWA({
          registerType: 'autoUpdate',
          injectRegister: false,
          workbox: {
            skipWaiting: true,
            clientsClaim: true,
            cleanupOutdatedCaches: true,
            /**
             * `notificationclick` só existe DENTRO do service worker, e o nosso é
             * GERADO (`generateSW`), não escrito à mão. `importScripts` cola o
             * handler no topo do `sw.js` gerado sem trocar a estratégia.
             *
             * Por que não `injectManifest`: obrigaria a reescrever à mão o
             * `navigateFallback`, a denylist e o `NetworkOnly` do `env-config.js`
             * aqui embaixo — justamente a parte que, se sair errada, congela a URL
             * do Supabase no cache sem dar erro nenhum. Ver `sw/notificacoes-sw.js`.
             */
            importScripts: ['/notificacoes-sw.js'],
            // env-config.js é sobrescrito em disco pelo Dockerfile DEPOIS do
            // `npm run build`, com a URL real do Supabase. O conteúdo que o
            // Workbox veria durante o build é sempre o stub — a revisão no
            // precache manifest nunca mudaria, e uma troca futura de
            // configuração seria servida do cache antigo sem erro nenhum.
            //
            // notificacoes-sw.js sai do precache por outro motivo: quem o carrega
            // é o `importScripts` acima, de dentro do próprio service worker —
            // caminho que NÃO passa pelo precache. Guardar uma segunda cópia no
            // cache das páginas seria peso morto. (Ele precisa constar aqui de
            // fato: o Workbox varre o diretório FINAL do build, então enxerga o
            // arquivo que o plugin `notificacoes-sw` copia no `writeBundle`.)
            globIgnores: ['env-config.js', 'notificacoes-sw.js'],
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