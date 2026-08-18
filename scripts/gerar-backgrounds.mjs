/**
 * Converte as artes de fundo do PRN Hub versionadas em `brand/backgrounds/*.png`
 * (renders ~2 MB cada, geradas por IA) para `src/assets/backgrounds/*.webp`
 * prontas para o bundle do app.
 *
 * Por que reprocessar em vez de importar o PNG direto: 6 PNGs de ~2 MB somam
 * ~12 MB no instalador do Electron só de plano de fundo. WebP com qualidade
 * 82 chega a uma fração disso sem perda visível a olho nu numa imagem que só
 * aparece desfocada atrás de um painel de vidro.
 *
 * Também calcula a cor média de cada arte (via `sharp().stats()`) e imprime
 * em hex — é o valor que alimenta `corBase` em `src/lib/backgrounds.ts`,
 * pintado atrás do `<img>` enquanto o WebP ainda não decodificou, pra não
 * haver um frame de fundo vazio/branco no primeiro paint.
 *
 * Idempotente: pode rodar de novo a qualquer momento, só sobrescreve os
 * `.webp` já gerados e não apaga nada fora de `src/assets/backgrounds/`.
 *
 * Roda com `npm run assets:backgrounds`.
 */
import sharp from 'sharp'
import { readdir, mkdir, stat } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join, basename, extname } from 'node:path'

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..')
const ORIGEM = join(raiz, 'brand/backgrounds')
const DESTINO = join(raiz, 'src/assets/backgrounds')

const LARGURA_SAIDA = 1920
const QUALIDADE_WEBP = 82

/** Converte um canal 0-255 em dois dígitos hex. */
function paraHex(valor) {
  return Math.round(valor).toString(16).padStart(2, '0')
}

/** Cor média da imagem (canais R/G/B de `.stats()`) como string hex `#rrggbb`. */
async function corMediaHex(caminho) {
  const { channels } = await sharp(caminho).stats()
  const [r, g, b] = channels
  return `#${paraHex(r.mean)}${paraHex(g.mean)}${paraHex(b.mean)}`
}

async function tamanhoKb(caminho) {
  const { size } = await stat(caminho)
  return size / 1024
}

async function gerarUma(nomeArquivo) {
  const nome = basename(nomeArquivo, extname(nomeArquivo))
  const origem = join(ORIGEM, nomeArquivo)
  const destino = join(DESTINO, `${nome}.webp`)

  await sharp(origem)
    .resize({ width: LARGURA_SAIDA, withoutEnlargement: true })
    .webp({ quality: QUALIDADE_WEBP, effort: 6 })
    .toFile(destino)

  const [kbOrigem, kbDestino, corBase] = await Promise.all([
    tamanhoKb(origem),
    tamanhoKb(destino),
    corMediaHex(origem),
  ])

  return { nome, kbOrigem, kbDestino, corBase }
}

async function main() {
  await mkdir(DESTINO, { recursive: true })

  const arquivos = (await readdir(ORIGEM)).filter((f) => extname(f).toLowerCase() === '.png')
  const resultados = []
  for (const arquivo of arquivos) {
    resultados.push(await gerarUma(arquivo))
  }

  let totalOrigem = 0
  let totalDestino = 0
  console.log('\nnome                 PNG (KB)   WebP (KB)   corBase')
  console.log('-------------------  ---------  ----------  -------')
  for (const { nome, kbOrigem, kbDestino, corBase } of resultados) {
    totalOrigem += kbOrigem
    totalDestino += kbDestino
    console.log(
      `${nome.padEnd(20)} ${kbOrigem.toFixed(0).padStart(9)}  ${kbDestino.toFixed(0).padStart(10)}  ${corBase}`,
    )
  }
  console.log('-------------------  ---------  ----------  -------')
  console.log(
    `total                ${totalOrigem.toFixed(0).padStart(9)}  ${totalDestino.toFixed(0).padStart(10)}\n`,
  )
  console.log(`${resultados.length} backgrounds gerados em src/assets/backgrounds/ a partir de brand/backgrounds/`)
}

await main()
