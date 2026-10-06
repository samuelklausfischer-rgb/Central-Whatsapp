// Cálculo na Edge Function fat-simular (com o login de quem está usando) e download
// dos arquivos gerados no navegador. O código do motor fica no repositório
// PRN-faturamento-unidades (supabase/functions/fat-simular); aqui só se chama.
import supabase from '@/lib/supabase/client'
import { appEnv } from '@/lib/env'
import { db } from './supabase'
import { paginar } from './pool'
import { gerarXlsx, montarPlanilha, type ExameLinha, type ResumoItem } from './excel'
import type { RespostaSimular, Simulacao, SimulacaoNome, SimulacaoPendencia, RegrasUnidade } from './tipos'
import { agregar, type ResumoLinha, type UnidadeEntrada } from './consolidado'
import { gerarConsolidado, nomeArquivoConsolidado } from './consolidadoXlsx'
import { normNome } from '../nucleo/motor'
import { faturaUnidadeXlsx, grupoDoNome, juntarResumo, type InfoAlias, type Relatorio } from './relatorioUnidade'

export type ModoCalculo = 'servidor' | 'local'
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Cache = Record<string, any>

const FUNCAO = 'fat-simular'

/** Confere se a função está publicada. Devolve o build ou null. */
export async function verificarFuncao(): Promise<string | null> {
  try {
    const chave = appEnv.VITE_SUPABASE_PUBLISHABLE_KEY
    const r = await fetch(`${appEnv.VITE_SUPABASE_URL}/functions/v1/${FUNCAO}`, {
      headers: { apikey: chave, Authorization: `Bearer ${chave}` }, signal: AbortSignal.timeout(15000),
    })
    const j = await r.json()
    return typeof j?.build === 'string' ? j.build : null
  } catch { return null }
}

/**
 * Calcula um nome do Bruto na Edge Function (vai com o token de quem está logado).
 * `do_acervo: true` (padrão do Central Whats): a função lê os exames do acervo, não do pedido.
 */
export async function simularNome(corpo: { simulacao_id: string; competencia: string; nome_bruto: string; linhas?: unknown[]; do_acervo?: boolean }, _modo: ModoCalculo = 'servidor', _cache: Cache = {}): Promise<RespostaSimular> {
  const { data, error } = await supabase.functions.invoke<RespostaSimular>(FUNCAO, { body: corpo })
  if (error) {
    // Erro HTTP da função: a mensagem útil vem no corpo ({ erro }).
    const resp = (error as { context?: Response }).context
    let msg = error.message
    try { const j = await resp?.json(); if (j?.erro) msg = j.erro } catch { /* corpo não é JSON */ }
    throw new Error(msg)
  }
  if (!data || data.erro) throw new Error(data?.erro ?? 'resposta vazia da função')
  return data
}

const COLUNAS_EXAME = 'nome_bruto, nome_paciente, estudo_descricao, accession_number, modalidade, prioridade, medico, quantidade, valor_unitario, valor_total, duplicado, data_exame, data_transferencia, data_conclusao, data_prazo, status_bruto, imagem_chave, digitador'

/** Busca exames e resumo de um nome × período e gera os bytes do .xlsx. */
export async function xlsxDoNome(simulacaoId: string, nomeBruto: string, periodo: string): Promise<Uint8Array> {
  const exames = await paginar<ExameLinha>((de, ate) =>
    db.from('simulacao_exame').select(COLUNAS_EXAME)
      .eq('simulacao_id', simulacaoId).eq('nome_bruto', nomeBruto).eq('periodo', periodo)
      .order('id').range(de, ate))
  const { data, error } = await db.from('simulacao_resumo').select('rotulo, quantidade, total, fixo')
    .eq('simulacao_id', simulacaoId).eq('nome_bruto', nomeBruto).eq('periodo', periodo).order('ordem')
  if (error) throw new Error(error.message)
  const resumo: ResumoItem[] = ((data ?? []) as { rotulo: string; quantidade: number; total: number; fixo: boolean }[]).map(r => ({ rotulo: r.rotulo, quantidade: Number(r.quantidade), total: Number(r.total), fixo: !!r.fixo }))
  const numerico = exames.map(e => ({ ...e, quantidade: Number(e.quantidade), valor_unitario: Number(e.valor_unitario), valor_total: Number(e.valor_total) }))
  return gerarXlsx(montarPlanilha(numerico, resumo))
}

/** Nome normalizado → grupo da Mobilemed e subunidade (do cadastro de nomes). */
export async function carregarInfoAlias(): Promise<Map<string, InfoAlias>> {
  const linhas = await paginar<{ nome_bruto: string; grupo: string | null; subunidade: string | null }>((de, ate) =>
    db.from('alias').select('nome_bruto, grupo, subunidade').order('nome_bruto').range(de, ate))
  return new Map(linhas.map(a => [normNome(a.nome_bruto), { grupo: a.grupo, subunidade: a.subunidade }]))
}

