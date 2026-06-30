import { useState } from 'react'
import { format } from 'date-fns'
import { UserCheck, Users, Clock, CheckCircle, Loader2 } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import supabase from '@/lib/supabase/client'
import type { ConversationAssignment, ConversationRecentViewer } from '@/lib/supabase/types'

interface ConversationActionModalProps {
  open: boolean
  deviceId: string
  remoteSender: string
  assignment: ConversationAssignment | null
  viewers: ConversationRecentViewer[]
  onClose: () => void
  onTakeOver: () => void
  onAssign: () => void
  onWaiting: () => void
  onFinish: () => void
}

type LoadingAction = 'take' | 'waiting' | 'finish' | null

function safeFormatTime(dateStr: string | null | undefined): string {
  if (!dateStr) return ''
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return ''
  return format(d, 'HH:mm')
}

export function ConversationActionModal({
  open,
  deviceId,
  remoteSender,
  assignment,
  viewers = [],
  onClose,
  onTakeOver,
  onAssign,
  onWaiting,
  onFinish,
}: ConversationActionModalProps) {
  const [loading, setLoading] = useState<LoadingAction>(null)

  const isLoading = loading !== null

  async function handleTake() {
    setLoading('take')
    try {
      const { error } = await supabase.rpc('take_conversation', {
        p_device_id: deviceId,
        p_remote_sender: remoteSender,
      })
      if (error) throw error
      onTakeOver()
      onClose()
    } catch (err) {
      console.error('Error taking conversation:', err)
    } finally {
      setLoading(null)
    }
  }

  async function handleWaiting() {
    setLoading('waiting')
    try {
      const { error } = await supabase.rpc('set_conversation_waiting', {
        p_device_id: deviceId,
        p_remote_sender: remoteSender,
      })
      if (error) throw error
      onWaiting()
      onClose()
    } catch (err) {
      console.error('Error setting conversation to waiting:', err)
    } finally {
      setLoading(null)
    }
  }

  async function handleFinish() {
    setLoading('finish')
    try {
      const { error } = await supabase.rpc('finish_conversation', {
        p_device_id: deviceId,
        p_remote_sender: remoteSender,
      })
      if (error) throw error
      onFinish()
      onClose()
    } catch (err) {
      console.error('Error finishing conversation:', err)
    } finally {
      setLoading(null)
    }
  }

  function handleAssign() {
    onAssign()
    onClose()
  }

  return (
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen && !isLoading) onClose() }}>
      <DialogContent
        className="max-w-sm w-full"
        onEscapeKeyDown={(e) => { if (isLoading) e.preventDefault() }}
        onPointerDownOutside={(e) => { if (isLoading) e.preventDefault() }}
      >
        <DialogHeader>
          <DialogTitle className="text-base font-semibold">
            Conversa aguardando atenção
          </DialogTitle>
          <DialogDescription className="sr-only">
            Escolha como deseja lidar com esta conversa de atendimento.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          {/* Viewers section */}
          {viewers.length > 0 && (
            <div className="text-sm text-muted-foreground">
              {viewers.map((viewer, index) => {
                const timeStr = safeFormatTime(viewer.read_at)
                const label = timeStr
                  ? `${viewer.user_name} às ${timeStr}`
                  : viewer.user_name
                return (
                  <span key={`${viewer.user_id}-${viewer.read_at}`}>
                    {index === 0
                      ? `Mensagem visualizada por: ${label}`
                      : `, ${label}`}
                  </span>
                )
              })}
            </div>
          )}

          {/* Waiting status notice */}
          {assignment?.status === 'waiting' && (
            <div className="flex items-center gap-2 rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950/30 dark:border-amber-800/40 dark:text-amber-300">
              <Clock className="h-4 w-4 shrink-0" />
              <span>Alguém marcou como não pode responder agora</span>
            </div>
          )}

          {/* Action buttons */}
          <div className="flex flex-col gap-2 pt-1">
            <Button
              variant="default"
              size="lg"
              className="w-full justify-start gap-3 text-sm font-medium"
              onClick={handleTake}
              disabled={isLoading}
            >
              {loading === 'take' ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <UserCheck className="h-4 w-4" />
              )}
              Pegar atendimento
            </Button>

            <Button
              variant="secondary"
              size="lg"
              className="w-full justify-start gap-3 text-sm font-medium"
              onClick={handleAssign}
              disabled={isLoading}
            >
              <Users className="h-4 w-4" />
              Designar para equipe
            </Button>

            <Button
              variant="outline"
              size="lg"
              className="w-full justify-start gap-3 text-sm font-medium border-amber-300 text-amber-700 hover:bg-amber-50 hover:text-amber-800 dark:border-amber-700 dark:text-amber-400 dark:hover:bg-amber-950/30"
              onClick={handleWaiting}
              disabled={isLoading}
            >
              {loading === 'waiting' ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Clock className="h-4 w-4" />
              )}
              Não posso responder agora
            </Button>

            <Button
              variant="outline"
              size="lg"
              className="w-full justify-start gap-3 text-sm font-medium border-green-300 text-green-700 hover:bg-green-50 hover:text-green-800 dark:border-green-700 dark:text-green-400 dark:hover:bg-green-950/30"
              onClick={handleFinish}
              disabled={isLoading}
            >
              {loading === 'finish' ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <CheckCircle className="h-4 w-4" />
              )}
              Finalizar atendimento
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
