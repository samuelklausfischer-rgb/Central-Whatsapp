// Cria a tag git no GitHub antes do electron-builder tentar publicar o release.
// Necessário porque releaseType:"release" exige que a tag já exista no repositório.
const https = require('https')
const pkg = require('../package.json')

const TAG = `v${pkg.version}`
const TOKEN = process.env.GH_TOKEN || process.env.GITHUB_TOKEN
const OWNER = 'samuelklausfischer-rgb'
const REPO = 'Central-Whatsapp'

if (!TOKEN) {
  console.error('GH_TOKEN não definido — pulando criação de tag')
  process.exit(0)
}

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null
    const req = https.request(
      {
        hostname: 'api.github.com',
        path,
        method,
        headers: {
          Authorization: `token ${TOKEN}`,
          'User-Agent': 'central-whats-publish',
          'Content-Type': 'application/json',
          ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
        },
      },
      (res) => {
        let raw = ''
        res.on('data', (c) => (raw += c))
        res.on('end', () => {
          try { resolve({ status: res.statusCode, body: JSON.parse(raw) }) }
          catch { resolve({ status: res.statusCode, body: raw }) }
        })
      },
    )
    req.on('error', reject)
    if (data) req.write(data)
    req.end()
  })
}

async function run() {
  // Busca SHA do último commit do branch padrão
  const { body: ref } = await request('GET', `/repos/${OWNER}/${REPO}/git/refs/heads/main`)
  const sha = ref?.object?.sha
  if (!sha) {
    console.error('Não foi possível obter SHA do branch main — pulando tag')
    process.exit(0)
  }

  // Tenta criar a tag
  const { status, body } = await request('POST', `/repos/${OWNER}/${REPO}/git/refs`, {
    ref: `refs/tags/${TAG}`,
    sha,
  })

  if (status === 201) {
    console.log(`Tag ${TAG} criada no GitHub (SHA: ${sha.slice(0, 7)})`)
  } else if (body?.message?.includes('already exists') || status === 422) {
    console.log(`Tag ${TAG} já existe — ok`)
  } else {
    console.error(`Erro ao criar tag: ${status}`, body?.message)
  }
}

run().catch((e) => { console.error(e); process.exit(0) })
