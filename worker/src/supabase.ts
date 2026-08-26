import { createClient } from '@supabase/supabase-js'
import { ErroDeEnvio } from './envio'

/**
 * A conversa do worker com o banco.
 *
 * Usa `service_role`, e por isso ignora RLS — é o único jeito de um processo sem
 * usuário logado consumir a fila. Todo o resto das regras (quem pode disparar,
 * qual aparelho) já foi decidido quando a campanha foi criada pela tela.
 */

const url = process.env.SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!url || !key) {
  throw new Error('SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórios')
}

export const supabase = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
})

export interface AlvoParaEnviar {
  alvo_id: string
  campaign_id: string
  device_id: string
  remote_sender: string
  nome_exibicao: string | null
  mensagem: string
  anexos: { url?: string; type?: string; name?: string }[] | null
  delay_min_ms: number
  delay_max_ms: number
  jitter_pct: number
  pausa_a_cada: number
  pausa_longa_ms: number
  created_by: string | null
  /** Campanha de ensaio: percorre a fila sem chamar a Evolution. */
  ensaio: boolean
}

/**
 * Pega o próximo alvo da fila.
 *
 * O `for update skip locked` mora na RPC, não aqui: é o banco que garante que duas
 * réplicas nunca peguem o mesmo alvo, e essa garantia não pode depender de o
 * cliente se comportar.
 */
export async function proximoAlvo(workerId: string): Promise<AlvoParaEnviar | null> {
  const { data, error } = await supabase.rpc('disparo_proximo_alvo', {
    p_worker_id: workerId,
    p_lease_minutos: 5,
  })
  if (error) throw new Error(`disparo_proximo_alvo: ${error.message}`)
  return ((data as AlvoParaEnviar[]) ?? [])[0] ?? null
}

export async function concluirAlvo(
  alvoId: string,
  sucesso: boolean,
  messageId?: string | null,
  erro?: string | null,
  simulado = false,
): Promise<void> {
  const { error } = await supabase.rpc('disparo_concluir_alvo', {
    p_alvo_id: alvoId,
    p_sucesso: sucesso,
    p_message_id: messageId ?? null,
    p_erro: erro ?? null,
    p_simulado: simulado,
  })
  if (error) throw new Error(`disparo_concluir_alvo: ${error.message}`)
}

/**
 * Publica QUANDO este alvo vai ser enviado.
 *
 * O worker sorteia o intervalo e, antes de dormir, grava aqui o horário que ele
 * mesmo vai esperar. Sem isso o número fica preso na memória do processo e a tela
 * não tem como contar — era essa a lacuna que o player veio resolver.
 */
export async function marcarPrevisao(alvoId: string, previstoPara: Date): Promise<void> {
  const { error } = await supabase.rpc('disparo_marcar_previsao', {
    p_alvo_id: alvoId,
    p_previsto_para: previstoPara.toISOString(),
  })
  if (error) throw new Error(`disparo_marcar_previsao: ${error.message}`)
}

/** Devolve o alvo para a fila sem contar como falha (ex.: fora da janela). */
export async function devolverAlvo(alvoId: string): Promise<void> {
  const { error } = await supabase
    .from('disparo_alvos')
    .update({ status: 'pendente', locked_by: null, locked_at: null })
    .eq('id', alvoId)
  if (error) throw new Error(`devolver alvo: ${error.message}`)
}

export async function adquirirLease(
  workerId: string,
  workerName: string,
  segundos: number,
  detalhes: Record<string, unknown>,
): Promise<boolean> {
  const { data, error } = await supabase.rpc('disparo_adquirir_lease', {
    p_worker_id: workerId,
    p_worker_name: workerName,
    p_segundos: segundos,
    p_detalhes: detalhes,
  })
  if (error) throw new Error(`disparo_adquirir_lease: ${error.message}`)
  return data === true
}

export async function soltarLease(workerId: string): Promise<void> {
  await supabase.rpc('disparo_soltar_lease', { p_worker_id: workerId })
}

