import { supabaseFinanceiro } from '@/lib/supabase/client-financeiro'

export type RateioEmpresa = 'PRN' | 'PRN_APICE' | 'MEDIMAGEM' | 'MEDIMAGEM_APICE'

// Serviço avulso do mês informado na tela (ex.: horas extras). Com `unidade`, o valor
// vai inteiro para aquela unidade (nome exatamente como veio de fetchRateioUnidades).
// Sem `unidade`, o motor divide entre as unidades cadastradas e ativas da empresa.
// Na resposta do motor, `unidade` vem null quando foi dividido e `n_unidades` diz entre
// quantas; itens antigos do histórico não têm nenhum dos dois campos.
export interface RateioAdicional {
  nome: string
  valor: number
  unidade?: string | null
  n_unidades?: number
}

export interface RateioResumo {
  empresa: string
  total_variavel: number
  total_encargos: number
  total_geral: number
  totais_taxa: Record<string, number>
  n_unidades: number
  total_exames: number
  adicionais?: RateioAdicional[]
  adicional_total?: number
  adicional_n_unidades?: number
}

export interface RateioPendencia {
  tipo: string
  referencia: string
}

// Uma unidade do rateio, como o motor devolve em `resposta.linhas` e como é gravada em
// `dash_rateio_execucoes.linhas` (contrato docs/rateio-omie/CONTRATO.md). `unidade` é o nome
// exibido no Excel; as taxas aparecem só quando existem, por isso o índice aberto.
export interface RateioLinha {
  unidade: string
  soma: number
  total: number
  PORTAL?: number
  INTEGRACAO?: number
  SERVIDOR?: number
  ROBO?: number
  STORAGE?: number
  ADICIONAL?: number
  [taxa: string]: string | number | undefined
}

export interface RateioResultado {
  ok: boolean
  mensagem?: string
  resumo: RateioResumo
  pendencias: RateioPendencia[]
  // Ausente enquanto o motor (n8n) não devolve as linhas: sem elas a execução não é lançável no Omie.
  linhas?: RateioLinha[]
  arquivo: { nome: string; mime: string; base64: string }
}

export interface RateioHistoricoItem {
  id: string
  empresa: string
  arquivo_nome: string
  total_variavel: number
  total_encargos: number
  total_geral: number
  totais_taxa: Record<string, number>
  n_unidades: number
  total_exames: number
  n_pendencias: number
  pendencias: RateioPendencia[]
  adicionais: RateioAdicional[] | null
  adicional_total: number | null
  criado_em: string
}

// Não é segredo (endpoint público, CORS liberado) — só evita depender de config em
// runtime para a feature funcionar out-of-the-box; VITE_N8N_RATEIO_WEBHOOK sobrescreve.
const WEBHOOK_FALLBACK = 'https://apps-n8n.srofjl.easypanel.host/webhook/rateio-upload'
const UNIDADES_WEBHOOK_FALLBACK = 'https://apps-n8n.srofjl.easypanel.host/webhook/rateio-unidades'

// Mesma tabela/projeto Supabase já usados pelo Dashboard Omie (histórico de rateio).
const TABLE_RATEIO = 'dash_rateio_execucoes'
const RATEIO_LIST_COLS =
  'id, empresa, arquivo_nome, total_variavel, total_encargos, total_geral, totais_taxa, ' +
  'n_unidades, total_exames, n_pendencias, pendencias, adicionais, adicional_total, criado_em'

interface RateioUnidadesResposta {
  ok: boolean
  mensagem?: string
  empresa?: string
  unidades?: { nome: string }[]
}

// Unidades ativas da empresa (já ordenadas pelo n8n), para o seletor do serviço
// adicional. Devolve só os nomes — é o valor que volta em `RateioAdicional.unidade`.
export async function fetchRateioUnidades(empresa: RateioEmpresa): Promise<string[]> {
  const base = import.meta.env.VITE_N8N_RATEIO_UNIDADES_WEBHOOK || UNIDADES_WEBHOOK_FALLBACK
  const res = await fetch(`${base}?${new URLSearchParams({ empresa })}`)
  if (!res.ok) throw new Error(`Falha ao carregar as unidades (HTTP ${res.status})`)
  const json = (await res.json()) as RateioUnidadesResposta
  if (!json.ok) throw new Error(json.mensagem || 'Falha ao carregar as unidades')
  return (json.unidades || []).map((u) => u.nome).filter(Boolean)
}

