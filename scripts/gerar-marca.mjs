/**
 * Deriva 11 arquivos de imagem da marca "PRN Hub" a partir de duas artes
 * originais versionadas em `brand/` (prnhub-icone.png e prnhub-lockup.png):
 * logo.png, src/assets/prn-globo.png, logo-prnhub.png,
 * logo-prnhub-invertida.png, favicon.ico, favicon-96.png, og-image.png,
 * apple-touch-icon.png, pwa-192.png, pwa-512.png e pwa-maskable-512.png.
 *
 * Não existe mais um SVG desenhado à mão como fonte auxiliar: o globo (só os
 * ladrilhos azuis, sem a placa) é RECORTADO da própria arte fonte
 * (`brand/prnhub-icone.png`, etapa A-2) e vira `src/assets/prn-globo.png` —
 * fonte única, tanto para os ícones estáticos gerados aqui (favicon,
 * favicon-96, maskable) quanto para `src/components/ui/prn-globo.tsx`, que
 * importa esse PNG. Antes disso havia duas versões do logo (a arte real, nos
 * ícones de app, e um globo redesenhado à mão em SVG, no favicon/maskable/
 * avatar) — essa duplicação acabou aqui.
 *
 * As duas fontes NÃO têm canal alfa — são screenshots de geração de imagem,
 * com a placa/globo desenhados sobre um fundo quase-branco opaco. Por isso
 * todo o trabalho aqui é "adivinhar" onde a arte termina e o fundo começa,
 * e não apenas redimensionar. Ver cada etapa abaixo para o porquê de cada
 * heurística — elas foram calibradas olhando pixel a pixel destas DUAS
 * imagens específicas, não é um algoritmo genérico para qualquer logo.
 *
 * Roda com `npm run assets:marca`.
 */
