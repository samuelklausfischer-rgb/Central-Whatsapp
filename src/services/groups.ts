import supabase from '@/lib/supabase/client'
import { interpretarErroDeFuncao } from '@/lib/friendly-error'
import { EvolutionApiError } from './evolution_instances'

/**
 * Participantes de um grupo.
 *
 * DE ONDE VEM O DADO, E O QUE ELE **NÃO** TEM
 * A Evolution devolve, por participante, exatamente três campos:
 * `{ id: "...@lid", phoneNumber, admin }`. **Não existe campo de nome.** Quem
 * resolve o nome é o app, cruzando o telefone com a tabela `contacts` — por isso
 * o `phone` é o campo mais importante da resposta, não o `id`.
 *
 * POR QUE NÃO DERIVAR TUDO DO BANCO
 * `messages.group_participant` só conhece quem FALOU no grupo, e é 100% `@lid`
 * (11.210 linhas, 181 LIDs distintos, zero em formato de telefone). Sem o
 * telefone não dá para abrir conversa privada nem casar com um contato. Serve só
 * como rede de segurança para os ~18% de grupos em que a Evolution responde 404
 * porque a instância saiu ou foi removida.
 *
 * CUIDADO COM `@lid`: `normalizeContactId` trata LID como telefone e prefixa
 * "55" em qualquer coisa com 10-13 dígitos — medido, 2 dos 181 LIDs resolvem para
 * um contato REAL que não é aquela pessoa. Por isso este módulo **nunca** indexa
 * participante por LID: a identidade é sempre o telefone vindo da Evolution.
 */

export interface Participante {
  /** JID interno do WhatsApp (@lid). Serve para casar com `group_participant`. */
  id: string
  /** Só dígitos. É a identidade usável: casa com `contacts.remote_jid`. */
  phone: string
  admin: 'admin' | 'superadmin' | null
  /** Nome que apareceu nas mensagens dele no grupo (pushName), se houver. */
  senderName?: string | null
}

export interface InfoDoGrupo {
  participantes: Participante[]
  /** A Evolution não conseguiu responder (instância saiu do grupo, por exemplo). */
  parcial: boolean
  total: number
}

// A chamada leva ~1s (mediana 905 ms, máximo 2,9 s) e o painel pode ser reaberto
// muitas vezes ao dia. TTL curto o bastante para refletir entrada/saída de gente
// no mesmo turno de trabalho.
const TTL_MS = 10 * 60 * 1000

/**
 * TTL do resultado PARCIAL (Evolution fora, caímos no banco). Curto de
 * propósito: parcial não tem telefone de ninguém, e o autocomplete de menção
 * lista só quem tem telefone. Guardar uma falha por 10 minutos deixava o `@`
 * daquele grupo vazio muito depois de a rede voltar.
 */
const TTL_FALHA_MS = 20 * 1000

interface Entrada {
  info: InfoDoGrupo
  em: number
}
const cache = new Map<string, Entrada>()

const chave = (deviceId: string, groupJid: string) => `${deviceId}|${groupJid}`

/**
 * Rede de segurança: quem já falou no grupo, direto do banco. Não tem telefone
 * (é tudo `@lid`), então as ações que dependem de telefone ficam indisponíveis
 * para esses — mas o atendente ao menos vê a lista.
 */
async function participantesQueFalaram(deviceId: string, groupJid: string): Promise<Participante[]> {
  const { data, error } = await supabase
    .from('messages')
    .select('group_participant, sender_name, created_at')
    .eq('device_id', deviceId)
    .eq('remote_sender', groupJid)
    .not('group_participant', 'is', null)
    .order('created_at', { ascending: false })
    .limit(2000)
  if (error) return []

  const vistos = new Map<string, Participante>()
  for (const linha of data ?? []) {
    const lid = String((linha as any).group_participant ?? '')
    if (!lid || vistos.has(lid)) continue
    // A ordenação é decrescente, então o primeiro que aparece é o pushName mais
    // RECENTE daquele participante — o mesmo LID já apareceu com nomes diferentes
    // ao longo do tempo.
    vistos.set(lid, {
      id: lid,
      phone: '',
      admin: null,
      senderName: (linha as any).sender_name ?? null,
    })
  }
  return [...vistos.values()]
}

