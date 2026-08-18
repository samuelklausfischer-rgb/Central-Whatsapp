/**
 * Os cinco desenhos de assinatura, cada um uma função que devolve um SVG
 * completo e autocontido (fontes e imagens embutidas).
 *
 * Porte literal do `gerador-assinaturas.html`: as contas de posicionamento são
 * as mesmas, linha a linha. Mexer nos números aqui muda o layout aprovado — o
 * que vale ajustar é `marcas.ts` (dados) e não a geometria.
 *
 * A altura do cartão cresce com a quantidade de linhas de contato: cada linha
 * ocupa 21 px (20 no Vidro), e é daí que saem os `Math.max(...)` de altura.
 */

import { cssDasFontes, type AssetsAssinatura } from './assets'
import {
  CORPO,
  FRACO,
  TINTA,
  esc,
  itensDe,
  legendaDe,
  linhasSVG,
  marcaDe,
  type DadosAssinatura,
} from './comuns'

type Desenhista = (d: DadosAssinatura, a: AssetsAssinatura) => string

/* ═══════════════════════════════════ AURORA ═════════════════════════════ */
const svgAurora: Desenhista = (d, a) => {
  const m = marcaDe(d)
  const it = itensDe(d, m)
  const img = a.imagens[d.marca]
  const IC = a.icones.claro
  const M = 22, CW = 636, PW = 206, RAD = 20
  const CH = Math.max(152, 102 + it.length * 21), SW = CW + M * 2, SH = CH + M * 2
  const negW = 152, negH = Math.round(negW / m.rz)
  const alt = 24 + 6 + 14 + 15 + it.length * 21 - 4
  const y = M + (CH - alt) / 2 + 17, x = M + PW + 30
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SW}" height="${SH}"
   viewBox="0 0 ${SW} ${SH}"><style>${cssDasFontes(a)}</style>
 <defs>
  <radialGradient id="g1" cx="12%" cy="8%" r="120%"><stop offset="0%" stop-color="#0B5BD3"/>
   <stop offset="42%" stop-color="#012C7E"/><stop offset="100%" stop-color="#001233"/></radialGradient>
  <radialGradient id="g2" cx="50%" cy="50%" r="50%">
   <stop offset="0%" stop-color="#78B4FF" stop-opacity=".55"/>
   <stop offset="70%" stop-color="#78B4FF" stop-opacity="0"/></radialGradient>
  <radialGradient id="g3" cx="50%" cy="50%" r="50%">
   <stop offset="0%" stop-color="#BE1446" stop-opacity=".62"/>
   <stop offset="70%" stop-color="#BE1446" stop-opacity="0"/></radialGradient>
  <clipPath id="cC"><rect x="${M}" y="${M}" width="${CW}" height="${CH}" rx="${RAD}"/></clipPath>
  <clipPath id="cP"><rect x="${M}" y="${M}" width="${PW}" height="${CH}"/></clipPath>
  <filter id="fC" x="-12%" y="-24%" width="124%" height="160%">
   <feDropShadow dx="0" dy="12" stdDeviation="13" flood-color="#0A1E46" flood-opacity=".22"/>
   <feDropShadow dx="0" dy="1" stdDeviation="2" flood-color="#0A1E46" flood-opacity=".07"/></filter>
  <filter id="fL" x="-25%" y="-40%" width="150%" height="190%">
   <feDropShadow dx="0" dy="6" stdDeviation="7" flood-color="#000616" flood-opacity=".50"/></filter>
  <filter id="fB"><feGaussianBlur stdDeviation="1.1"/></filter>
 </defs>
 <rect width="${SW}" height="${SH}" fill="#FFFFFF"/>
 <g filter="url(#fC)"><rect x="${M}" y="${M}" width="${CW}" height="${CH}" rx="${RAD}" fill="#fff"/></g>
 <g clip-path="url(#cC)"><g clip-path="url(#cP)">
   <rect x="${M}" y="${M}" width="${PW}" height="${CH}" fill="url(#g1)"/>
   <circle cx="${M + 55}" cy="${M - 5}" r="125" fill="url(#g2)"/>
   <circle cx="${M + PW + 10}" cy="${M + CH + 10}" r="100" fill="url(#g3)"/>
   <image href="${img.esfera}" x="${M - 80}" y="${M + CH - 152}" width="230" height="230"
     opacity=".11" filter="url(#fB)"/>
 </g></g>
 <g filter="url(#fL)"><image href="${img.neg}" x="${M + (PW - negW) / 2}" y="${M + (CH - negH) / 2}"
   width="${negW}" height="${negH}"/></g>
 <text x="${x}" y="${y}" font-family="Poppins" font-weight="500" font-size="21"
   letter-spacing="-.4" fill="${TINTA}">${esc(d.nome)}</text>
 <text x="${x}" y="${y + 22}" font-family="Poppins" font-size="10" letter-spacing="1.5"
   fill="${FRACO}">${esc(legendaDe(d, m))}</text>
 ${linhasSVG(it, x, y + 48, IC, CORPO, FRACO)}
