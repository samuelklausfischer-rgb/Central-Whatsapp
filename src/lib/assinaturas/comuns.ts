/**
 * Peças compartilhadas pelos cinco conceitos de assinatura.
 *
 * Porte direto do `gerador-assinaturas.html` — as funções são as mesmas, só
 * deixaram de ser globais de um `<script>`.
 */

import { MARCAS, type ChaveConceito, type ChaveMarca, type Marca } from './marcas'

/** As três cores de texto usadas em fundo claro. */
export const TINTA = '#0A1730'
export const CORPO = '#48566C'
export const FRACO = '#95A1B4'

export interface DadosAssinatura {
  conceito: ChaveConceito
  marca: ChaveMarca
  nome: string
  cargo: string
  telefone: string
  email: string
  endereco: string
  /** Mostrar o nome da empresa ao lado do cargo. */
  empresa: boolean
}

export type ChaveIcone = 'phone' | 'mail' | 'web' | 'pin'
/** `[tipo do ícone, texto exibido, href — vazio quando não é clicável]`. */
export type ItemContato = [ChaveIcone, string, string]

export const esc = (s: unknown): string =>
  String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const dig = (s: string | undefined): string => String(s || '').replace(/\D/g, '')

/**
 * Remove acentos: NFD separa a letra do diacrítico, o replace corta os
 * combinantes. O intervalo vai escapado porque são caracteres invisíveis —
 * literais, qualquer editor que normalize o arquivo apagaria a regra sem aviso.
 */
const DIACRITICOS = new RegExp('[\\u0300-\\u036f]', 'g')
export const semAcento = (s: string | undefined): string =>
  String(s || '').normalize('NFD').replace(DIACRITICOS, '')

/** `47 99137-8313` -> `+5547991378313`. Assume Brasil quando falta o DDI. */
export const telHref = (t: string): string => {
  let h = dig(t)
  if (h.length <= 11) h = '55' + h
  return '+' + h
}

/**
 * As linhas de contato, na ordem em que aparecem. Cada uma só entra se tiver
 * conteúdo — é isso que faz a altura do cartão variar entre 3 e 4 linhas.
 */
export function itensDe(d: DadosAssinatura, m: Marca): ItemContato[] {
  const it: ItemContato[] = []
  if (d.telefone) it.push(['phone', d.telefone, 'tel:' + telHref(d.telefone)])
  if (d.email) it.push(['mail', d.email, 'mailto:' + d.email])
  if (m.site) it.push(['web', m.site, m.siteUrl])
  const e = (d.endereco || '').trim()
  if (e) it.push(['pin', e, ''])
  return it
}

/** `ADMINISTRATIVO  ·  PRN DIAGNÓSTICOS` — a linha abaixo do nome. */
export const legendaDe = (d: DadosAssinatura, m: Marca): string =>
  ((d.cargo || '') + (d.empresa && m.nome ? '  ·  ' + m.nome : '')).toUpperCase()

/** As linhas de contato desenhadas em SVG, empilhadas de 21 em 21 px. */
export function linhasSVG(
  itens: ItemContato[],
  x: number,
  y0: number,
  icones: Record<ChaveIcone, string>,
  cor: string,
  corFraca: string,
): string {
  return itens
    .map(([k, txt], i) => {
      const cy = y0 + i * 21
      // O endereço é informação secundária: sai sempre na cor fraca.
      const c = k === 'pin' ? corFraca : cor
      return `<image href="${icones[k]}" x="${x}" y="${cy - 6.5}" width="13" height="13"/>
      <text x="${x + 22}" y="${cy + 4.4}" font-family="OpenSansX" font-size="12.5"
        fill="${c}">${esc(txt)}</text>`
    })
    .join('')
}

export const marcaDe = (d: DadosAssinatura): Marca => MARCAS[d.marca]

/** Nome de arquivo do PNG: `assinatura-renata-albuquerque.png`. */
export function nomeDoArquivo(nome: string): string {
  const base = semAcento(nome || 'assinatura')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
  return `assinatura-${base || 'assinatura'}.png`
}
