// Lógica pura da edição completa dos preços (item_preco): rascunho, validação, diff e efeitos de apagar.
import type { PapelItem } from '../../lib/tipos'
import { brl } from '../../lib/format'
import { ROTULO_PAPEL } from '../../lib/config'
import type { MudancaRevisao } from '../../components/ui'

/** Valores aceitos pelo CHECK de item_preco.modalidade. */
export const MODALIDADES = ['RX', 'TC', 'RM', 'MG', 'US', 'DO', 'ECG', 'FIXO', 'OUTRO'] as const
export const PAPEIS: PapelItem[] = ['normal', 'urgencia', 'fixo', 'excedente']

/** Linha completa de item_preco (o que a tela edita). */
export interface ItemCompleto {
  id: string; ordem: number; papel: PapelItem; exame: string; modalidade: string | null; subunidade: string | null
  codigo: string | null; unidade_medida: string | null; quantidade_estimada: number | null; valor_original: number | null
}

/** Linha em edição: tudo texto, como nos campos. `id` null = ainda não existe no banco. */
export interface RascunhoItem {
  chave: string; id: string | null; exame: string; papel: PapelItem; modalidade: string; subunidade: string
  codigo: string; unidade_medida: string; quantidade_estimada: string; valor_original: string
}

const txt = (v: string | number | null | undefined) => (v == null ? '' : String(v).replace('.', ','))

export function paraRascunho(i: ItemCompleto): RascunhoItem {
  return {
    chave: i.id, id: i.id, exame: i.exame, papel: i.papel, modalidade: i.modalidade ?? '', subunidade: i.subunidade ?? '',
    codigo: i.codigo ?? '', unidade_medida: i.unidade_medida ?? '', quantidade_estimada: txt(i.quantidade_estimada), valor_original: txt(i.valor_original),
  }
}

export function rascunhoVazio(chave: string, papel: PapelItem = 'normal'): RascunhoItem {
  return { chave, id: null, exame: '', papel, modalidade: '', subunidade: '', codigo: '', unidade_medida: '', quantidade_estimada: '', valor_original: '' }
}

/** Texto digitado vira número (vírgula ou ponto); vazio = null; lixo = undefined. */
export function lerNumero(s: string): number | null | undefined {
  const t = s.trim().replace(/\s/g, '')
  if (t === '') return null
  if (!/^-?\d+([.,]\d+)?$/.test(t)) return undefined
  const n = Number(t.replace(',', '.'))
  return Number.isFinite(n) ? n : undefined
}

const casas = (s: string) => (s.trim().replace(',', '.').split('.')[1] ?? '').length

/** Erros por campo (vazio = linha válida). Respeita o CHECK de modalidade/papel e numeric(12,4). */
export function validarRascunho(r: RascunhoItem): Partial<Record<'exame' | 'modalidade' | 'papel' | 'valor_original' | 'quantidade_estimada', string>> {
  const e: Partial<Record<'exame' | 'modalidade' | 'papel' | 'valor_original' | 'quantidade_estimada', string>> = {}
  if (!r.exame.trim()) e.exame = 'Informe o nome do item'
  if (!PAPEIS.includes(r.papel)) e.papel = 'Papel inválido'
  if (r.modalidade && !(MODALIDADES as readonly string[]).includes(r.modalidade)) e.modalidade = 'Modalidade inválida'
  const v = lerNumero(r.valor_original)
  if (v === undefined) e.valor_original = 'Use só números (ex.: 12,50)'
  else if (v !== null && v < 0) e.valor_original = 'O valor não pode ser negativo'
  else if (v !== null && casas(r.valor_original) > 4) e.valor_original = 'No máximo 4 casas decimais'
  else if (v !== null && v >= 1e8) e.valor_original = 'Valor grande demais'
  const q = lerNumero(r.quantidade_estimada)
  if (q === undefined) e.quantidade_estimada = 'Use só números'
  else if (q !== null && q < 0) e.quantidade_estimada = 'Não pode ser negativa'
  return e
}

/** Alertas (não bloqueiam) que repetem os erros D28/D29 do catálogo: item que nunca é escolhido ou concorre com tudo. */
export function avisosItem(r: RascunhoItem): string[] {
  const a: string[] = []
  const cobra = r.papel === 'normal' || r.papel === 'urgencia'
  if (cobra && (r.modalidade === 'FIXO' || r.modalidade === 'OUTRO')) a.push(`Com modalidade ${r.modalidade} este item quase nunca é escolhido (só casa com exames sem modalidade conhecida).`)
  if (cobra && !r.modalidade) a.push('Sem modalidade, o item concorre com exames de qualquer modalidade.')
  if (r.papel === 'fixo' && r.modalidade && r.modalidade !== 'FIXO') a.push('Itens de valor fixo costumam ter modalidade FIXO.')
  return a
}

/** Converte a linha em colunas do banco (assume linha válida). */
export function paraBanco(r: RascunhoItem): Omit<ItemCompleto, 'id' | 'ordem'> {
  return {
    exame: r.exame.trim(), papel: r.papel, modalidade: r.modalidade || null, subunidade: r.subunidade.trim() || null,
    codigo: r.codigo.trim() || null, unidade_medida: r.unidade_medida.trim() || null,
    quantidade_estimada: lerNumero(r.quantidade_estimada) ?? null, valor_original: lerNumero(r.valor_original) ?? null,
  }
}

export const CAMPOS_ITEM = ['exame', 'papel', 'modalidade', 'subunidade', 'codigo', 'unidade_medida', 'quantidade_estimada', 'valor_original'] as const
type CampoItem = (typeof CAMPOS_ITEM)[number]
export const ROTULO_CAMPO_ITEM: Record<CampoItem, string> = {
  exame: 'Item', papel: 'Papel', modalidade: 'Modalidade', subunidade: 'Hospital / subunidade', codigo: 'Código',
  unidade_medida: 'Unidade de medida', quantidade_estimada: 'Quantidade estimada', valor_original: 'Valor original',
}

