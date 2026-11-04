import supabase from '@/lib/supabase/client'
import { interpretarErroDeFuncao } from '@/lib/friendly-error'

export const FINANCEIRO_MEDIMAGEM_INSTANCE = 'Financeiro Medimagem'
export const FINANCEIRO_PRN_INSTANCE = 'Financeiro PRN'
export const WHATSAPP_ADM_INSTANCE = 'WhatsApp Adm'
export const ALLOWED_HISTORY_INSTANCES = [
  FINANCEIRO_MEDIMAGEM_INSTANCE,
  FINANCEIRO_PRN_INSTANCE,
  WHATSAPP_ADM_INSTANCE,
]

export type HistoryImportStatus = 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled'

export interface EvolutionHistoryImportJob {
  id: string
  instance_name: string
  device_id: string
  status: HistoryImportStatus
  total_messages: number
  total_pages: number
  target_pages: number
  current_page: number
  page_size: number
  media_mode: 'metadata_only' | 'hybrid'
  recent_media_days: number
  inserted_count: number
  skipped_count: number
  failed_count: number
  error_message: string | null
  started_by: string | null
  started_at: string | null
  finished_at: string | null
  created_at: string
  updated_at: string
  /** Período do buscador (ISO). Nulos nos jobs antigos, por páginas. */
  range_from?: string | null
  range_to?: string | null
}

/** Resultado do "Verificar" do buscador de mensagens. */
export interface BuscaPorPeriodoPreview {
  instanceName: string
  deviceId: string
  from: string
  to: string
  totalEvolution: number
  totalLocal: number
  /** Estimativa: a conta exata só sai na sincronização. */
  estimatedMissing: number
  activeJob: EvolutionHistoryImportJob | null
}

export interface EvolutionHistoryPreview {
  instanceName: string
  deviceId: string
  pageSize: number
  totalEvolution: number
  totalPages: number
  totalLocal: number
  estimatedMissing: number
  latestJob: EvolutionHistoryImportJob | null
}

export class EvolutionHistoryImportError extends Error {
  details: unknown
  job: EvolutionHistoryImportJob | null

  constructor(message: string, details?: unknown, job?: EvolutionHistoryImportJob | null) {
    super(message)
    this.name = 'EvolutionHistoryImportError'
    this.details = details
    this.job = job ?? null
  }
}

const invoke = async <T>(body: Record<string, unknown>): Promise<T> => {
  const { data, error } = await supabase.functions.invoke<T>('evolution-history-import', {
    method: 'POST',
    body,
  })

  if (error) {
    // Mesma leitura usada por todos os serviços que chamam edge function: corpo
    // lido como texto e só então interpretado, para não perder a causa quando
    // quem respondeu foi a plataforma e não a função.
    const info = await interpretarErroDeFuncao(error, 'Erro na importação de histórico')
    throw new EvolutionHistoryImportError(info.message, info.corpo.details, info.corpo.job ?? null)
  }

  return data as T
}

export const previewHistoryImport = (instanceName = FINANCEIRO_MEDIMAGEM_INSTANCE) =>
  invoke<EvolutionHistoryPreview>({ action: 'preview', instanceName })

export const startHistoryImport = (params: {
  mode: 'test' | 'last_1000' | 'all'
  instanceName?: string
  recentMediaDays?: number
  pageSize?: number
}) =>
  invoke<{ job: EvolutionHistoryImportJob }>({
    action: 'start',
    instanceName: params.instanceName || FINANCEIRO_MEDIMAGEM_INSTANCE,
    mode: params.mode,
    recentMediaDays: params.recentMediaDays ?? 7,
    pageSize: params.pageSize ?? 50,
  })

/** Quantas mensagens a Evolution e o sistema têm no período (sem gravar nada). */
export const verificarPeriodo = (params: { instanceName: string; from: string; to: string }) =>
  invoke<BuscaPorPeriodoPreview>({ action: 'range_preview', ...params })

/**
 * Cria o job de sincronização do período. `job: null` + `empty: true` quando a
 * Evolution não tem nada no intervalo (nenhum job é criado).
 */
export const iniciarSincronizacaoDoPeriodo = (params: {
  instanceName: string
  from: string
  to: string
  recentMediaDays?: number
}) =>
  invoke<{ job: EvolutionHistoryImportJob | null; empty?: boolean }>({
    action: 'start',
    mode: 'range',
    instanceName: params.instanceName,
    from: params.from,
    to: params.to,
    recentMediaDays: params.recentMediaDays ?? 7,
  })

export const runHistoryImport = (params: {
  jobId?: string
  instanceName?: string
  pagesPerRun?: number
}) =>
  invoke<{
    job: EvolutionHistoryImportJob
    processedPages: number
    inserted: number
    skipped: number
    failed: number
    done: boolean
  }>({
    action: 'run',
    instanceName: params.instanceName || FINANCEIRO_MEDIMAGEM_INSTANCE,
    jobId: params.jobId,
    pagesPerRun: params.pagesPerRun ?? 2,
  })

export const getHistoryImportStatus = (params?: { jobId?: string; instanceName?: string }) =>
  invoke<{ job: EvolutionHistoryImportJob | null }>({
    action: 'status',
    instanceName: params?.instanceName || FINANCEIRO_MEDIMAGEM_INSTANCE,
    jobId: params?.jobId,
  })

export const cancelHistoryImport = (params?: { jobId?: string; instanceName?: string }) =>
  invoke<{ job: EvolutionHistoryImportJob }>({
    action: 'cancel',
    instanceName: params?.instanceName || FINANCEIRO_MEDIMAGEM_INSTANCE,
    jobId: params?.jobId,
  })
