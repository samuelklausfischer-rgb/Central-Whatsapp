import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useIsMobile } from '@/hooks/use-mobile'
import { ChatList } from '@/components/chat/ChatList'
import { ChatWindow } from '@/components/chat/ChatWindow'
import { syncDeviceAvatar } from '@/services/devices'
import { getMessages, getConversationSummaries, getConversationMessages, type ConversationSummary } from '@/services/messages'
import { getContacts } from '@/services/contacts'
import { getMyStates, type ConversationUserState } from '@/services/conversation_states'
import { useRealtime } from '@/hooks/use-realtime'
import { useAuth } from '@/hooks/use-auth'

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
  const [contacts, setContacts] = useState<any[]>([])
  const [selectedContact, setSelectedContact] = useState<string | null>(null)
  const [userStates, setUserStates] = useState<ConversationUserState[]>([])
  const [showArchived, setShowArchived] = useState(false)
  const [isSheetOpen, setIsSheetOpen] = useState(false)

  useEffect(() => {
    getContacts()
      .then(setContacts)
      .catch(() => {})
  }, [])

  useEffect(() => {
    getMyStates().then(setUserStates)
  }, [])

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

  useRealtime('contacts', (e) => {
    if (e.action === 'create') setContacts((prev) => [e.record, ...prev])
    else if (e.action === 'update')
      setContacts((prev) => prev.map((c) => (c.id === e.record.id ? e.record : c)))
    else if (e.action === 'delete') setContacts((prev) => prev.filter((c) => c.id !== e.record.id))
  })

  useEffect(() => {
    if (selectedDeviceId) {
      sessionStorage.setItem('activeDeviceId', selectedDeviceId)
      getMessages(selectedDeviceId).then(setMessages)
      getConversationSummaries(selectedDeviceId).then(setConversationSummaries)
      setSelectedContact(null)
      setConversationMessages([])
    } else {
      setMessages([])
      setConversationSummaries([])
      setConversationMessages([])
      setSelectedContact(null)
    }
  }, [selectedDeviceId])

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
      playNotificationSound()
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
          setConversationMessages((prev) => [...prev, e.record])
        } else if (e.action === 'update') {
          setConversationMessages((prev) => prev.map((m) => (m.id === e.record.id ? e.record : m)))
        } else if (e.action === 'delete') {
          setConversationMessages((prev) => prev.filter((m) => m.id !== e.record.id))
        }
      }

      // Atualizar resumos de conversas quando chega mensagem nova
      if (e.action === 'create') {
        getConversationSummaries(selectedDeviceId).then(setConversationSummaries)
      }
    }
  })

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
  })

  // Carregar mensagens da conversa selecionada
  useEffect(() => {
    if (selectedDeviceId && selectedContact) {
      getConversationMessages(selectedDeviceId, selectedContact).then(setConversationMessages)
    } else {
      setConversationMessages([])
    }
  }, [selectedDeviceId, selectedContact])

  const handleOpenInfo = useCallback((deviceId: string, remoteSender: string) => {
    setSelectedContact(remoteSender)
    setIsSheetOpen(true)
  }, [])

  const conversations = useMemo(() => {
    if (conversationSummaries.length > 0) {
      // Usar resumos do banco (ordenados corretamente)
      return conversationSummaries.map((summary) => {
        const state = userStates.find(
          (s) => s.device_id === selectedDeviceId && s.remote_sender === summary.remote_sender,
        )

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
          unread_count: summary.unread_count,
          message_count: summary.message_count,
          pinned: state?.pinned ?? false,
          archived: state?.archived ?? false,
          pendingReply: summary.last_message_direction === 'inbound',
        }
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
        const state = userStates.find(
          (s) => s.device_id === selectedDeviceId && s.remote_sender === conv.remote_sender,
        )

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

        conv.pinned = state?.pinned ?? false
        conv.archived = state?.archived ?? false

        if (conv.lastMessage?.sender_name && conv.lastMessage.direction === 'inbound') {
          conv.sender_name = conv.lastMessage.sender_name
        }
        conv.pendingReply = conv.lastMessage?.direction === 'inbound'
        return conv
      })
      .sort((a, b) => {
        if (a.pinned !== b.pinned) return (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0)
        return new Date(b.lastMessage.created_at).getTime() - new Date(a.lastMessage.created_at).getTime()
      })
  }, [conversationSummaries, messages, userStates, selectedDeviceId])

  const selectedDevice = devices.find((d) => d.id === selectedDeviceId)

  const currentConversation = useMemo(() => {
    const baseConv = conversations.find((c) => c.remote_sender === selectedContact)
    if (!baseConv) return undefined
    return {
      ...baseConv,
      messages: conversationMessages,
    }
  }, [conversations, selectedContact, conversationMessages])

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
    <div ref={containerRef} className="h-full w-full relative bg-chat-app backdrop-blur-2xl border-chat-border flex rounded-none md:rounded-2xl border overflow-hidden shadow-[0_8px_30px_rgba(0,0,0,0.4)]">

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
            />
            <div
              className="absolute right-0 top-0 bottom-0 w-4 cursor-col-resize z-20 -mr-2"
              onPointerDown={handlePointerDown}
            >
              <div className="w-1.5 h-full mx-auto hover:bg-blue-400/40 active:bg-blue-500/50 transition-colors rounded-full" />
            </div>
          </div>
        )
      )}
      {(!isMobile || selectedContact) && (
        <ChatWindow
          device={selectedDevice}
          contact={selectedContact}
          conversation={currentConversation}
          contacts={contacts}
          onBack={() => setSelectedContact(null)}
          isMobile={isMobile}
          sheetOpen={isSheetOpen}
          onSheetOpenChange={setIsSheetOpen}
        />
      )}
    </div>
  )
}