</svg>`
}

/* ═══════════════════════════════════ VARREDURA ══════════════════════════ */
const svgVarredura: Desenhista = (d, a) => {
  const m = marcaDe(d)
  const it = itensDe(d, m)
  const img = a.imagens[d.marca]
  const IC = a.icones.claro
  const M = 22, CW = 660, PW = 134, RAD = 18
  const CH = Math.max(158, 108 + it.length * 21), SW = CW + M * 2, SH = CH + M * 2
  const cx = M + PW / 2, cy = M + CH / 2
  const aneis = ([[35, 0.55], [60, 0.38], [86, 0.26], [114, 0.17], [145, 0.11], [180, 0.07]] as const)
    .map(([r, o]) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none"
       stroke="#96CDFF" stroke-opacity="${o}" stroke-width="1"/>`)
    .join('')
  const logoW = 126, logoH = Math.round(logoW / m.rz)
  const xL = M + PW + 28, xT = xL + logoW + 24 + 1 + 24
  const alt = 23 + 6 + 14 + 13 + it.length * 21 - 4
  const y = M + (CH - alt) / 2 + 16
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SW}" height="${SH}"
   viewBox="0 0 ${SW} ${SH}"><style>${cssDasFontes(a)}</style>
 <defs>
  <linearGradient id="v1" x1="0" y1="0" x2=".55" y2="1">
   <stop offset="0%" stop-color="#001030"/><stop offset="55%" stop-color="#032A6E"/>
   <stop offset="100%" stop-color="#0645A8"/></linearGradient>
  <linearGradient id="v2" x1="0" y1="0" x2="1" y2="0">
   <stop offset="55%" stop-color="#BE1446" stop-opacity="0"/>
   <stop offset="100%" stop-color="#BE1446" stop-opacity=".28"/></linearGradient>
  <radialGradient id="v3" cx="50%" cy="50%" r="50%">
   <stop offset="35%" stop-color="#78BEFF" stop-opacity=".38"/>
   <stop offset="100%" stop-color="#78BEFF" stop-opacity="0"/></radialGradient>
  <linearGradient id="v4" x1="0" y1="0" x2="0" y2="1">
   <stop offset="0%" stop-color="#fff"/><stop offset="20%" stop-color="#E2E8F2"/>
   <stop offset="80%" stop-color="#E2E8F2"/><stop offset="100%" stop-color="#fff"/></linearGradient>
  <clipPath id="wC"><rect x="${M}" y="${M}" width="${CW}" height="${CH}" rx="${RAD}"/></clipPath>
  <clipPath id="wP"><rect x="${M}" y="${M}" width="${PW}" height="${CH}"/></clipPath>
  <filter id="wS" x="-12%" y="-24%" width="124%" height="160%">
   <feDropShadow dx="0" dy="11" stdDeviation="12" flood-color="#0A1E46" flood-opacity=".21"/>
   <feDropShadow dx="0" dy="1" stdDeviation="2" flood-color="#0A1E46" flood-opacity=".06"/></filter>
 </defs>
 <rect width="${SW}" height="${SH}" fill="#FFFFFF"/>
 <g filter="url(#wS)"><rect x="${M}" y="${M}" width="${CW}" height="${CH}" rx="${RAD}" fill="#fff"/></g>
 <g clip-path="url(#wC)"><g clip-path="url(#wP)">
   <rect x="${M}" y="${M}" width="${PW}" height="${CH}" fill="url(#v1)"/>
   ${aneis}
   <circle cx="${cx}" cy="${cy}" r="74" fill="url(#v3)"/>
   <image href="${img.esfera}" x="${cx - 52}" y="${cy - 52}" width="104" height="104"/>
   <rect x="${M}" y="${M}" width="${PW}" height="${CH}" fill="url(#v2)"/>
 </g></g>
 <image href="${img.logo}" x="${xL}" y="${M + (CH - logoH) / 2}" width="${logoW}" height="${logoH}"/>
 <rect x="${xL + logoW + 24}" y="${M + (CH - 122) / 2}" width="1" height="122" fill="url(#v4)"/>
 <text x="${xT}" y="${y}" font-family="Poppins" font-weight="500" font-size="20"
   letter-spacing="-.4" fill="${TINTA}">${esc(d.nome)}</text>
 <text x="${xT}" y="${y + 21}" font-family="Poppins" font-size="9.5" letter-spacing="1.5"
   fill="${FRACO}">${esc(legendaDe(d, m))}</text>
 ${linhasSVG(it, xT, y + 46, IC, CORPO, FRACO)}
