// Lógica pura da lista de unidades: filtros, contagens, "saúde do cadastro" e frase curta de cobrança.
import type { PrecoVigente, RegrasUnidade, UnidadeResumo } from '../../lib/tipos'
import { MODELO, alertaVigencia } from '../../lib/format'
import { agruparUnidades, alertasModelo, etiquetasRegras, nomeGrupo, regrasQuantidadeEfetivas, type GrupoUnidades } from '../../lib/config'

export type Agrupar = 'nenhum' | 'contrato' | 'empresa'
/** Como a lista começa agrupada (o plano D5 recomendava 'nenhum'; basta trocar aqui). */
export const AGRUPAR_PADRAO: Agrupar = 'contrato'

export type ChaveSaude = 'vencida_vigente' | 'vence_60' | 'sem_preco' | 'pendencia' | 'divergente'
export type ChaveRegra = 'corte' | 'exame' | 'todos_status' | 'conta_n' | 'fim_semana' | 'franquia'

export const SAUDE: { chave: ChaveSaude; rotulo: string; dica: string }[] = [
  { chave: 'vencida_vigente', rotulo: 'Vencida, marcada como vigente', dica: 'A situação diz "vigente", mas a data de fim da vigência já passou' },
  { chave: 'vence_60', rotulo: 'Vencem em até 60 dias', dica: 'Contratos que terminam nos próximos 60 dias' },
  { chave: 'sem_preco', rotulo: 'Sem preço', dica: 'Nenhum item de preço, ou nenhum com valor vigente na data escolhida — o cálculo vai parar' },
  { chave: 'pendencia', rotulo: 'Com pendência aberta', dica: 'Há pendências de cadastro ainda sem resolver' },
  { chave: 'divergente', rotulo: 'Tipo de cobrança divergente', dica: 'O tipo de cobrança marcado não bate com os preços cadastrados' },
]
export const REGRAS_ESPECIAIS: { chave: ChaveRegra; rotulo: string }[] = [
  { chave: 'corte', rotulo: 'Corte / quinzena' },
  { chave: 'exame', rotulo: 'Pela data do exame' },
  { chave: 'todos_status', rotulo: 'Todos os status' },
  { chave: 'conta_n', rotulo: 'Conta N' },
  { chave: 'fim_semana', rotulo: 'Fim de semana' },
  { chave: 'franquia', rotulo: 'Franquia' },
]
export const CHAVES_SAUDE = SAUDE.map(s => s.chave)
export const CHAVES_REGRAS = REGRAS_ESPECIAIS.map(r => r.chave)

export interface Filtros {
  busca: string
  empresa: string
  situacao: string
  saude: ChaveSaude[]
  regras: ChaveRegra[]
}
export const FILTROS_VAZIOS: Filtros = { busca: '', empresa: '', situacao: '', saude: [], regras: [] }

/** Dados de apoio dos filtros (mesmas fontes que a tela já carrega). */
export interface Contexto {
  regras: Map<string, RegrasUnidade>
  precos: Map<string, Pick<PrecoVigente, 'papel' | 'valor'>[]>
  aliases: Map<string, { nome_bruto: string }[]>
  /** false enquanto os preços da data escolhida ainda carregam: "sem preço" e "divergente" ficam de fora. */
  precosProntos: boolean
  hoje?: Date
}

export const semAcento = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()

export function saudeDe(u: UnidadeResumo, ctx: Contexto): ChaveSaude[] {
  const r: ChaveSaude[] = []
  const v = alertaVigencia(u.vigencia_fim, ctx.hoje)
  if (v?.tipo === 'vencida' && u.situacao === 'vigente') r.push('vencida_vigente')
  if (v?.tipo === 'vence_em') r.push('vence_60')
  if (ctx.precosProntos) {
    const itens = ctx.precos.get(u.id) ?? []
    if (!itens.some(i => i.valor != null)) r.push('sem_preco')
    if (itens.length && alertasModelo(u.modelo_cobranca, itens).length) r.push('divergente')
  }
  if (u.n_pendencias > 0) r.push('pendencia')
  return r
}

export function regrasEspeciaisDe(r: Partial<RegrasUnidade> | undefined): ChaveRegra[] {
  if (!r) return []
  const k: ChaveRegra[] = []
  const j = r.janela ?? 'mes'
  if (j !== 'mes') k.push('corte')
  if (r.criterio_data === 'exame') k.push('exame')
  if (r.todos_status) k.push('todos_status')
  if (regrasQuantidadeEfetivas(r).length) k.push('conta_n')
  if (r.acao_intensificada) k.push('fim_semana')
  if (r.franquia_mensal) k.push('franquia')
  return k
}

type Faceta = 'empresa' | 'situacao' | 'saude' | 'regras'

function casaBusca(u: UnidadeResumo, q: string, ctx: Contexto): boolean {
  if (!q) return true
  return semAcento(nomeGrupo(u)).includes(q) || semAcento(`${u.pasta} ${u.orgao ?? ''}`).includes(q)
    || (ctx.aliases.get(u.id) ?? []).some(a => semAcento(a.nome_bruto).includes(q))
}

