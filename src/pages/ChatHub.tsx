import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import logoUrl from '/logo.png'
import { useSearchParams } from 'react-router-dom'
import { useIsMobile } from '@/hooks/use-mobile'
import { ChatList } from '@/components/chat/ChatList'
import { ChatWindow } from '@/components/chat/ChatWindow'
import { syncDeviceAvatar } from '@/services/devices'
import { getMessages, getConversationSummaries, getConversationMessages, type ConversationSummary } from '@/services/messages'
import {
  getContacts,
  updateContactByJid,
  getCachedContacts,
  upsertCachedContact,
  removeCachedContact,
} from '@/services/contacts'
import { getMyStates, getDeviceAssignments, type ConversationUserState } from '@/services/conversation_states'
import type { ConversationAssignment } from '@/lib/supabase/types'
import { getNotes } from '@/services/notes'
import { useRealtime } from '@/hooks/use-realtime'
import { useAuth } from '@/hooks/use-auth'
import { getRawDevicePrefs } from '@/hooks/use-notification-prefs'
import { useToast } from '@/hooks/use-toast'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'

// Combina o "respondido" individual do usuário com o "respondido" compartilhado
// (gravado quando alguém finaliza o atendimento) e retorna o mais recente dos dois.
function latestDateString(a: string | null | undefined, b: string | null | undefined): string | null {
  if (!a) return b ?? null
  if (!b) return a
  return new Date(a) > new Date(b) ? a : b
}

function debounce<A extends any[]>(fn: (...args: A) => void, ms: number): (...args: A) => void {
  let timer: ReturnType<typeof setTimeout>
  return (...args: A) => {
    clearTimeout(timer)
    timer = setTimeout(() => fn(...args), ms)
  }
}

// Identifica uma mensagem enviada para casar o eco do realtime com a mensagem
// otimista (temp) já exibida — evita duplicar o balão.
function messageFingerprint(deviceId: string, remoteSender: string, content: string) {
  return `${deviceId}|${remoteSender}|${(content || '').trim()}`
}

const CONVERSATION_CACHE_MAX = 20

const conversationCacheKey = (deviceId: string, contact: string) => `${deviceId}|${contact}`

const SIDEBAR_MIN = 300
const SIDEBAR_MAX = 520
const SIDEBAR_DEFAULT = 384
const CHAT_MIN = 420
const SIDEBAR_STORAGE_KEY = 'central-whats.chatSidebarWidth.v1'

let audioCtx: AudioContext | null = null

function getAudioContext() {
  if (!audioCtx) audioCtx = new AudioContext()
  if (audioCtx.state === 'suspended') audioCtx.resume()
  return audioCtx
}

function playNotificationSound() {
  try {
    const ctx = getAudioContext()
    const gain = ctx.createGain()
    gain.connect(ctx.destination)
    gain.gain.setValueAtTime(0.12, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5)

    const osc = ctx.createOscillator()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(523.25, ctx.currentTime)
    osc.frequency.setValueAtTime(659.25, ctx.currentTime + 0.12)
    osc.connect(gain)
    osc.start(ctx.currentTime)
    osc.stop(ctx.currentTime + 0.4)
  } catch { /* silent fail */ }
}

