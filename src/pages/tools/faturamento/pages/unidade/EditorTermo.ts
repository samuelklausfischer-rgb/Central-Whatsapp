// Lógica pura da edição de termos/aditivos (evento + evento_valor).
import { brl, dataBR, TIPOS_EVENTO } from '../../lib/format'
import type { MudancaRevisao } from '../../components/ui'
import { lerNumero } from './EditorPrecos'

export const ROTULO_TIPO: Record<string, string> = {
  reajuste: 'Reajuste', aditivo_valor: 'Aditivo de valor', prorrogacao: 'Prorrogação', acrescimo_quantidade: 'Acréscimo de quantidade',
  supressao: 'Supressão', alteracao_cadastral: 'Alteração cadastral', outro: 'Outro',
}
export const tipoLegivel = (t: string) => ROTULO_TIPO[t] ?? (t.charAt(0).toUpperCase() + t.slice(1).replace(/_/g, ' '))

/** Termo como vem do banco (colunas editáveis + valores por item). */
export interface TermoBanco {
  id: string; ordem: number; tipo: string; numero: string | null; data_assinatura: string | null; data_efeito: string | null
  percentual: number | null; indice: string | null; objeto: string | null; nova_vigencia_fim: string | null
  fonte_doc: string | null; fonte_uri: string | null; data_referencia?: string | null; qualidade_data?: string
  evento_valor: { item_preco_id: string; valor: number }[]
}

/** Formulário: tudo texto. `valores` = id do item → texto do valor (vazio = sem valor neste termo). */
export interface FormTermo {
  tipo: string; numero: string; data_assinatura: string; data_efeito: string; percentual: string; indice: string; objeto: string
  nova_vigencia_fim: string; ordem: string; fonte_doc: string; fonte_uri: string; valores: Record<string, string>
}

export const FORM_TERMO_VAZIO = (ordem: number): FormTermo => ({
  tipo: 'reajuste', numero: '', data_assinatura: '', data_efeito: '', percentual: '', indice: '', objeto: '',
  nova_vigencia_fim: '', ordem: String(ordem), fonte_doc: '', fonte_uri: '', valores: {},
})

export function formDeTermo(t: TermoBanco): FormTermo {
  return {
    tipo: t.tipo, numero: t.numero ?? '', data_assinatura: t.data_assinatura ?? '', data_efeito: t.data_efeito ?? '',
    percentual: t.percentual == null ? '' : String(t.percentual).replace('.', ','), indice: t.indice ?? '', objeto: t.objeto ?? '',
    nova_vigencia_fim: t.nova_vigencia_fim ?? '', ordem: String(t.ordem), fonte_doc: t.fonte_doc ?? '', fonte_uri: t.fonte_uri ?? '',
    valores: Object.fromEntries(t.evento_valor.map(v => [v.item_preco_id, String(v.valor).replace('.', ',')])),
  }
}

export interface CamposTermo {
  tipo: string; numero: string | null; data_assinatura: string | null; data_efeito: string | null; percentual: number | null; indice: string | null
  objeto: string | null; nova_vigencia_fim: string | null; ordem: number; fonte_doc: string | null; fonte_uri: string | null
}

const t = (s: string) => (s.trim() === '' ? null : s.trim())

/** Valida o formulário. Devolve erros por campo (vazio = ok). */
export function validarTermo(f: FormTermo): { campos: Partial<Record<'tipo' | 'percentual' | 'ordem' | 'valores', string>>; avisos: string[] } {
  const campos: Partial<Record<'tipo' | 'percentual' | 'ordem' | 'valores', string>> = {}
  const avisos: string[] = []
  if (!(TIPOS_EVENTO as readonly string[]).includes(f.tipo)) campos.tipo = 'Tipo inválido'
  const p = lerNumero(f.percentual)
  if (p === undefined) campos.percentual = 'Use só números (ex.: 4,5)'
  else if (p !== null && Math.abs(p) >= 1e4) campos.percentual = 'Percentual grande demais'
  const o = lerNumero(f.ordem)
  if (o === undefined || o === null || !Number.isInteger(o)) campos.ordem = 'Use um número inteiro'
  const ruins = Object.entries(f.valores).filter(([, v]) => v.trim() !== '' && (lerNumero(v) === undefined || (lerNumero(v) ?? 0) < 0)).length
  if (ruins) campos.valores = `${ruins === 1 ? '1 valor inválido' : `${ruins} valores inválidos`}: use só números, sem negativo.`
  if (!f.data_efeito && !f.data_assinatura) avisos.push('Sem data de efeito nem de assinatura, o termo é ignorado no cálculo do preço.')
  const nValores = Object.values(f.valores).filter(v => v.trim() !== '').length
  if ((f.tipo === 'reajuste' || f.tipo === 'aditivo_valor') && !nValores && lerNumero(f.percentual) == null)
    avisos.push('Termo de reajuste/aditivo sem valores e sem percentual não muda nenhum preço.')
  return { campos, avisos }
}

export function camposDeForm(f: FormTermo): CamposTermo {
  return {
    tipo: f.tipo, numero: t(f.numero), data_assinatura: t(f.data_assinatura), data_efeito: t(f.data_efeito),
    percentual: lerNumero(f.percentual) ?? null, indice: t(f.indice), objeto: t(f.objeto), nova_vigencia_fim: t(f.nova_vigencia_fim),
    ordem: lerNumero(f.ordem) ?? 0, fonte_doc: t(f.fonte_doc), fonte_uri: t(f.fonte_uri),
  }
}

