import { supabase } from '@/lib/supabase/client'
import type { Email, EmailFilters } from '@/lib/supabase/email-types'
import { appEnv } from '@/lib/env'

/**
 * Colunas da LISTA — de propósito sem `body_html` e `body_text`.
 *
 * NÃO trocar por `select('*')`. Duas razões:
 *
 * 1. **Peso.** O corpo médio é 6,7 KB; cem mensagens são ~670 KB baixados a cada
 *    troca de pasta, para montar uma lista que só mostra `body_preview` (28 KB
 *    no total das cem). Era 24× mais dado do que o necessário.
 *
 * 2. **O corpo sumia depois do primeiro clique.** Corpo grande fica no TOAST, e
 *    o Postgres NÃO reenvia coluna grande que não mudou num UPDATE. Marcar como
 *    lido disparava um evento de Realtime com `body_html: null`, que substituía
 *    o objeto bom por um sem corpo e a tela escrevia "(sem conteúdo)". Com o
 *    corpo fora da lista, quem manda nele é sempre `getEmail(id)`.
 */
const COLUNAS_DA_LISTA = [
  'id', 'account_id', 'folder_id', 'message_id', 'imap_uid', 'thread_id',
  'in_reply_to', 'references_ids', 'direction', 'from_email', 'from_name',
  'to_emails', 'cc_emails', 'bcc_emails', 'reply_to_email', 'subject',
  'attachments', 'is_read', 'is_starred', 'is_archived',
  'ai_category', 'ai_sentiment', 'ai_summary', 'ai_processed',
  'contact_id', 'received_at', 'created_at',
  'graph_id', 'internet_message_id', 'conversation_id', 'has_attachments',
  'importance', 'is_draft', 'web_link', 'body_preview',
].join(',')

/**
 * Converte o resultado da lista para `Email[]`.
 *
 * A conversão é necessária porque `COLUNAS_DA_LISTA` é montada em tempo de
 * execução, e o cliente do Supabase só infere tipo a partir de um texto
 * literal — sem isso ele devolve `GenericStringError[]`.
 *
 * O que a conversão NÃO faz é mentir sobre o conteúdo: estas linhas realmente
 * chegam com `body_html` e `body_text` nulos, e os dois campos já são
 * `string | null` no tipo. Quem precisa do corpo usa `getEmail(id)`.
 */
function semCorpo(data: unknown): Email[] {
  return (data ?? []) as Email[]
}

export async function getEmails(
  account_id: string,
  filters: EmailFilters = {},
  limit = 100
): Promise<Email[]> {
  let query = supabase
    .from('emails')
    .select(COLUNAS_DA_LISTA)
    .eq('account_id', account_id)
    .eq('is_archived', filters.is_archived ?? false)
    .order('received_at', { ascending: false })
    .limit(limit)

  if (filters.folder_id !== undefined) {
    if (filters.folder_id === null) {
      query = query.is('folder_id', null)
    } else {
      query = query.eq('folder_id', filters.folder_id)
    }
  }

  if (filters.is_read !== undefined) {
    query = query.eq('is_read', filters.is_read)
  }

  if (filters.is_starred) {
    query = query.eq('is_starred', true)
  }

  if (filters.ai_sentiment) {
    query = query.eq('ai_sentiment', filters.ai_sentiment)
  }

  const { data, error } = await query
  if (error) throw error
  return semCorpo(data)
}

