import { Users } from 'lucide-react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { iniciaisDe } from '@/lib/chat-interno'
import { cn } from '@/lib/utils'

/**
 * Foto da pessoa (ou ícone de grupo) do Chat interno.
 *
 * Não reaproveita o `SmartAvatar`: aquele busca foto de WhatsApp por `jid` e
 * instância, e aqui a foto é só o `avatar_url` do perfil. A URL do perfil é
 * estável — diferente da assinada dos anexos, que vem de `useUrlsDosAnexos`.
 */
export function AvatarInterno({
  nome,
  url,
  grupo = false,
  className,
  fallbackClassName,
}: {
  nome: string | null | undefined
  url?: string | null
  grupo?: boolean
  className?: string
  fallbackClassName?: string
}) {
  const iniciais = iniciaisDe(nome)
  return (
    <Avatar className={cn('border border-chat-border bg-chat-sidebar', className)}>
      {url && !grupo && <AvatarImage src={url} alt={nome ?? ''} className="object-cover" />}
      <AvatarFallback className={cn('bg-chat-panel text-chat-muted', fallbackClassName)}>
        {grupo ? <Users className="h-1/2 w-1/2 opacity-70" /> : iniciais || <Users className="h-1/2 w-1/2 opacity-50" />}
      </AvatarFallback>
    </Avatar>
  )
}
