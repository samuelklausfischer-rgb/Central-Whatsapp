// Lógica pura da edição do contrato (tabela unidade) e da renomeação de pasta nas regras `config *_pastas`.
import type { UnidadeResumo } from '../../lib/tipos'
import { brl, dataBR } from '../../lib/format'
import { normNome } from '../../nucleo/motor'
import type { MudancaRevisao } from '../../components/ui'
import { lerNumero } from './EditorPrecos'

export interface FormContrato {
  orgao: string; numero_contrato: string; objeto: string; vigencia_inicio: string; vigencia_fim: string; valor_total: string
  grupo: string; sharepoint_url: string; empresa: 'PRN' | 'MEDIMAGEM'; pasta: string
}

export interface CamposContrato {
  orgao: string | null; numero_contrato: string | null; objeto: string | null; vigencia_inicio: string | null; vigencia_fim: string | null
  valor_total: number | null; grupo: string | null; sharepoint_url: string | null; empresa: 'PRN' | 'MEDIMAGEM'; pasta: string
}

export function formDeUnidade(u: UnidadeResumo): FormContrato {
  return {
    orgao: u.orgao ?? '', numero_contrato: u.numero_contrato ?? '', objeto: u.objeto ?? '',
    vigencia_inicio: u.vigencia_inicio ?? '', vigencia_fim: u.vigencia_fim ?? '',
    valor_total: u.valor_total == null ? '' : String(u.valor_total).replace('.', ','),
    grupo: u.grupo ?? '', sharepoint_url: u.sharepoint_url ?? '', empresa: u.empresa, pasta: u.pasta,
  }
}

const t = (s: string) => (s.trim() === '' ? null : s.trim())

export function camposDeForm(f: FormContrato): CamposContrato {
  return {
    orgao: t(f.orgao), numero_contrato: t(f.numero_contrato), objeto: t(f.objeto), vigencia_inicio: t(f.vigencia_inicio),
    vigencia_fim: t(f.vigencia_fim), valor_total: lerNumero(f.valor_total) ?? null, grupo: t(f.grupo), sharepoint_url: t(f.sharepoint_url),
    empresa: f.empresa, pasta: f.pasta.trim(),
  }
}

export type ErrosContrato = Partial<Record<'pasta' | 'valor_total' | 'vigencia_fim' | 'sharepoint_url' | 'empresa', string>>

export function validarContrato(f: FormContrato): ErrosContrato {
  const e: ErrosContrato = {}
  if (!f.pasta.trim()) e.pasta = 'A pasta é obrigatória'
  if (f.empresa !== 'PRN' && f.empresa !== 'MEDIMAGEM') e.empresa = 'Escolha PRN ou MEDIMAGEM'
  const v = lerNumero(f.valor_total)
  if (v === undefined) e.valor_total = 'Use só números (ex.: 125000,00)'
  else if (v !== null && v < 0) e.valor_total = 'O valor não pode ser negativo'
  if (f.vigencia_inicio && f.vigencia_fim && f.vigencia_fim < f.vigencia_inicio) e.vigencia_fim = 'O fim da vigência é anterior ao início'
  if (f.sharepoint_url.trim() && !/^https?:\/\//i.test(f.sharepoint_url.trim())) e.sharepoint_url = 'O link deve começar com http:// ou https://'
  return e
}

const ROTULOS: [keyof CamposContrato, string, (v: unknown) => string][] = [
  ['orgao', 'Órgão', v => String(v ?? '—')],
  ['numero_contrato', 'Nº do contrato', v => String(v ?? '—')],
  ['objeto', 'Objeto', v => String(v ?? '—')],
  ['vigencia_inicio', 'Início da vigência', v => (v ? dataBR(String(v)) : '—')],
  ['vigencia_fim', 'Fim da vigência', v => (v ? dataBR(String(v)) : '—')],
  ['valor_total', 'Valor total', v => (v == null ? '—' : brl(v as number))],
  ['grupo', 'Grupo', v => String(v ?? '—')],
  ['sharepoint_url', 'Link do SharePoint', v => String(v ?? '—')],
  ['empresa', 'Empresa', v => String(v)],
  ['pasta', 'Pasta', v => String(v)],
]

/** Só os campos que mudaram, e o objeto parcial para o `update`. */
export function diffContrato(u: UnidadeResumo, f: FormContrato): { mudancas: MudancaRevisao[]; dados: Partial<CamposContrato> } {
  const a = camposDeForm(formDeUnidade(u))
  const d = camposDeForm(f)
  const mudancas: MudancaRevisao[] = []
  const dados: Partial<CamposContrato> = {}
  for (const [k, rotulo, fmt] of ROTULOS) {
    if ((a[k] ?? null) === (d[k] ?? null)) continue
    mudancas.push({ rotulo, antes: fmt(a[k]), depois: fmt(d[k]) });
    (dados as Record<string, unknown>)[k] = d[k]
  }
  return { mudancas, dados }
}

// ── pasta nas regras por unidade ───────────────────────────────────────────
export const ROTULO_CHAVE_PASTAS: Record<string, string> = {
  juntar_cr_dx_pastas: 'Juntar CR e DX', separar_urgencia_pastas: 'Separar urgência', desdobrar_quantidade_pastas: 'Desdobrar quantidade',
}
export const ehChavePastas = (chave: string) => chave.endsWith('_pastas')

export interface LinhaConfig { chave: string; valor: string }
export interface AtualizacaoConfig { chave: string; valor: string; antes: string }

/**
 * Para cada regra `*_pastas` que cita a pasta antiga (comparando por normNome, como o motor), devolve o novo CSV com a pasta nova.
 * Se a troca não muda o normNome, a regra continua ligando e nada precisa mudar.
 */
export function atualizarPastasConfig(linhas: LinhaConfig[], pastaAntiga: string, pastaNova: string): AtualizacaoConfig[] {
  if (normNome(pastaAntiga) === normNome(pastaNova)) return []
  const alvo = normNome(pastaAntiga)
  const out: AtualizacaoConfig[] = []
  for (const l of linhas) {
    if (!ehChavePastas(l.chave)) continue
    const partes = l.valor.split(',').map(s => s.trim()).filter(Boolean)
    if (!partes.some(p => normNome(p) === alvo)) continue
    out.push({ chave: l.chave, antes: l.valor, valor: partes.map(p => (normNome(p) === alvo ? pastaNova.trim() : p)).join(',') })
  }
  return out
}

export function mudancasConfig(at: AtualizacaoConfig[]): MudancaRevisao[] {
  return at.map(a => ({ rotulo: `Regra “${ROTULO_CHAVE_PASTAS[a.chave] ?? a.chave}”`, antes: a.antes, depois: a.valor }))
}

/** Traduz erro do banco para a frase que o financeiro entende. */
export function traduzirErro(msg: string): string {
  if (/unidade_empresa_pasta_key|duplicate key.*(empresa|pasta)/i.test(msg)) return 'Já existe uma unidade com esta empresa e esta pasta.'
  if (/alias_nome_bruto_key|duplicate key.*nome_bruto/i.test(msg)) return 'Este nome da Mobilemed já está cadastrado em outra unidade.'
  if (/duplicate key/i.test(msg)) return 'Já existe um cadastro igual a este.'
  if (/violates check constraint/i.test(msg)) return `Um dos valores não é aceito pelo cadastro (${msg}).`
  return msg
}