</svg>`
}

/* ═══════════════════════════════════ EDITORIAL ══════════════════════════ */
const svgEditorial: Desenhista = (d, a) => {
  const m = marcaDe(d)
  const img = a.imagens[d.marca]
  const M = 22, CW = 636, RAD = 4
  const temEnd = !!(d.endereco || '').trim()
  const CH = temEnd ? 196 : 172, SW = CW + M * 2, SH = CH + M * 2
  const logoW = 132, logoH = Math.round(logoW / m.rz)
  const px = M + 38

  // O Editorial não usa ícones: os contatos viram colunas rotuladas. A largura
  // de cada uma é fixa por tipo de dado, porque e-mail é sempre o mais longo.
  const cols: [string, string, number][] = []
  if (d.telefone) cols.push(['Telefone', d.telefone, 118])
  if (d.email) cols.push(['E-mail', d.email, 252])
  if (m.site) cols.push(['Site', m.site, 160])
  let cx = px
  const colunas = cols
    .map(([r, v, w]) => {
      const s = `<text x="${cx}" y="${M + 128}" font-family="Poppins" font-size="8.5"
        letter-spacing="1.8" fill="#AFB9C9">${esc(r.toUpperCase())}</text>
      <text x="${cx}" y="${M + 147}" font-family="OpenSansX" font-size="12"
        fill="${CORPO}">${esc(v)}</text>`
      cx += w + 26
      return s
    })
    .join('')

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SW}" height="${SH}"
   viewBox="0 0 ${SW} ${SH}"><style>${cssDasFontes(a)}</style>
 <defs>
  <linearGradient id="e1" x1="0" y1="0" x2="1" y2="0">
   <stop offset="0%" stop-color="#002A6F"/><stop offset="100%" stop-color="#9E0020"/></linearGradient>
  <clipPath id="eC"><rect x="${M}" y="${M}" width="${CW}" height="${CH}" rx="${RAD}"/></clipPath>
  <filter id="eS" x="-12%" y="-24%" width="124%" height="170%">
   <feDropShadow dx="0" dy="12" stdDeviation="14" flood-color="#0A1E46" flood-opacity=".16"/></filter>
  <filter id="eB"><feGaussianBlur stdDeviation="1.8"/></filter>
 </defs>
 <rect width="${SW}" height="${SH}" fill="#FFFFFF"/>
 <g filter="url(#eS)"><rect x="${M}" y="${M}" width="${CW}" height="${CH}" rx="${RAD}" fill="#fff"/></g>
 <g clip-path="url(#eC)">
   <image href="${img.esfera}" x="${M + CW - 148}" y="${M + CH - 134}" width="212" height="212"
     opacity=".055" filter="url(#eB)"/>
 </g>
 <text x="${px}" y="${M + 62}" font-family="Poppins" font-weight="400" font-size="30"
   letter-spacing="-1" fill="${TINTA}">${esc(d.nome)}</text>
 <text x="${px}" y="${M + 82}" font-family="Poppins" font-size="9.5" letter-spacing="2.4"
   fill="${FRACO}">${esc((d.cargo || '').toUpperCase())}</text>
 <image href="${img.logo}" x="${M + CW - 38 - logoW}" y="${M + 36}" width="${logoW}" height="${logoH}"/>
 <rect x="${px}" y="${M + 104}" width="${CW - 76}" height="1" fill="#E9EDF4"/>
 <rect x="${px}" y="${M + 104}" width="54" height="1" fill="url(#e1)"/>
 ${colunas}
 ${
    temEnd
      ? `<text x="${px}" y="${M + 176}" font-family="OpenSansX" font-size="11.5"
   fill="${FRACO}">${esc(d.endereco)}</text>`
      : ''
  }
</svg>`
}