import sharp from 'sharp'
import { writeFile, mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..')
const BRAND_ICONE = join(raiz, 'brand/prnhub-icone.png')
const BRAND_LOCKUP = join(raiz, 'brand/prnhub-lockup.png')
const PUBLIC = join(raiz, 'public')
const SRC_ASSETS = join(raiz, 'src/assets')

/** Fundo escuro do app (`--background: 240 10% 4%`), usado no og-image. */
const FUNDO_ESCURO = { r: 10, g: 10, b: 11, alpha: 1 }

// ---------------------------------------------------------------------------
// Utilidades de baixo nível sobre pixels crus (sem essas, sharp não faz nem
// detecção de bordas por cor nem flood fill — são operações "manuais").
// ---------------------------------------------------------------------------

async function lerRaw(caminho) {
  const { data, info } = await sharp(caminho).raw().toBuffer({ resolveWithObject: true })
  return { data, width: info.width, height: info.height, channels: info.channels }
}

/**
 * Acha a borda de um formato claro sobre fundo claro andando a partir da
 * margem da imagem para dentro.
 *
 * Não dá pra usar um limiar fixo de cor porque o fundo (`brand/prnhub-icone.png`)
 * e a placa são os DOIS quase-brancos — a única pista visível é a sombra suave
 * que o design tem entre os dois. Essa sombra cresce, atinge um pico de
 * contraste bem em cima da borda real da placa, e depois decai devagar (nunca
 * volta a zero, porque o interior da placa também é levemente diferente do
 * fundo). Por isso: entra no primeiro trecho com contraste perceptível, e sai
 * dele quando o valor cair para menos da metade do pico já visto — isso
 * aguenta a sombra que não retorna à linha de base, sem também devorar o
 * gráfico interno (que fica bem mais pra dentro e tem contraste muito maior).
 */
function acharBorda(getDist, inicio, fim, limiarBaixo = 6) {
  const passo = fim >= inicio ? 1 : -1
  let i = inicio
  let dentroDoPico = false
  let picoPos = inicio
  let picoVal = -1
  for (; i !== fim + passo; i += passo) {
    const v = getDist(i)
    if (!dentroDoPico) {
      if (v > limiarBaixo) {
        dentroDoPico = true
        picoVal = v
        picoPos = i
      }
    } else {
      if (v > picoVal) {
        picoVal = v
        picoPos = i
      } else if (v < picoVal * 0.5) {
        break
      }
    }
  }
  return picoPos
}

/** SVG de retângulo arredondado branco — usado como máscara alfa via `dest-in`. */
function svgRoundedRect(lado, raio) {
  return Buffer.from(
    `<svg width="${lado}" height="${lado}"><rect x="0" y="0" width="${lado}" height="${lado}" rx="${raio}" ry="${raio}" fill="#fff"/></svg>`,
  )
}

/**
 * Remove o fundo de `brand/prnhub-lockup.png` por flood fill (BFS) a partir
 * das 4 bordas da imagem.
 *
 * Por que flood fill e não limiar de cor: o globo e a placa têm branco puro
 * no desenho (os quadradinhos claros translúcidos, o miolo da placa) que
 * PRECISA sobreviver — um limiar global apagaria isso junto com o fundo. Só
 * o fundo verdadeiro é uma região CONEXA que toca as 4 bordas; os brancos
 * "internos" (miolo da placa, contadores das letras P/R fechados) não tocam
 * a borda da imagem, então o BFS nunca chega neles.
 *
 * BFS (fila) em vez de recursão: a imagem tem ~1,5 milhão de pixels e
 * recursão estouraria a pilha de chamadas.
 *
 * A origem de comparação de cada pixel de fundo é a cor do PRÓPRIO pixel de
 * borda que iniciou aquele ramo do BFS (não uma cor global única) — isso
 * tolera o leve gradiente de iluminação que a arte tem de um canto a outro
 * do fundo, sem precisar alargar a tolerância a ponto de comer a arte.
 */
function removerFundoPorFloodFill(data, width, height, channels, tolerancia) {
  const total = width * height
  const visitado = new Uint8Array(total)
  const ehFundo = new Uint8Array(total)
  const idx = (x, y) => y * width + x
  const corEm = (x, y) => {
    const o = idx(x, y) * channels
    return [data[o], data[o + 1], data[o + 2]]
  }

  const fila = []
  const semear = (x, y) => {
    const i = idx(x, y)
    if (visitado[i]) return
    visitado[i] = 1
    ehFundo[i] = 1
    fila.push([x, y, corEm(x, y)])
  }
  for (let x = 0; x < width; x++) {
    semear(x, 0)
    semear(x, height - 1)
  }
  for (let y = 0; y < height; y++) {
    semear(0, y)
    semear(width - 1, y)
  }

  let cabeca = 0
  while (cabeca < fila.length) {
    const [x, y, origem] = fila[cabeca++]
    const vizinhos = [
      [x - 1, y],
      [x + 1, y],
      [x, y - 1],
      [x, y + 1],
    ]
    for (const [nx, ny] of vizinhos) {
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
      const ni = idx(nx, ny)
      if (visitado[ni]) continue
      const [r, g, b] = corEm(nx, ny)
      const dr = r - origem[0]
      const dg = g - origem[1]
      const db = b - origem[2]
      if (Math.sqrt(dr * dr + dg * dg + db * db) < tolerancia) {
        visitado[ni] = 1
        ehFundo[ni] = 1
        fila.push([nx, ny, origem])
      }
    }
  }

  // Monta a saída RGBA: alfa 0 onde é fundo, 255 (opaco) no resto.
  const saida = Buffer.alloc(width * height * 4)
  for (let i = 0; i < total; i++) {
    const s = i * channels
    const o = i * 4
    saida[o] = data[s]
    saida[o + 1] = data[s + 1]
    saida[o + 2] = data[s + 2]
    saida[o + 3] = ehFundo[i] ? 0 : 255
  }
  return saida
}

/**
 * Monta um .ico multi-resolução manualmente — sharp não escreve .ico, mas o
 * formato aceita PNG embutido desde o Windows Vista, então não precisa
 * reimplementar compressão BMP: só empacotar os PNGs já prontos.
 *
 * Layout do arquivo (ICONDIR + N×ICONDIRENTRY + os PNGs em sequência):
 *   - header (6 bytes): reserved=0 (2B) · type=1/ícone (2B) · count=N (2B)
 *   - por imagem, um ICONDIRENTRY (16 bytes):
 *       largura (1B, 0 significa 256) · altura (1B, 0 significa 256)
 *       paleta (1B=0) · reservado (1B=0) · planes (2B=1) · bitCount (2B=32)
 *       tamanho em bytes do PNG (4B) · offset do PNG a partir do início do arquivo (4B)
 *   - os bytes crus de cada PNG, na mesma ordem dos ICONDIRENTRY
 */
function montarIco(imagens) {
  const HEADER = 6
  const ENTRADA = 16
  const offsetInicial = HEADER + ENTRADA * imagens.length

  const header = Buffer.alloc(HEADER)
  header.writeUInt16LE(0, 0) // reserved
  header.writeUInt16LE(1, 2) // type = ícone
  header.writeUInt16LE(imagens.length, 4)

  const entradas = []
  const blocos = []
  let offset = offsetInicial
  for (const { tamanho, buffer } of imagens) {
    const entrada = Buffer.alloc(ENTRADA)
    entrada.writeUInt8(tamanho >= 256 ? 0 : tamanho, 0)
    entrada.writeUInt8(tamanho >= 256 ? 0 : tamanho, 1)
    entrada.writeUInt8(0, 2) // sem paleta
    entrada.writeUInt8(0, 3) // reservado
    entrada.writeUInt16LE(1, 4) // color planes
    entrada.writeUInt16LE(32, 6) // bits por pixel (RGBA)
    entrada.writeUInt32LE(buffer.length, 8)
    entrada.writeUInt32LE(offset, 12)
    entradas.push(entrada)
    blocos.push(buffer)
    offset += buffer.length
  }

  return Buffer.concat([header, ...entradas, ...blocos])
}

// ---------------------------------------------------------------------------
// A) public/logo.png — ícone 512×512 com cantos arredondados e alfa
// ---------------------------------------------------------------------------

async function gerarLogoIcone() {
  const { data, width, height, channels } = await lerRaw(BRAND_ICONE)
  const px = (x, y, c) => data[(y * width + x) * channels + c]
  const bg = [px(0, 0, 0), px(0, 0, 1), px(0, 0, 2)]
  const dist = (x, y) => {
    const dr = px(x, y, 0) - bg[0]
    const dg = px(x, y, 1) - bg[1]
    const db = px(x, y, 2) - bg[2]
    return Math.sqrt(dr * dr + dg * dg + db * db)
  }

  // A borda plana de cada lado (não o canto arredondado) é medida no meio do
  // lado oposto — perto dos cantos o corte cruzaria a curva e mediria a placa
  // como menor do que realmente é.
  const midX = Math.floor(width / 2)
  const midY = Math.floor(height / 2)
  const top = acharBorda((y) => dist(midX, y), 0, height - 1)
  const bottom = acharBorda((y) => dist(midX, y), height - 1, 0)
  const left = acharBorda((x) => dist(x, midY), 0, width - 1)
  const right = acharBorda((x) => dist(x, midY), width - 1, 0)

  // Recorte quadrado centrado na caixa da placa — usar o maior dos dois lados
  // evita esticar a placa (que é visualmente quadrada) ao redimensionar.
  const centroX = (left + right) / 2
  const centroY = (top + bottom) / 2
  const lado = Math.max(right - left, bottom - top)
  const metade = Math.round(lado / 2)
  const recorte = {
    left: Math.max(0, Math.round(centroX - metade)),
    top: Math.max(0, Math.round(centroY - metade)),
    width: Math.min(width, lado),
    height: Math.min(height, lado),
  }

  const LADO_SAIDA = 512
  const RAIO = Math.round(LADO_SAIDA * 0.22) // calibrado olhando o raio da placa na arte original

  const placaRedimensionada = await sharp(BRAND_ICONE)
    .extract(recorte)
    .resize(LADO_SAIDA, LADO_SAIDA)
    .ensureAlpha()
    .toBuffer()

  const mascara = await sharp(svgRoundedRect(LADO_SAIDA, RAIO)).png().toBuffer()

  const saida = await sharp(placaRedimensionada)
    .composite([{ input: mascara, blend: 'dest-in' }])
    .png()
    .toBuffer()

  await writeFile(join(PUBLIC, 'logo.png'), saida)
  return saida
}

// ---------------------------------------------------------------------------
// A-2) src/assets/prn-globo.png — só os ladrilhos azuis do globo, sem a
// placa branca, fundo transparente e recortado justo
//
// Fonte única do globo isolado: alimenta `src/components/ui/prn-globo.tsx`
// (via import estático) e, aqui mesmo, o favicon/favicon-96/maskable — três
// consumidores, um arquivo.
//
// Heurística: separar por "azulidade", NÃO por luminância. A placa é neutra
// (R≈G≈B, branco/cinza claro); o globo é azul saturado. `azulidade = B -
// max(R, G)` fica perto de 0 (ou negativa) em toda a placa — incluindo o
// anel/sombra cinza que ela tem por dentro, que assim cai fora sozinho — e
// sobe bem acima disso em qualquer pixel com tinta azul de verdade.
//
// Rampa suave, não limiar binário: alfa 0 abaixo de LIMIAR_BAIXO, alfa 255
// acima de LIMIAR_ALTO, interpolado linear no meio. Um corte seco deixa
// escada visível a 512px — a antisserrilha das bordas dos ladrilhos precisa
// sobreviver, e um limiar único mata a transição suave que o PNG fonte já
// tem.
//
// CUIDADO (é onde isso costuma falhar): o ladrilho central é ciano quase
// branco e há ladrilhos translúcidos sobrepostos no miolo (a "moldura"
// arredondada ao redor do brilho central, e as sobreposições entre
// ladrilhos vizinhos). Esses pixels têm azulidade BAIXA — próxima da do
// próprio anel neutro da placa — porque são o resultado de uma tinta azul
// bem diluída sobre o branco. LIMIAR_BAIXO em 15 (calibrado olhando pixel a
// pixel esta arte específica) é o ponto que ainda pega o traço mais visível
// dessas sobreposições (a moldura translúcida tem um contorno com azulidade
// ~45, bem acima da faixa neutra ~0-2 da placa) sem também acender a placa
// inteira. Sozinha, a rampa zera o alfa do PREENCHIMENTO de cada
// sobreposição (fica indistinguível do anel neutro da placa por azulidade) —
// só o contorno sobrevive. Isso é invisível sobre fundo branco (a área
// zerada se confunde com a página), mas sobre o fundo escuro do ícone
// maskable (etapa G) um buraco 100% transparente cercado por um contorno
// visível lê como um "buraco preto sólido" dentro do globo, não como vidro
// translúcido. Corrigido abaixo por CONECTIVIDADE, não por cor: só o fundo
// de verdade forma uma região de alfa zero que toca as 4 bordas da imagem
// (mesmo raciocínio de `removerFundoPorFloodFill`, na etapa B/C, adaptado
// aqui para o canal de alfa já calculado em vez de para cor). Qualquer
// bolsão de alfa zero que fica ILHADO — cercado por pixels com alfa
// não-zero, sem caminho até a borda — é miolo de ladrilho translúcido, não
// fundo, e ganha um alfa mínimo em vez de ficar 100% transparente.
async function gerarGloboRecorte() {
  const { data, width, height, channels } = await lerRaw(BRAND_ICONE)

  const LIMIAR_BAIXO = 15
  const LIMIAR_ALTO = 45
  const ALFA_MINIMO_MIOLO = 90 // ~35% — leitura de vidro fosco, sem virar bloco opaco
  const FOLGA = 0.06 // margem pequena ao redor do recorte quadrado final

  const rgba = Buffer.alloc(width * height * 4)
  for (let i = 0, total = width * height; i < total; i++) {
    const s = i * channels
    const o = i * 4
    const r = data[s]
    const g = data[s + 1]
    const b = data[s + 2]
    const azulidade = b - Math.max(r, g)
    const cobertura =
      azulidade <= LIMIAR_BAIXO
        ? 0
        : azulidade >= LIMIAR_ALTO
          ? 1
          : (azulidade - LIMIAR_BAIXO) / (LIMIAR_ALTO - LIMIAR_BAIXO)
    rgba[o] = r
    rgba[o + 1] = g
    rgba[o + 2] = b
    rgba[o + 3] = Math.round(cobertura * 255)
  }

  // BFS (fila, mesmo motivo de `removerFundoPorFloodFill`: ~1,5 milhão de
  // pixels estouraria a pilha de uma versão recursiva) a partir das 4 bordas,
  // andando só por pixels de alfa zero. O que essa busca alcança é fundo de
  // verdade; o que sobra de alfa-zero sem ser alcançado é miolo ilhado.
  {
    const total = width * height
    const visitado = new Uint8Array(total)
    const ehFundo = new Uint8Array(total)
    const idx = (x, y) => y * width + x
    const alfaEm = (i) => rgba[i * 4 + 3]
    const fila = []
    const semear = (x, y) => {
      const i = idx(x, y)
      if (visitado[i] || alfaEm(i) !== 0) return
      visitado[i] = 1
      ehFundo[i] = 1
      fila.push(i)
    }
    for (let x = 0; x < width; x++) {
      semear(x, 0)
      semear(x, height - 1)
    }
    for (let y = 0; y < height; y++) {
      semear(0, y)
      semear(width - 1, y)
    }
    let cabeca = 0
    while (cabeca < fila.length) {
      const i = fila[cabeca++]
      const x = i % width
      const y = Math.floor(i / width)
      const vizinhos = [
        [x - 1, y],
        [x + 1, y],
        [x, y - 1],
        [x, y + 1],
      ]
      for (const [nx, ny] of vizinhos) {
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
        const ni = idx(nx, ny)
        if (visitado[ni] || alfaEm(ni) !== 0) continue
        visitado[ni] = 1
        ehFundo[ni] = 1
        fila.push(ni)
      }
    }
    for (let i = 0; i < total; i++) {
      const o = i * 4
      if (rgba[o + 3] === 0 && !ehFundo[i]) {
        rgba[o + 3] = ALFA_MINIMO_MIOLO
      }
    }
  }

  const semFundo = await sharp(rgba, { raw: { width, height, channels: 4 } }).png().toBuffer()

  // `.trim()` mede a caixa real do que sobrou (o alfa 0 do resto conta como
  // "fundo" para o trim, já que não há mais nenhum pixel opaco fora do
  // globo). Depois, quadra com uma folga pequena — sem isso, ladrilhos que
  // encostam mais numa borda do que na outra deixariam o recorte final
  // descentrado dentro do quadro.
  //
  // ARMADILHA: nesta versão do sharp (0.32), `.metadata()` chamado sobre um
  // pipeline com `.trim()` pendente devolve as dimensões do buffer de
  // ENTRADA, não do resultado aparado — o trim só é aplicado quando o
  // pipeline é de fato renderizado. Por isso as dimensões corretas vêm do
  // `info` de `.toBuffer({ resolveWithObject: true })`, não de `.metadata()`.
  const { data: bufferAparado, info: infoAparado } = await sharp(semFundo)
    .trim()
    .png()
    .toBuffer({ resolveWithObject: true })

  const lado = Math.round(Math.max(infoAparado.width, infoAparado.height) * (1 + FOLGA))

  const saida = await sharp({
    create: { width: lado, height: lado, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([{ input: bufferAparado, gravity: 'center' }])
    .png()
    .toBuffer()

  // O arquivo que vai para o BUNDLE é reduzido de propósito. O recorte em
  // resolução cheia (~750px) pesa ~340 KB, e o único consumidor no app é o
  // fallback de avatar de aparelho (`PrnGlobo`), que desenha o globo a ~32px —
  // 96px mesmo numa tela de 3x. Mandar 750px para dentro do bundle web seria
  // pagar 340 KB para exibir 32. 256px cobre 3x com folga.
  //
  // A resolução cheia continua sendo usada AQUI DENTRO (é o valor de retorno):
  // o maskable precisa de ~370px de globo, e derivar de um master reduzido
  // devolveria um ícone borrado.
  const LADO_BUNDLE = 256
  const paraBundle = await sharp(saida).resize(LADO_BUNDLE, LADO_BUNDLE).png().toBuffer()

  await mkdir(SRC_ASSETS, { recursive: true })
  await writeFile(join(SRC_ASSETS, 'prn-globo.png'), paraBundle)
  return saida
}

/**
 * Maior distância do centro até um pixel VISÍVEL (alfa acima do limiar).
 *
 * A caixa delimitadora subestima ou superestima conforme a forma: para um
 * desenho arredondado como o globo, os CANTOS da caixa são vazios, então usar
 * a diagonal dela como raio encolhe o ícone à toa. Medir o raio real do que
 * está pintado dá o maior tamanho que ainda cabe na zona segura do Android.
 */
async function raioDoConteudo(buffer) {
  const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const cx = (info.width - 1) / 2
  const cy = (info.height - 1) / 2
  let maior = 0
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      const alfa = data[(y * info.width + x) * info.channels + 3]
      if (alfa < 24) continue
      const d = Math.hypot(x - cx, y - cy)
      if (d > maior) maior = d
    }
  }
  return maior
}

// ---------------------------------------------------------------------------
// B) public/logo-prnhub.png (tema claro) e
// C) public/logo-prnhub-invertida.png (tema escuro — "PRN" em branco)
// ---------------------------------------------------------------------------

async function gerarLockups() {
  const { data, width, height, channels } = await lerRaw(BRAND_LOCKUP)
  const TOLERANCIA_FLOOD_FILL = 30
  const semFundo = removerFundoPorFloodFill(data, width, height, channels, TOLERANCIA_FLOOD_FILL)

  const LARGURA_FINAL = 640

  // --- B: variante clara, sem nenhum recolorimento -----------------------
  const lockupClaroBuffer = await sharp(semFundo, { raw: { width, height, channels: 4 } })
    .png()
    .toBuffer()
  const logoClaro = await sharp(lockupClaroBuffer)
    .trim()
    .resize({ width: LARGURA_FINAL })
    .png()
    .toBuffer()
  await writeFile(join(PUBLIC, 'logo-prnhub.png'), logoClaro)

  // --- C: variante escura, com "PRN" em branco ----------------------------
  //
  // ESCOPO: só a faixa horizontal que contém "PRN". O globo usa o MESMO
  // azul-marinho das letras, então recolorir por matiz globalmente o
  // destruiria; e "Hub" já é azul claro, legível no escuro como está. Os dois
  // cortes são os vãos limpos medidos varrendo colunas sem pixel de conteúdo.
  //
  // MÉTODO: o alfa é DERIVADO DA TINTA, não copiado do flood fill.
  //
  // Pintar de branco os pixels escuros (a ideia óbvia, e a primeira tentativa
  // aqui) não funciona: o miolo fechado do "P" e do "R" é fundo BRANCO cercado
  // pelo traço, e o flood fill vem das bordas da imagem — ele nunca entra ali.
  // Esse miolo continuava branco opaco, e sobre o fundo escuro do app as duas
  // letras viravam blocos maciços, sem buraco. Conferido varrendo a linha do
  // miolo: era branco contínuo de um lado a outro do "P".
  //
  // Como a arte é tinta escura sobre fundo claro, a própria luminância já diz
  // o que é letra e o que é vazio. Mapeando luminância → alfa (escuro = opaco,
  // claro = transparente) e forçando o RGB para branco, o miolo se resolve
  // sozinho junto com o fundo, e as bordas ganham antialiasing de graça em vez
  // do recorte duro do flood fill.
  //
  // A rampa é fechada nos dois lados de propósito: o relevo 3D das letras tem
  // brilhos que chegam perto de 150 de luminância e precisam continuar OPACOS
  // (senão a letra fica manchada, que era o outro defeito da versão por
  // limiar); e o branco do miolo/fundo passa de 215.
  const CORTE_INICIO = 580 // vão entre o globo (termina ~549) e o "P" (começa ~610)
  const CORTE_FIM = 1218 // vão entre o "N" (termina ~1203) e o "H" de Hub (começa ~1234)
  const LUM_OPACO = 150 // até aqui é traço da letra: alfa cheio
  const LUM_VAZIO = 215 // daqui pra cima é miolo/fundo: alfa zero

  const recolorido = Buffer.from(semFundo) // cópia — não mexe no buffer usado por B
  for (let y = 0; y < height; y++) {
    for (let x = CORTE_INICIO; x < CORTE_FIM; x++) {
      const o = (y * width + x) * 4
      const luminancia = 0.2126 * recolorido[o] + 0.7152 * recolorido[o + 1] + 0.0722 * recolorido[o + 2]
      const cobertura =
        luminancia <= LUM_OPACO ? 1 : luminancia >= LUM_VAZIO ? 0 : (LUM_VAZIO - luminancia) / (LUM_VAZIO - LUM_OPACO)
      recolorido[o] = 255
      recolorido[o + 1] = 255
      recolorido[o + 2] = 255
      // `min` com o alfa que veio do flood fill: o que já era fundo externo
      // continua transparente, independente da luminância.
      recolorido[o + 3] = Math.min(recolorido[o + 3], Math.round(cobertura * 255))
    }
  }

  const lockupEscuroBuffer = await sharp(recolorido, { raw: { width, height, channels: 4 } })
    .png()
    .toBuffer()
  const logoEscuro = await sharp(lockupEscuroBuffer)
    .trim()
    .resize({ width: LARGURA_FINAL })
    .png()
    .toBuffer()
  await writeFile(join(PUBLIC, 'logo-prnhub-invertida.png'), logoEscuro)

  return logoEscuro
}

// ---------------------------------------------------------------------------
// D) public/favicon.ico — multi-resolução 16/32/48 — e
// D-2) public/favicon-96.png, ambos a partir da saída A-2 (o globo recortado,
// não mais a placa inteira nem o SVG desenhado à mão)
//
// Antes o .ico incluía também uma camada de 256px (arquivo final de 102 KB).
// Essa camada nunca era usada: todo navegador relevante hoje prefere um PNG
// declarado em `<link rel="icon">` (`favicon-96.png`) e só cai pro .ico como
// rede de segurança em navegador antigo — caso em que o maior tamanho de
// aba/favoritos pedido é ~48px. Cortar o 256 reduz o arquivo sem perder
// nenhum caso de uso real.
// ---------------------------------------------------------------------------

async function gerarFavicon(globoBuffer) {
  const TAMANHOS = [16, 32, 48]
  const imagens = []
  for (const tamanho of TAMANHOS) {
    const buffer = await sharp(globoBuffer).resize(tamanho, tamanho).png().toBuffer()
    imagens.push({ tamanho, buffer })
  }
  await writeFile(join(PUBLIC, 'favicon.ico'), montarIco(imagens))

  const favicon96 = await sharp(globoBuffer).resize(96, 96).png().toBuffer()
  await writeFile(join(PUBLIC, 'favicon-96.png'), favicon96)
}

// ---------------------------------------------------------------------------
// E) public/og-image.png — 1200×630, lockup escuro centralizado no fundo do app
// ---------------------------------------------------------------------------

async function gerarOgImage(logoEscuroBuffer) {
  const LARGURA = 1200
  const ALTURA = 630
  const LARGURA_LOGO = Math.round(LARGURA * 0.55)

  const logoRedimensionado = await sharp(logoEscuroBuffer).resize({ width: LARGURA_LOGO }).toBuffer()

  const saida = await sharp({
    create: { width: LARGURA, height: ALTURA, channels: 4, background: FUNDO_ESCURO },
  })
    .composite([{ input: logoRedimensionado, gravity: 'center' }])
    .png()
    .toBuffer()

  await writeFile(join(PUBLIC, 'og-image.png'), saida)
}

// ---------------------------------------------------------------------------
// F) PWA instalável — apple-touch-icon.png (180), pwa-192.png e pwa-512.png,
// os três a partir da mesma placa 512×512 já pronta na saída A
// ---------------------------------------------------------------------------

async function gerarIconesPwa(logoIconeBuffer) {
  // O iOS ignora o canal alfa do apple-touch-icon: ele aplica os próprios
  // cantos arredondados e pinta de PRETO qualquer pixel transparente que
  // sobrar por baixo (documentado no HIG da Apple). A saída A tem alfa fora
  // do retângulo arredondado da placa — sem achatar isso aqui, os cantos da
  // placa ganhariam uma borda preta visível no springboard do iPhone. Por
  // isso, diferente de todo outro tamanho gerado aqui, este precisa de um
  // `flatten()` sobre um fundo opaco antes de exportar.
  //
  // A cor do fundo aproxima o quase-branco da própria arte original
  // (`brand/prnhub-icone.png`) — não branco puro — pra não criar um degrau
  // de cor visível na borda entre a placa e o preenchimento do flatten.
  const FUNDO_PLACA_OPACO = { r: 250, g: 250, b: 251 }
  const appleTouchIcon = await sharp(logoIconeBuffer)
    .flatten({ background: FUNDO_PLACA_OPACO })
    .resize(180, 180)
    .png()
    .toBuffer()
  await writeFile(join(PUBLIC, 'apple-touch-icon.png'), appleTouchIcon)

  // pwa-192 e pwa-512: mesma arte, só reamostrada. Diferente do
  // apple-touch-icon, o manifest do Chrome/Android aceita (e prefere) alfa
  // nesses dois tamanhos "any" — só o "maskable" (etapa G) tem a regra da
  // zona segura.
  const pwa192 = await sharp(logoIconeBuffer).resize(192, 192).png().toBuffer()
  await writeFile(join(PUBLIC, 'pwa-192.png'), pwa192)

  // A saída A já É 512×512; o resize aqui é technically um no-op, mas fica
  // explícito e à prova de futuro caso o tamanho de A mude um dia.
  const pwa512 = await sharp(logoIconeBuffer).resize(512, 512).png().toBuffer()
  await writeFile(join(PUBLIC, 'pwa-512.png'), pwa512)
}

// ---------------------------------------------------------------------------
// G) public/pwa-maskable-512.png — só o globo (sem placa), centrado sobre
// fundo sólido, respeitando a "zona segura" que o Android exige
//
// O Android recorta ícones maskable num círculo (ou squircle, variando por
// skin/launcher) que pode comer até 20% da borda do quadrado de 512px. Por
// isso a especificação PWA pede que todo conteúdo visível caiba dentro de um
// círculo de raio 40% do lado (80% central) — o resto é só fundo, que pode
// ser cortado sem perda.
//
// Fonte do globo: o buffer já recortado na etapa A-2 (`gerarGloboRecorte`),
// passado direto como parâmetro — nada de ler `public/favicon.svg` (extinto)
// nem duplicar geometria em JS. Um único arquivo (`src/assets/prn-globo.png`)
// alimenta o maskable, o favicon, o favicon-96 e o componente React.
// ---------------------------------------------------------------------------

async function gerarIconeMaskable(globoBuffer, logoIconeBuffer) {
  const LADO_SAIDA = 512
  const FRACAO_ZONA_SEGURA = 0.8 // conteúdo visível cabe em 80% central (círculo de raio 40% do lado)

  const metaGlobo = await sharp(globoBuffer).metadata()

  // Escala pelo RAIO REAL do que está pintado, não pela diagonal da caixa.
  //
  // A versão anterior usava a diagonal da caixa aparada, o que é o pior caso
  // correto para um retângulo cheio — mas o globo é arredondado e os cantos da
  // caixa são vazios. Resultado: o desenho ocupava ~45% do quadro e o ícone
  // saía pequeno e perdido dentro da moldura. Medindo o raio dos pixels
  // visíveis, o globo cresce até encostar de verdade na zona segura.
  const raioAtual = await raioDoConteudo(globoBuffer)
  const raioSeguro = (LADO_SAIDA * FRACAO_ZONA_SEGURA) / 2
  const escala = raioSeguro / raioAtual

  const globoFinal = await sharp(globoBuffer)
    .resize(Math.round(metaGlobo.width * escala), Math.round(metaGlobo.height * escala))
    .toBuffer()

  // Fundo CLARO, amostrado da própria placa — não o escuro do app.
  //
  // Os ladrilhos translúcidos do miolo do globo foram desenhados para ficar
  // SOBRE a placa branca: é o fundo claro atravessando eles que os faz parecer
  // vidro. Sobre o escuro do app eles invertem de sentido e viram manchas
  // acinzentadas, com cara de sujeira em vez de desenho. Amostrar a cor da
  // placa (em vez de fixar um branco) mantém o ícone idêntico ao `pwa-512` e
  // ao `apple-touch-icon`, que também são a placa — e o recorte circular do
  // Android não revela nenhuma emenda entre globo e fundo.
  const fundoPlaca = await corDaPlaca(logoIconeBuffer)

  const saida = await sharp({
    create: { width: LADO_SAIDA, height: LADO_SAIDA, channels: 4, background: fundoPlaca },
  })
    .composite([{ input: globoFinal, gravity: 'center' }])
    .png()
    .toBuffer()

  await writeFile(join(PUBLIC, 'pwa-maskable-512.png'), saida)
}

/**
 * Cor de preenchimento da placa, medida numa faixa vertical à ESQUERDA do
 * globo (x ≈ 12% do lado), onde há placa e não há ladrilho. Média de uma
 * coluna inteira para não depender de um pixel só, que poderia cair num
 * gradiente ou num pixel de ruído do render original.
 */
async function corDaPlaca(logoIconeBuffer) {
  const { data, info } = await sharp(logoIconeBuffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const x = Math.round(info.width * 0.12)
  let r = 0, g = 0, b = 0, n = 0
  for (let y = Math.round(info.height * 0.35); y < Math.round(info.height * 0.65); y++) {
    const i = (y * info.width + x) * info.channels
    if (data[i + 3] < 200) continue // fora da placa (canto arredondado)
    r += data[i]; g += data[i + 1]; b += data[i + 2]; n++
  }
  if (!n) return { r: 244, g: 245, b: 247, alpha: 1 } // placa não encontrada: cinza-claro neutro
  return { r: Math.round(r / n), g: Math.round(g / n), b: Math.round(b / n), alpha: 1 }
}

// ---------------------------------------------------------------------------

const logoIcone = await gerarLogoIcone()
const globo = await gerarGloboRecorte()
const logoEscuro = await gerarLockups()
await gerarFavicon(globo)
await gerarOgImage(logoEscuro)
await gerarIconesPwa(logoIcone)
await gerarIconeMaskable(globo, logoIcone)

console.log('Marca PRN Hub gerada em public/ e src/assets/ a partir de brand/prnhub-icone.png e brand/prnhub-lockup.png')
