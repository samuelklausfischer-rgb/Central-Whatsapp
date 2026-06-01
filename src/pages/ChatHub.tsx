import { useState, useEffect, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Settings2 } from 'lucide-react'
import { useIsMobile } from '@/hooks/use-mobile'
import { ChatList } from '@/components/chat/ChatList'
import { ChatWindow } from '@/components/chat/ChatWindow'
import { syncDeviceAvatar } from '@/services/devices'
import { getMessages } from '@/services/messages'
import { getContacts } from '@/services/contacts'
import { useRealtime } from '@/hooks/use-realtime'
import { Button } from '@/components/ui/button'
import { SignatureManagerDialog } from '@/components/SignatureManagerDialog'
import { useAuth } from '@/hooks/use-auth'

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
  const [contacts, setContacts] = useState<any[]>([])
  const [selectedContact, setSelectedContact] = useState<string | null>(null)

  useEffect(() => {
    getContacts()
      .then(setContacts)
      .catch(() => {})
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
      setSelectedContact(null)
    } else {
      setMessages([])
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
    }
  })

  const conversations = useMemo(() => {
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
      if (!m.is_read && m.direction === 'inbound') {
        conv.unread_count += 1
      }
    })
    return Array.from(map.values())
      .map((conv) => {
        if (conv.lastMessage?.sender_name && conv.lastMessage.direction === 'inbound') {
          conv.sender_name = conv.lastMessage.sender_name
        }
        conv.pendingReply = conv.lastMessage?.direction === 'inbound'
        return conv
      })
      .sort(
        (a, b) =>
          new Date(b.lastMessage.created_at).getTime() - new Date(a.lastMessage.created_at).getTime(),
      )
  }, [messages])

  const selectedDevice = devices.find((d) => d.id === selectedDeviceId)

  const currentConversation = useMemo(() => {
    return conversations.find((c) => c.remote_sender === selectedContact)
  }, [conversations, selectedContact])

  const [isSignaturesModalOpen, setIsSignaturesModalOpen] = useState(false)

  return (
    <div className="h-full w-full relative bg-card backdrop-blur-2xl border-border flex rounded-none md:rounded-2xl border overflow-hidden shadow-[0_8px_30px_rgba(0,0,0,0.4)]">
      {(!isMobile || !selectedContact) && (
        <Button
          variant="outline"
          size="icon"
          className="absolute bottom-6 left-6 z-50 h-12 w-12 rounded-full shadow-2xl bg-card border-border backdrop-blur-xl hover:bg-accent transition-all hover:scale-105"
          onClick={() => setIsSignaturesModalOpen(true)}
          title="Gerenciar Assinaturas de Dispositivos"
        >
          <Settings2 className="h-5 w-5 text-foreground" />
        </Button>
      )}

      <SignatureManagerDialog
        open={isSignaturesModalOpen}
        onOpenChange={setIsSignaturesModalOpen}
        devices={devices}
      />

      {(!isMobile || !selectedContact) && (
        <ChatList
          devices={devices}
          selectedDeviceId={selectedDeviceId}
          onSelectDevice={setSelectedDeviceId}
          conversations={conversations}
          contacts={contacts}
          selectedContact={selectedContact}
          onSelectContact={setSelectedContact}
          isMobile={isMobile}
        />
      )}
      {(!isMobile || selectedContact) && (
        <ChatWindow
          device={selectedDevice}
          contact={selectedContact}
          conversation={currentConversation}
          contacts={contacts}
          onBack={() => setSelectedContact(null)}
          isMobile={isMobile}
        />
      )}
    </div>
  )
}
