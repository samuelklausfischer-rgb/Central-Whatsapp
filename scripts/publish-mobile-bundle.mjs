// Empacota dist/ num zip e publica como asset da release do app Android.
//
// O app usa @capgo/capacitor-updater auto-hospedado: ele lê uma linha em
// public.app_mobile_bundles (version/url/checksum), baixa o zip da url,
// confere o sha256 e aplica o bundle sem passar pela Play Store.
//
// A ORDEM DOS PASSOS ABAIXO É REQUISITO, NÃO ESTILO:
//   1) ler a versão de package.json
//   2) zipar dist/
//   3) calcular o sha256 do zip
//   4) subir o zip como asset da release no GitHub
//   5) SÓ DEPOIS do upload terminar, gravar a linha em app_mobile_bundles
//
// Se a linha do banco entrasse antes do upload concluir, o app veria uma
// versão nova, tentaria baixar o arquivo e o download falharia porque o
// asset ainda não existe no ar. É exatamente o motivo pelo qual a release
// do desktop (electron-builder --publish always) sobe como rascunho antes
// de virar visível — aqui replicamos a mesma garantia "arquivo primeiro,
// aviso depois" via ordem de execução em vez de rascunho.

import { existsSync, statSync, readFileSync, createWriteStream, unlinkSync } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'
import https from 'node:https'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import archiver from 'archiver'
// ^ "archiver" não é dependência direta deste projeto — ela chega hoisted no
// node_modules por causa do electron-builder (build:electron já depende dela
// por baixo dos panos). Reaproveitar em vez de instalar pacote novo, como
// pedido: não rodar npm i enquanto outro agente mexe em dependências.

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')
const DIST_DIR = path.join(ROOT, 'dist')
const OWNER = 'samuelklausfischer-rgb'
const RELEASES_REPO = 'Central-Whatsapp-releases'

function fail(msg) {
  console.error(`[publish-mobile-bundle] ${msg}`)
  process.exit(1)
}

// Captura stdout (para parsear JSON de "gh release view --json ...").
function ghCapture(args) {
  return execFileSync('gh', args, { encoding: 'utf8' })
}

// Deixa o gh escrever direto no terminal (barra de progresso do upload,
// mensagens de erro completas) em vez de engolir a saída num buffer.
function ghInherit(args) {
  execFileSync('gh', args, { stdio: 'inherit' })
}

function insertBundleRow(supabaseUrl, supabaseKey, row) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(row)
    const url = new URL('/rest/v1/app_mobile_bundles', supabaseUrl)
    const req = https.request(
      {
        hostname: url.hostname,
        path: url.pathname,
        method: 'POST',
        headers: {
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          Prefer: 'return=minimal',
        },
      },
      (res) => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve()
        } else {
          let raw = ''
          res.on('data', (c) => (raw += c))
          res.on('end', () => reject(new Error(`Supabase respondeu ${res.statusCode}: ${raw}`)))
        }
      },
    )
    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

