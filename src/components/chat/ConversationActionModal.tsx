import { useState } from 'react'
import { format } from 'date-fns'
import { UserCheck, Users, Clock, CheckCircle, Loader2 } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { takeConversation, setConversationWaiting, finishConversation } from '@/services/conversation_states'
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

export function ConversationActionModal({
  open,
  deviceId,
  remoteSender,
  assignment,
  viewers,
  onClose,
  onTakeOver,
  onAssign,
  onWaiting,
  onFinish,
}: ConversationActionModalProps) {
  const [loading, setLoading] = useState<LoadingAction>(null)

  async function handleTake() {
    setLoading('take')
    try {
      await takeConversation(deviceId, remoteSender)
      onTakeOver()
      onClose()
    } finally {
      setLoading(null)
    }
  }

  async function handleWaiting() {
    setLoading('waiting')
    try {
      await setConversationWaiting(deviceId, remoteSender)
      onWaiting()
      onClose()
    } finally {
      setLoading(null)
    }
  }

  async function handleFinish() {
    setLoading('finish')
    try {
      await finishConversation(deviceId, remoteSender)
      onFinish()
      onClose()
    } finally {
      setLoading(null)
    }
  }

  function handleAssign() {
    onAssign()
    onClose()
  }

  const isLoading = loading !== null

  return (
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) onClose() }}>
      <DialogContent className="max-w-sm w-full">
        <DialogHeader>
          <DialogTitle className="text-base font-semibold">
            Conversa aguardando atenção
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          {/* Viewers section */}
          {viewers.length > 0 && (
            <div className="text-sm text-muted-foreground">
              {viewers.map((viewer, index) => (
                <span key={viewer.user_id}>
                  {index === 0
                    ? `Mensagem visualizada por: ${viewer.user_name} às ${format(new Date(viewer.read_at), 'HH:mm')}`
                    : `, ${viewer.user_name} às ${format(new Date(viewer.read_at), 'HH:mm')}`}
                </span>
              ))}
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
