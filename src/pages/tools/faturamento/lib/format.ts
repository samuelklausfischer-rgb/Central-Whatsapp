export function brl(v: number | null | undefined): string {
  if (v === null || v === undefined) return '—'
  return 'R$ ' + Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function dataBR(s: string | null | undefined): string {
  if (!s) return '—'
  const [a, m, d] = s.slice(0, 10).split('-')
  return `${d}/${m}/${a}`
}

export const SITUACAO: Record<string, { rotulo: string; cor: string }> = {
  vigente:      { rotulo: 'Vigente',      cor: 'bg-emerald-100 text-emerald-800' },
  vencido:      { rotulo: 'Vencido',      cor: 'bg-rose-100 text-rose-800' },
  encerrado:    { rotulo: 'Encerrado',    cor: 'bg-slate-200 text-slate-700' },
  minuta:       { rotulo: 'Minuta',       cor: 'bg-amber-100 text-amber-800' },
  nao_iniciado: { rotulo: 'Não iniciado', cor: 'bg-sky-100 text-sky-800' },
  sem_data:     { rotulo: 'Sem data',     cor: 'bg-slate-100 text-slate-700' },
}

export const MODELO: Record<string, string> = {
  preco_unico: 'Preço único', por_modalidade: 'Por modalidade', por_procedimento: 'Por procedimento',
  fixo_mensal: 'Fixo mensal', misto: 'Misto', nao_identificado: '—',
}

export const TIPOS_EVENTO = ['reajuste','aditivo_valor','prorrogacao','acrescimo_quantidade','supressao','alteracao_cadastral','outro'] as const

export function hojeISO(): string {
  return new Date().toISOString().slice(0, 10)
}

/** Data ISO → dd/mm/aaaa; sem data → "não informada". (dataBR continua devolvendo "—" para tabelas.) */
export function dataBRouNaoInformada(iso: string | null | undefined): string {
  return iso ? dataBR(iso) : 'não informada'
}

export function vigenciaTexto(ini: string | null | undefined, fim: string | null | undefined): string {
  if (ini && fim) return `${dataBR(ini)} a ${dataBR(fim)}`
  if (fim) return `até ${dataBR(fim)}`
  if (ini) return `desde ${dataBR(ini)}`
  return 'vigência não informada'
}

export const LIMIAR_VENCIMENTO_DIAS = 60

/** Alerta de fim de vigência: vencida, ou vence em até 60 dias (contados por data, sem hora). */
export function alertaVigencia(fim: string | null | undefined, hoje: Date = new Date()): null | { tipo: 'vencida' | 'vence_em'; dias: number; texto: string } {
  if (!fim) return null
  const [a, m, d] = fim.slice(0, 10).split('-').map(Number)
  if (!a || !m || !d) return null
  const dias = Math.round((Date.UTC(a, m - 1, d) - Date.UTC(hoje.getFullYear(), hoje.getMonth(), hoje.getDate())) / 86400000)
  if (dias < 0) return { tipo: 'vencida', dias: -dias, texto: `Vigência terminou em ${dataBR(fim)} (há ${plural(-dias, 'dia', 'dias')})` }
  if (dias <= LIMIAR_VENCIMENTO_DIAS) return { tipo: 'vence_em', dias, texto: dias === 0 ? `Vigência termina hoje (${dataBR(fim)})` : `Vigência termina em ${dataBR(fim)} (em ${plural(dias, 'dia', 'dias')})` }
  return null
}

/** "1 grupo", "2 grupos". */
export function plural(n: number, singular: string, pl: string): string {
  return `${n} ${n === 1 ? singular : pl}`
}

export const ROTULO_PENDENCIA: Record<string, string> = {
  ilegivel: 'Trecho ilegível no contrato', situacao: 'Situação a confirmar', vigencia: 'Vigência não encontrada',
  fixo: 'Valor fixo a conferir', divergencia: 'Divergência entre documentos', imagem: 'Documento só em imagem',
  de_para: 'Nome a ligar',
}

export function rotuloPendencia(tipo: string | null | undefined): string {
  const t = (tipo ?? '').trim()
  if (!t) return 'Pendência'
  if (ROTULO_PENDENCIA[t]) return ROTULO_PENDENCIA[t]
  const s = t.replace(/_/g, ' ')
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/** Tira o jargão interno do texto da pendência: "(Fase 0 …)" e o tipo colado no início ("de_para: …", "[fixo] …"). */
export function limparDetalhePendencia(texto: string | null | undefined): string {
  let t = (texto ?? '').replace(/\s*\((?:[^()]*\b)?fase\s*\d+[^()]*\)/gi, '')
  t = t.replace(/^\s*[\[(]?(?:ilegivel|situacao|vigencia|fixo|divergencia|imagem|de_para)[\])]?\s*[:\-–—]\s*/i, '')
  return t.replace(/\s{2,}/g, ' ').trim()
}

/** Nome para exibir: tira o prefixo de pasta do SharePoint ("01 - NÃO INICIADOS/x" → "x"). Só exibição; a chave continua sendo `pasta`. */
export function nomeExibicao(pasta: string): string {
  const i = pasta.lastIndexOf('/')
  return (i >= 0 ? pasta.slice(i + 1) : pasta).trim() || pasta
}
