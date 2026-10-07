import { supabaseFinanceiro } from '@/lib/supabase/client-financeiro'
import { interpretarErroDeFuncao } from '@/lib/friendly-error'
import type { RateioEmpresa } from '@/services/rateio/rateio-service'

// Cliente da edge function `rateio-omie` (projeto Supabase financeiro). Os tipos abaixo
// são cópia do contrato em docs/rateio-omie/CONTRATO.md: mudou lá, muda aqui.

const FUNCAO = 'rateio-omie'

export const MSG_SEM_PERMISSAO = 'Você não tem permissão para lançar no Omie'

export type OmieBloqueioTipo =
  | 'EXECUCAO_SEM_LINHAS'
  | 'EXECUCAO_INCONSISTENTE'
  | 'UNIDADE_SEM_DEPARTAMENTO'
  | 'DEPARTAMENTO_INEXISTENTE'
  | 'NF_DIVERGENTE'
  | 'NF_VAZIA'
  | 'JA_LANCADO'
  | 'CREDENCIAL_EMPRESA_ERRADA'
  | 'ACIMA_DO_TETO'
  | 'CONFIG_AUSENTE'
  | 'NF_JA_LANCADA'
  | 'EXECUCAO_JA_LANCADA'
  | 'DEPARTAMENTO_VALOR_INVALIDO'
  | 'EXECUCAO_DE_OUTRO_USUARIO'
  | 'LANCAMENTO_EM_ANDAMENTO'

export type OmieAvisoTipo =
  | 'VINCULO_BAIXA_CONFIANCA'
  | 'EXECUCAO_COM_PENDENCIAS'
  | 'AJUSTE_CENTAVOS'
  | 'LANCAMENTO_INCERTO'
  | 'TENTATIVA_ANTERIOR_COM_ERRO'

export interface OmieBloqueio {
  tipo: OmieBloqueioTipo | (string & {})
  mensagem: string
  referencia?: string
}

export interface OmieAviso {
  tipo: OmieAvisoTipo | (string & {})
  mensagem: string
  referencia?: string
}

export interface OmieAnaliseEntrada {
  execucao_id: string
  nf: string
  valor_nf: number
  competencia: string // AAAA-MM
  emissao: string // AAAA-MM-DD
  vencimento?: string // AAAA-MM-DD; padrão no servidor: último dia do mês da emissão
  conta_corrente?: number // padrão no servidor: rateio_omie_config.conta_corrente_padrao
}

export interface OmieDistribuicao {
  cod_departamento: number
  nome: string
  unidades: string[]
  valor: number
  perc: number
}

export interface OmieJaLancado {
  status: string
  omie_codigo_lancamento: number | null
  criado_em: string | null
  // O contrato nao lista este campo; se o servidor passar a mandá-lo, a tela só mostra o
  // "já lançado" quando ele for igual à chave da análise atual.
  chave?: string
}

export interface OmieAnalise {
  ok: true
  empresa: RateioEmpresa
  conta_omie: 'PRN' | 'MEDIMAGEM'
  chave: string
  ja_lancado: OmieJaLancado | null
  total_rateio: number
  valor_nf: number
  diferenca: number
  ajuste: { cod_departamento: number; centavos: number } | null
  distribuicao: OmieDistribuicao[]
  bloqueios: OmieBloqueio[]
  avisos: OmieAviso[]
  hash: string
}

export type OmieLancarStatus = 'lancado' | 'erro' | 'incerto'
export type OmieLancarMotivo =
  | 'JA_LANCADO'
  | 'LANCAMENTO_EM_ANDAMENTO'
  | 'NF_JA_LANCADA'
  | 'EXECUCAO_JA_LANCADA'
  | 'HASH_MUDOU'
  | 'ESCRITA_DESLIGADA'
  | 'BLOQUEADO'

export interface OmieLancarResultado {
  ok: boolean
  status?: OmieLancarStatus
  motivo?: OmieLancarMotivo
  lancamento_id?: string
  omie_codigo_lancamento?: number | null
  mensagem?: string
  // Presente em HASH_MUDOU e BLOQUEADO: a análise refeita pelo servidor.
  analise?: OmieAnalise
}

export interface OmieDepartamento {
  cod: number
  nome: string
}

type Corpo =
  | ({ acao: 'analisar' } & OmieAnaliseEntrada)
  | ({ acao: 'lancar'; hash: string } & OmieAnaliseEntrada)
  | { acao: 'vincular'; empresa: RateioEmpresa; unidade: string; cod_departamento: number }
  | { acao: 'departamentos'; empresa: RateioEmpresa }

// Erros de negócio com código fixo ganham texto próprio; os demais passam como o servidor mandou.
function mensagemDeErro(erro: string | undefined, padrao: string): string {
  if (erro === 'FORMATO_OMIE_INESPERADO') {
    return 'O Omie respondeu num formato inesperado, então a análise foi interrompida por segurança. Nada foi criado; avise o suporte.'
  }
  return erro || padrao
}

