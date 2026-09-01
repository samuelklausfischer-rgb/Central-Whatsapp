export interface Profile {
  id: string
  email: string | null
  username: string | null
  name: string | null
  avatar_url: string | null
  signature: string | null
  department: string | null
  is_admin: boolean
  is_super_admin?: boolean
  devices_restricted?: boolean
  /**
   * Aviso de mensagem nova por aparelho: `{ "<device_id>": { sound, background } }`.
   * Mora no perfil, e não no localStorage, para a configuração seguir a PESSOA
   * entre desktop, web e PWA — ver `hooks/use-notification-prefs.ts`.
   */
  notification_prefs?: Record<string, { sound: boolean; background: boolean }>
  created_at: string
  updated_at: string
}

export interface Device {
  id: string
  name: string
  department: string | null
  status: string
  unread_count: number
  instance_key: string | null
  signature: string | null
  avatar_url: string | null
  avatar_updated_at: string | null
  deleted_at: string | null
  created_at: string
  updated_at: string
}

export interface UserAllowedDevice {
  id: string
  user_id: string
  device_id: string
  created_at: string
}

export interface Contact {
  id: string
  remote_jid: string
  name: string | null
  nickname: string | null
  name_locked?: boolean
  avatar_url: string | null
  avatar_updated_at: string | null
  created_at: string
  updated_at: string
}

export interface Message {
  id: string
  content: string
  device_id: string
  sender_id: string | null
  sender_name: string | null
  group_participant: string | null
  is_read: boolean
  remote_sender: string
  direction: 'inbound' | 'outbound'
  origin: 'app' | 'webhook'
  external_id: string | null
  attachments: Record<string, unknown> | null
  reactions: Record<string, unknown>[] | null
  reply_to_id: string | null
  reply_to_snapshot: { content: string; sender_name: string; id: string } | null
  edited_at: string | null
  deleted_at: string | null
  revoked_at: string | null
  /**
   * Mensagem encaminhada. Diferente de `edited_at`/`deleted_at`/`revoked_at`,
   * que são eventos posteriores, esta é propriedade de nascimento — por isso
   * booleano e não timestamp.
   */
  is_forwarded: boolean
  /**
   * ITEM 12: transcrição automática de áudio RECEBIDO (Groq). `status` NULL
   * é o estado de toda mensagem que não é áudio recebido, e também de todo
   * áudio anterior a este recurso — não retroage por decisão do usuário.
   */
  transcription: string | null
  transcription_status: 'pending' | 'ready' | 'failed' | null
  created_at: string
  updated_at: string
}

export interface Label {
  id: string
  name: string
  color: string
  user_id: string
  created_at: string
  updated_at: string
}

export interface ContactTag {
  id: string
  device_id: string
  remote_sender: string
  label_id: string
  created_at: string
  updated_at: string
  expand?: { label_id: Label }
}

export interface Note {
  id: string
  title: string
  content: string
  user_id: string
  contact_jid: string | null
  contact_name: string | null
  category: 'geral' | 'financeiro' | 'rh' | 'administrativo'
  created_at: string
  updated_at: string
}

export interface MessageTrigger {
  id: string
  title: string
  content: string
  user_id: string
  created_at: string
  updated_at: string
}

export interface ScheduledMessage {
  id: string
  content: string
  scheduled_at: string
  status: 'pending' | 'processing' | 'sent' | 'failed' | 'cancelled'
  device_id: string
  remote_sender: string
  user_id: string
  attachments: ScheduledAttachment[] | null
  processed_at: string | null
  error_message: string | null
  retry_count: number
  sent_message_ids: string[]
  created_at: string
  updated_at: string
}

export interface ScheduledAttachment {
  url: string
  type: string
  name: string
}

export interface AiPrompt {
  id: string
  label: string
  action_key: string
  system_prompt: string
  user_id: string
  is_active: boolean
  is_global: boolean
  created_at: string
  updated_at: string
}

/**
 * ITEM 9: `waiting` e `in_review` entraram para a tarefa poder dizer POR QUE
 * ainda não acabou, em vez de ficar parada em "em andamento" sem explicação.
 * A situação é COMPARTILHADA — é o que permite a conferência de outra pessoa.
 */
