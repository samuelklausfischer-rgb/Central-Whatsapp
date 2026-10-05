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
  encerrado:    { rotulo: 'Encerrado',    cor: 'bg-slate-200 text-slate-600' },
  minuta:       { rotulo: 'Minuta',       cor: 'bg-amber-100 text-amber-800' },
  nao_iniciado: { rotulo: 'Não iniciado', cor: 'bg-sky-100 text-sky-800' },
  sem_data:     { rotulo: 'Sem data',     cor: 'bg-slate-100 text-slate-500' },
}

export const MODELO: Record<string, string> = {
  preco_unico: 'Preço único', por_modalidade: 'Por modalidade', por_procedimento: 'Por procedimento',
  fixo_mensal: 'Fixo mensal', misto: 'Misto', nao_identificado: '—',
}

export const TIPOS_EVENTO = ['reajuste','aditivo_valor','prorrogacao','acrescimo_quantidade','supressao','alteracao_cadastral','outro'] as const

export function hojeISO(): string {
  return new Date().toISOString().slice(0, 10)
}