export interface ItemAlterado { antes: ItemCompleto; depois: RascunhoItem; campos: CampoItem[]; dados: Partial<Omit<ItemCompleto, 'id' | 'ordem'>> }
export interface DiffItens { novos: RascunhoItem[]; alterados: ItemAlterado[] }

/** Compara os itens do banco com o rascunho: só linhas novas e campos que mudaram. `rascunhos` traz as linhas existentes (com id) e as novas (id null). */
export function diffItens(originais: ItemCompleto[], rascunhos: RascunhoItem[]): DiffItens {
  const porId = new Map(originais.map(i => [i.id, i]))
  const novos: RascunhoItem[] = []
  const alterados: ItemAlterado[] = []
  for (const r of rascunhos) {
    const o = r.id ? porId.get(r.id) : undefined
    if (!o) { novos.push(r); continue }
    const novo = paraBanco(r)
    const dados: ItemAlterado['dados'] = {}
    const campos: CampoItem[] = []
    for (const c of CAMPOS_ITEM) {
      if ((novo[c] ?? null) !== (o[c] ?? null)) { campos.push(c); (dados as Record<string, unknown>)[c] = novo[c] }
    }
    if (campos.length) alterados.push({ antes: o, depois: r, campos, dados })
  }
  return { novos, alterados }
}

function formatarCampo(c: CampoItem, v: unknown): string {
  if (v == null || v === '') return '—'
  if (c === 'valor_original') return brl(v as number)
  if (c === 'papel') return ROTULO_PAPEL[v as PapelItem] ?? String(v)
  return String(v).replace('.', ',')
}

/** Lista "antes → depois" para o painel de revisão. */
export function mudancasItens(d: DiffItens): MudancaRevisao[] {
  const out: MudancaRevisao[] = []
  for (const r of d.novos) {
    const b = paraBanco(r)
    const partes = [ROTULO_PAPEL[b.papel], b.modalidade, b.valor_original != null ? brl(b.valor_original) : 'sem valor', b.subunidade].filter(Boolean)
    out.push({ rotulo: 'Novo item', antes: '—', depois: `${b.exame} · ${partes.join(' · ')}` })
  }
  for (const a of d.alterados) {
    for (const c of a.campos) {
      out.push({
        rotulo: `${a.antes.exame} — ${ROTULO_CAMPO_ITEM[c]}`,
        antes: formatarCampo(c, a.antes[c]),
        depois: formatarCampo(c, paraBanco(a.depois)[c]),
      })
    }
  }
  return out
}

/** Avisos da revisão: mudar o valor original de item que tem valor de aditivo só afeta os meses antes do 1º termo. */
export function avisosRevisao(d: DiffItens, valoresPorItem: Map<string, number>): string[] {
  return d.alterados
    .filter(a => a.campos.includes('valor_original') && (valoresPorItem.get(a.antes.id) ?? 0) > 0)
    .map(a => `“${a.antes.exame}” tem valor em aditivo: o valor de hoje vem do termo; mudar o original só muda os meses antes do primeiro termo.`)
}

export interface EfeitoRemoverItem { nivel: 'leve' | 'pesado'; efeitos: string[] }

/**
 * O que acontece ao apagar um item. `outros` = demais itens da unidade (já com o valor de hoje em `valor`),
 * `nValores` = valores de aditivos que apontam para este item.
 */
export function efeitosRemoverItem(
  item: Pick<ItemCompleto, 'exame' | 'papel' | 'modalidade'>,
  nValores: number,
  outros: { papel: PapelItem; modalidade: string | null; valor: number | null }[],
): EfeitoRemoverItem {
  const efeitos: string[] = []
  const cobra = item.papel === 'normal' || item.papel === 'urgencia'
  const temOutro = outros.some(o => o.valor != null && (item.papel === 'fixo' ? o.papel === 'fixo' : item.papel === 'excedente' ? o.papel === 'excedente' : cobra && (o.papel === 'normal' || o.papel === 'urgencia') && (!item.modalidade || o.modalidade === item.modalidade || o.modalidade == null)))
  let ultimo = false
  if (!temOutro) {
    ultimo = true
    if (item.papel === 'fixo') efeitos.push('A unidade fica sem valor fixo mensal: o valor fixo deixa de ser cobrado e o cálculo gera pendência.')
    else if (item.papel === 'excedente') efeitos.push('A franquia fica sem preço de excedente: o que passar dela não é cobrado.')
    else efeitos.push(`Os exames${item.modalidade ? ` de ${item.modalidade}` : ''} ficam sem preço: o cálculo para para eles.`)
  }
  if (nValores > 0) efeitos.push(`${nValores === 1 ? '1 valor' : `${nValores} valores`} de aditivos deste item ${nValores === 1 ? 'some' : 'somem'} junto.`)
  if (!efeitos.length) efeitos.push('Os exames deste item passam a ser cobrados pelos outros itens parecidos da unidade.')
  efeitos.push('Uma cópia de segurança (arquivo) é baixada antes de apagar, e dá para desfazer logo depois.')
  return { nivel: nValores > 0 || ultimo ? 'pesado' : 'leve', efeitos }
}

/** Conta os valores de aditivo por item. */
export function contarValoresPorItem(eventos: { evento_valor: { item_preco_id: string }[] }[]): Map<string, number> {
  const m = new Map<string, number>()
  for (const e of eventos) for (const v of e.evento_valor) m.set(v.item_preco_id, (m.get(v.item_preco_id) ?? 0) + 1)
  return m
}
