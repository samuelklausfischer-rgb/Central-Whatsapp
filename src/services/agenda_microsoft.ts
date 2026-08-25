import supabase from '@/lib/supabase/client'
import { appEnv } from '@/lib/env'

/**
 * Conversa com a edge function `agenda-microsoft`.
 *
 * Nenhuma chamada à Microsoft sai daqui: o `refresh_token` da pessoa não pode
 * existir no navegador, e o banco impede isso por grant de coluna (migration
 * `20260824190000`). Este arquivo só fala com a nossa função.
 */

const BASE = `${appEnv.VITE_SUPABASE_URL}/functions/v1/agenda-microsoft`

export interface EventoDoOutlook {
  id: string
  titulo: string
  descricao: string | null
  starts_at: string
  ends_at: string
  dia_inteiro: boolean
  link: string | null
  origem: 'outlook'
  /**
   * `singleInstance` | `occurrence` | `exception` | `seriesMaster`.
   * A leitura usa `calendarView`, que expande a repetição: o que chega aqui é
   * uma OCORRÊNCIA, e mexer nela vale só para aquele dia.
   */
  tipo?: string
  serie_id?: string | null
}

/** Faz parte de um compromisso que se repete? */
export function seRepete(ev: { tipo?: string; serie_id?: string | null }): boolean {
  return Boolean(ev.serie_id) || ev.tipo === 'occurrence' || ev.tipo === 'exception'
}

export interface StatusDaConexao {
  /** As chaves do aplicativo já foram cadastradas no servidor? */
  configurado: boolean
  conectado: boolean
  conta_email?: string | null
}

async function chamar(rota: string, corpo?: unknown) {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  if (!session?.access_token) throw new Error('Sessão não encontrada. Saia e entre novamente.')

  const resp = await fetch(`${BASE}/${rota}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      'Content-Type': 'application/json',
    },
    body: corpo ? JSON.stringify(corpo) : undefined,
  })

  const dados = await resp.json().catch(() => ({}))
  if (!resp.ok) throw new Error(dados?.error || `Falha ao falar com o Outlook (${resp.status})`)
  return dados
}

export async function getStatus(): Promise<StatusDaConexao> {
  try {
    return (await chamar('status')) as StatusDaConexao
  } catch {
    // Servidor fora do ar ou função ainda não publicada não pode derrubar a
    // Agenda inteira — ela funciona sem o Outlook.
    return { configurado: false, conectado: false }
  }
}

/**
 * Abre o consentimento da Microsoft numa aba nova.
 *
 * Aba nova, e não navegação na mesma janela, porque o retorno cai na edge
 * function e não no app. Assim funciona igual na web, no Electron (que roda em
 * `file://` e não teria para onde voltar) e no Android.
 */
export async function conectar(): Promise<void> {
  const { url } = (await chamar('authorize')) as { url: string }
  window.open(url, '_blank', 'noopener,noreferrer')
}

export async function desconectar(): Promise<void> {
  await chamar('desconectar')
}

export async function getEventosDoOutlook(inicioIso: string, fimIso: string): Promise<EventoDoOutlook[]> {
  const dados = (await chamar('eventos', { inicio: inicioIso, fim: fimIso })) as {
    eventos?: EventoDoOutlook[]
  }
  return dados.eventos ?? []
}

export interface RascunhoDoOutlook {
  titulo: string
  descricao?: string | null
  /** Horário LOCAL, sem fuso: a função declara America/Sao_Paulo por nós. */
  inicio: string
  fim: string
  dia_inteiro?: boolean
}

export async function criarNoOutlook(evento: RascunhoDoOutlook): Promise<void> {
  await chamar('criar', evento)
}

/**
 * Edita um compromisso no Outlook.
 *
 * Se o `id` for de uma OCORRÊNCIA de repetição, a mudança vale só para aquele
 * dia — a Microsoft transforma a ocorrência numa exceção da série. Quem avisa a
 * pessoa é a tela; aqui só se registra o porquê.
 */
export async function atualizarNoOutlook(id: string, evento: RascunhoDoOutlook): Promise<void> {
  await chamar('atualizar', { ...evento, id })
}

/** Idem: apagar uma ocorrência apaga só aquele dia, não a série. */
export async function excluirDoOutlook(id: string): Promise<void> {
  await chamar('excluir', { id })
}
