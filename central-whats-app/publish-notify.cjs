/**
 * Notifica todos os apps abertos que uma nova versão foi publicada.
 * Insere uma row em app_releases no Supabase — o Realtime propaga instantaneamente.
 * Executado automaticamente ao final de `npm run publish:electron`.
 */
const https = require('https')
const fs = require('fs')
const path = require('path')

const envPath = path.join(__dirname, '../.env.local')
const envContent = fs.readFileSync(envPath, 'utf8')
const env = Object.fromEntries(
  envContent
    .split('\n')
    .filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=')
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()]
    }),
)

const SUPABASE_URL = env.VITE_SUPABASE_URL
const SUPABASE_KEY = env.VITE_SUPABASE_PUBLISHABLE_KEY
const version = require('../package.json').version

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('[publish-notify] VITE_SUPABASE_URL ou VITE_SUPABASE_PUBLISHABLE_KEY não encontrados em .env.local')
  process.exit(0) // não bloqueia o publish
}

const body = JSON.stringify({ version })
const url = new URL('/rest/v1/app_releases', SUPABASE_URL)

const req = https.request(
  {
    hostname: url.hostname,
    path: url.pathname,
    method: 'POST',
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
      Prefer: 'return=minimal',
    },
  },
  (res) => {
    if (res.statusCode >= 200 && res.statusCode < 300) {
      console.log(`[publish-notify] ✓ v${version} notificada via Supabase (status ${res.statusCode})`)
    } else {
      let raw = ''
      res.on('data', (c) => (raw += c))
      res.on('end', () => console.error(`[publish-notify] Erro ${res.statusCode}:`, raw))
    }
  },
)

req.on('error', (e) => console.error('[publish-notify] Erro de rede:', e.message))
req.write(body)
req.end()
