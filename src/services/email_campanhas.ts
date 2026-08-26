import supabase from '@/lib/supabase/client'
import { appEnv } from '@/lib/env'

/**
 * Listas e campanhas de disparo de e-mail.
 *
 * A leitura vai direto ao banco (a RLS já limita a quem pode disparar). O que
 * ENVIA passa pela edge function `email-campanha`, porque o envio precisa do
 * token da Microsoft — que nunca pode existir no navegador.
 */

const BASE = `${appEnv.VITE_SUPABASE_URL}/functions/v1/email-campanha`

export interface EmailLista {
  id: string
  nome: string
  descricao: string | null
  created_at: string
}

export interface MembroDaLista {
  id: string
  list_id: string
  email: string
  nome: string | null
  organizacao: string | null
  /** De onde veio o contato — obrigatório, é o que justifica o envio. */
  origem: string
}

export interface EmailCampanha {
  id: string
  nome: string
  account_id: string
  list_id: string
  canal: 'outlook' | 'esp'
  assunto: string
  corpo_html: string
  corpo_texto: string | null
  responder_para: string | null
  status: 'rascunho' | 'preparada' | 'enviando' | 'pausada' | 'concluida' | 'cancelada'
  delay_min_ms: number
  delay_max_ms: number
  pausa_a_cada: number
  pausa_longa_ms: number
  respeitar_horario: boolean
  hora_inicio: number
  hora_fim: number
  agendado_para: string | null
  iniciado_em: string | null
  concluido_em: string | null
  created_at: string
}

export interface Supressao {
  email: string
  motivo: 'descadastro' | 'bounce' | 'reclamacao' | 'manual'
  detalhe: string | null
  created_at: string
}

async function chamar(rota: string, corpo?: unknown) {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  if (!session?.access_token) throw new Error('Sessão não encontrada. Saia e entre novamente.')

  const resp = await fetch(`${BASE}/${rota}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
    body: corpo ? JSON.stringify(corpo) : undefined,
  })
  const dados = await resp.json().catch(() => ({}))
  if (!resp.ok) throw new Error(dados?.error || `Falha no disparo (${resp.status})`)
  return dados
}

// ——— Listas ———

export async function getListas(): Promise<EmailLista[]> {
  const { data, error } = await supabase
    .from('email_listas')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as EmailLista[]
}

export async function criarLista(nome: string, descricao: string): Promise<EmailLista> {
  const { data: { user } } = await supabase.auth.getUser()
  const { data, error } = await supabase
    .from('email_listas')
    .insert({ nome, descricao: descricao || null, created_by: user?.id })
    .select()
    .single()
  if (error) throw error
  return data as EmailLista
}

export async function getMembros(listId: string): Promise<MembroDaLista[]> {
  const { data, error } = await supabase
    .from('email_lista_membros')
    .select('*')
    .eq('list_id', listId)
    .order('email', { ascending: true })
  if (error) throw error
  return (data ?? []) as MembroDaLista[]
}

/** Uma linha reconhecida da importação. */
export interface LinhaImportada {
  email: string
  nome: string | null
  organizacao: string | null
}

/**
 * Lê texto colado e devolve as linhas válidas e as recusadas.
 *
 * Aceita `email`, `email, nome` e `email, nome, organização`, separados por
 * vírgula, ponto-e-vírgula ou tabulação — que é o que sai de uma planilha
 * copiada. Também aceita a ordem invertida (nome primeiro), decidindo pelo
 * campo que tem `@`: quem monta lista raramente confere a ordem das colunas.
 */
export function lerColagem(texto: string): { validas: LinhaImportada[]; recusadas: string[] } {
  const validas: LinhaImportada[] = []
  const recusadas: string[] = []
  const vistos = new Set<string>()
  const formato = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

  for (const bruta of texto.split(/\r?\n/)) {
    const linha = bruta.trim()
    if (!linha) continue

    const partes = linha.split(/[,;\t]/).map((p) => p.trim().replace(/^["']|["']$/g, ''))
    const iEmail = partes.findIndex((p) => p.includes('@'))
    if (iEmail === -1) {
      recusadas.push(linha)
      continue
    }

    const email = partes[iEmail].toLowerCase()
    if (!formato.test(email)) {
      recusadas.push(linha)
      continue
    }
    // Duplicado dentro da própria colagem: silenciosamente ignorado, não é erro
    // de quem colou — planilha repete linha o tempo todo.
    if (vistos.has(email)) continue
    vistos.add(email)

    const resto = partes.filter((_, i) => i !== iEmail).filter(Boolean)
    validas.push({
      email,
      nome: resto[0] ?? null,
      organizacao: resto[1] ?? null,
    })
  }

  return { validas, recusadas }
}

export async function importarMembros(
  listId: string,
  linhas: LinhaImportada[],
  origem: string,
): Promise<number> {
  if (linhas.length === 0) return 0
  const { error } = await supabase
    .from('email_lista_membros')
    .upsert(
      linhas.map((l) => ({ list_id: listId, ...l, origem })),
      { onConflict: 'list_id,email', ignoreDuplicates: true },
    )
  if (error) throw error
  return linhas.length
}

export async function removerMembro(id: string): Promise<void> {
  const { error } = await supabase.from('email_lista_membros').delete().eq('id', id)
  if (error) throw error
}

// ——— Campanhas ———

export async function getCampanhas(): Promise<EmailCampanha[]> {
  const { data, error } = await supabase
    .from('email_campanhas')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as EmailCampanha[]
}

export async function criarCampanha(
  c: Pick<EmailCampanha, 'nome' | 'account_id' | 'list_id' | 'assunto' | 'corpo_html'> &
    Partial<Pick<EmailCampanha, 'corpo_texto' | 'responder_para'>>,
): Promise<EmailCampanha> {
  const { data: { user } } = await supabase.auth.getUser()
  const { data, error } = await supabase
    .from('email_campanhas')
    .insert({ ...c, created_by: user?.id })
    .select()
    .single()
  if (error) throw error
  return data as EmailCampanha
}

/** Expande a lista em destinatários, já tirando quem está suprimido. */
export async function prepararCampanha(campaignId: string) {
  return (await chamar('preparar', { campaign_id: campaignId })) as {
    preparados: number
    ignorados: number
  }
}

/** Manda só para um endereço. Obrigatório antes de liberar o disparo de verdade. */
export async function enviarTeste(campaignId: string, para: string): Promise<void> {
  await chamar('teste', { campaign_id: campaignId, para })
}

/**
 * Libera o disparo.
 *
 * Não envia nada aqui: só marca a campanha como pronta. Quem manda é o worker
 * agendado no banco, de minuto em minuto, respeitando o ritmo. Enviar 200
 * e-mails a partir de um clique no navegador seria perder tudo se a aba fechar.
 */
export async function liberarDisparo(campaignId: string): Promise<void> {
  const { error } = await supabase
    .from('email_campanhas')
    .update({ status: 'preparada', updated_at: new Date().toISOString() })
    .eq('id', campaignId)
  if (error) throw error
}

export async function cancelarCampanha(campaignId: string): Promise<void> {
  await chamar('cancelar', { campaign_id: campaignId })
}

export async function getProgresso(campaignId: string) {
  return (await chamar('status', { campaign_id: campaignId })) as {
    total: number
    por_status: Record<string, number>
  }
}

// ——— Supressão ———

export async function getSupressao(): Promise<Supressao[]> {
  const { data, error } = await supabase
    .from('email_supressao')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(200)
  if (error) throw error
  return (data ?? []) as Supressao[]
}