export async function getParticipantesDoGrupo(
  deviceId: string,
  instanceName: string,
  groupJid: string,
  opcoes?: { forcar?: boolean },
): Promise<InfoDoGrupo> {
  const k = chave(deviceId, groupJid)
  const emCache = cache.get(k)
  if (!opcoes?.forcar && emCache && Date.now() - emCache.em < TTL_MS) {
    return emCache.info
  }

  let info: InfoDoGrupo
  try {
    const { data, error } = await supabase.functions.invoke<any>('evolution-instances', {
      method: 'POST',
      body: { action: 'group_participants', deviceId, instanceName, groupJid },
    })
    if (error) throw error

    if (data?.indisponivel) {
      const doBanco = await participantesQueFalaram(deviceId, groupJid)
      info = { participantes: doBanco, parcial: true, total: doBanco.length }
    } else {
      const daEvolution: Participante[] = (data?.participants ?? []).map((p: any) => ({
        id: String(p.id ?? ''),
        phone: String(p.phone ?? ''),
        admin: p.admin ?? null,
      }))
      // Enriquecer com o pushName de quem já falou, casando por LID — é o único
      // nome disponível para participante que não está na tabela de contatos.
      const falaram = await participantesQueFalaram(deviceId, groupJid)
      const nomePorLid = new Map(falaram.map((f) => [f.id, f.senderName]))
      for (const p of daEvolution) {
        if (p.id && nomePorLid.has(p.id)) p.senderName = nomePorLid.get(p.id) ?? null
      }
      info = { participantes: daEvolution, parcial: false, total: daEvolution.length }
    }
  } catch {
    const doBanco = await participantesQueFalaram(deviceId, groupJid)
    info = { participantes: doBanco, parcial: true, total: doBanco.length }
  }

  /**
   * Resultado PARCIAL não fica 10 minutos no cache.
   *
   * `parcial` significa que a Evolution não respondeu e caímos no banco, onde
   * todo participante vem sem telefone — e o autocomplete de menção só lista
   * quem tem telefone. Com o TTL cheio, uma indisponibilidade de um segundo
   * deixava o `@` daquele grupo sem nenhuma pessoa selecionável por 10 minutos,
   * já com a rede restabelecida, porque o compositor não tem como forçar
   * recarga (só o botão "Atualizar lista", dentro do painel de Participantes).
   */
  cache.set(k, { info, em: info.parcial ? Date.now() - (TTL_MS - TTL_FALHA_MS) : Date.now() })
  return info
}

/**
 * Qual conversa privada abrir para este participante?
 *
 * A mesma pessoa costuma existir como DUAS conversas: uma com chave de telefone e
 * outra com chave `@lid`, cada uma com histórico próprio (medido: 29 de 31 LIDs
 * têm as duas, com casos de 2.268 mensagens numa e 573 na outra). Sem escolher, o
 * atendente abriria uma e juraria que "sumiu o histórico".
 *
 * Critério: a que tem a mensagem MAIS RECENTE — é a conversa que está viva.
 * Não tenta unificar as duas: isso é problema de dados, não desta tela.
 */
export async function escolherConversaDoParticipante(
  deviceId: string,
  participante: Participante,
): Promise<string | null> {
  // O LID chega da Evolution COM sufixo (`123...@lid`), mas `messages.remote_sender`
  // grava LID em dígitos puros — medido: 9.029 mensagens em 34 conversas com chave
  // LID, e ZERO `remote_sender` terminando em `@lid`. Sem normalizar, o candidato
  // LID não casava linha nenhuma: a consulta abaixo, o `order` e o critério
  // "mensagem mais recente" eram código morto, e isto equivalia a
  // `return participante.phone || null`. O sufixo só serve para casar com
  // `messages.group_participant`, o único campo que guarda o formato com `@lid`.
  const lidEmDigitos = participante.id ? participante.id.replace(/@.*$/, '').replace(/\D/g, '') : ''
  const candidatos = [...new Set([participante.phone, lidEmDigitos].filter(Boolean))]
  if (candidatos.length === 0) return null

  const { data, error } = await supabase
    .from('messages')
    .select('remote_sender, created_at')
    .eq('device_id', deviceId)
    .in('remote_sender', candidatos)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
  if (error || !data || data.length === 0) {
    // Nenhuma conversa ainda: abre pelo telefone, que é a chave que a função de
    // envio usa ao criar a conversa.
    return participante.phone || null
  }
  return String((data[0] as any).remote_sender)
}

export function limparCacheDeGrupos(): void {
  cache.clear()
}

/**
 * Chama uma action de ESCRITA de grupo na edge function `evolution-instances`.
 *
 * Diferente de `getParticipantesDoGrupo` — que é leitura e degrada em silêncio
 * para o banco quando a Evolution falha —, escrita NUNCA pode fingir sucesso:
 * todo erro sobe como `EvolutionApiError`. `details` carrega o corpo de erro
 * INTEIRO devolvido pela edge function (não só o campo `details` dela), porque
 * as duas categorias de erro que a UI precisa distinguir (`group_unavailable`:
 * a instância saiu do grupo; `not_group_admin`: o número conectado não é admin)
 * vêm como `code` no nível raiz da resposta, ao lado — não dentro — do payload
 * bruto da Evolution. Leia `err.details?.code` para diferenciar.
 */
