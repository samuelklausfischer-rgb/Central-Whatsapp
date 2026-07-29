/**
 * Snapshot da lista de conversas por aparelho.
 *
 * PROBLEMA QUE ISTO RESOLVE
 * `ChatHub.tsx` zerava `conversationSummaries`/`assignments` ANTES de disparar o
 * fetch da troca de aparelho, e `loadDeviceData` ia direto na rede sem consultar
 * nada. Resultado: voltar para um aparelho aberto segundos antes refazia a viagem
 * inteira, e a sidebar ficava vazia no caminho — exibindo "Nenhuma conversa por
 * aqui", que é a mensagem de aparelho SEM conversa, não de carregamento.
 *
 * O snapshot guarda summaries e assignments JUNTOS de propósito: os dois
 * alimentam o mesmo `useMemo` de `conversations`, e `pinned` depende de
 * `assigned_to`. Aplicá-los em dois `setState` separados fazia a lista montar,
 * remontar e MUDAR DE ORDEM na frente do usuário.
 *
 * ESCOPO: memória, só durante a sessão. Nada vai para disco — `last_message_content`
 * é conteúdo de paciente/cliente, mesma classe de dado dos rascunhos
 * (ver conversationDrafts.ts), e o app roda na máquina do atendente. Persistir
 * exigiria chave por usuário e limpeza no logout; não é o caso aqui.
 *
 * Escopo de MÓDULO, não `useRef`: `ChatHub` é lazy (App.tsx) e desmonta ao
 * navegar para Dashboard/Email, o que zeraria qualquer ref.
 */

import type { ConversationSummary } from '@/services/messages'
import type { ConversationAssignment } from '@/lib/supabase/types'

export interface DeviceSnapshot {
  summaries: ConversationSummary[]
  assignments: Map<string, ConversationAssignment>
}

const byDevice = new Map<string, DeviceSnapshot>()

/**
 * Devolve `null` quando o aparelho NUNCA foi carregado — diferente de um
 * snapshot com `summaries: []`, que significa "carregou e não tem conversa".
 * É essa distinção que separa o skeleton do estado vazio de verdade.
 */
export function getDeviceSnapshot(deviceId: string | null | undefined): DeviceSnapshot | null {
  if (!deviceId) return null
  return byDevice.get(deviceId) ?? null
}

export function setDeviceSnapshot(deviceId: string | null | undefined, snapshot: DeviceSnapshot): void {
  if (!deviceId) return
  byDevice.set(deviceId, snapshot)
}

/**
 * Atualiza só as summaries preservando os assignments já conhecidos. Usado pelo
 * refresh incremental (realtime/debounce), que não rebusca assignments.
 */
export function setDeviceSummaries(
  deviceId: string | null | undefined,
  summaries: ConversationSummary[],
): void {
  if (!deviceId) return
  const atual = byDevice.get(deviceId)
  byDevice.set(deviceId, { summaries, assignments: atual?.assignments ?? new Map() })
}

export function setDeviceAssignments(
  deviceId: string | null | undefined,
  assignments: Map<string, ConversationAssignment>,
): void {
  if (!deviceId) return
  const atual = byDevice.get(deviceId)
  byDevice.set(deviceId, { summaries: atual?.summaries ?? [], assignments })
}

/** Chamado na troca de usuário — o snapshot é por sessão, não por conta. */
export function clearDeviceSnapshots(): void {
  byDevice.clear()
}
