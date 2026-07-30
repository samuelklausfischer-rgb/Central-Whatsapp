/**
 * Monta as imagens-fonte do ícone e da tela de abertura do Android, a partir de
 * `public/logo.png` — a MESMA logo que o app usa no cabeçalho e que o instalador
 * do Windows usa como ícone (ver `central-whats-app/create-icon.cjs`).
 *
 * Sem isto o APK sai com o "X" azul do Capacitor, a marca genérica da ferramenta
 * que empacota o app.
 *
 * O resultado alimenta `npx @capacitor/assets generate --android`, que espalha
 * nas densidades. Os dois passos estão em `npm run assets:mobile`.
 */
import sharp from 'sharp'
import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..')
const LOGO = join(raiz, 'public/logo.png')
const SAIDA = join(raiz, 'assets')

/** Fundo do tema escuro do app (`--background: 240 10% 4%`). */
const FUNDO = { r: 10, g: 10, b: 11, alpha: 1 }

/**
 * Quanto da largura a logo ocupa NESTA fonte — não no ícone final.
 *
 * O `@capacitor/assets` já envolve o primeiro plano num `<inset>` de 16,7% por
 * lado, que é exatamente a área segura do Android (o centro 66%, único pedaço
 * que nenhuma máscara de fabricante recorta). Ou seja, o recuo já é dado por
 * ele: reduzir a logo aqui também recua DUAS vezes.
 *
 * Foi o que aconteceu na primeira tentativa com 0,6 — a logo saía com ~40% do
 * ícone, nadando em fundo escuro. Com 0,72 ela ocupa ~72% do círculo visível,
 * que é a proporção usual de ícone de app.
 */
const OCUPACAO_ICONE = 0.72

/** Na tela de abertura não há máscara, mas logo gigante fica pesada. */
const OCUPACAO_SPLASH = 0.28

/**
 * 1024 é o mínimo que o @capacitor/assets exige. A logo tem 512 e o maior alvo
 * real é 432 (`xxxhdpi`), então a ampliação aqui é só do intermediário — a saída
 * final nunca é ampliada.
 */
const LADO_ICONE = 1024
const LADO_SPLASH = 2732

async function logoCentralizada(lado, ocupacao, fundo) {
  const alvo = Math.round(lado * ocupacao)
  const logo = await sharp(LOGO).resize(alvo, alvo, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).toBuffer()
  return sharp({
    create: { width: lado, height: lado, channels: 4, background: fundo },
  })
    .composite([{ input: logo, gravity: 'center' }])
    .png()
    .toBuffer()
}

const TRANSPARENTE = { r: 0, g: 0, b: 0, alpha: 0 }

await mkdir(SAIDA, { recursive: true })

// Primeiro plano do ícone adaptativo: só a logo, sem fundo — quem pinta o fundo
// é a camada de baixo, e é isso que permite o efeito de profundidade do Android.
await writeFile(join(SAIDA, 'icon-foreground.png'), await logoCentralizada(LADO_ICONE, OCUPACAO_ICONE, TRANSPARENTE))

// Fundo do ícone adaptativo: cor chapada.
await writeFile(
  join(SAIDA, 'icon-background.png'),
  await sharp({ create: { width: LADO_ICONE, height: LADO_ICONE, channels: 4, background: FUNDO } }).png().toBuffer(),
)

// Ícone antigo (Android 7 e anteriores, que não têm ícone adaptativo): logo já
// sobre o fundo, e pode ocupar mais porque não há máscara recortando.
await writeFile(join(SAIDA, 'icon.png'), await logoCentralizada(LADO_ICONE, 0.72, FUNDO))

// Tela de abertura. As duas variantes iguais: o app abre no escuro dos dois
// jeitos, e um splash claro daria um flash branco na passagem.
const splash = await logoCentralizada(LADO_SPLASH, OCUPACAO_SPLASH, FUNDO)
await writeFile(join(SAIDA, 'splash.png'), splash)
await writeFile(join(SAIDA, 'splash-dark.png'), splash)

console.log('Fontes geradas em assets/ a partir de public/logo.png')