export interface ValorTermo { item_preco_id: string; valor: number }
export interface DiffValores { adicionados: ValorTermo[]; alterados: (ValorTermo & { antes: number })[]; removidos: ValorTermo[] }

/** Compara os valores por item do termo com o formulário (vazio = remover). */
export function diffValores(antes: { item_preco_id: string; valor: number }[], valores: Record<string, string>): DiffValores {
  const mapa = new Map(antes.map(v => [v.item_preco_id, v.valor]))
  const d: DiffValores = { adicionados: [], alterados: [], removidos: [] }
  for (const [id, txt] of Object.entries(valores)) {
    const n = txt.trim() === '' ? null : lerNumero(txt)
    if (n === undefined) continue
    const a = mapa.get(id)
    if (n === null) { if (a !== undefined) d.removidos.push({ item_preco_id: id, valor: a }); continue }
    if (a === undefined) d.adicionados.push({ item_preco_id: id, valor: n })
    else if (a !== n) d.alterados.push({ item_preco_id: id, valor: n, antes: a })
  }
  // item que tinha valor e nem aparece mais no formulário também sai
  for (const [id, a] of mapa) if (!(id in valores)) d.removidos.push({ item_preco_id: id, valor: a })
  return d
}

const ROTULOS: [keyof CamposTermo, string, (v: unknown) => string][] = [
  ['tipo', 'Tipo', v => tipoLegivel(String(v))],
  ['numero', 'Número', v => String(v ?? '—')],
  ['data_assinatura', 'Data de assinatura', v => (v ? dataBR(String(v)) : '—')],
  ['data_efeito', 'Data de efeito', v => (v ? dataBR(String(v)) : '—')],
  ['percentual', 'Percentual', v => (v == null ? '—' : `${String(v).replace('.', ',')}%`)],
  ['indice', 'Índice', v => String(v ?? '—')],
  ['nova_vigencia_fim', 'Nova vigência até', v => (v ? dataBR(String(v)) : '—')],
  ['ordem', 'Ordem', v => String(v ?? '—')],
  ['objeto', 'O que o termo faz', v => String(v ?? '—')],
  ['fonte_doc', 'Documento de origem', v => String(v ?? '—')],
  ['fonte_uri', 'Link do documento', v => String(v ?? '—')],
]

/** Lista antes → depois do termo editado (campos + valores). `nomeItem` traduz o id do item para o nome. */
export function mudancasTermo(antes: TermoBanco, f: FormTermo, nomeItem: (id: string) => string): MudancaRevisao[] {
  const out: MudancaRevisao[] = []
  const a: CamposTermo = camposDeForm(formDeTermo({ ...antes, evento_valor: [] }))
  const d = camposDeForm(f)
  for (const [k, rotulo, fmt] of ROTULOS) if ((a[k] ?? null) !== (d[k] ?? null)) out.push({ rotulo, antes: fmt(a[k]), depois: fmt(d[k]) })
  const dv = diffValores(antes.evento_valor, f.valores)
  for (const v of dv.adicionados) out.push({ rotulo: `Valor — ${nomeItem(v.item_preco_id)}`, antes: '—', depois: brl(v.valor) })
  for (const v of dv.alterados) out.push({ rotulo: `Valor — ${nomeItem(v.item_preco_id)}`, antes: brl(v.antes), depois: brl(v.valor) })
  for (const v of dv.removidos) out.push({ rotulo: `Valor — ${nomeItem(v.item_preco_id)}`, antes: brl(v.valor), depois: 'removido do termo' })
  return out
}

const EFEITO_APAGAR: Record<string, string> = {
  reajuste: 'o percentual deste reajuste deixa de ser aplicado aos preços',
  aditivo_valor: 'os valores deste termo deixam de valer e o preço volta ao do termo anterior',
  prorrogacao: 'a prorrogação deixa de existir no histórico',
}

export function efeitosApagarTermo(tipo: string, nValores: number): { nivel: 'leve' | 'pesado'; efeitos: string[] } {
  const efeitos = [`Efeito no cálculo: ${EFEITO_APAGAR[tipo] ?? 'o que este termo muda no cálculo deixa de valer'}.`]
  if (nValores > 0) efeitos.push(`${nValores === 1 ? '1 valor' : `${nValores} valores`} de itens ${nValores === 1 ? 'some' : 'somem'} junto com o termo.`)
  efeitos.push('Uma cópia de segurança (arquivo) é baixada antes de apagar, e dá para desfazer logo depois.')
  return { nivel: nValores > 0 ? 'pesado' : 'leve', efeitos }
}

/** Revisão de um termo novo: "Novo termo" + os campos e valores preenchidos (o que está vazio não aparece). */
export function mudancasNovoTermo(f: FormTermo, nomeItem: (id: string) => string): MudancaRevisao[] {
  const base: TermoBanco = {
    id: '', ordem: lerNumero(f.ordem) ?? 0, tipo: f.tipo, numero: null, data_assinatura: null, data_efeito: null, percentual: null, indice: null,
    objeto: null, nova_vigencia_fim: null, fonte_doc: null, fonte_uri: null, evento_valor: [],
  }
  return [
    { rotulo: 'Novo termo', antes: '—', depois: `${tipoLegivel(f.tipo)}${f.numero.trim() ? ` · ${f.numero.trim()}` : ''}` },
    ...mudancasTermo(base, f, nomeItem),
  ]
}
