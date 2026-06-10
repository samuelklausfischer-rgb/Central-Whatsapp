import React, { useEffect, useState } from 'react'
import {
  CalendarClock,
  CheckCircle,
  Clock,
  RefreshCw,
  Trash2,
  XCircle,
  AlertCircle,
  Smartphone,
  Paperclip,
} from 'lucide-react'

import {
  getScheduledMessages,
  deleteScheduledMessage,
  updateScheduledMessage,
  retryScheduledMessage,
  type ScheduledMessageWithContact,
} from '@/services/scheduled_messages'
import { useRealtime } from '@/hooks/use-realtime'
import { useToast } from '@/hooks/use-toast'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'

export default function ScheduledMessages() {
  const [messages, setMessages] = useState<ScheduledMessageWithContact[]>([])
  const [loading, setLoading] = useState(true)
  const { toast } = useToast()

  const loadMessages = async () => {
    try {
      const data = await getScheduledMessages()
      setMessages(data)
    } catch (err) {
      toast({ title: 'Erro ao carregar mensagens agendadas', variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadMessages()
  }, [])

  useRealtime('scheduled_messages', () => {
    loadMessages()
  })

  const handleCancel = async (id: string) => {
    try {
      await updateScheduledMessage(id, { status: 'cancelled' })
      toast({ title: 'Mensagem cancelada com sucesso' })
    } catch {
      toast({ title: 'Erro ao cancelar mensagem', variant: 'destructive' })
    }
  }

  const handleRetry = async (id: string) => {
    try {
      await retryScheduledMessage(id)
      toast({ title: 'Mensagem será reenviada em breve' })
    } catch {
      toast({ title: 'Erro ao reagendar mensagem', variant: 'destructive' })
    }
  }

  const handleDelete = async (id: string) => {
    try {
      await deleteScheduledMessage(id)
      toast({ title: 'Mensagem excluída com sucesso' })
    } catch {
      toast({ title: 'Erro ao excluir mensagem', variant: 'destructive' })
    }
  }

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'pending':
        return (
          <Badge className="bg-amber-500/20 text-amber-500 border-amber-500/30 gap-1.5 flex items-center">
            <Clock className="w-3.5 h-3.5" /> Pendente
          </Badge>
        )
      case 'sent':
        return (
          <Badge className="bg-emerald-500/20 text-emerald-500 border-emerald-500/30 gap-1.5 flex items-center">
            <CheckCircle className="w-3.5 h-3.5" /> Enviada
          </Badge>
        )
      case 'processing':
        return (
          <Badge className="bg-blue-500/20 text-blue-500 border-blue-500/30 gap-1.5 flex items-center">
            <Clock className="w-3.5 h-3.5" /> Processando
          </Badge>
        )
      case 'failed':
        return (
          <Badge className="bg-red-500/20 text-red-500 border-red-500/30 gap-1.5 flex items-center">
            <AlertCircle className="w-3.5 h-3.5" /> Falha
          </Badge>
        )
      case 'cancelled':
        return (
          <Badge className="bg-zinc-500/20 text-zinc-400 border-zinc-500/30 gap-1.5 flex items-center">
            <XCircle className="w-3.5 h-3.5" /> Cancelada
          </Badge>
        )
      default:
        return <Badge variant="outline">{status}</Badge>
    }
  }

  const formatDateTime = (dateStr: string) => {
    return new Intl.DateTimeFormat('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(dateStr))
  }

  return (
    <div className="flex-1 overflow-y-auto bg-muted p-8">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex flex-col gap-2">
          <h1 className="text-3xl font-display font-bold text-foreground tracking-tight flex items-center gap-3">
            <CalendarClock className="w-8 h-8 text-blue-500" />
            Mensagens Agendadas
          </h1>
          <p className="text-muted-foreground text-sm">
            Gerencie os envios programados, cancele ou remova mensagens antigas.
          </p>
        </div>

        <Card className="bg-card border-border backdrop-blur-xl">
          <CardHeader>
            <CardTitle>Histórico de Agendamentos</CardTitle>
            <CardDescription>
              Visualize todas as suas mensagens com envio futuro ou já processadas.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="text-center py-10 text-muted-foreground">Carregando...</div>
            ) : messages.length === 0 ? (
              <div className="text-center py-16 text-muted-foreground flex flex-col items-center gap-3">
                <CalendarClock className="w-10 h-10 opacity-20" />
                <p>Nenhuma mensagem agendada encontrada.</p>
              </div>
            ) : (
              <div className="rounded-md border border-border overflow-hidden">
                <Table>
                  <TableHeader className="bg-accent">
                    <TableRow className="border-border hover:bg-transparent">
                      <TableHead>Contato</TableHead>
                      <TableHead>Dispositivo</TableHead>
                      <TableHead>Mensagem</TableHead>
                      <TableHead>Agendado para</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Ações</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {messages.map((msg) => (
                      <TableRow
                        key={msg.id}
                        className="border-border hover:bg-accent transition-colors"
                      >
                        <TableCell className="font-medium">
                          <span>{msg.contact_name || msg.remote_sender}</span>
                          {msg.contact_name && (
                            <span className="block text-xs text-muted-foreground font-normal">{msg.remote_sender}</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Avatar className="h-6 w-6 rounded-md bg-blue-500/20 border border-blue-500/30">
                              <AvatarFallback className="bg-transparent">
                                <Smartphone className="h-3 w-3 text-blue-400" />
                              </AvatarFallback>
                            </Avatar>
                            <span className="text-xs text-muted-foreground">
                              {msg.device_name || 'Desconhecido'}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="max-w-[250px]">
                          <div
                            className="truncate text-sm text-foreground/80 flex items-center gap-1.5"
                            title={msg.content}
                          >
                            {msg.attachments && msg.attachments.length > 0 && (
                              <Paperclip className="h-3.5 w-3.5 flex-shrink-0 text-blue-400" />
                            )}
                            <span>
                              {msg.content === '[Anexo]' ? 'Mensagem com Anexo(s)' : msg.content}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="text-sm whitespace-nowrap">
                          {formatDateTime(msg.scheduled_at)}
                        </TableCell>
                        <TableCell>
                          <div className="space-y-1">
                            {getStatusBadge(msg.status)}
                            {msg.status === 'failed' && msg.error_message && (
                              <p className="text-xs text-red-400 max-w-[220px] truncate" title={msg.error_message}>
                                {msg.error_message}
                              </p>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-right whitespace-nowrap space-x-2">
                          {msg.status === 'pending' && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-8 bg-transparent border-border hover:bg-accent"
                              onClick={() => handleCancel(msg.id!)}
                            >
                              Cancelar
                            </Button>
                          )}
                          {msg.status === 'failed' && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-8 bg-transparent border-border hover:bg-accent"
                              onClick={() => handleRetry(msg.id!)}
                            >
                              <RefreshCw className="h-3.5 w-3.5 mr-1" />
                              Reenviar
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 p-0 text-red-400 hover:text-red-300 hover:bg-red-400/10"
                            onClick={() => handleDelete(msg.id!)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
