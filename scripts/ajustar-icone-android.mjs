/**
 * Ajustes no ícone do Android que o `@capacitor/assets` não faz — e que ele
 * DESFAZ a cada geração. Por isso este passo roda depois dele, dentro de
 * `npm run assets:mobile`.
 *
 * 1. FUNDO CHAPADO EM VEZ DE IMAGEM.
 *    O gerador troca o fundo do ícone adaptativo por um PNG e o envolve no mesmo
 *    `<inset>` de 16,7% do primeiro plano. Fundo recuado deixa a borda vazia:
 *    máscaras maiores, e o deslocamento que alguns lançadores fazem ao arrastar
 *    o ícone, revelam o vazio. O fundo tem que cobrir os 108dp inteiros — e cor
 *    chapada cobre por definição.
 *
 * 2. TELA DE ABERTURA DO ANDROID 12+.
 *    De lá para cá o sistema desenha a abertura sozinho e IGNORA o
 *    `android:background` que o Capacitor configura: ele usa o ícone do app
 *    sobre `windowSplashScreenBackground`. Sem declarar, a cor é escolhida pelo
 *    sistema — normalmente branca, dando um flash antes de um app que abre
 *    escuro.
 */
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..')
const RES = join(raiz, 'android/app/src/main/res')

/** Fundo do tema escuro do app (`--background: 240 10% 4%`). */
const FUNDO = '#0A0A0B'

await writeFile(
  join(RES, 'values/ic_launcher_background.xml'),
  `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <!-- Fundo do ícone do app. Mesma cor do tema escuro do Central Whats. -->
    <color name="ic_launcher_background">${FUNDO}</color>
</resources>
`,
)

const iconeAdaptativo = `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <!-- Cor chapada, e não imagem: o fundo precisa cobrir os 108dp inteiros.
         O gerador usa um PNG recuado em 16,7%, e aí a borda fica vazia. -->
    <background android:drawable="@color/ic_launcher_background" />
    <!-- O recuo aqui é a área segura: o Android só garante visível o centro 66%. -->
    <foreground>
        <inset android:drawable="@mipmap/ic_launcher_foreground" android:inset="16.7%" />
    </foreground>
</adaptive-icon>
`

for (const arquivo of ['mipmap-anydpi-v26/ic_launcher.xml', 'mipmap-anydpi-v26/ic_launcher_round.xml']) {
  await writeFile(join(RES, arquivo), iconeAdaptativo)
}

const estilos = join(RES, 'values/styles.xml')
let conteudo = await readFile(estilos, 'utf8')

if (!conteudo.includes('windowSplashScreenBackground')) {
  conteudo = conteudo.replace(
    /<style name="AppTheme\.NoActionBarLaunch"[^>]*>[\s\S]*?<\/style>/,
    `<style name="AppTheme.NoActionBarLaunch" parent="Theme.SplashScreen">
        <!-- Android 11 e anteriores. -->
        <item name="android:background">@drawable/splash</item>
        <!-- Android 12+: o sistema desenha a abertura e ignora o item acima.
             Sem estes três, a cor é escolhida pelo sistema e dá flash branco
             antes de um app que abre no escuro. -->
        <item name="windowSplashScreenBackground">@color/ic_launcher_background</item>
        <item name="windowSplashScreenAnimatedIcon">@mipmap/ic_launcher_foreground</item>
        <item name="postSplashScreenTheme">@style/AppTheme.NoActionBar</item>
    </style>`,
  )
  await writeFile(estilos, conteudo)
}

console.log('Ícone e tela de abertura ajustados (fundo chapado + splash do Android 12+)')