/** Relatório "Fatura de unidade": junta todos os nomes da unidade daquele grupo e período. */
export async function xlsxDoRelatorio(simulacaoId: string, competencia: string, rel: Relatorio): Promise<Uint8Array> {
  const exames = await paginar<ExameLinha>((de, ate) =>
    db.from('simulacao_exame').select(COLUNAS_EXAME)
      .eq('simulacao_id', simulacaoId).in('nome_bruto', rel.nomes).eq('periodo', rel.periodo)
      .order('nome_bruto').order('id').range(de, ate))
  const { data, error } = await db.from('simulacao_resumo').select('rotulo, quantidade, valor_unitario, total, fixo')
    .eq('simulacao_id', simulacaoId).in('nome_bruto', rel.nomes).eq('periodo', rel.periodo)
  if (error) throw new Error(error.message)
  const resumo = juntarResumo(((data ?? []) as { rotulo: string; quantidade: number; valor_unitario: number | null; total: number; fixo: boolean }[]).map(r => ({
    rotulo: r.rotulo, quantidade: Number(r.quantidade), total: Number(r.total), fixo: !!r.fixo,
    valor_unitario: r.valor_unitario == null ? null : Number(r.valor_unitario),
  })))
  const numerico = exames.map(e => ({ ...e, quantidade: Number(e.quantidade), valor_unitario: Number(e.valor_unitario), valor_total: Number(e.valor_total) }))
  return faturaUnidadeXlsx(rel, competencia, resumo, numerico)
}

export function baixarArquivo(conteudo: Blob, nome: string) {
  const url = URL.createObjectURL(conteudo)
  const a = document.createElement('a')
  a.href = url; a.download = nome
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10000)
}

/** Busca tudo de uma simulação e monta os bytes do Excel consolidado (todas as abas). */
export async function montarConsolidado(simulacaoId: string): Promise<{ bytes: Uint8Array; nome: string }> {
  const unico = async <T>(consulta: PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T> => {
    const { data, error } = await consulta
    if (error) throw new Error(error.message)
    return data as T
  }
  const [simulacao, resumo, pendencias, nomes, unidadesBase, regras, config, ignorados] = await Promise.all([
    unico<Simulacao>(db.from('simulacao').select('*').eq('id', simulacaoId).single()),
    paginar<ResumoLinha>((de, ate) => db.from('simulacao_resumo').select('*').eq('simulacao_id', simulacaoId)
      .order('nome_bruto').order('periodo').order('ordem').order('rotulo').range(de, ate)),
    paginar<SimulacaoPendencia>((de, ate) => db.from('simulacao_pendencia').select('*').eq('simulacao_id', simulacaoId).order('id').range(de, ate)),
    paginar<SimulacaoNome>((de, ate) => db.from('v_simulacao_nome').select('*').eq('simulacao_id', simulacaoId).order('nome_bruto').order('periodo').range(de, ate)),
    paginar<UnidadeEntrada>((de, ate) => db.from('v_unidade_resumo').select('id, empresa, pasta, grupo, modelo_cobranca, situacao').order('id').range(de, ate)),
    paginar<RegrasUnidade>((de, ate) => db.from('unidade').select('id, janela, criterio_data, franquia_mensal').order('id').range(de, ate)),
    paginar<{ chave: string; valor: string }>((de, ate) => db.from('config').select('chave, valor').order('chave').range(de, ate)),
    paginar<{ nome_bruto: string; motivo: string }>((de, ate) => db.from('nome_ignorado').select('nome_bruto, motivo').order('nome_bruto').range(de, ate)),
  ])
  const regraPorId = new Map(regras.map(r => [r.id, r]))
  const unidades = unidadesBase.map(u => ({ ...u, ...(regraPorId.get(u.id) ? { janela: regraPorId.get(u.id)!.janela, criterio_data: regraPorId.get(u.id)!.criterio_data, franquia_mensal: regraPorId.get(u.id)!.franquia_mensal } : {}) }))
  // grupo da Mobilemed e hospital de cada nome → as abas "Por unidade" saem divididas igual aos relatórios por unidade
  const info = await carregarInfoAlias()
  const empresaDe = new Map(nomes.map(n => [n.nome_bruto, n.empresa]))
  const todosNomes = new Set([...nomes.map(n => n.nome_bruto), ...pendencias.map(p => p.nome_bruto).filter((x): x is string => !!x)])
  const gruposDosNomes = Object.fromEntries([...todosNomes].map(nome => {
    const ia = info.get(normNome(nome))
    return [nome, { grupo: grupoDoNome(nome, ia?.grupo, empresaDe.get(nome) ?? null), subunidade: ia?.subunidade ?? null }]
  }))
  const agg = agregar({ simulacao, resumo, unidades, pendencias, nomes, gruposDosNomes })
  const competencia = simulacao.competencia.slice(0, 7)
  const bytes = await gerarConsolidado(agg, {
    competencia, arquivoNome: simulacao.arquivo_nome, geradoEm: new Date(),
    config: Object.fromEntries(config.map(c => [c.chave, c.valor])), ignorados,
  })
  return { bytes, nome: nomeArquivoConsolidado(competencia) }
}

/** Monta o Excel consolidado e baixa no navegador. */
export async function baixarConsolidado(simulacaoId: string): Promise<void> {
  const { bytes, nome } = await montarConsolidado(simulacaoId)
  baixarArquivo(new Blob([bytes as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), nome)
}