/* ═══════════════════════════════════ NOTURNO ════════════════════════════ */
const svgNoturno: Desenhista = (d, a) => {
  const m = marcaDe(d)
  const it = itensDe(d, m)
  const img = a.imagens[d.marca]
  const ICB = a.icones.escuro
  const M = 22, CW = 636, RAD = 18
  const CH = Math.max(150, 100 + it.length * 21), SW = CW + M * 2, SH = CH + M * 2
  const negW = 158, negH = Math.round(negW / m.rz)
  const x = M + 32 + negW + 28
  const alt = 24 + 6 + 14 + 2 + 12 + 13 + it.length * 21 - 4
  const y = M + (CH - alt) / 2 + 17
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SW}" height="${SH}"
   viewBox="0 0 ${SW} ${SH}"><style>${cssDasFontes(a)}</style>
 <defs>
  <linearGradient id="n1" x1="0" y1="0" x2=".9" y2="1">
   <stop offset="0%" stop-color="#00102E"/><stop offset="46%" stop-color="#032563"/>
   <stop offset="100%" stop-color="#063F94"/></linearGradient>
  <radialGradient id="n2" cx="50%" cy="50%" r="50%">
   <stop offset="0%" stop-color="#78B4FF" stop-opacity=".30"/>
   <stop offset="70%" stop-color="#78B4FF" stop-opacity="0"/></radialGradient>
  <radialGradient id="n3" cx="50%" cy="50%" r="50%">
   <stop offset="0%" stop-color="#C8194B" stop-opacity=".55"/>
   <stop offset="68%" stop-color="#C8194B" stop-opacity="0"/></radialGradient>
  <linearGradient id="n4" x1="0" y1="0" x2="1" y2="0">
   <stop offset="0%" stop-color="#5E9BF0"/><stop offset="100%" stop-color="#C8194B"/></linearGradient>
  <clipPath id="nC"><rect x="${M}" y="${M}" width="${CW}" height="${CH}" rx="${RAD}"/></clipPath>
  <filter id="nS" x="-12%" y="-28%" width="124%" height="170%">
   <feDropShadow dx="0" dy="16" stdDeviation="16" flood-color="#04143C" flood-opacity=".45"/></filter>
  <filter id="nL" x="-25%" y="-40%" width="150%" height="190%">
   <feDropShadow dx="0" dy="8" stdDeviation="9" flood-color="#000616" flood-opacity=".55"/></filter>
  <filter id="nB"><feGaussianBlur stdDeviation="2"/></filter>
 </defs>
 <rect width="${SW}" height="${SH}" fill="#FFFFFF"/>
 <g filter="url(#nS)"><rect x="${M}" y="${M}" width="${CW}" height="${CH}" rx="${RAD}"
   fill="url(#n1)"/></g>
 <g clip-path="url(#nC)">
   <rect x="${M}" y="${M}" width="${CW}" height="${CH}" fill="url(#n1)"/>
   <circle cx="${M + CW - 40}" cy="${M - 30}" r="165" fill="url(#n2)"/>
   <circle cx="${M + CW - 20}" cy="${M + CH + 50}" r="125" fill="url(#n3)"/>
   <image href="${img.esfera}" x="${M + CW - 176}" y="${M - 48}" width="262" height="262"
     opacity=".09" filter="url(#nB)"/>
 </g>
 <g filter="url(#nL)"><image href="${img.neg}" x="${M + 32}" y="${M + (CH - negH) / 2}"
   width="${negW}" height="${negH}"/></g>
 <text x="${x}" y="${y}" font-family="Poppins" font-weight="500" font-size="21"
   letter-spacing="-.4" fill="#FFFFFF">${esc(d.nome)}</text>
 <text x="${x}" y="${y + 21}" font-family="Poppins" font-size="9.5" letter-spacing="1.6"
   fill="#8FB4E8">${esc(legendaDe(d, m))}</text>
 <rect x="${x}" y="${y + 30}" width="34" height="2" rx="1" fill="url(#n4)"/>
 ${linhasSVG(it, x, y + 56, ICB, '#DCE8F9', '#8FB4E8')}
