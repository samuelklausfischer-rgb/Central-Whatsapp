export interface UnidadeResumo {
  id: string; empresa: 'PRN' | 'MEDIMAGEM'; pasta: string; grupo: string | null; orgao: string | null
  numero_contrato: string | null; objeto: string | null; vigencia_inicio: string | null; vigencia_fim: string | null
  valor_total: number | null; modelo_cobranca: string; situacao: string; motivo_situacao: string | null
  situacao_manual: boolean; confianca: string | null; sharepoint_url: string | null; observacoes: string[]
  n_itens: number; n_eventos: number; n_pendencias: number; n_aliases: number
  ultimo_evento: { numero: string | null; tipo: string; data: string } | null
}
// Regras de faturamento da unidade (colunas novas da fase 2 — lidas da tabela `unidade`,
// porque a view v_unidade_resumo congela as colunas no momento em que foi criada)
export type { Janela } from '../nucleo/motor'
import type { Janela } from '../nucleo/motor'
export type CriterioData = 'laudo' | 'exame' | null
export interface RegrasUnidade {
  id: string; janela: Janela; criterio_data: CriterioData; franquia_mensal: number | null; todos_status: boolean; estudos_conta_2: string | null
}
export type PapelItem = 'normal' | 'urgencia' | 'fixo' | 'excedente'
// linha da RPC precos_vigentes(p_data): preço vigente de TODAS as unidades
export interface PrecoVigente {
  unidade_id: string; item_preco_id: string; exame: string; modalidade: string | null; papel: PapelItem
  valor_original: number | null; valor: number | null; vigente_desde: string | null
}
export interface ItemVigente {
  item_preco_id: string; subunidade: string | null; exame: string; modalidade: string | null; codigo: string | null
  valor_original: number | null; valor: number | null; vigente_desde: string | null; definido_por: string | null
}
export interface Evento {
  id: string; unidade_id: string; ordem: number; tipo: string; numero: string | null
  data_assinatura: string | null; data_efeito: string | null; data_referencia: string | null; qualidade_data: string
  objeto: string | null; indice: string | null; percentual: number | null; fonte_doc: string | null
  evento_valor: { valor: number; item_preco: { exame: string } | null }[]
}
export interface Pendencia {
  id: string; unidade_id: string | null; tipo: string; detalhe: string; resolvida: boolean
  resolvida_em: string | null; nota: string | null; unidade?: { pasta: string; empresa: string } | null
}
export interface Alias {
  id: string; nome_bruto: string; unidade_id: string; subunidade: string | null; incerto: boolean; principal: boolean
  grupo: string | null // um dos 4 grupos da Mobilemed (null = automático)
  unidade?: { pasta: string; empresa: string } | null
}

// ── Simulação de fatura (fase 2) ─────────────────────────────────────────────
export interface Simulacao {
  id: string; competencia: string; arquivo_nome: string | null; status: 'processando' | 'concluida' | 'erro'
  erro: string | null; total_nomes: number | null; nomes_feitos: number; total_exames: number | null
  total_valor: number | null; criada_em: string
}
// linha da view v_simulacao_nome (um registro por nome do Bruto × período)
export interface SimulacaoNome {
  simulacao_id: string; nome_bruto: string; unidade_id: string | null; periodo: string
  pasta: string | null; empresa: 'PRN' | 'MEDIMAGEM' | null; modelo_cobranca: string | null; situacao: string | null
  qtd_exames: number | null; total: number | null; n_pendencias: number
}
export interface SimulacaoPendencia {
  id: number; simulacao_id: string; nome_bruto: string | null; unidade_id: string | null
  tipo: string; detalhe: string; qtd_exames: number | null
}
// resposta da Edge Function fat-simular (um nome do Bruto)
export interface RespostaSimular {
  build: string; nome_bruto?: string; unidade?: string | null; faturados?: number
  fora_do_periodo?: number; total?: number; pendencias?: string[]; erro?: string
}
