// Agregação PURA do relatório consolidado de uma simulação (sem acesso a banco nem a ExcelJS).
// Entrada = linhas já lidas do banco; saída = tudo que as abas do Excel precisam.
// Nunca carrega dados de paciente: só nomes do Bruto, unidades, modalidades e totais.
import type { SimulacaoNome, SimulacaoPendencia } from './tipos'
import { etiquetasRegras } from './config'

export type Empresa = 'PRN' | 'MEDIMAGEM'
export const EMPRESAS: Empresa[] = ['PRN', 'MEDIMAGEM']
export const GRUPO_PROPRIO = 'Contrato próprio'

/** Rótulos amigáveis dos tipos de pendência gravados pela simulação. */
export const TIPO_PENDENCIA: Record<string, string> = {
  unidade_desconhecida: 'Nome sem contrato',
  sem_preco: 'Exame sem preço no contrato',
  situacao: 'Situação do contrato',
  franquia: 'Franquia sem preço de excedente',
  fixo_sem_valor: 'Unidade fixa sem valor vigente',
}

export interface ResumoLinha {
  simulacao_id?: string; nome_bruto: string; unidade_id: string | null; periodo: string; rotulo: string
  quantidade: number; valor_unitario?: number | null; total: number; fixo: boolean; ordem?: number
}
export interface UnidadeEntrada {
  id: string; empresa: string; pasta: string; grupo: string | null; modelo_cobranca: string; situacao: string
  janela?: string | null; criterio_data?: string | null; franquia_mensal?: number | null
}
export interface EntradaConsolidado {
  simulacao: { competencia: string; arquivo_nome: string | null; criada_em: string; total_exames?: number | null; total_valor?: number | null; total_nomes?: number | null }
  resumo: ResumoLinha[]
  unidades: UnidadeEntrada[]
  pendencias: SimulacaoPendencia[]
  nomes: SimulacaoNome[]
  /** grupo da Mobilemed (PRN, PRN Apice Tele…) e hospital de cada nome — divide as linhas como os relatórios por unidade */
  gruposDosNomes?: Record<string, { grupo: string; subunidade: string | null }>
}

export interface PorEmpresa { total: number; exames: number; unidades: number }
export interface PendenciaTipo { tipo: string; quantidade: number; exames: number }
export interface Kpis {
  total: number; totalPorExame: number; totalFixo: number; exames: number; unidadesFaturadas: number
  nomes: number; ticketMedio: number
  porEmpresa: Record<Empresa, PorEmpresa>
  pendenciasPorTipo: PendenciaTipo[]
}
export interface LinhaUnidade {
  unidadeId: string; empresa: string; grupo: string; grupoMobilemed: string; subunidade: string | null
  pasta: string; modelo: string; situacao: string
  exames: number; valorExames: number; valorFixo: number; total: number; pctTotal: number
  nPendencias: number; nomes: string[]
}
export interface LinhaGrupo {
  grupo: string; unidades: number; exames: number; valorExames: number; valorFixo: number; total: number; pctTotal: number
}
/** Ordem de apresentação dos grupos da Mobilemed (o resto vem depois, em ordem alfabética). */
export const ORDEM_GRUPOS = ['PRN', 'PRN Apice Tele', 'Medimagem', 'Medimagem Apice Tele']
export const ordemGrupo = (g: string) => { const i = ORDEM_GRUPOS.indexOf(g); return i < 0 ? ORDEM_GRUPOS.length : i }
export interface LinhaModalidade {
  modalidade: string; fixo?: boolean; quantidade: number; total: number; ticket: number | null; pctTotal: number
  porEmpresa: Record<Empresa, { quantidade: number; total: number }>
  porGrupo: Record<string, { quantidade: number; total: number }> // os 4 grupos da Mobilemed
}
export interface LinhaMatriz {
  unidadeId: string; empresa: string; grupoMobilemed: string; pasta: string
  quantidade: Record<string, number>; valor: Record<string, number>
  valorFixo: number; totalQuantidade: number; totalValor: number
}
export interface Matriz { modalidades: string[]; linhas: LinhaMatriz[]; totais: Omit<LinhaMatriz, 'unidadeId' | 'empresa' | 'grupoMobilemed' | 'pasta'> }
export interface LinhaNome { grupo: string; nome_bruto: string; periodo: string; unidade: string | null; empresa: string | null; qtd: number; total: number; pendencias: number }
export interface LinhaPendencia { tipo: string; grupo: string; unidade: string | null; nome_bruto: string | null; detalhe: string; qtd_exames: number | null }
export interface ExcecaoUnidade { pasta: string; empresa: string; regras: string[] }
export interface Agregado {
  kpis: Kpis; porUnidade: LinhaUnidade[]; porGrupo: LinhaGrupo[]; porModalidade: LinhaModalidade[]; matriz: Matriz
  porNome: LinhaNome[]; pendencias: LinhaPendencia[]; excecoes: ExcecaoUnidade[]
}