// Toda resposta de negócio é HTTP 200 com { ok, ... }; 401/403 vira a mensagem amigável.
async function chamar<T extends { ok: boolean }>(body: Corpo): Promise<T & { erro?: string }> {
  const { data, error } = await supabaseFinanceiro.functions.invoke(FUNCAO, { body })
  if (error) {
    const e = await interpretarErroDeFuncao(error, 'Falha ao falar com o serviço do Omie')
    if (e.status === 401 || e.status === 403) throw new Error(MSG_SEM_PERMISSAO)
    throw new Error(e.message)
  }
  if (!data || typeof data !== 'object') throw new Error('Resposta vazia do serviço do Omie')
  return data as T & { erro?: string }
}

// Não grava nada: devolve a distribuição, os bloqueios e o hash que `lancar` exige.
export async function analisarRateioOmie(entrada: OmieAnaliseEntrada): Promise<OmieAnalise> {
  const r = await chamar<OmieAnalise>({ acao: 'analisar', ...entrada })
  if (!r.ok) throw new Error(mensagemDeErro(r.erro, 'Não foi possível analisar o lançamento'))
  return r
}

// Cria a conta a pagar real no Omie. Recusas de negócio (HASH_MUDOU, BLOQUEADO,
// ESCRITA_DESLIGADA) e os status erro/incerto voltam como resultado, não como exceção.
export async function lancarRateioOmie(entrada: OmieAnaliseEntrada, hash: string): Promise<OmieLancarResultado> {
  const r = await chamar<OmieLancarResultado>({ acao: 'lancar', hash, ...entrada })
  if (!r.ok && !r.motivo && !r.status) throw new Error(mensagemDeErro(r.erro, 'Não foi possível lançar no Omie'))
  return r
}

export async function vincularUnidadeOmie(
  empresa: RateioEmpresa,
  unidade: string,
  codDepartamento: number,
): Promise<{ departamento_nome: string }> {
  const r = await chamar<{ ok: boolean; departamento_nome: string }>({
    acao: 'vincular',
    empresa,
    unidade,
    cod_departamento: codDepartamento,
  })
  if (!r.ok) throw new Error(mensagemDeErro(r.erro, 'Não foi possível vincular a unidade'))
  return { departamento_nome: r.departamento_nome }
}

// Departamentos ativos da conta Omie da empresa, para o seletor do "vincular".
export async function listarDepartamentosOmie(empresa: RateioEmpresa): Promise<OmieDepartamento[]> {
  const r = await chamar<{ ok: boolean; departamentos: OmieDepartamento[] }>({ acao: 'departamentos', empresa })
  if (!r.ok) throw new Error(mensagemDeErro(r.erro, 'Não foi possível carregar os departamentos'))
  return r.departamentos || []
}

/*
 * "Lançar tudo": no produto é um laço por empresa, 1 chamada por execução, cada resultado
 * independente (uma falha não derruba as demais). A tela de hoje processa 1 empresa por vez;
 * quando o histórico permitir escolher as 4 execuções do mês, descomente e ligue ao painel.
 *
 * export interface LancarTudoItem {
 *   execucao_id: string
 *   empresa: RateioEmpresa
 *   nf: string
 *   valor_nf: number
 * }
 *
 * export type LancarTudoResultado =
 *   | { execucao_id: string; empresa: RateioEmpresa; tipo: 'lancado' | 'erro' | 'incerto' | 'recusado'; detalhe: string }
 *
 * export async function lancarTudo(
 *   itens: LancarTudoItem[],
 *   comum: Pick<OmieAnaliseEntrada, 'competencia' | 'emissao' | 'vencimento' | 'conta_corrente'>,
 * ): Promise<LancarTudoResultado[]> {
 *   const saida: LancarTudoResultado[] = []
 *   for (const item of itens) {
 *     const entrada: OmieAnaliseEntrada = { ...comum, execucao_id: item.execucao_id, nf: item.nf, valor_nf: item.valor_nf }
 *     const base = { execucao_id: item.execucao_id, empresa: item.empresa }
 *     try {
 *       const analise = await analisarRateioOmie(entrada)
 *       if (analise.bloqueios.length) {
 *         saida.push({ ...base, tipo: 'recusado', detalhe: analise.bloqueios.map((b) => b.mensagem).join(' | ') })
 *         continue
 *       }
 *       const r = await lancarRateioOmie(entrada, analise.hash)
 *       saida.push({ ...base, tipo: r.status ?? 'recusado', detalhe: r.mensagem || r.motivo || '' })
 *     } catch (err) {
 *       saida.push({ ...base, tipo: 'erro', detalhe: (err as Error).message })
 *     }
 *   }
 *   return saida
 * }
 */
