import supabase from '@/lib/supabase/client'

/**
 * Controle de mensagens: quanto o time demora para responder.
 *
 * Chamadas finas sobre RPCs — a conta é toda do banco, de propósito. Média,
 * mediana e contagem de estouro em SQL evitam trazer milhares de linhas para o
 * navegador só para somar, e mantêm o número da tela igual ao número que
 * qualquer consulta manual devolve.
 *
 * Essa regra estava escrita aqui e mesmo assim foi furada: os quatro cartões da
 * tela eram somados no navegador sobre as 200 linhas mais recentes, então "média
 * do período" em 30 dias era a média de 200 registros. `getResumo` existe para
 * não haver mais nenhuma métrica calculada fora do banco.
 *
 * ── CORRIDO vs INTEGRAL ──────────────────────────────────────────────────────
 * Todo tempo vem em duas versões. **Corrido** é o relógio de parede. **Integral**
 * conta só os segundos que caíram entre 07:00 e 23:59 (`segundos_uteis` no banco),
 * porque a média era sequestrada por esperas que atravessam a madrugada: mensagem
 * das 22 h respondida às 8 h marcava 10 h de demora para um time que não estava
 * trabalhando. São 8 registros em 227, e derrubavam a média de 2.544 s para
 * 1.655 s quando descontados.
 *
 * ── O RECORTE É POR MENSAGEM RECEBIDA ────────────────────────────────────────
 * Todas perguntam "das mensagens que CHEGARAM no período, como foram atendidas?".
 * Antes os cartões filtravam por `inbound_at` e as tabelas por `responded_at`, e
 * por isso números da mesma tela não fechavam. A fila viva (`abertas`,
 * `getFila`, `getPendencias({apenasAbertas})`) é a exceção declarada: ignora
 * período, porque quem espera desde ontem ainda espera hoje.
 *
 * Todas filtram por `can_access_device` no servidor: quem não tem o aparelho não
 * recebe a linha, mesmo chamando a RPC direto.
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
  p90_corrido: number | null
  media_integral: number | null
  p50_integral: number | null
  pior_corrido: number | null
}

export interface MetricaPorContato {
  device_id: string
  remote_sender: string
  contato: string
  respondidas: number
  media_segundos: number | null
  estouros_5min: number
  pior_segundos: number | null
  p50_corrido: number | null
  p90_corrido: number | null
  media_integral: number | null
  p50_integral: number | null
  /** Pendências deste contato ainda sem resposta — "quem foi esquecido". */
  abertas: number
}

/** Uma linha só: é ela que manda nos cartões do topo. */
export interface ResumoDoAtendimento {
  recebidas: number
  respondidas: number
  /** Fila viva. IGNORA o período — ver o cabeçalho deste arquivo. */
  abertas: number
  media_corrido: number | null
  p50_corrido: number | null
  p90_corrido: number | null
  p95_corrido: number | null
  media_integral: number | null
  p50_integral: number | null
  p90_integral: number | null
  p95_integral: number | null
  estouros_5min: number
  /** Respostas enviadas pelo celular, sem passar pelo app. */
  fora_do_app: number
  pct_fora_do_app: number | null
  /** Quando o motor começou a gravar. Serve para a tela não fingir ter histórico. */
  medindo_desde: string | null
}

export interface MetricaPorSetor {
  setor: string
  respondidas: number
  media_corrido: number | null
  p50_corrido: number | null
  p90_corrido: number | null
  media_integral: number | null
  p50_integral: number | null
  estouros_5min: number
  pior_corrido: number | null
}

export interface PontoDaSerie {
  /** Hora do dia (0-23) ou dia da semana (0=domingo). Formatar é da tela. */
  balde: number
  recebidas: number
  respondidas: number
  p50_corrido: number | null
  p50_integral: number | null
  estouros_5min: number
}

export interface FaixaDaFila {
  faixa: string
  ordem: number
  n: number
  contatos: number
}

interface Janela {
  desde: string
  ate: string
  deviceId?: string | null
}

/**
 * O resumo do topo, numa consulta só.
 *
 * `setor` recorta apenas o que foi RESPONDIDO — pendência aberta não tem autor,
 * logo não tem setor. Por isso `abertas` continua sendo a fila inteira mesmo com
 * setor escolhido, e a tela precisa dizer isso ao lado do número.
 */
export async function getResumo({
  desde,
  ate,
  deviceId,
  setor,
}: Janela & { setor?: string | null }): Promise<ResumoDoAtendimento | null> {
  const { data, error } = await supabase.rpc('get_controle_resumo', {
    p_desde: desde,
    p_ate: ate,
    p_device_id: deviceId ?? null,
    p_setor: setor ?? null,
  })
  if (error) throw new Error(error.message)
  return ((data as ResumoDoAtendimento[]) || [])[0] ?? null
}

export async function getMetricasPorSetor({ desde, ate, deviceId }: Janela): Promise<MetricaPorSetor[]> {
  const { data, error } = await supabase.rpc('get_controle_por_setor', {
    p_desde: desde,
    p_ate: ate,
    p_device_id: deviceId ?? null,
  })
  if (error) throw new Error(error.message)
  return (data as MetricaPorSetor[]) || []
}

export async function getSerie({
  desde,
  ate,
  deviceId,
  granularidade,
}: Janela & { granularidade: 'hora' | 'dia_semana' }): Promise<PontoDaSerie[]> {
  const { data, error } = await supabase.rpc('get_controle_serie', {
    p_desde: desde,
    p_ate: ate,
    p_device_id: deviceId ?? null,
    p_granularidade: granularidade,
  })
  if (error) throw new Error(error.message)
  return (data as PontoDaSerie[]) || []
}

/**
 * Os setores que existem, para alimentar o filtro.
 *
 * Consulta direta em vez de reusar `listarSetores` de `services/setores.ts`: aquele
 * arquivo é da área de Emails e ainda não está commitado, e importá-lo faria esta
 * tela quebrar o build de quem fizesse checkout deste commit sozinho. Quando ele
 * entrar no repositório, vale trocar por ele e apagar isto.
 *
 * A regra que ele documenta continua valendo aqui, e é o motivo de não existir
 * tabela de setores: um setor EXISTE enquanto alguém estiver nele.
 */
export async function listarSetoresDisponiveis(): Promise<string[]> {
  const { data, error } = await supabase
    .from('user_sectors')
    .select('setor')
    .order('setor', { ascending: true })
  if (error) throw new Error(error.message)
  return [...new Set((data ?? []).map((l) => l.setor as string))]
}

/** Fila viva por faixa de idade. Sem período, de propósito. */
export async function getFila(deviceId?: string | null): Promise<FaixaDaFila[]> {
  const { data, error } = await supabase.rpc('get_controle_fila', {
    p_device_id: deviceId ?? null,
  })
  if (error) throw new Error(error.message)
  return (data as FaixaDaFila[]) || []
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