/** Passa em todos os filtros (busca + faceta a faceta). `ignorar` pula uma faceta, para contar as opções dela. */
export function passa(u: UnidadeResumo, f: Filtros, ctx: Contexto, ignorar?: Faceta): boolean {
  if (!casaBusca(u, semAcento(f.busca.trim()), ctx)) return false
  if (ignorar !== 'empresa' && f.empresa && u.empresa !== f.empresa) return false
  if (ignorar !== 'situacao' && f.situacao && u.situacao !== f.situacao) return false
  if (ignorar !== 'saude' && f.saude.length) { const s = saudeDe(u, ctx); if (!f.saude.some(k => s.includes(k))) return false }
  if (ignorar !== 'regras' && f.regras.length) { const s = regrasEspeciaisDe(ctx.regras.get(u.id)); if (!f.regras.some(k => s.includes(k))) return false }
  return true
}

export function filtrar(unidades: UnidadeResumo[], f: Filtros, ctx: Contexto): UnidadeResumo[] {
  return unidades.filter(u => passa(u, f, ctx))
}

export interface Contagens {
  empresa: Record<string, number>
  situacao: Record<string, number>
  saude: Record<ChaveSaude, number>
  regras: Record<ChaveRegra, number>
}

/** Contagem de cada opção: respeita a busca e os filtros das OUTRAS facetas (dentro da faceta vale "qualquer uma"). */
export function contagens(unidades: UnidadeResumo[], f: Filtros, ctx: Contexto): Contagens {
  const c: Contagens = {
    empresa: {}, situacao: {},
    saude: Object.fromEntries(CHAVES_SAUDE.map(k => [k, 0])) as Record<ChaveSaude, number>,
    regras: Object.fromEntries(CHAVES_REGRAS.map(k => [k, 0])) as Record<ChaveRegra, number>,
  }
  for (const u of unidades) {
    if (passa(u, f, ctx, 'empresa')) c.empresa[u.empresa] = (c.empresa[u.empresa] ?? 0) + 1
    if (passa(u, f, ctx, 'situacao')) c.situacao[u.situacao] = (c.situacao[u.situacao] ?? 0) + 1
    if (passa(u, f, ctx, 'saude')) for (const k of saudeDe(u, ctx)) c.saude[k]++
    if (passa(u, f, ctx, 'regras')) for (const k of regrasEspeciaisDe(ctx.regras.get(u.id))) c.regras[k]++
  }
  return c
}

export function filtroAtivo(f: Filtros): boolean {
  return !!(f.busca.trim() || f.empresa || f.situacao || f.saude.length || f.regras.length)
}

/** Liga/desliga uma chave numa lista, sem mexer na original. */
export function alternarChave<T>(lista: T[], k: T): T[] {
  return lista.includes(k) ? lista.filter(x => x !== k) : [...lista, k]
}

export function agruparPor(unidades: UnidadeResumo[], modo: Agrupar): GrupoUnidades<UnidadeResumo>[] {
  if (modo === 'contrato') return agruparUnidades(unidades)
  const porPasta = (a: UnidadeResumo, b: UnidadeResumo) => a.pasta.localeCompare(b.pasta, 'pt-BR')
  if (modo === 'empresa') {
    return [['PRN', 'PRN'], ['MEDIMAGEM', 'MedImagem']]
      .map(([emp, nome]) => ({ nome, proprio: false, unidades: unidades.filter(u => u.empresa === emp).sort(porPasta) }))
      .filter(g => g.unidades.length)
  }
  return unidades.length ? [{ nome: '', proprio: false, unidades: [...unidades].sort(porPasta) }] : []
}

/** Frase curta da linha: "Por modalidade · laudo · corte 14→13". */
export function fraseCobranca(modelo: string, r: Partial<RegrasUnidade> | undefined): string {
  const data = r?.criterio_data ?? (modelo === 'fixo_mensal' ? 'exame' : 'laudo')
  const partes = [MODELO[modelo] ?? modelo, data]
  const janela = etiquetasRegras(r as RegrasUnidade | undefined).find(e => /^(corte|27 do|quinzenal)/.test(e))
  if (janela) partes.push(janela)
  if (r?.todos_status) partes.push('todos os status')
  return partes.join(' · ')
}

/** Etiquetas das demais regras (as que a frase curta não mostra). */
export function etiquetasExtras(r: Partial<RegrasUnidade> | undefined): string[] {
  return etiquetasRegras(r as RegrasUnidade | undefined).filter(e => !/^(corte|27 do|quinzenal|todos os status|pela data do)/.test(e))
}

const SITUACOES_VALIDAS = ['vigente', 'vencido', 'encerrado', 'minuta', 'nao_iniciado', 'sem_data']
/** Lê com segurança o que veio do sessionStorage. */
export function filtrosSalvos(s: Partial<Record<keyof Filtros, unknown>> | undefined): Filtros {
  const lista = <T extends string>(v: unknown, ok: readonly T[]): T[] => Array.isArray(v) ? v.filter((x): x is T => ok.includes(x as T)) : []
  return {
    busca: typeof s?.busca === 'string' ? s.busca : '',
    empresa: s?.empresa === 'PRN' || s?.empresa === 'MEDIMAGEM' ? s.empresa : '',
    situacao: typeof s?.situacao === 'string' && SITUACOES_VALIDAS.includes(s.situacao) ? s.situacao : '',
    saude: lista(s?.saude, CHAVES_SAUDE),
    regras: lista(s?.regras, CHAVES_REGRAS),
  }
}
