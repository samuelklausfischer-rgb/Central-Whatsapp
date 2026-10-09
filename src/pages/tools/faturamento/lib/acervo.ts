// Acervo de exames (tabela faturamento_unidades.exame_bruto, 3 meses de retenção).
//
// POR QUE EXISTE: o Bruto da Mobilemed sai pela data de TRANSFERÊNCIA — o arquivo do mês
// traz exame ainda sem laudo, e o do mês anterior traz laudo que saiu neste mês. Cada
// Bruto que sobe fica guardado aqui, e o cálculo (função fat-simular, pedido com
// do_acervo) lê do acervo: assim cada exame entra no mês do seu laudo (ou do exame, na
// unidade que fatura pela data do exame), venha de qual arquivo vier. As unidades com
// dia de corte (27→26, 21→20…) também pegam daqui os dias do mês anterior.
import { db } from './supabase'
import { executarEmPool, paginar } from './pool'
import { chaveExame } from './bruto'
import { diaDeCorte, normNome, parseDataBR, periodos, type Janela, type LinhaBruto } from '../nucleo/motor'

const CAMPOS = [
  'unidade', 'nome_paciente', 'estudo_descricao', 'accession_number', 'modalidade', 'prioridade', 'medico',
  'duplicado', 'data_exame', 'data_transferencia', 'data_conclusao', 'data_prazo', 'status', 'imagem_chave', 'digitador',
] as const

const iso = (d: Date) => d.toISOString().slice(0, 10)
const dataISO = (s?: string) => { const d = parseDataBR(s); return d ? iso(d) : null }

/**
 * Guarda (ou atualiza) os exames lidos. Linhas idênticas no mesmo envio são exames
 * repetidos de verdade: a `ocorrencia` (1ª, 2ª…) mantém cada uma.
 */
export async function guardarNoAcervo(
  linhas: LinhaBruto[], arquivoNome: string, aoProgredir?: (feitos: number, total: number) => void,
): Promise<number> {
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
    return r
  })
  const lotes: Record<string, unknown>[][] = []
  for (let i = 0; i < registros.length; i += 500) lotes.push(registros.slice(i, i + 500))
  let feitos = 0
  await executarEmPool(lotes, 3, async lote => {
    // guardar_exames atualiza o que já estava guardado, mas não troca versão COM laudo por uma sem laudo
    const { error } = await db.rpc('guardar_exames', { p_linhas: lote })
    if (error) throw new Error(`acervo: ${error.message}`)
    feitos += lote.length
    aoProgredir?.(feitos, registros.length)
  })
  return registros.length
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
 * O acervo tem os dias do mês anterior que o corte precisa? Conta laudos guardados entre
 * `desde` e `ate` (de QUALQUER unidade): se o Bruto daquele mês já subiu, há milhares.
 * Pelo laudo, e não pela data do exame, porque o Bruto novo também traz exame antigo
 * laudado agora — contar pela data do exame daria "coberto" sem o mês anterior ter subido.
 */
export async function acervoCobre(desde: string, ate: string): Promise<boolean> {
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