async function main() {
  // 1) Versão — é ela que nomeia a release, a tag e o asset. Sem ela não dá
  // pra seguir, então falha já de cara em vez de gerar um "bundle-undefined.zip".
  const pkgPath = path.join(ROOT, 'package.json')
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
  const version = pkg.version
  if (!version) fail('package.json não tem campo "version".')
  const tag = `v${version}`
  const assetName = `bundle-${version}.zip`

  console.log(`[publish-mobile-bundle] versão: ${version}`)

  // Validações prévias, todas antes de gastar tempo zipando: falhar cedo e
  // com mensagem clara é mais barato do que descobrir no meio do upload.
  if (!existsSync(DIST_DIR)) {
    fail('dist/ não existe. Rode o build (ex.: npm run build:mobile) antes de publicar.')
  }
  const indexPath = path.join(DIST_DIR, 'index.html')
  if (!existsSync(indexPath)) {
    fail('dist/index.html não existe — sinal de que ninguém rodou o build ainda.')
  }
  try {
    ghCapture(['auth', 'status'])
  } catch {
    fail('gh não está autenticado. Rode "gh auth login" antes de publicar.')
  }
  // Este script NÃO cria a release — ela precisa já existir, publicada por
  // quem prepara o changelog/assets desktop. Mesma disciplina do publish do
  // Electron: a tag/release é um passo separado e anterior ao upload de asset.
  try {
    ghCapture(['release', 'view', tag, '--repo', `${OWNER}/${RELEASES_REPO}`])
  } catch {
    fail(
      `Release ${tag} não existe em ${OWNER}/${RELEASES_REPO}. ` +
        `Publique a release primeiro (gh release create ${tag} --repo ${OWNER}/${RELEASES_REPO}) e rode de novo.`,
    )
  }

  // 2) Zip — a RAIZ do zip precisa ser o CONTEÚDO de dist/, não uma pasta
  // "dist/" dentro dele. O @capgo/capacitor-updater descompacta o bundle
  // esperando achar index.html direto na raiz do zip; se sobrar mais um
  // nível de pasta, o app não encontra o entrypoint e a atualização falha
  // em silêncio no aparelho (sem erro visível pro usuário).
  const zipPath = path.join(ROOT, `bundle-${version}.zip`)
  if (existsSync(zipPath)) unlinkSync(zipPath)

  await new Promise((resolve, reject) => {
    const output = createWriteStream(zipPath)
    const archive = archiver('zip', { zlib: { level: 9 } })
    output.on('close', resolve)
    output.on('error', reject)
    archive.on('error', reject)
    archive.on('warning', (err) => {
      // Avisos de "arquivo não encontrado" durante o walk são fatais aqui
      // também — bundle incompleto é pior que falha explícita.
      reject(err)
    })
    archive.pipe(output)
    archive.directory(DIST_DIR, false) // false = conteúdo na raiz, sem pasta "dist"
    archive.finalize()
  })

  const zipSize = statSync(zipPath).size
  console.log(`[publish-mobile-bundle] zip criado (${(zipSize / 1024 / 1024).toFixed(2)} MB)`)

  // 3) SHA256 — o updater confere esse hash depois de baixar o zip, antes de
  // aplicar o bundle. Se não bater, ele descarta o download.
  const sha256 = createHash('sha256').update(readFileSync(zipPath)).digest('hex')
  console.log(`[publish-mobile-bundle] sha256: ${sha256}`)

  // Idempotência: se o asset já existe na release, avisa antes de sobrescrever
  // em vez de duplicar/silenciar — um checksum trocado sem aviso é o tipo de
  // bug que só aparece quando o app já falhou pra usuário de verdade.
  let assetExists = false
  try {
    const viewOut = ghCapture(['release', 'view', tag, '--repo', `${OWNER}/${RELEASES_REPO}`, '--json', 'assets'])
    const { assets } = JSON.parse(viewOut)
    assetExists = Array.isArray(assets) && assets.some((a) => a.name === assetName)
  } catch {
    // Se o check falhar por qualquer motivo, segue: o --clobber do upload
    // abaixo cobre o caso de sobrescrita mesmo sem essa checagem prévia.
  }
  if (assetExists) {
    console.warn(`[publish-mobile-bundle] AVISO: ${assetName} já existe em ${tag} — será sobrescrito (--clobber).`)
  }

  // 4) Upload. Só depois que este comando retornar com sucesso é que o passo
  // 5 roda — ver o comentário de topo do arquivo sobre por que a ordem importa.
  ghInherit(['release', 'upload', tag, `${zipPath}#${assetName}`, '--repo', `${OWNER}/${RELEASES_REPO}`, '--clobber'])
  console.log(`[publish-mobile-bundle] upload concluído: ${assetName}`)

  const publicUrl = `https://github.com/${OWNER}/${RELEASES_REPO}/releases/download/${tag}/${assetName}`

  // 5) Grava no Supabase self-hosted.
  //
  // A URL sai de `.env.local` como no `publish-notify.cjs`, mas a CHAVE **NÃO**
  // é a publicável. Esta é a diferença mais importante deste script, e não é
  // preciosismo:
  //
  // `app_releases` tem policy `public insert` — qualquer um com a chave anônima
  // insere uma linha. Para lá isso é aceitável: o pior que alguém faz é
  // anunciar um número de versão errado no aviso do desktop.
  //
  // `app_mobile_bundles` é outra história. A linha aqui contém a URL do
  // JavaScript que TODO celular vai baixar e EXECUTAR. Com insert liberado para
  // a chave anônima — que é pública e viaja dentro do próprio app — qualquer
  // pessoa apontaria a frota inteira para um bundle próprio. Isso é execução
  // remota de código em todos os aparelhos, não um aviso errado.
  //
  // Por isso a tabela nasce com RLS e SEM policy nenhuma, e a escrita só
  // acontece com a service role, que nunca fica em `.env.local` (versionável
  // por acidente) — vem do ambiente, na hora de publicar:
  //
  //   SUPABASE_SERVICE_ROLE_KEY=... npm run publish:mobile
  const envPath = path.join(ROOT, '.env.local')
  if (!existsSync(envPath)) {
    fail('.env.local não encontrado na raiz do projeto — necessário para VITE_SUPABASE_URL.')
  }
  const envContent = readFileSync(envPath, 'utf8')
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
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!SUPABASE_URL) {
    fail('VITE_SUPABASE_URL não encontrado em .env.local.')
  }
  if (!SUPABASE_KEY) {
    fail(
      'SUPABASE_SERVICE_ROLE_KEY não está no ambiente.\n' +
        'A tabela app_mobile_bundles tem RLS sem policies de propósito: a chave anônima é pública\n' +
        'e um insert liberado ali viraria execução remota de código em todos os celulares.\n' +
        'Rode assim (sem gravar a chave em arquivo):\n' +
        '  SUPABASE_SERVICE_ROLE_KEY=<chave> npm run publish:mobile',
    )
  }

  try {
    await insertBundleRow(SUPABASE_URL, SUPABASE_KEY, { version, url: publicUrl, checksum: sha256 })
  } catch (e) {
    // O arquivo já está publicado no GitHub nesse ponto — só o registro no
    // banco falhou. Não apaga o asset (isso seria pior: teria que subir de
    // novo), só reporta pra alguém inserir a linha manualmente.
    fail(
      `Upload OK, mas falhou ao gravar em app_mobile_bundles: ${e.message}\n` +
        `Insira manualmente: version=${version}, url=${publicUrl}, checksum=${sha256}`,
    )
  }

  // Não deixa o zip solto na raiz do repo sujando git status.
  unlinkSync(zipPath)

  console.log('')
  console.log('[publish-mobile-bundle] publicado com sucesso:')
  console.log(`  versão  : ${version}`)
  console.log(`  tamanho : ${(zipSize / 1024 / 1024).toFixed(2)} MB`)
  console.log(`  sha256  : ${sha256}`)
  console.log(`  url     : ${publicUrl}`)

  process.exit(0)
}

main().catch((e) => {
  console.error(`[publish-mobile-bundle] falhou: ${e.message}`)
  process.exit(1)
})