async function invokeGroupWrite<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke<any>('evolution-instances', {
    method: 'POST',
    body,
  })
  if (error) {
    // `ctxData` recebia o próprio `Response`, então `.error` era sempre undefined
    // e a causa real nunca chegava à tela. O helper lê o corpo de verdade e
    // reconhece sessão encerrada — o `err.details?.code` documentado acima segue
    // funcionando, porque `info.corpo` é o JSON da resposta.
    const info = await interpretarErroDeFuncao(error, 'Erro ao alterar o grupo')
    throw new EvolutionApiError(info.message, info.corpo, info.corpo.diagnostics)
  }
  return data as T
}

export interface AtualizarFotoResultado {
  groupJid: string
  updated: boolean
}

/**
 * Troca a foto do grupo.
 *
 * `image` é repassado EXATAMENTE como o chamador mandar (URL pública ou base64
 * data URL). O formato aceito pela Evolution varia por versão da API e não foi
 * confirmado contra a instância real nesta tarefa — ver PENDÊNCIAS.
 */
export async function atualizarFotoDoGrupo(
  deviceId: string,
  groupJid: string,
  image: string,
): Promise<AtualizarFotoResultado> {
  return invokeGroupWrite<AtualizarFotoResultado>({
    action: 'group_update_picture', deviceId, groupJid, image,
  })
}

export interface AtualizarAssuntoResultado {
  groupJid: string
  subject: string
  updated: boolean
}

/** Muda o nome (assunto) do grupo. */
export async function atualizarAssuntoDoGrupo(
  deviceId: string,
  groupJid: string,
  subject: string,
): Promise<AtualizarAssuntoResultado> {
  return invokeGroupWrite<AtualizarAssuntoResultado>({
    action: 'group_update_subject', deviceId, groupJid, subject,
  })
}

export interface AtualizarDescricaoResultado {
  groupJid: string
  description: string
  updated: boolean
}

/** Muda a descrição do grupo. Descrição vazia é válida (limpa a descrição). */
export async function atualizarDescricaoDoGrupo(
  deviceId: string,
  groupJid: string,
  description: string,
): Promise<AtualizarDescricaoResultado> {
  return invokeGroupWrite<AtualizarDescricaoResultado>({
    action: 'group_update_description', deviceId, groupJid, description,
  })
}

export interface AlterarParticipanteResultado {
  groupJid: string
  participant: string
  action: 'promote' | 'demote' | 'remove'
  updated: boolean
}

/**
 * Promove/rebaixa/remove um participante e invalida o cache DAQUELE grupo (não
 * o cache inteiro) — senão o painel de participantes mostra o estado antigo até
 * o TTL de 10 minutos vencer.
 */
async function alterarParticipante(
  action: 'group_promote_participant' | 'group_demote_participant' | 'group_remove_participant',
  atributoAcao: 'promote' | 'demote' | 'remove',
  deviceId: string,
  groupJid: string,
  participant: string,
): Promise<AlterarParticipanteResultado> {
  const resultado = await invokeGroupWrite<AlterarParticipanteResultado>({
    action, deviceId, groupJid, participant,
  })
  cache.delete(chave(deviceId, groupJid))
  return resultado ?? { groupJid, participant, action: atributoAcao, updated: true }
}

/** Promove participante a admin do grupo. */
export const promoverParticipante = (deviceId: string, groupJid: string, participant: string) =>
  alterarParticipante('group_promote_participant', 'promote', deviceId, groupJid, participant)

/** Rebaixa um admin do grupo (tira o cargo de admin). */
export const rebaixarParticipante = (deviceId: string, groupJid: string, participant: string) =>
  alterarParticipante('group_demote_participant', 'demote', deviceId, groupJid, participant)

/** Remove o participante do grupo. Destrutivo/irreversível — gate `requireAdmin` no backend. */
export const removerParticipante = (deviceId: string, groupJid: string, participant: string) =>
  alterarParticipante('group_remove_participant', 'remove', deviceId, groupJid, participant)

export interface CriarGrupoResultado {
  created: boolean
  groupJid: string | null
  raw: unknown
}

/** Cria um grupo novo. Destrutivo/irreversível — gate `requireAdmin` no backend. */
export async function criarGrupo(
  deviceId: string,
  subject: string,
  participants: string[],
  description?: string,
): Promise<CriarGrupoResultado> {
  return invokeGroupWrite<CriarGrupoResultado>({
    action: 'group_create', deviceId, subject, participants, description,
  })
}

export interface SairDoGrupoResultado {
  groupJid: string
  left: boolean
}

/** Sai do grupo. Destrutivo/irreversível — gate `requireAdmin` no backend. */
export async function sairDoGrupo(deviceId: string, groupJid: string): Promise<SairDoGrupoResultado> {
  const resultado = await invokeGroupWrite<SairDoGrupoResultado>({
    action: 'group_leave', deviceId, groupJid,
  })
  cache.delete(chave(deviceId, groupJid))
  return resultado
}
