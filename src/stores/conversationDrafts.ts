/**
 * Rascunhos por conversa.
 *
 * PROBLEMA QUE ISTO RESOLVE
 * `ChatHub.tsx` renderiza `<ChatWindow>` sem prop `key`. Tipo e posição na árvore
 * são estáveis entre trocas de contato, então o React reconcilia no MESMO fiber e
 * todo `useState` do componente sobrevive à troca — só a prop `contact` muda.
 * Resultado: o texto digitado para o contato X continua no compositor quando o
 * atendente abre o contato Y, com risco real de enviar para a pessoa errada.
 *
 * E não é só o texto: anotação, tarefa e apelido digitados em X e salvos depois da
 * troca GRAVAM NO CONTATO Y no banco.
 *
 * POR QUE NÃO `key={convKey}` NO ChatWindow
 * Remontaria um componente de 3.194 linhas a cada clique, destruindo posição de
 * scroll, busca aberta, diálogos e o estado de atendimento — caro e com efeito
 * colateral muito maior que o problema.
 *
 * ESCOPO: memória, só durante a sessão (decisão do usuário). Nada vai para disco:
 * o app roda em Electron na máquina do atendente e o conteúdo é de paciente/cliente.
 * Fechar o app descarta os rascunhos.
 */

const DRAFT_ATTACHMENT_BUDGET_BYTES = 25 * 1024 * 1024

export type DraftNoteCategory = 'geral' | 'financeiro' | 'rh' | 'administrativo'

export interface ConversationDraft {
  /** Texto do compositor. */
  text: string
  /** Mensagem sendo respondida (banner acima do compositor). */
  replyingTo: any | null
  /** Id da mensagem em edição, se houver. */
  editingMessageId: string | null
  /** Anexos escolhidos e ainda não enviados. */
  attachments: File[]
  /**
   * Áudio gravado e ainda não enviado. Guardamos só o Blob: a objectURL é
   * recriada na restauração. Assim o componente é sempre o dono da URL viva e
   * não existe risco de o rascunho segurar uma URL já revogada.
   */
  audioBlob: Blob | null
  /** Agendamento preenchido no diálogo de envio futuro. */
  scheduleDate: string
  /**
   * "@todos" escolhido no autocomplete de menção, para ESTE grupo.
   *
   * Mora no rascunho, e não em estado de tela, porque o texto `@todos ...`
   * sobrevive à troca de conversa: uma flag global era zerada na troca e o aviso
   * voltava com o `@todos` escrito e sem notificar ninguém. Por conversa, texto
   * e marcação nunca discordam.
   */
  mentionEveryone: boolean
  /** Diálogo de anotação — grava em `notes.contact_jid`. */
  noteTitle: string
  noteContent: string
  noteCategory: DraftNoteCategory
  /** Diálogo de tarefa — grava em `tasks.contact_id`. */
  taskTitle: string
  taskDescription: string
  /** Diálogo de apelido — grava em `contacts.nickname`. */
  nicknameInput: string
}

export const EMPTY_DRAFT: ConversationDraft = {
  text: '',
  replyingTo: null,
  editingMessageId: null,
  attachments: [],
  audioBlob: null,
  scheduleDate: '',
  mentionEveryone: false,
  noteTitle: '',
  noteContent: '',
  noteCategory: 'geral',
  taskTitle: '',
  taskDescription: '',
  nicknameInput: '',
}

/**
 * Chave da conversa. Devolve `null` quando o aparelho ainda não carregou —
 * `selectedDevice` é `undefined` por alguns frames no boot, e sem esta guarda o
 * rascunho seria gravado numa chave transitória tipo ":5547..." e depois perdido.
 */
export function conversationDraftKey(
  deviceId: string | null | undefined,
  contact: string | null | undefined,
): string | null {
  if (!deviceId || !contact) return null
  return `${deviceId}:${contact}`
}

const drafts = new Map<string, ConversationDraft>()
const listeners = new Set<() => void>()

/**
 * Snapshot imutável só das CHAVES com rascunho de texto. É o que a lista lateral
 * consome; trocar a referência apenas quando esse conjunto muda evita re-render
 * da lista a cada tecla digitada.
 */
let keysSnapshot: ReadonlySet<string> = new Set()

function isDraftEmpty(draft: ConversationDraft): boolean {
  return (
    draft.text.trim() === '' &&
    draft.replyingTo === null &&
    draft.editingMessageId === null &&
    draft.attachments.length === 0 &&
    draft.audioBlob === null &&
    draft.scheduleDate === '' &&
    draft.noteTitle.trim() === '' &&
    draft.noteContent.trim() === '' &&
    draft.taskTitle.trim() === '' &&
    draft.taskDescription.trim() === '' &&
    draft.nicknameInput.trim() === ''
  )
}

/** Só o texto conta para o indicador "Rascunho:" — é o que o WhatsApp faz. */
function hasVisibleDraft(draft: ConversationDraft): boolean {
  return draft.text.trim() !== ''
}

function emit() {
  const next = new Set<string>()
  for (const [key, draft] of drafts) {
    if (hasVisibleDraft(draft)) next.add(key)
  }
  const changed =
    next.size !== keysSnapshot.size || [...next].some((k) => !keysSnapshot.has(k))
  if (!changed) return
  keysSnapshot = next
  for (const listener of listeners) listener()
}

function attachmentBytes(files: File[]): number {
  return files.reduce((total, file) => total + (file.size || 0), 0)
}

export function saveDraft(key: string | null, draft: ConversationDraft): void {
  if (!key) return

  if (isDraftEmpty(draft)) {
    drafts.delete(key)
    emit()
    return
  }

  let attachments = draft.attachments
  // Imagem colada do clipboard vira `File` EM MEMÓRIA (diferente do input de
  // arquivo, que é só um handle de disco). Sem teto, guardar anexos de dezenas de
  // conversas estoura a RAM do processo. Acima do orçamento, preserva-se o texto
  // e descartam-se os anexos — o texto é o que o usuário pediu para não perder.
  if (attachmentBytes(attachments) > DRAFT_ATTACHMENT_BUDGET_BYTES) {
    attachments = []
  }

  drafts.set(key, { ...draft, attachments })
  emit()
}

export function getDraft(key: string | null): ConversationDraft | null {
  if (!key) return null
  return drafts.get(key) ?? null
}

export function clearDraft(key: string | null): void {
  if (!key) return
  if (drafts.delete(key)) emit()
}

export function clearAllDrafts(): void {
  if (drafts.size === 0) return
  drafts.clear()
  emit()
}

// ---- Assinatura para a lista de conversas (useSyncExternalStore, nativo do React 19) ----

export function subscribeDraftKeys(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function getDraftKeysSnapshot(): ReadonlySet<string> {
  return keysSnapshot
}
