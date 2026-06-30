import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { ScrollArea } from '@/components/ui/scroll-area'
import supabase from '@/lib/supabase/client'
import { getDeviceTeamMembers } from '@/services/conversation_states'
import type { TeamMember } from '@/lib/supabase/types'

interface TeamAssignDialogProps {
  open: boolean
  deviceId: string
  remoteSender: string
  onClose: () => void
  onAssigned: () => void
}

function getInitials(name: string | null): string {
  if (!name) return '?'
  return name.split(' ').slice(0, 2).map(n => n[0]).join('').toUpperCase()
}

export function TeamAssignDialog({
  open,
  deviceId,
  remoteSender,
  onClose,
  onAssigned,
}: TeamAssignDialogProps) {
  const [members, setMembers] = useState<TeamMember[]>([])
  const [loading, setLoading] = useState(false)
  const [assigningId, setAssigningId] = useState<string | null>(null)

  const isAssigning = assigningId !== null

  useEffect(() => {
    if (!open) return
    setLoading(true)
    getDeviceTeamMembers(deviceId)
      .then(setMembers)
      .finally(() => setLoading(false))
  }, [open, deviceId])

  async function handleAssign(member: TeamMember) {
    if (isAssigning) return
    setAssigningId(member.id)
    try {
      const { error } = await supabase.rpc('assign_conversation', {
        p_device_id: deviceId,
        p_remote_sender: remoteSender,
        p_target_user_id: member.id,
      })
      if (error) throw error
      onAssigned()
      onClose()
    } catch (err) {
      console.error('Error assigning conversation:', err)
    } finally {
      setAssigningId(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen && !isAssigning) onClose() }}>
      <DialogContent
        className="max-w-sm w-full"
        onEscapeKeyDown={(e) => { if (isAssigning) e.preventDefault() }}
        onPointerDownOutside={(e) => { if (isAssigning) e.preventDefault() }}
      >
        <DialogHeader>
          <DialogTitle className="text-base font-semibold">
            Designar para membro da equipe
          </DialogTitle>
          <DialogDescription className="sr-only">
            Selecione um membro da equipe para atribuir esta conversa.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex flex-col gap-3 py-2">
            {[1, 2, 3].map((i) => (
              <div key={i} className="flex items-center gap-3 px-1">
                <div className="h-9 w-9 rounded-full bg-muted animate-pulse shrink-0" />
                <div className="flex flex-col gap-1.5 flex-1">
                  <div className="h-3.5 w-32 rounded bg-muted animate-pulse" />
                  <div className="h-3 w-48 rounded bg-muted animate-pulse" />
                </div>
              </div>
            ))}
          </div>
        ) : members.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">
            Nenhum membro do setor encontrado
          </p>
        ) : (
          <ScrollArea className="max-h-72">
            <div className="flex flex-col gap-1 py-1">
              {members.map((member) => {
                const isThisMember = assigningId === member.id
                return (
                  <button
                    key={member.id}
                    type="button"
                    className="flex items-center gap-3 rounded-md px-2 py-2 text-left transition-colors hover:bg-chat-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-60"
                    onClick={() => handleAssign(member)}
                    disabled={isAssigning}
                  >
                    <div className="relative shrink-0">
                      <Avatar className="h-9 w-9">
                        <AvatarImage src={member.avatar_url ?? undefined} alt={member.name ?? ''} />
                        <AvatarFallback className="text-xs">
                          {getInitials(member.name)}
                        </AvatarFallback>
                      </Avatar>
                      {isThisMember && (
                        <span className="absolute inset-0 flex items-center justify-center rounded-full bg-background/70">
                          <Loader2 className="h-4 w-4 animate-spin text-foreground" />
                        </span>
                      )}
                    </div>
                    <div className="flex flex-col min-w-0">
                      <span className="truncate text-sm font-medium text-chat-text">
                        {member.name ?? '—'}
                      </span>
                      {member.email && (
                        <span className="truncate text-xs text-chat-muted">
                          {member.email}
                        </span>
                      )}
                    </div>
                  </button>
                )
              })}
            </div>
          </ScrollArea>
        )}
      </DialogContent>
    </Dialog>
  )
}
