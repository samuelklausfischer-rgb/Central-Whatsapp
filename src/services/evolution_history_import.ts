import supabase from '@/lib/supabase/client'

export const FINANCEIRO_MEDIMAGEM_INSTANCE = 'Financeiro Medimagem'

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
    const ctx = (error as any).context
    let ctxData: any = typeof ctx === 'object' && ctx ? ctx : {}
    if (ctx && typeof ctx.clone === 'function') {
      ctxData = await ctx.clone().json().catch(() => ctxData)
    }
    const message = (ctxData as any).error || error.message
    const details = (ctxData as any).details
    const job = (ctxData as any).job || null
    throw new EvolutionHistoryImportError(message, details, job)
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
