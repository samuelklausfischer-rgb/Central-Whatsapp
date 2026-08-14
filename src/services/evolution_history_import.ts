import supabase from '@/lib/supabase/client'

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
    const resposta: Response | null = ctx && typeof ctx.clone === 'function' ? (ctx as Response) : null

    // Lê o corpo UMA vez como texto e só então tenta interpretar. Antes era
    // `.json()` direto: quando a resposta não era JSON, a chamada falhava e o
    // corpo real se perdia — o usuário via só "Edge Function returned a non-2xx
    // status code", que não diz nada sobre o que aconteceu.
    let corpo: any = {}
    let textoCru = ''
    if (resposta) {
      textoCru = await resposta.clone().text().catch(() => '')
      try {
        corpo = textoCru ? JSON.parse(textoCru) : {}
      } catch {
        corpo = {}
      }
    }

    // Sem campo `error` no corpo, quem respondeu NÃO foi a função — toda saída
    // de erro dela carrega esse campo. Sobra worker morto (memória/CPU), gateway
    // ou proxy. Mostrar o status e um trecho cru é o que separa esses casos de
    // "sessão expirada" sem precisar abrir log de container.
    const status = resposta?.status
    const message: string =
      corpo.error ||
      (status
        ? `HTTP ${status}${textoCru ? ` — ${textoCru.slice(0, 200)}` : ' (resposta sem corpo — função não respondeu)'}`
        : error.message)

    throw new EvolutionHistoryImportError(message, corpo.details, corpo.job ?? null)
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