export type TaskStatus = 'pending' | 'in_progress' | 'waiting' | 'in_review' | 'completed'

export interface Task {
  id: string
  title: string
  description: string | null
  status: TaskStatus
  /** ITEM 9: o motivo de estar parada. Visível a todos que veem a tarefa. */
  status_reason: string | null
  /** Nula para tarefa avulsa — nem toda tarefa nasce de uma conversa. */
  contact_id: string | null
  /** Quem criou. Quem deve executar é `assigned_to`. */
  user_id: string
  assigned_to: string | null
  due_date: string | null
  created_at: string
  updated_at: string
}

/** ITEM 11: um item do checklist de uma tarefa. */
export interface TaskChecklistItem {
  id: string
  task_id: string
  texto: string
  feito: boolean
  ordem: number
  created_at: string
}

/**
 * ITEM 11: como ESTA pessoa quer ver a coluna. Não muda a tarefa nem o quadro
 * de ninguém — só a apresentação. Sem linha, vale o padrão.
 */
export interface TaskBoardPreference {
  user_id: string
  status: TaskStatus
  visivel: boolean
  ordem: number
  titulo: string | null
  cor: string | null
  updated_at: string
}

/** ITEM 1: escopo de um compromisso da agenda. */
export type AgendaEscopo = 'usuario' | 'setor' | 'grupo'
export type AgendaImportancia = 'baixa' | 'normal' | 'alta' | 'urgente'

export interface AgendaEvent {
  id: string
  titulo: string
  descricao: string | null
  starts_at: string
  ends_at: string
  dia_inteiro: boolean
  importancia: AgendaImportancia
  link: string | null
  email: string | null
  escopo: AgendaEscopo
  /** Preenchido quando `escopo` é 'setor'; casa com `profiles.department`. */
  setor: string | null
  /** Preenchido quando `escopo` é 'grupo'. */
  group_id: string | null
  created_by: string
  /** Quem deve cumprir. Nulo = o próprio criador. */
  assigned_to: string | null
  /** Cor de destaque escolhida na criação. Nula = visual padrão. Não sincroniza com o Outlook. */
  cor: string | null
  created_at: string
  updated_at: string
}

export interface AgendaGroup {
  id: string
  nome: string
  created_by: string
  created_at: string
}

export interface ConversationAssignment {
  id: string
  device_id: string
  remote_sender: string
  status: 'open' | 'taken' | 'assigned' | 'finished' | 'waiting' | 'invited'
  assigned_to: string | null
  assigned_by: string | null
  assigned_at: string | null
  finished_at: string | null
  finished_by: string | null
  global_read_at: string | null
  global_read_by: string | null
  invited_to: string | null
  invited_by: string | null
  invited_at: string | null
  global_responded_at: string | null
  global_responded_by: string | null
  created_at: string
  updated_at: string
  // Joined fields from get_conversation_assignment RPC
  assigned_to_name: string | null
  assigned_by_name: string | null
  invited_to_name: string | null
  invited_by_name: string | null
}

export interface ConversationActionLog {
  id: string
  device_id: string
  remote_sender: string
  user_id: string
  action: 'opened' | 'taken' | 'assigned' | 'finished' | 'waiting'
  target_user_id: string | null
  created_at: string
}

export interface TeamMember {
  // O nome espelha o retorno real da RPC get_device_team_members em produção
  // (RETURNS TABLE(user_id uuid, ...)). Renomear para `id` faz o cast em
  // conversation_states.ts virar `undefined` em silêncio e quebra a designação.
  user_id: string
  name: string | null
  email: string | null
  avatar_url: string | null
  department: string | null
}

export interface ConversationRecentViewer {
  user_id: string
  user_name: string
  read_at: string
}

// Relatório App (super-admin). Leitura protegida por RLS via _is_super_admin();
// a escrita passa só pela RPC app_heartbeat.
export interface UserAppSessionRow {
  user_id: string
  platform: 'app' | 'web'
  app_version: string | null
  started_at: string
  last_seen_at: string
  last_active_at: string | null
}

export interface UserAppDailyActivityRow {
  user_id: string
  dia: string
  platform: 'app' | 'web'
  active_seconds: number
  open_seconds: number
  app_version: string | null
  first_seen_at: string
  last_seen_at: string
}