</svg>`
}

/* ═══════════════════════════════════ VIDRO ══════════════════════════════ */
const svgVidro: Desenhista = (d, a) => {
  const m = marcaDe(d)
  const it = itensDe(d, m)
  const img = a.imagens[d.marca]
  const ICB = a.icones.escuro
  const M = 22, CW = 636, RAD = 18, PAD = 14, LW = 190, GAP = 16
  const alt = 61 + it.length * 20
  const CH = Math.max(168, alt + 60), SW = CW + M * 2, SH = CH + M * 2

  const px = M + PAD + LW + GAP, pw = CW - PAD * 2 - LW - GAP
  const py = M + PAD, ph = CH - PAD * 2

  // A MedImagem tem logotipo mais largo e baixo (rz 3.79): sem esse ajuste ela
  // ficaria visivelmente menor que as outras duas no mesmo espaço.
  const negW = d.marca === 'medimagem' ? 178 : 156
  const negH = Math.round(negW / m.rz)
  const lx = M + PAD + (LW - negW) / 2, ly = M + (CH - negH) / 2

  const tx = px + 24
  const y = py + (ph - alt) / 2 + 17
  const yNome = y, ySub = y + 21, yRegua = y + 31
  const y0 = y + 49

  const linhas = it
    .map(([k, txt], i) => {
      const cy = y0 + i * 20
      const cor = k === 'pin' ? '#AFCCF6' : '#E4EDFA'
      return `<image href="${ICB[k]}" x="${tx}" y="${cy - 6.5}" width="13" height="13"
        opacity=".85"/>
      <text x="${tx + 23}" y="${cy + 4.4}" font-family="OpenSansX" font-size="12.5"
        fill="${cor}">${esc(txt)}</text>`
    })
    .join('')

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SW}" height="${SH}"
   viewBox="0 0 ${SW} ${SH}"><style>${cssDasFontes(a)}</style>
 <defs>
  <radialGradient id="vd1" cx=".08" cy="0" r="1.25">
   <stop offset="0%" stop-color="#0C63E4"/><stop offset="40%" stop-color="#02246B"/>
   <stop offset="100%" stop-color="#010B26"/></radialGradient>
  <radialGradient id="vd2" cx="50%" cy="50%" r="50%">
   <stop offset="0%" stop-color="#D61A56" stop-opacity=".65"/>
   <stop offset="70%" stop-color="#D61A56" stop-opacity="0"/></radialGradient>
  <linearGradient id="vd3" x1="0" y1="0" x2="1" y2="0">
   <stop offset="0%" stop-color="#5E9BF0"/><stop offset="100%" stop-color="#C8194B"/></linearGradient>
  <clipPath id="vdC"><rect x="${M}" y="${M}" width="${CW}" height="${CH}" rx="${RAD}"/></clipPath>
  <filter id="vdS" x="-12%" y="-28%" width="124%" height="175%">
   <feDropShadow dx="0" dy="18" stdDeviation="17" flood-color="#04143C" flood-opacity=".50"/></filter>
  <filter id="vdL" x="-25%" y="-45%" width="150%" height="200%">
   <feDropShadow dx="0" dy="8" stdDeviation="9" flood-color="#000414" flood-opacity=".62"/></filter>
  <filter id="vdB"><feGaussianBlur stdDeviation="2.2"/></filter>
 </defs>
 <rect width="${SW}" height="${SH}" fill="#FFFFFF"/>
 <g filter="url(#vdS)"><rect x="${M}" y="${M}" width="${CW}" height="${CH}" rx="${RAD}"
   fill="url(#vd1)"/></g>
 <g clip-path="url(#vdC)">
   <rect x="${M}" y="${M}" width="${CW}" height="${CH}" fill="url(#vd1)"/>
   <image href="${img.esfera}" x="${M - 72}" y="${M - 66}" width="262" height="262"
     opacity=".09" filter="url(#vdB)"/>
   <circle cx="${M + CW + 80}" cy="${M + CH + 20}" r="170" fill="url(#vd2)"/>
 </g>
 <rect x="${px}" y="${py}" width="${pw}" height="${ph}" rx="13"
   fill="#FFFFFF" fill-opacity=".07" stroke="#FFFFFF" stroke-opacity=".14"/>
 <rect x="${px + 14}" y="${py + 1}" width="${pw - 28}" height="1" fill="#FFFFFF" fill-opacity=".22"/>
 <g filter="url(#vdL)"><image href="${img.neg}" x="${lx}" y="${ly}" width="${negW}"
   height="${negH}"/></g>
 <text x="${tx}" y="${yNome}" font-family="Poppins" font-weight="500" font-size="21"
   letter-spacing="-.4" fill="#FFFFFF">${esc(d.nome)}</text>
 <text x="${tx}" y="${ySub}" font-family="Poppins" font-size="9.5" letter-spacing="1.6"
   fill="#AFCCF6">${esc(legendaDe(d, m))}</text>
 <rect x="${tx}" y="${yRegua}" width="34" height="2" rx="1" fill="url(#vd3)"/>
 ${linhas}
</svg>`
}

const DESENHISTAS: Record<string, Desenhista> = {
  vidro: svgVidro,
  aurora: svgAurora,
  varredura: svgVarredura,
  editorial: svgEditorial,
  noturno: svgNoturno,
}

/** O SVG da assinatura. `vidro` é o padrão aprovado. */
export const montarSVG = (d: DadosAssinatura, a: AssetsAssinatura): string =>
  (DESENHISTAS[d.conceito] || svgVidro)(d, a)
