/**
 * Escolher (ou tirar) o atendente fixo de um contato.
 *
 * Espelha o `TeamAssignDialog` de propósito — mesma lista de colegas, mesmo
 * jeito de escolher — porque para quem usa é o mesmo gesto. O que muda é o
 * alcance, e o texto da tela precisa deixar isso claro: designar vale para
 * ESTE atendimento; fixar vale para sempre, inclusive nas conversas que ainda
 * nem começaram.
 */

import { useEffect, useState } from 'react'
import { Loader2, Pin, PinOff } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { ScrollArea } from '@/components/ui/scroll-area'
import { getDeviceTeamMembers } from '@/services/conversation_states'
import { desfixarContato, fixarContato, type DonoDoContato } from '@/services/contact_owners'
import type { TeamMember } from '@/lib/supabase/types'
import { useToast } from '@/hooks/use-toast'

interface Props {
  open: boolean
  deviceId: string
  remoteSender: string
  /** O vínculo de hoje, para marcar quem já é dono e liberar o "deixar de fixar". */
  donoAtual: DonoDoContato | null
  onClose: () => void
  onChanged: () => void
}

function iniciais(nome: string | null): string {
  if (!nome) return '?'
  return nome.split(' ').slice(0, 2).map((n) => n[0]).join('').toUpperCase()
}

export function DialogoDeContatoFixo({
  open,
  deviceId,
  remoteSender,
  donoAtual,
  onClose,
  onChanged,
}: Props) {
  const [membros, setMembros] = useState<TeamMember[]>([])
  const [carregando, setCarregando] = useState(false)
  const [ocupado, setOcupado] = useState(false)
  const { toast } = useToast()

  useEffect(() => {
    if (!open) return
    setCarregando(true)
    getDeviceTeamMembers(deviceId)
      .then(setMembros)
      .catch(() => setMembros([]))
      .finally(() => setCarregando(false))
  }, [open, deviceId])

  async function fixar(membro: TeamMember) {
    if (ocupado || !membro.user_id) return
    setOcupado(true)
    try {
      await fixarContato(deviceId, remoteSender, membro.user_id)
      toast({
        title: `Contato fixado em ${membro.name ?? 'essa pessoa'}`,
        description:
          'Toda mensagem nova deste contato vai direto para ela quando estiver no app. Fora do app, a conversa fica aguardando.',
      })
      onChanged()
      onClose()
    } catch (e) {
      toast({
        title: 'Não consegui fixar',
        description: e instanceof Error ? e.message : 'Erro desconhecido',
        variant: 'destructive',
      })
    } finally {
      setOcupado(false)
    }
  }

  async function desfixar() {
    if (ocupado) return
    setOcupado(true)
    try {
      await desfixarContato(deviceId, remoteSender)
      toast({ title: 'Contato desfixado', description: 'Ele volta a seguir a fila normal.' })
      onChanged()
      onClose()
    } catch (e) {
      toast({
        title: 'Não consegui desfixar',
        description: e instanceof Error ? e.message : 'Erro desconhecido',
        variant: 'destructive',
      })
    } finally {
      setOcupado(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(aberto) => !aberto && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Pin className="h-4 w-4" /> Contato fixo
          </DialogTitle>
          <DialogDescription>
            Diferente de designar: o vínculo continua valendo depois de finalizar a conversa. Se a
            pessoa não estiver no app quando o contato escrever, a conversa fica aguardando e
            qualquer um pode assumir — ninguém fica sem resposta.
          </DialogDescription>
        </DialogHeader>

        {carregando ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : membros.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Ninguém do time tem acesso a este aparelho.
          </p>
        ) : (
          <ScrollArea className="max-h-72">
            <div className="flex flex-col gap-1 pr-2">
              {membros.map((m) => {
                const ehODono = donoAtual?.owner_id === m.user_id
                return (
                  <button
                    key={m.user_id}
                    type="button"
                    disabled={ocupado}
                    onClick={() => void fixar(m)}
                    className={
                      'flex items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors disabled:opacity-50 ' +
                      (ehODono ? 'bg-primary/10' : 'hover:bg-muted')
                    }
                  >
                    <Avatar className="h-8 w-8">
                      <AvatarImage src={m.avatar_url ?? undefined} />
                      <AvatarFallback className="text-xs">{iniciais(m.name)}</AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{m.name ?? 'Sem nome'}</p>
                      {m.department && (
                        <p className="truncate text-xs text-muted-foreground">{m.department}</p>
                      )}
                    </div>
                    {ehODono && (
                      <span className="shrink-0 text-[11px] font-medium text-primary">fixo hoje</span>
                    )}
                  </button>
                )
              })}
            </div>
          </ScrollArea>
        )}

        {donoAtual && (
          <button
            type="button"
            disabled={ocupado}
            onClick={() => void desfixar()}
            className="mt-1 inline-flex items-center justify-center gap-1.5 rounded-lg border border-border/60 px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted disabled:opacity-50"
          >
            <PinOff className="h-3.5 w-3.5" /> Deixar de fixar este contato
          </button>
        )}
      </DialogContent>
    </Dialog>
  )
}