export async function searchEmails(
  account_id: string,
  search: string,
  limit = 50
): Promise<Email[]> {
  const q = search.replace(/[%_]/g, '\\$&')
  const { data, error } = await supabase
    .from('emails')
    // Mesmas colunas da lista: a busca devolve linhas para a MESMA lista, e
    // trazer o corpo aqui teria o mesmo custo e o mesmo defeito.
    // O `body_text` continua no filtro — procurar dentro do texto é o ponto da
    // busca; o que não volta é o conteúdo em si.
    .select(COLUNAS_DA_LISTA)
    .eq('account_id', account_id)
    .or(`subject.ilike.%${q}%,from_name.ilike.%${q}%,from_email.ilike.%${q}%,body_text.ilike.%${q}%`)
    .order('received_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return semCorpo(data)
}

/**
 * Uma mensagem COMPLETA, com o corpo.
 *
 * Aqui o `select('*')` é obrigatório e não é descuido: esta é a única porta por
 * onde o corpo entra na tela. A lista não o traz mais (ver `COLUNAS_DA_LISTA`).
 */
export async function getEmail(id: string): Promise<Email | null> {
  const { data, error } = await supabase
    .from('emails')
    .select('*')
    .eq('id', id)
    .maybeSingle()
  if (error) throw error
  return data
}

export async function getThreadEmails(thread_id: string): Promise<Email[]> {
  const { data, error } = await supabase
    .from('emails')
    .select('*')
    .eq('thread_id', thread_id)
    .order('received_at', { ascending: true })
  if (error) throw error
  return data ?? []
}

/**
 * Chama uma rota da edge function `email-microsoft`.
 *
 * Envio e marcação passam por lá desde 08/09/2026 porque é onde moram o token da
 * Microsoft e a checagem de acesso à caixa. O navegador nunca vê o token.
 */
async function chamarEmailMicrosoft(
  rota: 'enviar' | 'marcar',
  corpo: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('Sessão expirada. Entre no app de novo.')

  const resp = await fetch(`${appEnv.VITE_SUPABASE_URL}/functions/v1/email-microsoft/${rota}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify(corpo),
  })
  const resultado = await resp.json().catch(() => ({}))
  if (!resp.ok) throw new Error(String(resultado.error || 'A Microsoft não respondeu.'))
  return resultado
}

/**
 * Marcar como lido, DE VERDADE.
 *
 * Antes isto era um `update` direto na tabela, e não durava: a varredura delta
 * seguinte trazia o valor do Outlook por cima. A pessoa lia trinta e-mails e a
 * caixa voltava a dizer trinta. Agora o `PATCH` vai primeiro para a Microsoft —
 * e é por isso que o contador da pasta finalmente baixa, já que ele é o número
 * dela, não o nosso.
 */
export async function markEmailRead(id: string, is_read: boolean): Promise<void> {
  await chamarEmailMicrosoft('marcar', { email_id: id, is_read })
}

export async function markEmailStarred(id: string, is_starred: boolean): Promise<void> {
  await chamarEmailMicrosoft('marcar', { email_id: id, is_starred })
}

export async function archiveEmail(id: string): Promise<void> {
  const { error } = await supabase
    .from('emails')
    .update({ is_archived: true })
    .eq('id', id)
  if (error) throw error
}

/**
 * Resultado de uma operação em lote: quantos deram certo e, de cada falha,
 * o id e o motivo.
 *
 * Não é `throw` na primeira falha de propósito — ver `marcarEmailsEmLote`.
 */
export interface ResultadoLote {
  ok: number
  falhas: { id: string; motivo: string }[]
}

/** Máximo de chamadas simultâneas do fan-out abaixo. */
const CONCORRENCIA_MAXIMA_LOTE = 6

/**
 * Marca (lido/estrela) uma lista de e-mails, um por um.
 *
 * NÃO existe uma rota de "marcar em massa": `email-microsoft/marcar` (a mesma
 * que `markEmailRead`/`markEmailStarred` chamam) só aceita um `email_id` por
 * requisição, porque é ela quem fala com o Graph da Microsoft, e o Graph
 * marca mensagem por mensagem. Selecionar 40 e-mails e apertar "marcar como
 * lido" vira 40 chamadas — daí "em lote" aqui significa fan-out, não uma
 * única requisição com uma lista de ids.
 *
 * A concorrência é limitada a `CONCORRENCIA_MAXIMA_LOTE` (um pool simples de
 * workers, não `Promise.all` direto) para não disparar dezenas de requisições
 * ao mesmo tempo contra a mesma caixa — o Graph tem limite de taxa por conta,
 * e a edge function é a mesma para todo mundo.
 *
 * Nunca lança exceção por causa de UM e-mail que falhou: se lançasse, uma
 * falha no meio (rede, token expirado, mensagem apagada no Outlook) perderia
 * o resultado de todas as outras que já tinham dado certo. Em vez disso cada
 * falha é coletada, e quem chamou decide como avisar — inclusive avisar que
 * foi "38 de 40", nunca "pronto" quando sobrou gente de fora.
 */
export async function marcarEmailsEmLote(
  ids: string[],
  mudanca: { is_read?: boolean; is_starred?: boolean },
  aoProgredir?: (feitos: number, total: number) => void,
): Promise<ResultadoLote> {
  const falhas: ResultadoLote['falhas'] = []
  let ok = 0
  let feitos = 0
  let proximoIndice = 0

  async function processarFila(): Promise<void> {
    while (proximoIndice < ids.length) {
      const indice = proximoIndice++
      const id = ids[indice]
      try {
        await chamarEmailMicrosoft('marcar', { email_id: id, ...mudanca })
        ok++
      } catch (err) {
        falhas.push({ id, motivo: err instanceof Error ? err.message : 'Falha desconhecida' })
      } finally {
        feitos++
        aoProgredir?.(feitos, ids.length)
      }
    }
  }

  const trabalhadores = Array.from(
    { length: Math.min(CONCORRENCIA_MAXIMA_LOTE, ids.length) },
    () => processarFila(),
  )
  await Promise.all(trabalhadores)

  return { ok, falhas }
}

/**
 * Arquiva vários e-mails de uma vez.
 *
 * Diferente de `marcarEmailsEmLote`, isto é uma chamada só: `archiveEmail`
 * já é um `update` direto na nossa tabela (não fala com a Microsoft — ver o
 * comentário de `archiveEmail`), e um `update` aceita `.in('id', ids)` sem
 * precisar de fan-out nenhum.
 */
export async function arquivarEmailsEmLote(ids: string[]): Promise<void> {
  if (ids.length === 0) return
  const { error } = await supabase
    .from('emails')
    .update({ is_archived: true })
    .in('id', ids)
  if (error) throw error
}

export async function moveEmailToFolder(id: string, folder_id: string | null): Promise<void> {
  const { error } = await supabase
    .from('emails')
    .update({ folder_id })
    .eq('id', id)
  if (error) throw error
}

export async function getUnreadCount(account_id: string): Promise<number> {
  const { count, error } = await supabase
    .from('emails')
    .select('id', { count: 'exact', head: true })
    .eq('account_id', account_id)
    .eq('is_read', false)
    .eq('is_archived', false)
  if (error) throw error
  return count ?? 0
}

/** Um anexo já lido do disco, pronto para viajar. */
export interface AnexoParaEnviar {
  nome: string
  tipo: string
  /** Conteúdo em base64, SEM o prefixo `data:`. */
  base64: string
}

export type ModoDeEnvio = 'novo' | 'responder' | 'responder_todos' | 'encaminhar'

/**
 * Envia um e-mail pela caixa da Microsoft.
 *
 * Trocou a edge function `email-send` em 08/09/2026. Aquela usava SMTP e recusava
 * toda conta sem `smtp_host` — que é TODA conta, porque o OAuth da Microsoft não
 * preenche esse campo. Na prática o botão Enviar nunca funcionou uma vez.
 *
 * `modo` decide a chamada do lado de lá, e a escolha não é cosmética:
 *  - `responder` / `responder_todos` mantêm a conversa costurada pelo Outlook,
 *    sem precisarmos montar `In-Reply-To`/`References` na mão;
 *  - `responder_todos` acerta os destinatários incluindo quem estava em cópia,
 *    que a versão antiga simplesmente descartava;
 *  - `encaminhar` leva os anexos do original junto — antes eles se perdiam.
 *
 * Não devolve o e-mail enviado: o Graph responde 202 sem corpo. A cópia aparece
 * sozinha em Itens Enviados e chega aqui pelo aviso em tempo real.
 */
export async function sendEmail(payload: {
  account_id: string
  modo?: ModoDeEnvio
  to?: string[]
  cc?: string[]
  bcc?: string[]
  subject?: string
  body_html: string
  reply_to_email_id?: string
  anexos?: AnexoParaEnviar[]
}): Promise<void> {
  await chamarEmailMicrosoft('enviar', { modo: 'novo', ...payload })
}