export default function ChatHub() {
  const isMobile = useIsMobile()
  const { user, allowedDevices } = useAuth()
  const [searchParams] = useSearchParams()
  const urlDeviceId = searchParams.get('device')

  const [devices, setDevices] = useState<any[]>([])
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null)
  const [messages, setMessages] = useState<any[]>([])
  const [conversationSummaries, setConversationSummaries] = useState<ConversationSummary[]>([])
  const [conversationMessages, setConversationMessages] = useState<any[]>([])
  // Semeado de forma síncrona a partir do cache write-through de contacts.ts —
  // pinta a sidebar imediatamente no mount, sem esperar a rede. O efeito
  // abaixo sempre refaz o fetch em paralelo e substitui pelo resultado fresco.
  const [contacts, setContacts] = useState<any[]>(() => getCachedContacts() || [])
  const [selectedContact, setSelectedContact] = useState<string | null>(() =>
    sessionStorage.getItem('activeContactJid')
  )
  const [userStates, setUserStates] = useState<ConversationUserState[]>([])
  const [assignments, setAssignments] = useState<Map<string, ConversationAssignment>>(new Map())
  const [showArchived, setShowArchived] = useState(false)
  const [noteCountByJid, setNoteCountByJid] = useState<Map<string, number>>(new Map())
  const prevDeviceIdRef = useRef<string | null>(null)
  // Sempre refletem o valor mais recente de seleção — usados para descartar
  // respostas assíncronas que chegam depois de o usuário já ter trocado de
  // dispositivo/conversa (evita a corrida que mostrava dados do WhatsApp errado).
  const selectedDeviceIdRef = useRef<string | null>(selectedDeviceId)
  const selectedContactRef = useRef<string | null>(selectedContact)
  selectedDeviceIdRef.current = selectedDeviceId
  selectedContactRef.current = selectedContact
  const devicesRef = useRef<any[]>(devices)
  const userIdRef = useRef<string | undefined>(user?.id)
  // Mensagens otimistas pendentes (temp) aguardando o eco do realtime.
  const pendingTempsRef = useRef<{ tempId: string; fp: string; ts: number }[]>([])
  // Cache das últimas conversas abertas (LRU simples, em memória). Serve só para
  // pintar na hora ao voltar para uma conversa já vista — o fetch continua sendo
  // a fonte da verdade e sobrescreve logo em seguida.
  const conversationCacheRef = useRef<Map<string, any[]>>(new Map())
  // Última vez que a rede de segurança rodou. Precisa viver no nível do
  // componente: dentro do efeito ele seria recriado a cada troca de conversa e
  // não deduplicaria a rajada de focus/online/visibility do Alt-Tab.
  const lastRefetchRef = useRef(0)
  const noteJids = useMemo(() => new Set(noteCountByJid.keys()), [noteCountByJid])
  const [isSheetOpen, setIsSheetOpen] = useState(false)
  const [isRefreshingAll, setIsRefreshingAll] = useState(false)
  const [isNewContactOpen, setIsNewContactOpen] = useState(false)
  const [newContactName, setNewContactName] = useState('')
  const [newContactDdd, setNewContactDdd] = useState('')
  const [newContactNumber, setNewContactNumber] = useState('')
  const [isCreatingContact, setIsCreatingContact] = useState(false)

  const { toast } = useToast()

  useEffect(() => {
    getContacts()
      .then(setContacts)
      .catch(() => {})
  }, [])

  useEffect(() => {
    getMyStates().then(setUserStates)
  }, [])

  useEffect(() => {
    if (selectedContact) sessionStorage.setItem('activeContactJid', selectedContact)
    else sessionStorage.removeItem('activeContactJid')
  }, [selectedContact])

  useEffect(() => {
    devicesRef.current = devices
  }, [devices])

  useEffect(() => {
    userIdRef.current = user?.id
  }, [user])

  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission()
    }
  }, [])

  useEffect(() => {
    getNotes().then((notes) => {
      const countMap = new Map<string, number>()
      notes.forEach((n) => {
        if (n.contact_jid) {
          countMap.set(n.contact_jid, (countMap.get(n.contact_jid) || 0) + 1)
        }
      })
      setNoteCountByJid(countMap)
    }).catch(() => {})
  }, [])

  useRealtime('notes', (e) => {
    const jid = e.record.contact_jid
    if (!jid) return
    setNoteCountByJid((prev) => {
      const next = new Map(prev)
      if (e.action === 'create') {
        next.set(jid, (next.get(jid) || 0) + 1)
      } else if (e.action === 'delete') {
        const remaining = (next.get(jid) || 1) - 1
        if (remaining <= 0) next.delete(jid)
        else next.set(jid, remaining)
      }
      return next
    })
  })

  useEffect(() => {
    const uniqueDevicesMap = new Map()

    allowedDevices.forEach((d) => {
      const key = d.instance_key || d.name
      if (!uniqueDevicesMap.has(key)) {
        uniqueDevicesMap.set(key, d)
      } else {
        const existing = uniqueDevicesMap.get(key)
        if (new Date(d.updated_at).getTime() > new Date(existing.updated_at).getTime()) {
          uniqueDevicesMap.set(key, d)
        }
      }
    })

    const filteredDevices = Array.from(uniqueDevicesMap.values())
    setDevices(filteredDevices)

    setSelectedDeviceId((prev) => {
      const savedId = sessionStorage.getItem('activeDeviceId')
      const targetId = urlDeviceId || prev || savedId

      if (targetId && filteredDevices.some((d) => d.id === targetId)) {
        return targetId
      }
      return filteredDevices[0]?.id || null
    })
  }, [allowedDevices, urlDeviceId])

  useRealtime('devices', (e) => {
    if (e.action === 'create') {
      setDevices((prev) => {
        if (!user?.is_admin && !allowedDevices.some((d) => d.id === e.record.id)) return prev
        const exists = prev.find(
          (d) =>
            (d.instance_key === e.record.instance_key && e.record.instance_key) ||
            d.name === e.record.name,
        )
        if (exists) return prev.map((d) => (d.id === exists.id ? e.record : d))
        return [e.record, ...prev]
      })
    } else if (e.action === 'update') {
      setDevices((prev) => prev.map((d) => (d.id === e.record.id ? e.record : d)))
    } else if (e.action === 'delete') {
      setDevices((prev) => prev.filter((d) => d.id !== e.record.id))
    }
  })

  useRealtime(
    'contacts',
    (e) => {
      if (e.action === 'create') {
        upsertCachedContact(e.record)
        setContacts((prev) => [e.record, ...prev])
      } else if (e.action === 'update') {
        // Escreve no cache do módulo SEMPRE, mesmo quando o guard de no-op
        // abaixo pula o re-render — senão o cache fica preso na versão antiga
        // e a PRÓXIMA montagem pintaria por um instante o nome/avatar velho.
        upsertCachedContact(e.record)
        setContacts((prev) => {
          const idx = prev.findIndex((c) => c.id === e.record.id)
          if (idx < 0) return prev
          // Guarda de no-op: a edge function `contact-avatar` faz PATCH mesmo
          // quando não acha foto, mexendo só em `avatar_updated_at`. Sem esta
          // checagem, cada PATCH desses cria um array novo e derruba tudo que
          // depende de `contacts` — buildContactIndex (~6.000 Map.set), as 520
          // linhas da lista e os 500 balões da conversa aberta.
          // Só os campos realmente renderizados entram na comparação.
          const atual = prev[idx]
          if (
            atual.avatar_url === e.record.avatar_url &&
            atual.name === e.record.name &&
            atual.nickname === e.record.nickname &&
            atual.remote_jid === e.record.remote_jid
          ) {
            return prev
          }
          const next = [...prev]
          next[idx] = e.record
          return next
        })
      } else if (e.action === 'delete') {
        removeCachedContact(e.record.id)
        setContacts((prev) => prev.filter((c) => c.id !== e.record.id))
      }
    },
    true,
    undefined,
    // Fecha a janela entre o fetch inicial e o handshake do websocket: uma
    // alteração de contato que chegasse nesse intervalo seria perdida em
    // silêncio (SUBSCRIBED só vira true depois do fetch já ter disparado).
    // Reconciliar a cada SUBSCRIBED (mount e reconexões) também cobre quedas
    // de rede — dispara raro, o `useRealtime` já tem backoff pra isso.
    () => {
      getContacts()
        .then(setContacts)
        .catch(() => {})
    },
  )

  // Busca resumos/mensagens/atribuições de um dispositivo específico. Cada
  // setState só é aplicado se o dispositivo ainda for o selecionado no
  // momento em que a resposta chega — evita que uma resposta atrasada de um
  // WhatsApp já abandonado sobrescreva os dados do WhatsApp atual.
  const loadDeviceData = useCallback((deviceId: string) => {
    const fetchFallbackMessages = () =>
      getMessages(deviceId)
        .then((msgs) => { if (selectedDeviceIdRef.current === deviceId) setMessages(msgs) })
        .catch(() => { if (selectedDeviceIdRef.current === deviceId) setMessages([]) })

    const summariesPromise = getConversationSummaries(deviceId)
      .then((summaries) => {
        if (selectedDeviceIdRef.current !== deviceId) return
        setConversationSummaries(summaries)
        if (summaries.length === 0) {
          return fetchFallbackMessages()
        }
        setMessages([])
      })
      .catch(fetchFallbackMessages)

    const assignmentsPromise = getDeviceAssignments(deviceId)
      .then((map) => { if (selectedDeviceIdRef.current === deviceId) setAssignments(map) })
      .catch(() => {})

    return Promise.all([summariesPromise, assignmentsPromise])
  }, [])

  useEffect(() => {
    if (selectedDeviceId) {
      sessionStorage.setItem('activeDeviceId', selectedDeviceId)
      const deviceChanged = prevDeviceIdRef.current !== null && prevDeviceIdRef.current !== selectedDeviceId
      prevDeviceIdRef.current = selectedDeviceId
      if (deviceChanged) {
        // Limpar ANTES de disparar o fetch. Sem isto a sidebar segue mostrando as
        // conversas do aparelho ANTERIOR já cruzadas com o selectedDeviceId NOVO
        // (o useMemo de `conversations` usa o id novo para achar os estados), e
        // clicar nesse intervalo abre uma conversa que pode nem existir no
        // aparelho novo. `setMessages([])` é obrigatório junto: sem ele, limpar
        // as summaries cai no branch de fallback que remonta a lista a partir de
        // `messages` — ou seja, o aparelho antigo de volta.
        setSelectedContact(null)
        setConversationMessages([])
        setConversationSummaries([])
        setMessages([])
        setAssignments(new Map())
        conversationCacheRef.current.clear()
      }
      loadDeviceData(selectedDeviceId)
    } else {
      setMessages([])
      setConversationSummaries([])
      setConversationMessages([])
      setSelectedContact(null)
      prevDeviceIdRef.current = null
    }
  }, [selectedDeviceId, loadDeviceData])

  useEffect(() => {
    if (selectedDeviceId) {
      const device = devices.find((d) => d.id === selectedDeviceId)
      if (device && (!device.avatar_url || !device.avatar_updated_at)) {
        const syncKey = `synced_device_${device.id}`
        if (!sessionStorage.getItem(syncKey)) {
          sessionStorage.setItem(syncKey, '1')
          syncDeviceAvatar(device.id).catch(() => {})
        }
      }
    }
  }, [selectedDeviceId, devices])

  useEffect(() => {
    const enable = () => {
      getAudioContext()
      document.removeEventListener('click', enable)
    }
    document.addEventListener('click', enable, { once: true })
  }, [])

  useRealtime('messages', (e) => {
    if (e.action === 'create' && e.record.direction === 'inbound') {
      const uid = userIdRef.current
      const deviceId = e.record.device_id
      const remoteSender = e.record.remote_sender as string
      const prefs = uid ? getRawDevicePrefs(uid, deviceId) : { sound: true, background: true }

      const assignment = assignments.get(remoteSender)
      const isAssignedToSomeoneElse =
        assignment?.assigned_to != null && assignment.assigned_to !== uid

      if (!isAssignedToSomeoneElse && prefs.sound) {
        playNotificationSound()
      }

      if (!isAssignedToSomeoneElse && prefs.background && 'Notification' in window && Notification.permission === 'granted') {
        const device = devicesRef.current.find((d) => d.id === deviceId)
        const deviceName = device?.name || 'WhatsApp'
        const senderName =
          e.record.sender_name ||
          e.record.remote_sender?.split('@')[0] ||
          'Contato'
        const preview = e.record.content?.slice(0, 80) || '📎 Mídia'
        const notif = new Notification(deviceName, {
          body: `${senderName}: ${preview}`,
          icon: logoUrl,
          silent: true,
        })
        notif.onclick = () => {
          window.focus()
          ;(window as any).electronAPI?.focusWindow?.()
          notif.close()
        }
      }
    }

    if (e.record.device_id === selectedDeviceId) {
      if (e.action === 'create') setMessages((prev) => [...prev, e.record])
      else if (e.action === 'update')
        setMessages((prev) => prev.map((m) => (m.id === e.record.id ? e.record : m)))
      else if (e.action === 'delete')
        setMessages((prev) => prev.filter((m) => m.id !== e.record.id))

      // Atualizar mensagens da conversa aberta
      if (e.record.remote_sender === selectedContact) {
        if (e.action === 'create') {
          // Reconciliação: se este eco corresponde a uma mensagem otimista
          // (temp) ainda pendente, substitui o temp pelo registro real em vez
          // de adicionar — evita balão duplicado. O lookup do pending acontece
          // fora do updater (que pode rodar 2x em StrictMode).
          let matchedTempId: string | null = null
          if (e.record.direction === 'outbound') {
            const fp = messageFingerprint(e.record.device_id, e.record.remote_sender, e.record.content)
            const idx = pendingTempsRef.current.findIndex((p) => p.fp === fp)
            if (idx >= 0) {
              matchedTempId = pendingTempsRef.current[idx].tempId
              pendingTempsRef.current.splice(idx, 1)
            }
          }
          setConversationMessages((prev) => {
            if (prev.some((m) => m.id === e.record.id)) {
              return prev.map((m) => (m.id === e.record.id ? e.record : m))
            }
            if (matchedTempId) {
              return prev.map((m) => (m.id === matchedTempId ? e.record : m))
            }
            return [...prev, e.record]
          })
        } else if (e.action === 'update') {
          setConversationMessages((prev) => prev.map((m) => (m.id === e.record.id ? e.record : m)))
        } else if (e.action === 'delete') {
          setConversationMessages((prev) => prev.filter((m) => m.id !== e.record.id))
        }
      }

      // Atualizar resumos de conversas quando chega mensagem nova
      if (e.action === 'create') {
        debouncedRefreshSummaries(selectedDeviceId)
      }
    }
  })

  const debouncedRefreshSummaries = useMemo(
    () => debounce((deviceId: string) => {
      getConversationSummaries(deviceId)
        .then((summaries) => {
          // Descarta se o usuário já trocou de dispositivo antes desta
          // chamada (debounced) resolver — senão sobrescreve o resumo certo.
          if (selectedDeviceIdRef.current !== deviceId) return
          setConversationSummaries(summaries)
        })
        .catch(() => {})
    }, 150),
    [],
  )

  const refreshConversationStates = useCallback(async () => {
    const states = await getMyStates()
    setUserStates(states)
    if (selectedDeviceId) {
      debouncedRefreshSummaries(selectedDeviceId)
    }
  }, [selectedDeviceId, debouncedRefreshSummaries])

  // ── Optimistic send: exibe a mensagem enviada na hora e reconcilia depois ──
  const addOptimisticMessage = useCallback((tempMsg: any) => {
    // Limpa temps antigos que nunca foram reconciliados (segurança).
    const cutoff = Date.now() - 120000
    pendingTempsRef.current = pendingTempsRef.current.filter((p) => p.ts >= cutoff)
    pendingTempsRef.current.push({
      tempId: tempMsg.id,
      fp: messageFingerprint(tempMsg.device_id, tempMsg.remote_sender, tempMsg.content),
      ts: Date.now(),
    })
    setConversationMessages((prev) => [...prev, tempMsg])
  }, [])

  const confirmOptimisticMessage = useCallback((tempId: string, realMsg?: any) => {
    // Remove o pending para o eco do realtime não tentar reconciliar de novo.
    pendingTempsRef.current = pendingTempsRef.current.filter((p) => p.tempId !== tempId)
    setConversationMessages((prev) => {
      if (realMsg && realMsg.id) {
        // Substitui a mensagem otimista pela linha real retornada pela RPC.
        // Determinístico (por tempId) — funciona mesmo se o realtime estiver fora.
        if (prev.some((m) => m.id === realMsg.id)) {
          // O eco do realtime já inseriu a mensagem real → só remove a temp.
          return prev.filter((m) => m.id !== tempId)
        }
        return prev.map((m) => (m.id === tempId ? realMsg : m))
      }
      // Sem a linha real: ao menos marca como enviada.
      return prev.map((m) => (m.id === tempId ? { ...m, status: 'sent' } : m))
    })
    if (selectedDeviceId) debouncedRefreshSummaries(selectedDeviceId)
  }, [selectedDeviceId, debouncedRefreshSummaries])

  const markOptimisticFailed = useCallback((tempId: string) => {
    pendingTempsRef.current = pendingTempsRef.current.filter((p) => p.tempId !== tempId)
    setConversationMessages((prev) =>
      prev.map((m) => (m.id === tempId ? { ...m, status: 'failed' } : m)),
    )
  }, [])

  useRealtime('conversation_user_states', (e) => {
    if (e.record.user_id !== user?.id) return
    if (e.action === 'create' || e.action === 'update') {
      setUserStates((prev) => {
        const idx = prev.findIndex((s) => s.id === e.record.id)
        if (idx >= 0) {
          const next = [...prev]
          next[idx] = e.record as ConversationUserState
          return next
        }
        return [...prev, e.record as ConversationUserState]
      })
    } else if (e.action === 'delete') {
      setUserStates((prev) => prev.filter((s) => s.id !== e.record.id))
    }
    // Reflete pin/arquivar/lida na ordenação da sidebar sem esperar a próxima mensagem.
    if (selectedDeviceId) debouncedRefreshSummaries(selectedDeviceId)
  })

  useRealtime('conversation_assignments', (e) => {
    if (e.action === 'create' || e.action === 'update') {
      const row = e.record as ConversationAssignment
      setAssignments((prev) => {
        const next = new Map(prev)
        next.set(row.remote_sender, row)
        return next
      })
    } else if (e.action === 'delete') {
      const row = e.record as ConversationAssignment
      setAssignments((prev) => {
        const next = new Map(prev)
        next.delete(row.remote_sender)
        return next
      })
    }
    if (selectedDeviceId) debouncedRefreshSummaries(selectedDeviceId)
  })

  const writeConversationCache = useCallback((key: string, msgs: any[]) => {
    const cache = conversationCacheRef.current
    cache.delete(key)
    cache.set(key, msgs)
    // Map preserva ordem de inserção: a primeira chave é sempre a mais antiga.
    while (cache.size > CONVERSATION_CACHE_MAX) {
      const oldest = cache.keys().next().value
      if (oldest === undefined) break
      cache.delete(oldest)
    }
  }, [])

  // Busca as mensagens de uma conversa específica; só aplica o resultado se
  // dispositivo+contato ainda forem os selecionados quando a resposta chegar.
  const loadConversationMessages = useCallback((deviceId: string, contact: string) => {
    const key = conversationCacheKey(deviceId, contact)
    const cached = conversationCacheRef.current.get(key)
    if (cached && selectedDeviceIdRef.current === deviceId && selectedContactRef.current === contact) {
      // Pinta o snapshot imediatamente e revalida logo abaixo. Sem isto, voltar
      // para uma conversa já vista pisca em branco durante o round-trip.
      setConversationMessages(cached)
    }
    return getConversationMessages(deviceId, contact)
      .then((msgs) => {
        writeConversationCache(key, msgs)
        if (selectedDeviceIdRef.current !== deviceId || selectedContactRef.current !== contact) return
        setConversationMessages(msgs)
      })
      .catch(() => {})
  }, [writeConversationCache])

  // Botão manual de "atualizar tudo": recarrega resumos, mensagens e
  // atribuições do WhatsApp selecionado (e a conversa aberta, se houver).
  const handleRefreshAll = useCallback(async () => {
    const deviceId = selectedDeviceId
    if (!deviceId) return
    setIsRefreshingAll(true)
    try {
      const contact = selectedContact
      await Promise.all([
        loadDeviceData(deviceId),
        contact ? loadConversationMessages(deviceId, contact) : Promise.resolve(),
      ])
    } finally {
      setIsRefreshingAll(false)
    }
  }, [selectedDeviceId, selectedContact, loadDeviceData, loadConversationMessages])

  // Carregar mensagens da conversa selecionada
  useEffect(() => {
    if (selectedDeviceId && selectedContact) {
      loadConversationMessages(selectedDeviceId, selectedContact)
    } else {
      setConversationMessages([])
    }
  }, [selectedDeviceId, selectedContact, loadConversationMessages])

  // Mantém o cache em dia com a conversa aberta. Guardar só o snapshot do fetch
  // não basta: mensagens que chegam pelo realtime enquanto a conversa está
  // aberta ficariam de fora, e reabrir mostraria a lista encolhida por um
  // instante antes de o fetch corrigir — a lista cresceria na frente do usuário,
  // o oposto do que o cache existe para fazer.
  useEffect(() => {
    if (!selectedDeviceId || !selectedContact) return
    if (conversationMessages.length === 0) return
    writeConversationCache(
      conversationCacheKey(selectedDeviceId, selectedContact),
      conversationMessages,
    )
  }, [selectedDeviceId, selectedContact, conversationMessages, writeConversationCache])

  // Rede de segurança: se o realtime falhar (queda de WebSocket, sleep, troca de
  // rede), re-busca a conversa aberta e os resumos ao voltar o foco/visibilidade/
  // rede e a cada ~25s enquanto visível. Automatiza o "sair e entrar" manual.
  useEffect(() => {
    const refetchOpen = () => {
      if (document.visibilityState !== 'visible') return
      // Um Alt-Tab dispara focus + visibilitychange (e às vezes online) quase no
      // mesmo instante, cada um refazendo a query de 500 mensagens e a RPC de
      // resumos. 10 s de janela colapsa a rajada em uma rodada só.
      const agora = Date.now()
      if (agora - lastRefetchRef.current < 10000) return
      lastRefetchRef.current = agora

      const deviceId = selectedDeviceIdRef.current
      const contact = selectedContactRef.current
      if (deviceId && contact) {
        loadConversationMessages(deviceId, contact)
      }
      if (deviceId) debouncedRefreshSummaries(deviceId)
    }
    const onVisibility = () => {
      if (document.visibilityState === 'visible') refetchOpen()
    }
    window.addEventListener('focus', refetchOpen)
    window.addEventListener('online', refetchOpen)
    document.addEventListener('visibilitychange', onVisibility)
    const interval = setInterval(refetchOpen, 60000)
    return () => {
      window.removeEventListener('focus', refetchOpen)
      window.removeEventListener('online', refetchOpen)
      document.removeEventListener('visibilitychange', onVisibility)
      clearInterval(interval)
    }
    // `selectedDeviceId`/`selectedContact` de propósito FORA das deps: o corpo lê
    // as refs, que já refletem o valor mais recente. Mantê-los aqui destruía e
    // recriava o setInterval a cada clique em outra conversa, e o poll de 60 s
    // praticamente nunca chegava a disparar para um atendente ativo.
  }, [loadConversationMessages, debouncedRefreshSummaries])

  const handleCloseConversation = useCallback(() => {
    setSelectedContact(null)
    setIsSheetOpen(false)
  }, [])

  useEffect(() => {
    if (!selectedContact) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (e.defaultPrevented) return
      e.preventDefault()
      handleCloseConversation()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [selectedContact, handleCloseConversation])

  const handleOpenInfo = useCallback((deviceId: string, remoteSender: string) => {
    setSelectedContact(remoteSender)
    setIsSheetOpen(true)
  }, [])

  const handleCreateContact = useCallback(async () => {
    const ddd = newContactDdd.replace(/\D/g, '')
    const numero = newContactNumber.replace(/\D/g, '')
    if (!ddd || !numero) {
      toast({ title: 'Preencha DDD e número', variant: 'destructive' })
      return
    }
    if (ddd.length < 2) {
      toast({ title: 'DDD inválido', variant: 'destructive' })
      return
    }
    if (numero.length < 8 || numero.length > 9) {
      toast({ title: 'Número inválido (8-9 dígitos)', variant: 'destructive' })
      return
    }

    const jid = `55${ddd}${numero}`

    setIsCreatingContact(true)
    try {
      const created = await updateContactByJid(jid, {
        name: newContactName.trim() || undefined,
      })
      setContacts((prev) => {
        const exists = prev.some((c) => c.remote_jid === jid)
        return exists ? prev : [created, ...prev]
      })
      setIsNewContactOpen(false)
      setNewContactName('')
      setNewContactDdd('')
      setNewContactNumber('')
      setSelectedContact(jid)
      toast({ title: 'Conversa criada com sucesso' })
    } catch {
      toast({ title: 'Erro ao criar conversa', variant: 'destructive' })
    } finally {
      setIsCreatingContact(false)
    }
  }, [newContactName, newContactDdd, newContactNumber, toast])

  const handleOpenNewContact = useCallback(() => {
    setNewContactName('')
    setNewContactDdd('')
    setNewContactNumber('')
    setIsNewContactOpen(true)
  }, [])

  const handleOpenConversationByJid = useCallback((jid: string) => {
    if (!jid) return
    setSelectedContact(jid)
    setIsSheetOpen(false)
  }, [])

  const conversations = useMemo(() => {
    const userStatesMap = new Map<string, ConversationUserState>()
    for (const s of userStates) {
      userStatesMap.set(`${s.device_id}|${s.remote_sender}`, s)
    }

    if (conversationSummaries.length > 0) {
      const mapped = conversationSummaries.map((summary) => {
        const state = userStatesMap.get(`${selectedDeviceId}|${summary.remote_sender}`)
        const assignment = assignments.get(summary.remote_sender)
        const assignedToMe = !!assignment
          && (assignment.status === 'taken' || assignment.status === 'assigned')
          && assignment.assigned_to === user?.id

        let unreadCount = summary.unread_count
        if (state?.manual_unread) {
          unreadCount = Math.max(1, unreadCount)
        } else if (state?.last_read_at) {
          const lastRead = new Date(state.last_read_at)
          const lastMsgDate = new Date(summary.last_message_created_at)
          if (lastMsgDate <= lastRead) {
            unreadCount = 0
          }
        }

        const respondedAt = latestDateString(state?.responded_at, assignment?.global_responded_at)

        return {
          remote_sender: summary.remote_sender,
          sender_name: summary.sender_name,
          lastMessage: {
            id: summary.last_message_id,
            content: summary.last_message_content,
            direction: summary.last_message_direction,
            created_at: summary.last_message_created_at,
            is_read: summary.last_message_is_read,
            attachments: summary.last_message_attachments,
            sender_name: summary.sender_name,
          },
          unread_count: unreadCount,
          message_count: summary.message_count,
          pinned: (state?.pinned ?? false) || assignedToMe,
          archived: state?.archived ?? false,
          pendingReply: summary.last_message_direction === 'inbound' && (!respondedAt || new Date(summary.last_message_created_at) > new Date(respondedAt)),
        }
      })

      return mapped.sort((a, b) => {
        if (a.pinned !== b.pinned) return (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0)
        return new Date(b.lastMessage.created_at).getTime() - new Date(a.lastMessage.created_at).getTime()
      })
    }

    // Fallback: montar a partir das mensagens carregadas (compatibilidade)
    const map = new Map<string, any>()
    messages.forEach((m) => {
      const sender = m.remote_sender || 'Unknown Sender'
      if (!map.has(sender)) {
        map.set(sender, {
          remote_sender: sender,
          sender_name: m.sender_name || '',
          lastMessage: m,
          messages: [],
          unread_count: 0,
        })
      }
      const conv = map.get(sender)
      conv.messages.push(m)
      if (m.sender_name && m.direction === 'inbound') {
        conv.sender_name = m.sender_name
      }
      if (new Date(m.created_at) > new Date(conv.lastMessage.created_at)) {
        conv.lastMessage = m
      }
    })
    return Array.from(map.values())
      .map((conv) => {
        const state = userStatesMap.get(`${selectedDeviceId}|${conv.remote_sender}`)
        const assignment = assignments.get(conv.remote_sender)
        const assignedToMe = !!assignment
          && (assignment.status === 'taken' || assignment.status === 'assigned')
          && assignment.assigned_to === user?.id

        if (state?.manual_unread) {
          conv.unread_count = Math.max(1, conv.messages.filter(
            (m: any) => m.direction === 'inbound' && (!state.last_read_at || new Date(m.created_at) > new Date(state.last_read_at)),
          ).length)
        } else if (state?.last_read_at) {
          const lastRead = new Date(state.last_read_at)
          conv.unread_count = conv.messages.filter(
            (m: any) => m.direction === 'inbound' && new Date(m.created_at) > lastRead,
          ).length
        } else {
          conv.unread_count = 0
        }

        conv.pinned = (state?.pinned ?? false) || assignedToMe
        conv.archived = state?.archived ?? false

        if (conv.lastMessage?.sender_name && conv.lastMessage.direction === 'inbound') {
          conv.sender_name = conv.lastMessage.sender_name
        }
        const respondedAt = latestDateString(state?.responded_at, assignment?.global_responded_at)
        conv.pendingReply = conv.lastMessage?.direction === 'inbound' && (!respondedAt || new Date(conv.lastMessage.created_at) > new Date(respondedAt))
        return conv
      })
      .sort((a, b) => {
        if (a.pinned !== b.pinned) return (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0)
        return new Date(b.lastMessage.created_at).getTime() - new Date(a.lastMessage.created_at).getTime()
      })
  }, [conversationSummaries, messages, userStates, selectedDeviceId, assignments, user?.id])

  const selectedDevice = devices.find((d) => d.id === selectedDeviceId)

  const currentConversation = useMemo(() => {
    const baseConv = conversations.find((c) => c.remote_sender === selectedContact)
    if (!baseConv) return undefined
    return {
      ...baseConv,
      messages: conversationMessages,
    }
  }, [conversations, selectedContact, conversationMessages])

  const currentAssignment = useMemo(() => {
    return selectedContact ? assignments.get(selectedContact) ?? null : null
  }, [assignments, selectedContact])

  const containerRef = useRef<HTMLDivElement>(null)
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_DEFAULT)
  const sidebarWidthRef = useRef(sidebarWidth)
  sidebarWidthRef.current = sidebarWidth

  const clampSidebarWidth = useCallback((width: number, containerWidth?: number) => {
    let max = SIDEBAR_MAX
    if (containerWidth) {
      max = Math.min(SIDEBAR_MAX, containerWidth - CHAT_MIN)
    }
    return Math.max(SIDEBAR_MIN, Math.min(width, max))
  }, [])

  useEffect(() => {
    const stored = localStorage.getItem(SIDEBAR_STORAGE_KEY)
    const cw = containerRef.current?.clientWidth
    if (stored && cw) {
      const parsed = Number(stored)
      if (Number.isFinite(parsed)) {
        setSidebarWidth(clampSidebarWidth(parsed, cw))
      }
    }
  }, [clampSidebarWidth])

  useEffect(() => {
    const handleResize = () => {
      if (containerRef.current) {
        setSidebarWidth((prev) => clampSidebarWidth(prev, containerRef.current!.clientWidth))
      }
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [clampSidebarWidth])

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault()
    const startX = e.clientX
    const startWidth = sidebarWidthRef.current
    const containerRect = containerRef.current?.getBoundingClientRect()
    if (!containerRect) return

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const delta = moveEvent.clientX - startX
      const newWidth = clampSidebarWidth(startWidth + delta, containerRect.width)
      setSidebarWidth(newWidth)
    }

    const handlePointerUp = () => {
      localStorage.setItem(SIDEBAR_STORAGE_KEY, String(sidebarWidthRef.current))
      document.removeEventListener('pointermove', handlePointerMove)
      document.removeEventListener('pointerup', handlePointerUp)
    }

    document.addEventListener('pointermove', handlePointerMove)
    document.addEventListener('pointerup', handlePointerUp)
  }, [clampSidebarWidth])

  return (
    <div ref={containerRef} className="h-full w-full relative bg-chat-app border-chat-border flex rounded-none md:rounded-2xl border overflow-hidden shadow-[0_8px_30px_rgba(0,0,0,0.4)]">

      {(!isMobile || !selectedContact) && (
        isMobile ? (
          <ChatList
            devices={devices}
            selectedDeviceId={selectedDeviceId}
            onSelectDevice={setSelectedDeviceId}
            conversations={conversations}
            contacts={contacts}
            selectedContact={selectedContact}
            onSelectContact={setSelectedContact}
            isMobile={true}
            conversationStates={userStates}
            onOpenInfo={handleOpenInfo}
            showArchived={showArchived}
            onToggleArchived={() => setShowArchived(!showArchived)}
            onStateChange={refreshConversationStates}
            noteJids={noteJids}
            assignments={assignments}
            currentUserId={user?.id}
            onRefreshAll={handleRefreshAll}
            isRefreshingAll={isRefreshingAll}
          />
        ) : (
          <div
            className="flex flex-col h-full bg-chat-sidebar border-r border-chat-border relative flex-shrink-0"
            style={{ width: sidebarWidth }}
          >
            <ChatList
              devices={devices}
              selectedDeviceId={selectedDeviceId}
              onSelectDevice={setSelectedDeviceId}
              conversations={conversations}
              contacts={contacts}
              selectedContact={selectedContact}
              onSelectContact={setSelectedContact}
              isMobile={false}
              conversationStates={userStates}
              onOpenInfo={handleOpenInfo}
              showArchived={showArchived}
              onToggleArchived={() => setShowArchived(!showArchived)}
              onStateChange={refreshConversationStates}
              noteJids={noteJids}
              assignments={assignments}
              currentUserId={user?.id}
              onRefreshAll={handleRefreshAll}
              isRefreshingAll={isRefreshingAll}
            />
            <div
              className="absolute -right-[6px] top-0 bottom-0 w-[14px] cursor-col-resize z-10 flex items-center justify-center"
              onPointerDown={handlePointerDown}
            >
              <div className="w-1 h-3/5 mx-auto hover:bg-blue-400/40 active:bg-blue-500/50 transition-colors rounded-full" />
            </div>
          </div>
        )
      )}
      {(!isMobile || selectedContact) && (
        <ChatWindow
          device={selectedDevice}
          contact={selectedContact}
          conversation={currentConversation}
          assignment={currentAssignment}
          contacts={contacts}
          onBack={handleCloseConversation}
          isMobile={isMobile}
          sheetOpen={isSheetOpen}
          onSheetOpenChange={setIsSheetOpen}
          onStartConversation={handleOpenNewContact}
          onOpenConversationByJid={handleOpenConversationByJid}
          onOptimisticSend={addOptimisticMessage}
          onOptimisticConfirm={confirmOptimisticMessage}
          onOptimisticFail={markOptimisticFailed}
        />
      )}
      <Dialog open={isNewContactOpen} onOpenChange={setIsNewContactOpen}>
        <DialogContent className="sm:max-w-[440px] bg-chat-panel border-chat-border">
          <DialogHeader>
            <DialogTitle>Adicionar nova conversa</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-1.5">
              <Label htmlFor="new-contact-name">Nome (opcional)</Label>
              <Input
                id="new-contact-name"
                value={newContactName}
                onChange={(e) => setNewContactName(e.target.value)}
                placeholder="Nome do contato"
                className="bg-chat-sidebar border-chat-border text-chat-text"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-1.5">
                <Label htmlFor="new-contact-ddd">DDD</Label>
                <Input
                  id="new-contact-ddd"
                  value={newContactDdd}
                  onChange={(e) => setNewContactDdd(e.target.value.replace(/\D/g, '').slice(0, 2))}
                  placeholder="11"
                  inputMode="numeric"
                  maxLength={2}
                  className="bg-chat-sidebar border-chat-border text-chat-text text-center"
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="new-contact-number">Número</Label>
                <Input
                  id="new-contact-number"
                  value={newContactNumber}
                  onChange={(e) => setNewContactNumber(e.target.value.replace(/\D/g, '').slice(0, 9))}
                  placeholder="99999-9999"
                  inputMode="numeric"
                  maxLength={9}
                  className="bg-chat-sidebar border-chat-border text-chat-text"
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsNewContactOpen(false)} disabled={isCreatingContact}>
              Cancelar
            </Button>
            <Button onClick={handleCreateContact} disabled={isCreatingContact}>
              {isCreatingContact ? 'Criando...' : 'Criar conversa'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
