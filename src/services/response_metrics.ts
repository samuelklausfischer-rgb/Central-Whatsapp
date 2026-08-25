import supabase from '@/lib/supabase/client'

/**
 * Controle de mensagens: quanto o time demora para responder.
 *
 * Três chamadas finas sobre RPCs — a conta é toda do banco, de propósito. Média,
 * mediana e contagem de estouro em SQL evitam trazer milhares de linhas para o
 * navegador só para somar, e mantêm o número da tela igual ao número que
 * qualquer consulta manual devolve.
 *
 * As três já filtram por `can_access_device` no servidor: quem não tem o
 * aparelho não recebe a linha, mesmo chamando a RPC direto.
 */

/** Uma pendência de resposta, com nomes já resolvidos pela RPC. */
export interface PendenciaRecente {
  id: string
  device_id: string
  aparelho: string
  remote_sender: string
  contato: string
  inbound_at: string
  responded_at: string | null
  response_seconds: number | null
  respondido_por: string | null
  requires_reply: boolean | null
  classification: string | null
  alerta_2m_at: string | null
  alerta_5m_at: string | null
  alerta_10m_at: string | null
  /** Só vem preenchido nas abertas. Nas fechadas o tempo é `response_seconds`. */
  esperando_segundos: number | null
}

export interface MetricaPorAtendente {
  user_id: string | null
  user_name: string
  respondidas: number
  media_segundos: number | null
  mediana_segundos: number | null
  estouros_5min: number
}

export interface MetricaPorContato {
  device_id: string
  remote_sender: string
  contato: string
  respondidas: number
  media_segundos: number | null
  estouros_5min: number
  pior_segundos: number | null
}

interface Janela {
  desde: string
  ate: string
  deviceId?: string | null
}

export async function getMetricasPorAtendente({
  desde,
  ate,
  deviceId,
}: Janela): Promise<MetricaPorAtendente[]> {
  const { data, error } = await supabase.rpc('get_response_metrics_by_user', {
    p_desde: desde,
    p_ate: ate,
    p_device_id: deviceId ?? null,
  })
  if (error) throw new Error(error.message)
  return (data as MetricaPorAtendente[]) || []
}

export async function getMetricasPorContato({
  desde,
  ate,
  deviceId,
}: Janela): Promise<MetricaPorContato[]> {
  const { data, error } = await supabase.rpc('get_response_metrics_by_contact', {
    p_desde: desde,
    p_ate: ate,
    p_device_id: deviceId ?? null,
    p_limit: 50,
  })
  if (error) throw new Error(error.message)
  return (data as MetricaPorContato[]) || []
}

/**
 * `apenasAbertas` é a fila viva. Quando ligado, a RPC IGNORA o período — mensagem
 * de ontem sem resposta continua esperando hoje, e escondê-la por causa do filtro
 * seria justamente perder o caso mais grave.
 */
export async function getPendencias({
  desde,
  ate,
  deviceId,
  apenasAbertas = false,
  limite = 200,
}: Janela & { apenasAbertas?: boolean; limite?: number }): Promise<PendenciaRecente[]> {
  const { data, error } = await supabase.rpc('get_pendencias_recentes', {
    p_desde: desde,
    p_ate: ate,
    p_device_id: deviceId ?? null,
    p_apenas_abertas: apenasAbertas,
    p_limit: limite,
  })
  if (error) throw new Error(error.message)
  return (data as PendenciaRecente[]) || []
}
