/**
 * Confere o renderizador da proposta contra os dados reais do app Python, sem
 * precisar subir o app.
 *
 * Monta o HTML a partir de um JSON de `PROPOSTA PRN PDF/work/dados/` e checa o
 * que dá para checar sem abrir o PDF: 13 seções, nenhuma tag Jinja sobrando,
 * marcadores substituídos e a logo embutida.
 *
 * Uso:
 *   node scripts/conferir-proposta.mjs [caminho-do-json]
 *
 * Importa os `.ts` direto: o Node remove os tipos sozinho, e o motor da
 * proposta é código puro (só `montar-html.ts` toca em `import.meta.env`, e faz
 * isso dentro de função justamente para continuar importável aqui).
 *
 * O HTML fica em `build-proposta/proposta.html` — abrir no Chrome e imprimir dá
 * exatamente o PDF que o app produz.
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { montarHtml } from '../src/lib/proposta/montar-html.ts'
import { resolverToken, nomeDoPdf, slugDe } from '../src/lib/proposta/dados.ts'

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const WORK = 'C:/Users/OPERACIONAL/Desktop/Projetos PRN/PROPOSTA PRN PDF/work'
const SAIDA = path.join(RAIZ, 'build-proposta')

const jsonCliente = process.argv[2] || path.join(WORK, 'dados/hospital-sao-donato.json')

const dadosCrus = JSON.parse(await fs.readFile(jsonCliente, 'utf-8'))
const dados = resolverToken(dadosCrus, dadosCrus.cliente.nome)

const ler = (f) => fs.readFile(path.join(RAIZ, 'public/proposta', f), 'utf-8')
const pecas = {
  template: await ler('template.html'),
  estilos: await ler('estilos.css'),
  slides: await ler('slides.html.j2'),
  imagens: JSON.parse(await ler('imagens.json')),
}

const html = montarHtml(dados, pecas)
await fs.mkdir(SAIDA, { recursive: true })
const destino = path.join(SAIDA, 'proposta.html')
await fs.writeFile(destino, html, 'utf-8')

const conta = (re) => (html.match(re) || []).length
const logos = conta(/src="data:image\/png;base64,/g)
// Conta pelos `id="page-N"`, não pela tag: o `template.html` cita
// `<section class="page">` num comentário, e qualquer contagem baseada na tag
// devolve 14 — foi exatamente o falso alarme que apareceu na primeira execução.
const paginas = conta(/id="page-\d+"/g)
const checagens = [
  ['13 páginas renderizadas', paginas === 13, paginas],
  ['nenhuma interpolação Jinja sobrando', !html.includes('{{'), conta(/{{/g)],
  ['nenhum bloco Jinja sobrando', !html.includes('{%'), conta(/{%/g)],
  ['marcador STYLES substituído', !html.includes('<!--STYLES-->'), ''],
  ['marcador SECTIONS substituído', !html.includes('<!--SECTIONS-->'), ''],
  ['logo embutida em data URI (2x)', logos === 2, logos],
  ['nenhum caminho relativo de asset', !html.includes('src="assets/'), ''],
  ['nome do cliente aplicado', html.includes(dados.cliente.nome), ''],
  ['token {cliente} resolvido', !html.includes('{cliente}'), ''],
  ['Poppins embutida no CSS', html.includes('font-family: ' + "'Poppins'"), ''],
]

console.log(`\nProposta: ${dados.cliente.nome} — ${dados.cliente.cidade_uf}`)
console.log(`Exames: ${dados.exames.length} | Cases: ${(dados.cases || []).length}`)
console.log(`Arquivo: ${nomeDoPdf(dados.cliente.nome)} (slug ${slugDe(dados.cliente.nome)})`)
console.log(`HTML: ${(html.length / 1024 / 1024).toFixed(2)} MB -> ${destino}\n`)

let ok = true
for (const [rotulo, passou, detalhe] of checagens) {
  console.log(`  ${passou ? 'OK   ' : 'FALHA'} ${rotulo}${detalhe !== '' ? ` (${detalhe})` : ''}`)
  if (!passou) ok = false
}

if (dados.exames.length > 5) {
  console.log(`\n  [AVISO] ${dados.exames.length} exames — o slide 4 foi desenhado para até 5.`)
}

console.log(`\nSTATUS: ${ok ? 'OK' : 'REVISAR'}\n`)
process.exit(ok ? 0 : 1)
