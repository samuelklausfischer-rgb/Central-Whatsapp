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

export interface Task {
  id: string
  title: string
  description: string | null
  status: 'pending' | 'in_progress' | 'completed'
  contact_id: string
  user_id: string
  created_at: string
  updated_at: string
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
  id: string
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
