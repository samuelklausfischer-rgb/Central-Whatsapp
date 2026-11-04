// Acervo de exames (tabela faturamento_unidades.exame_bruto, 3 meses de retenção).
//
// POR QUE EXISTE: o Bruto da Mobilemed sai pela data de TRANSFERÊNCIA — o arquivo do mês
// traz exame ainda sem laudo, e o do mês anterior traz laudo que saiu neste mês. Cada
// Bruto que sobe fica guardado aqui, e o cálculo (função fat-simular, pedido com
// do_acervo) lê do acervo: assim cada exame entra no mês do seu laudo (ou do exame, na
// unidade que fatura pela data do exame), venha de qual arquivo vier. As unidades com
// dia de corte também pegam daqui os dias fora do mês (21→20 vai até o mês seguinte; FHEMIG 27→26 vem do anterior).
import { db } from './supabase'
import { executarEmPool, paginar } from './pool'
import { chaveExame, type BrutosLidos } from './bruto'
import { descreverArquivo, diaDeCorte, normNome, parseDataBR, periodos, type Janela, type LinhaBruto } from '../nucleo/motor'

const CAMPOS = [
  'unidade', 'nome_paciente', 'estudo_descricao', 'accession_number', 'modalidade', 'prioridade', 'medico',
  'duplicado', 'data_exame', 'data_transferencia', 'data_conclusao', 'data_prazo', 'status', 'imagem_chave', 'digitador',
] as const

const iso = (d: Date) => d.toISOString().slice(0, 10)
const dataISO = (s?: string) => { const d = parseDataBR(s); return d ? iso(d) : null }

/**
 * Registra o Bruto (tabela arquivo_bruto: período, jeito da exportação, Unidades que vieram). É o que deixa o cálculo
 * achar o DIA do 1º laudo do reassinado e cortar no dia certo (FHEMIG 27→26, corte_NN…). Null = sem período no nome
 * (arquivo renomeado) ou banco ainda sem a tabela: os exames entram como antes.
 */
async function registrarArquivo(nome: string, linhas: LinhaBruto[]): Promise<string | null> {
  const d = descreverArquivo(nome, linhas)
  if (!d) return null
  const { data, error } = await db.rpc('registrar_arquivo', {
    p_nome: nome, p_de: d.periodo_de, p_ate: d.periodo_ate, p_exportado_em: d.exportado_em, p_modo: d.modo, p_nomes: d.nomes, p_linhas: d.linhas,
  })
  if (error) {
    if (/registrar_arquivo|schema cache|does not exist/i.test(error.message)) return null
    throw new Error(`acervo: ${error.message}`)
  }
  return (data as string | null) ?? null
}

/**
 * Guarda (ou atualiza) os exames de cada arquivo, um arquivo por vez, do exportado há mais tempo para o mais
 * novo (a versão mais nova do exame fica por último). Linhas idênticas no mesmo arquivo são exames repetidos
 * de verdade: a `ocorrencia` (1ª, 2ª…) mantém cada uma. Cada exame leva o registro do arquivo em que veio.
 */
export async function guardarNoAcervo(
  lido: Pick<BrutosLidos, 'porArquivo'>, aoProgredir?: (feitos: number, total: number) => void,
): Promise<number> {
  const total = lido.porArquivo.reduce((s, a) => s + a.linhas.length, 0)
  const ordem = [...lido.porArquivo].sort((a, b) =>
    (descreverArquivo(a.nome, a.linhas)?.exportado_em ?? '').localeCompare(descreverArquivo(b.nome, b.linhas)?.exportado_em ?? ''))
  let feitos = 0
  for (const arq of ordem) {
    const arquivoId = await registrarArquivo(arq.nome, arq.linhas)
    await guardarLinhas(arq.linhas, arq.nome, arquivoId, n => { feitos += n; aoProgredir?.(feitos, total) })
  }
  return total
}

async function guardarLinhas(linhas: LinhaBruto[], arquivoNome: string, arquivoId: string | null, aoGravar: (n: number) => void) {
  const ocorrencias = new Map<string, number>()
  const agora = new Date().toISOString()
  const registros = linhas.map(l => {
    const chave = chaveExame(l)
    const ocorrencia = (ocorrencias.get(chave) ?? 0) + 1
    ocorrencias.set(chave, ocorrencia)
    const r: Record<string, unknown> = { chave, ocorrencia, arquivo_nome: l.arquivo_nome ?? arquivoNome, recebido_em: agora }
    for (const c of CAMPOS) r[c] = l[c] ?? null
    r.data_exame_d = dataISO(l.data_exame)
    r.data_laudo_d = dataISO(l.data_conclusao)
    // mês do Bruto em que o exame veio: diz o mês do 1º laudo do reassinado (sem ele, o banco tenta pelo nome do arquivo)
    r.mes_arquivo = l.mes_arquivo ?? null
    if (arquivoId) { r.arquivo_id = arquivoId; r.com_laudo = !!l.data_conclusao }
    return r
  })
  const lotes: Record<string, unknown>[][] = []
  for (let i = 0; i < registros.length; i += 500) lotes.push(registros.slice(i, i + 500))
  await executarEmPool(lotes, 3, async lote => {
    // guardar_exames atualiza o que já estava guardado, mas não troca versão COM laudo por uma sem laudo
    const { error } = await db.rpc('guardar_exames', { p_linhas: lote })
    if (error) throw new Error(`acervo: ${error.message}`)
    aoGravar(lote.length)
  })
}