const ORDEM_MODALIDADES = ['RX', 'TC', 'RM', 'MG', 'US', 'ECG', 'OUTRO']
const MAPA_MODALIDADE: Record<string, string> = { CR: 'RX', DX: 'RX', RX: 'RX', CT: 'TC', TC: 'TC', MR: 'RM', RM: 'RM', MG: 'MG', US: 'US', ECG: 'ECG' }
const r2 = (v: number) => Math.round(v * 100) / 100
const ptBR = (a: string, b: string) => a.localeCompare(b, 'pt-BR')

/** Código de modalidade do Bruto → modalidade do relatório (CR/DX→RX, CT→TC, MR→RM; resto→OUTRO). */
export function modalidadeNormalizada(codigo: string | null | undefined): string {
  return MAPA_MODALIDADE[(codigo ?? '').trim().toUpperCase()] ?? 'OUTRO'
}

const vazioEmpresa = () => ({ PRN: { quantidade: 0, total: 0 }, MEDIMAGEM: { quantidade: 0, total: 0 } })
const ehEmpresa = (e: string): e is Empresa => e === 'PRN' || e === 'MEDIMAGEM'

export function agregar(entrada: EntradaConsolidado): Agregado {
  const unidadePorId = new Map(entrada.unidades.map(u => [u.id, u]))
  const resumo = entrada.resumo.map(r => ({ ...r, quantidade: Number(r.quantidade), total: Number(r.total) }))

  // ── por unidade de contrato × grupo da Mobilemed × hospital (mesma divisão dos relatórios por unidade) ──
  const grupoDe = (nome: string) => entrada.gruposDosNomes?.[nome] ?? { grupo: '', subunidade: null }
  const chaveDe = (nome: string, uid: string) => { const g = grupoDe(nome); return `${g.grupo}|${uid}|${g.subunidade ?? ''}` }
  const acc = new Map<string, { uid: string; grupo: string; sub: string | null; exames: number; valorExames: number; valorFixo: number; nomes: Set<string> }>()
  for (const r of resumo) {
    if (!r.unidade_id) continue
    const k = chaveDe(r.nome_bruto, r.unidade_id)
    const g = grupoDe(r.nome_bruto)
    const a = acc.get(k) ?? { uid: r.unidade_id, grupo: g.grupo, sub: g.subunidade, exames: 0, valorExames: 0, valorFixo: 0, nomes: new Set<string>() }
    if (r.fixo) a.valorFixo += r.total
    else { a.exames += r.quantidade; a.valorExames += r.total }
    a.nomes.add(r.nome_bruto)
    acc.set(k, a)
  }
  const nomeParaUnidade = new Map<string, string>()
  for (const r of resumo) if (r.unidade_id) nomeParaUnidade.set(r.nome_bruto, r.unidade_id)
  for (const n of entrada.nomes) if (n.unidade_id) nomeParaUnidade.set(n.nome_bruto, n.unidade_id)

  const unidadeDaPendencia = (p: SimulacaoPendencia): string | null =>
    p.unidade_id ?? (p.nome_bruto ? nomeParaUnidade.get(p.nome_bruto) ?? null : null)
  const pendPorChave = new Map<string, number>()
  for (const p of entrada.pendencias) {
    const uid = unidadeDaPendencia(p)
    if (!uid) continue
    // pendência sem nome (só unidade) vai para a primeira linha daquela unidade
    const k = p.nome_bruto ? chaveDe(p.nome_bruto, uid) : [...acc.keys()].find(x => acc.get(x)!.uid === uid)
    if (k) pendPorChave.set(k, (pendPorChave.get(k) ?? 0) + 1)
  }

  const totalGeral = r2(resumo.reduce((s, r) => s + r.total, 0))
  const porUnidadeComChave = [...acc.entries()].map(([k, a]) => {
    const id = a.uid
    const u = unidadePorId.get(id)
    const total = r2(a.valorExames + a.valorFixo)
    const pasta = (u?.pasta ?? id) + (a.sub ? ` · ${a.sub}` : '')
    return {
      chave: k, unidadeId: id, empresa: u?.empresa ?? '—', grupo: u?.grupo?.trim() || GRUPO_PROPRIO,
      grupoMobilemed: a.grupo, subunidade: a.sub, pasta,
      modelo: u?.modelo_cobranca ?? 'nao_identificado', situacao: u?.situacao ?? 'sem_data',
      exames: a.exames, valorExames: r2(a.valorExames), valorFixo: r2(a.valorFixo), total,
      pctTotal: totalGeral ? total / totalGeral : 0,
      nPendencias: pendPorChave.get(k) ?? 0, nomes: [...a.nomes].sort(ptBR),
    }
  }).sort((x, y) => ordemGrupo(x.grupoMobilemed) - ordemGrupo(y.grupoMobilemed) || ptBR(x.grupoMobilemed, y.grupoMobilemed) ||
    y.total - x.total || ptBR(x.pasta, y.pasta))
  const porUnidade: LinhaUnidade[] = porUnidadeComChave.map(({ chave: _c, ...u }) => u)

  // ── por grupo da Mobilemed (na ordem de apresentação) ─────────────────────
  const grupos = new Map<string, LinhaGrupo & { ids: Set<string> }>()
  for (const u of porUnidade) {
    const g = grupos.get(u.grupoMobilemed) ?? { grupo: u.grupoMobilemed, unidades: 0, exames: 0, valorExames: 0, valorFixo: 0, total: 0, pctTotal: 0, ids: new Set<string>() }
    g.exames += u.exames; g.valorExames = r2(g.valorExames + u.valorExames); g.valorFixo = r2(g.valorFixo + u.valorFixo)
    g.total = r2(g.total + u.total); g.ids.add(u.unidadeId)
    grupos.set(u.grupoMobilemed, g)
  }
  const porGrupo: LinhaGrupo[] = [...grupos.values()].map(({ ids, ...g }) => ({ ...g, unidades: ids.size, pctTotal: totalGeral ? g.total / totalGeral : 0 }))

  // ── KPIs ───────────────────────────────────────────────────────────────────
  const totalFixo = r2(resumo.filter(r => r.fixo).reduce((s, r) => s + r.total, 0))
  const totalPorExame = r2(totalGeral - totalFixo)
  const exames = resumo.filter(r => !r.fixo).reduce((s, r) => s + r.quantidade, 0)
  const porEmpresa: Record<Empresa, PorEmpresa> = { PRN: { total: 0, exames: 0, unidades: 0 }, MEDIMAGEM: { total: 0, exames: 0, unidades: 0 } }
  const faturadas = new Map<Empresa, Set<string>>([['PRN', new Set()], ['MEDIMAGEM', new Set()]])
  for (const u of porUnidade) {
    if (!ehEmpresa(u.empresa)) continue
    const e = porEmpresa[u.empresa]
    e.total = r2(e.total + u.total); e.exames += u.exames
    if (u.total > 0) faturadas.get(u.empresa)!.add(u.unidadeId) // unidade de contrato conta 1 vez, mesmo dividida por grupo
  }
  for (const emp of EMPRESAS) porEmpresa[emp].unidades = faturadas.get(emp)!.size
  const tipos = new Map<string, PendenciaTipo>()
  for (const p of entrada.pendencias) {
    const t = tipos.get(p.tipo) ?? { tipo: p.tipo, quantidade: 0, exames: 0 }
    t.quantidade++; t.exames += Number(p.qtd_exames ?? 0)
    tipos.set(p.tipo, t)
  }
  const nomesDistintos = new Set<string>([...entrada.nomes.map(n => n.nome_bruto), ...resumo.map(r => r.nome_bruto),
    ...entrada.pendencias.map(p => p.nome_bruto).filter((n): n is string => !!n)])
  const kpis: Kpis = {
    total: totalGeral, totalPorExame, totalFixo, exames,
    unidadesFaturadas: new Set(porUnidade.filter(u => u.total > 0).map(u => u.unidadeId)).size,
    nomes: entrada.simulacao.total_nomes ?? nomesDistintos.size,
    ticketMedio: exames ? totalPorExame / exames : 0,
    porEmpresa, pendenciasPorTipo: [...tipos.values()].sort((a, b) => ptBR(a.tipo, b.tipo)),
  }

  // ── por modalidade (+ matriz unidade × modalidade) ─────────────────────────
  const mods = new Map<string, LinhaModalidade>()
  const nova = (modalidade: string, fixo?: boolean): LinhaModalidade =>
    ({ modalidade, ...(fixo ? { fixo: true } : {}), quantidade: 0, total: 0, ticket: null, pctTotal: 0, porEmpresa: vazioEmpresa(), porGrupo: {} })
  const celulas = new Map<string, { quantidade: Record<string, number>; valor: Record<string, number> }>()
  for (const r of resumo) {
    const emp = r.unidade_id ? unidadePorId.get(r.unidade_id)?.empresa : undefined
    const chave = r.fixo ? 'FIXO' : modalidadeNormalizada(r.rotulo)
    const m = mods.get(chave) ?? nova(chave, r.fixo)
    m.quantidade += r.fixo ? 0 : r.quantidade; m.total += r.total
    if (emp && ehEmpresa(emp)) { m.porEmpresa[emp].quantidade += r.fixo ? 0 : r.quantidade; m.porEmpresa[emp].total += r.total }
    const gr = grupoDe(r.nome_bruto).grupo
    if (gr) {
      const pg = m.porGrupo[gr] ?? { quantidade: 0, total: 0 }
      pg.quantidade += r.fixo ? 0 : r.quantidade; pg.total = r2(pg.total + r.total)
      m.porGrupo[gr] = pg
    }
    mods.set(chave, m)
    if (r.unidade_id && !r.fixo) {
      const k = chaveDe(r.nome_bruto, r.unidade_id)
      const c = celulas.get(k) ?? { quantidade: {}, valor: {} }
      c.quantidade[chave] = (c.quantidade[chave] ?? 0) + r.quantidade
      c.valor[chave] = (c.valor[chave] ?? 0) + r.total
      celulas.set(k, c)
    }
  }
  const posicao = (m: string) => ORDEM_MODALIDADES.indexOf(m)
  const porModalidade = [...mods.values()].map(m => ({
    ...m, total: r2(m.total), ticket: m.fixo || !m.quantidade ? null : m.total / m.quantidade,
    pctTotal: totalGeral ? m.total / totalGeral : 0,
    porEmpresa: {
      PRN: { quantidade: m.porEmpresa.PRN.quantidade, total: r2(m.porEmpresa.PRN.total) },
      MEDIMAGEM: { quantidade: m.porEmpresa.MEDIMAGEM.quantidade, total: r2(m.porEmpresa.MEDIMAGEM.total) },
    },
  })).sort((a, b) => b.total - a.total || posicao(a.modalidade) - posicao(b.modalidade))

  const modalidades = ORDEM_MODALIDADES.filter(m => mods.has(m))
  const somar = (xs: Record<string, number>[]) => Object.fromEntries(modalidades.map(m => [m, r2(xs.reduce((s, x) => s + (x[m] ?? 0), 0))]))
  const linhas: LinhaMatriz[] = porUnidadeComChave.map(u => {
    const c = celulas.get(u.chave) ?? { quantidade: {}, valor: {} }
    return {
      unidadeId: u.unidadeId, empresa: u.empresa, grupoMobilemed: u.grupoMobilemed, pasta: u.pasta,
      quantidade: somar([c.quantidade]), valor: somar([c.valor]),
      valorFixo: u.valorFixo, totalQuantidade: u.exames, totalValor: u.total,
    }
  })
  const matriz: Matriz = {
    modalidades, linhas,
    totais: {
      quantidade: somar(linhas.map(l => l.quantidade)), valor: somar(linhas.map(l => l.valor)),
      valorFixo: r2(linhas.reduce((s, l) => s + l.valorFixo, 0)),
      totalQuantidade: linhas.reduce((s, l) => s + l.totalQuantidade, 0),
      totalValor: r2(linhas.reduce((s, l) => s + l.totalValor, 0)),
    },
  }

  // ── por nome do Bruto ──────────────────────────────────────────────────────
  const pendPorNome = new Map<string, { n: number; exames: number }>()
  for (const p of entrada.pendencias) {
    if (!p.nome_bruto) continue
    const x = pendPorNome.get(p.nome_bruto) ?? { n: 0, exames: 0 }
    x.n++; x.exames += Number(p.qtd_exames ?? 0)
    pendPorNome.set(p.nome_bruto, x)
  }
  const porNome: LinhaNome[] = entrada.nomes.map(n => {
    const u = n.unidade_id ? unidadePorId.get(n.unidade_id) : undefined
    return {
      grupo: grupoDe(n.nome_bruto).grupo,
      nome_bruto: n.nome_bruto, periodo: n.periodo ?? '', unidade: n.pasta ?? u?.pasta ?? null, empresa: n.empresa ?? u?.empresa ?? null,
      qtd: Number(n.qtd_exames ?? 0), total: Number(n.total ?? 0), pendencias: Number(n.n_pendencias ?? 0),
    }
  })
  // nomes que só aparecem nas pendências (ex.: sem contrato) também entram, sem exames faturados nem valor
  const presentes = new Set(porNome.map(n => n.nome_bruto))
  for (const [nome, x] of pendPorNome) {
    if (presentes.has(nome)) continue
    const uid = nomeParaUnidade.get(nome)
    const u = uid ? unidadePorId.get(uid) : undefined
    porNome.push({ grupo: grupoDe(nome).grupo, nome_bruto: nome, periodo: '', unidade: u?.pasta ?? null, empresa: u?.empresa ?? null, qtd: 0, total: 0, pendencias: x.n })
  }
  porNome.sort((a, b) => ordemGrupo(a.grupo) - ordemGrupo(b.grupo) || ptBR(a.nome_bruto, b.nome_bruto) || ptBR(a.periodo, b.periodo))

  // ── lista de pendências ────────────────────────────────────────────────────
  const pendencias: LinhaPendencia[] = entrada.pendencias.map(p => {
    const uid = unidadeDaPendencia(p)
    return { tipo: p.tipo, grupo: p.nome_bruto ? grupoDe(p.nome_bruto).grupo : '', unidade: uid ? unidadePorId.get(uid)?.pasta ?? null : null, nome_bruto: p.nome_bruto, detalhe: p.detalhe, qtd_exames: p.qtd_exames }
  }).sort((a, b) => ordemGrupo(a.grupo) - ordemGrupo(b.grupo) || ptBR(a.tipo, b.tipo) || ptBR(a.nome_bruto ?? '', b.nome_bruto ?? ''))

  // ── exceções de regra por unidade (para a aba Premissas) ───────────────────
  const excecoes: ExcecaoUnidade[] = entrada.unidades
    .map(u => ({
      pasta: u.pasta, empresa: u.empresa,
      regras: etiquetasRegras({ janela: (u.janela ?? 'mes') as 'mes', criterio_data: (u.criterio_data ?? null) as 'laudo' | 'exame' | null, franquia_mensal: u.franquia_mensal ?? null }),
    }))
    .filter(e => e.regras.length > 0)
    .sort((a, b) => ptBR(a.pasta, b.pasta))

  return { kpis, porUnidade, porGrupo, porModalidade, matriz, porNome, pendencias, excecoes }
}