export async function processarRateio(
  arquivo: File,
  empresa: RateioEmpresa,
  adicionais: RateioAdicional[] = [],
): Promise<RateioResultado> {
  const webhookUrl = import.meta.env.VITE_N8N_RATEIO_WEBHOOK || WEBHOOK_FALLBACK

  const fd = new FormData()
  fd.append('data', arquivo, arquivo.name)
  fd.append('empresa', empresa)
  // Lista vazia não vai no corpo: sem o campo, o motor devolve o mesmo de sempre.
  if (adicionais.length) fd.append('adicionais', JSON.stringify(adicionais))

  const res = await fetch(webhookUrl, { method: 'POST', body: fd })
  if (!res.ok) throw new Error(`Falha no processamento (HTTP ${res.status})`)
  const json = (await res.json()) as RateioResultado
  if (!json.ok) throw new Error(json.mensagem || 'Falha no processamento do rateio')
  return json
}

export interface RateioExecucaoGravada {
  id: string
  // false quando a coluna `linhas` ainda não existe no banco e a gravação caiu para o
  // insert sem ela (migração não aplicada): a execução fica no histórico, mas não é lançável.
  linhasGravadas: boolean
}

// O banco ainda pode não ter a coluna `linhas` (PostgREST: PGRST204 / "schema cache";
// Postgres: 42703 / "column ... does not exist").
function colunaLinhasAusente(error: { code?: string; message?: string }): boolean {
  const msg = error.message || ''
  if (!/linhas/i.test(msg)) return false
  return error.code === 'PGRST204' || error.code === '42703' || /does not exist|schema cache|could not find/i.test(msg)
}

// Grava uma execução de rateio no histórico e devolve o id da linha criada. Falha aqui não
// deve impedir o usuário de ver/baixar o resultado que acabou de gerar (chamador decide se é fatal).
export async function insertRateioExecucao(row: Record<string, unknown>): Promise<RateioExecucaoGravada> {
  let { data, error } = await supabaseFinanceiro.from(TABLE_RATEIO).insert(row).select('id').single()
  let linhasGravadas = row.linhas != null

  if (error && 'linhas' in row && colunaLinhasAusente(error)) {
    // Migração ainda não aplicada: grava sem `linhas` para não quebrar o histórico.
    console.warn(
      'A coluna "linhas" ainda não existe em dash_rateio_execucoes (aplique a migração do rateio-omie). ' +
        'Gravando a execução sem as linhas; o lançamento no Omie fica indisponível para ela.',
    )
    const semLinhas = { ...row }
    delete semLinhas.linhas
    ;({ data, error } = await supabaseFinanceiro.from(TABLE_RATEIO).insert(semLinhas).select('id').single())
    linhasGravadas = false
  }

  if (error) throw new Error(error.message)
  const id = (data as { id?: string } | null)?.id
  if (!id) throw new Error('O histórico não devolveu o id da execução gravada')
  return { id, linhasGravadas }
}

// Não traz o xlsx (pesado) — use fetchRateioArquivo(id) sob demanda no download.
export async function fetchRateioHistorico(empresa: RateioEmpresa, limit = 25): Promise<RateioHistoricoItem[]> {
  const { data, error } = await supabaseFinanceiro
    .from(TABLE_RATEIO)
    .select(RATEIO_LIST_COLS)
    .eq('empresa', empresa)
    .order('criado_em', { ascending: false })
    .limit(limit)
  if (error) throw new Error(error.message)
  return (data as unknown as RateioHistoricoItem[]) || []
}

export async function fetchRateioArquivo(
  id: string,
): Promise<{ resultado_xlsx_nome: string; resultado_xlsx_base64: string } | null> {
  const { data, error } = await supabaseFinanceiro
    .from(TABLE_RATEIO)
    .select('resultado_xlsx_nome, resultado_xlsx_base64')
    .eq('id', id)
    .single()
  if (error) throw new Error(error.message)
  return data as { resultado_xlsx_nome: string; resultado_xlsx_base64: string } | null
}

export async function deleteRateioExecucao(id: string): Promise<void> {
  const { error } = await supabaseFinanceiro.from(TABLE_RATEIO).delete().eq('id', id)
  if (error) throw new Error(error.message)
}