/** Janela de cada nome do Bruto (pela unidade de contrato ligada a ele). Chave = normNome(nome). */
export async function janelasPorNome(): Promise<Map<string, Janela>> {
  const [aliases, unidades] = await Promise.all([
    paginar<{ nome_bruto: string; unidade_id: string }>((de, ate) =>
      db.from('alias').select('nome_bruto, unidade_id').order('nome_bruto').range(de, ate)),
    paginar<{ id: string; janela: Janela }>((de, ate) =>
      db.from('unidade').select('id, janela').order('id').range(de, ate)),
  ])
  const janelaDe = new Map(unidades.map(u => [u.id, u.janela]))
  return new Map(aliases.map(a => [normNome(a.nome_bruto), janelaDe.get(a.unidade_id) ?? 'mes']))
}

export interface NomeComCorte { nome: string; janela: Janela; inicio: string; fim: string }

/** Nomes do envio cuja unidade tem dia de corte, com o início e o fim do período da competência. */
export function nomesComCorte(nomes: string[], janelas: Map<string, Janela>, competencia: string): NomeComCorte[] {
  return nomes.flatMap(nome => {
    const janela = janelas.get(normNome(nome))
    if (!janela || !diaDeCorte(janela)) return []
    const p = periodos(competencia, janela)[0]
    return [{ nome, janela, inicio: iso(p.inicio), fim: iso(p.fim) }]
  })
}

/** Nomes com exame guardado (pela data do laudo OU do exame) entre `desde` e `ate` (ISO). */
export async function nomesNoAcervo(desde: string, ate: string): Promise<Map<string, number>> {
  const linhas = await paginar<{ unidade: string; exames: number }>((de, a) =>
    db.rpc('nomes_no_acervo', { p_desde: desde, p_ate: ate }).order('unidade').range(de, a))
  return new Map(linhas.map(l => [l.unidade, Number(l.exames)]))
}

/**
 * O acervo tem os dias fora do mês que o corte precisa? Conta laudos guardados entre
 * `desde` e `ate` (de QUALQUER unidade): se o Bruto daquele mês já subiu, há milhares.
 * Pelo laudo, e não pela data do exame, porque o Bruto novo também traz exame antigo
 * laudado agora — contar pela data do exame daria "coberto" sem aquele mês ter subido.
 */
export async function acervoCobre(desde: string, ate: string, nomes: string[] = []): Promise<boolean> {
  // com os Brutos registrados (desde 04/11/2026): cada dia tem que estar num Bruto exportado depois dele, dos que
  // trazem a Unidade (a Mobilemed exporta por grupo); unidade que não veio em nenhum deles → vale qualquer Bruto
  const { data: regs, error: e1 } = await db.from('arquivo_bruto').select('periodo_de, periodo_ate, exportado_em, nomes')
    .lte('periodo_de', ate).gte('periodo_ate', desde)
  if (!e1 && regs?.length) {
    const alvo = new Set(nomes.map(normNome))
    const daUnidade = regs.filter(r => (r.nomes ?? []).some((n: string) => alvo.has(normNome(n))))
    const uteis = daUnidade.length ? daUnidade : regs
    const vespera = (d: string) => new Date(Date.parse(`${d}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10)
    const cobreAte = (r: { periodo_ate: string; exportado_em: string }) => {
      const exp = r.exportado_em.slice(0, 10)
      return exp > r.periodo_ate ? r.periodo_ate : vespera(exp)
    }
    for (let d = desde; d <= ate; d = new Date(Date.parse(`${d}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10))
      if (!uteis.some(r => r.periodo_de <= d && d <= cobreAte(r))) return false
    return true
  }
  const { count, error } = await db.from('exame_bruto').select('chave', { count: 'exact', head: true })
    .gte('data_laudo_d', desde).lte('data_laudo_d', ate)
  if (error) throw new Error(`acervo: ${error.message}`)
  return (count ?? 0) > 0
}

/**
 * O acervo já tem exame vindo do Bruto do mês `mes` ('AAAA-MM-01')? Com o Bruto do mês seguinte guardado, o
 * laudo reassinado cai no mês do 1º laudo sem dúvida (motor, intervaloDoLaudo).
 */
export async function acervoTemMes(mes: string): Promise<boolean> {
  const { data, error } = await db.from('exame_bruto').select('chave').eq('mes_arquivo', mes).limit(1)
  if (error) throw new Error(`acervo: ${error.message}`)
  return (data ?? []).length > 0
}