/**
 * Envia pela MESMA RPC que o chat usa.
 *
 * Este é o ponto mais importante do worker inteiro. O `prn-vigilante` falava
 * direto com a Evolution; aqui não dá, porque quem grava a mensagem em `messages`
 * — e portanto quem a faz aparecer na conversa — é a `send_whatsapp_message`. Um
 * cliente Evolution separado mandaria mensagem que o atendente não conseguiria
 * ler, e ele veria o cliente respondendo a algo invisível.
 *
 * `p_sender_id` é quem criou a campanha: o disparo sai assinado por essa pessoa,
 * como se ela tivesse mandado.
 *
 * Efeito colateral bem-vindo: o gatilho `atribuir_conversa_ao_responder` só age
 * quando `auth.uid() = sender_id`, e aqui não há JWT. Ou seja, um disparo de 500
 * contatos NÃO joga 500 conversas na fila de quem criou a campanha.
 */
export async function enviarMensagem(alvo: AlvoParaEnviar, texto: string): Promise<string | null> {
  const anexo = alvo.anexos?.[0]
  const { data, error } = await supabase.rpc('send_whatsapp_message', {
    p_device_id: alvo.device_id,
    p_remote_sender: alvo.remote_sender,
    p_content: texto,
    p_sender_id: alvo.created_by,
    p_media_url: anexo?.url ?? null,
    p_media_type: anexo?.type ?? null,
    p_media_name: anexo?.name ?? null,
  })
  // Erro de transporte (rede, timeout do PostgREST). Sem status HTTP da Evolution:
  // `classificarErro` decide pelo texto.
  if (error) throw new ErroDeEnvio(error.message)

  // A RPC devolve `{ error, status, body }` em vez de lançar quando a Evolution
  // recusa. Sem esta checagem, uma recusa seria contada como envio feito e o
  // contato nunca receberia nada.
  //
  // O `status` é preservado no erro, e não concatenado no texto como antes: é ele
  // que separa um 429 (repetir vale a pena) de um 400 (repetir só perde tempo).
  const json = data as { error?: string; status?: number; body?: string; message?: { id?: string } }
  if (json?.error) {
    throw new ErroDeEnvio(
      `${json.error}${json.body ? ` | ${json.body}` : ''}`.slice(0, 900),
      json.status,
    )
  }
  return json?.message?.id ?? null
}

/**
 * Mostra "digitando..." para o contato.
 *
 * Volta na hora: a duração de fato quem controla é o worker, esperando do lado
 * dele. Ver o comentário de `disparo_presenca` no banco — mandar `delay` faria a
 * Evolution segurar a conexão e bater no `statement_timeout` de 8 s.
 */
export async function mostrarDigitando(alvo: AlvoParaEnviar): Promise<void> {
  const { error } = await supabase.rpc('disparo_presenca', {
    p_device_id: alvo.device_id,
    p_remote_sender: alvo.remote_sender,
    p_presence: 'composing',
  })
  if (error) throw new Error(error.message)
}

/**
 * A mensagem já saiu nos últimos segundos?
 *
 * É a guarda que permite repetir um timeout sem mandar duas vezes. Ver
 * `disparo_ja_saiu` no banco e `enviarComRetentativa` em `envio.ts`.
 */
export async function jaSaiu(alvo: AlvoParaEnviar, texto: string): Promise<string | null> {
  const { data, error } = await supabase.rpc('disparo_ja_saiu', {
    p_device_id: alvo.device_id,
    p_remote_sender: alvo.remote_sender,
    p_content: texto,
    p_segundos: 120,
  })
  // Lança de propósito, e o efeito é PARAR de repetir: o erro sobe por
  // `enviarComRetentativa` e o alvo termina como `falhou`, com o motivo gravado.
  //
  // É o lado certo para errar. Sem conseguir confirmar se a mensagem saiu,
  // insistir poderia mandá-la duas vezes para o cliente; desistir deixa no máximo
  // um contato sem receber, visível na tela e reenviável. Mensagem a menos se
  // conserta, mensagem repetida não.
  if (error) throw new Error(`disparo_ja_saiu: ${error.message}`)
  return (data as string | null) ?? null
}
