import { useEffect, useState } from 'react'
import {
  CalendarClock,
  Clock,
  RefreshCw,
  Trash2,
  XCircle,
  AlertCircle,
  CheckCircle,
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
import { CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { GlassCard } from '@/components/ui/surface'
import { ListRow, ListRowPill, type ListRowTom } from '@/components/ui/list-row'
import { useIsMobile } from '@/hooks/use-mobile'

// Mesmo mapa de tom que o resto do idioma de listas usa (`ListRowTom`) — o
// "ponto de status" pedido para esta tela é justamente este mapa aplicado ao
// `status` de 5 valores da mensagem agendada, e não só hoje/não-hoje como a
// prévia da home usa (lá só existem itens pendentes).
const STATUS_TOM: Record<ScheduledMessageWithContact['status'], ListRowTom> = {
  pending: 'ambar',
  sent: 'esmeralda',
  processing: 'azul',
  failed: 'rosa',
  cancelled: 'ardosia',
}
const STATUS_LABEL: Record<ScheduledMessageWithContact['status'], string> = {
  pending: 'Pendente',
  sent: 'Enviada',
  processing: 'Processando',
  failed: 'Falha',
  cancelled: 'Cancelada',
}
const STATUS_ICON: Record<ScheduledMessageWithContact['status'], typeof Clock> = {
  pending: Clock,
  sent: CheckCircle,
  processing: Clock,
  failed: AlertCircle,
  cancelled: XCircle,
}

export default function ScheduledMessages() {
  const [messages, setMessages] = useState<ScheduledMessageWithContact[]>([])
  const [loading, setLoading] = useState(true)
  const { toast } = useToast()

  // Sem hover no APK Android (Capacitor): um controle só visível em hover é,
  // na prática, um controle que não existe no toque. No celular ele fica
  // sempre visível.
  const noCelular = useIsMobile()

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

  const classesAcoesMensagem = noCelular
    ? 'flex items-center gap-0.5 opacity-100'
    : 'flex items-center gap-0.5 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity'

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
    <div className="flex-1 overflow-y-auto p-8">
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

        {/*
          `GlassCard` no lugar do `<Card className="bg-card border-border
          backdrop-blur-xl">` que envolvia a página inteira: `bg-card` é
          opaco (sem alpha), então aquele `backdrop-blur-xl` era morto — não
          havia nada por baixo para borrar, só GPU gasta à toa. `GlassCard`
          já resolve vidro + fundo translúcido corretos para os dois temas.
        */}
        <GlassCard>
          <CardHeader>
            <CardTitle>Histórico de Agendamentos</CardTitle>
            <CardDescription>
              Visualize todas as suas mensagens com envio futuro ou já processadas.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="space-y-2" aria-busy="true">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="h-14 rounded-xl bg-foreground/10 animate-pulse" />
                ))}
              </div>
            ) : messages.length === 0 ? (
              <div className="text-center py-16 text-muted-foreground flex flex-col items-center gap-3">
                <CalendarClock className="w-10 h-10 opacity-20" />
                <p>Nenhuma mensagem agendada encontrada.</p>
              </div>
            ) : (
              // Tabela HTML antiga virou lista de linhas — mesmo idioma do
              // card "Agendamentos pendentes" da home: ponto de status (aqui
              // generalizado para os 5 status possíveis, não só hoje/não-hoje)
              // + conteúdo + pílula de data. Nenhuma coluna original ficou de
              // fora: Contato e Mensagem no corpo, Dispositivo e Status na
              // legenda abaixo, Agendado para na pílula, Ações reveladas no
              // hover — sem apertar layout nenhum.
              <div className="space-y-0.5">
                {messages.map((msg) => {
                  const StatusIcon = STATUS_ICON[msg.status]
                  return (
                    <ListRow key={msg.id} status={STATUS_TOM[msg.status]} className="items-start">
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-foreground truncate">
                          {msg.contact_name || msg.remote_sender}
                        </p>
                        <p className="text-[11px] text-muted-foreground truncate mt-0.5 flex items-center gap-1">
                          {msg.attachments && msg.attachments.length > 0 && (
                            <Paperclip className="h-3 w-3 flex-shrink-0" />
                          )}
                          <span className="truncate">
                            {msg.content === '[Anexo]' ? 'Mensagem com Anexo(s)' : msg.content}
                          </span>
                        </p>
                        {msg.status === 'failed' && msg.error_message && (
                          <p className="text-[10px] text-rose-500 truncate mt-0.5" title={msg.error_message}>
                            {msg.error_message}
                          </p>
                        )}
                        <p className="text-[10px] text-muted-foreground/70 mt-1 flex items-center gap-1.5">
                          <StatusIcon className="h-2.5 w-2.5 flex-shrink-0" />
                          {STATUS_LABEL[msg.status]}
                          <span aria-hidden="true">·</span>
                          <Smartphone className="h-2.5 w-2.5 flex-shrink-0" />
                          {msg.device_name || 'Desconhecido'}
                        </p>
                      </div>

                      <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                        <ListRowPill tom={STATUS_TOM[msg.status]}>{formatDateTime(msg.scheduled_at)}</ListRowPill>
                        {/* No APK Android não existe hover: sem `useIsMobile()` esses
                            botões ficariam invisíveis e inalcançáveis no toque. */}
                        <div className={classesAcoesMensagem}>
                          {msg.status === 'pending' && (
                            <Button
                              variant="ghost"
                              size="icon"
                              title="Cancelar"
                              className="h-6 w-6 text-muted-foreground hover:text-amber-500"
                              onClick={() => handleCancel(msg.id!)}
                            >
                              <XCircle className="h-3.5 w-3.5" />
                            </Button>
                          )}
                          {msg.status === 'failed' && (
                            <Button
                              variant="ghost"
                              size="icon"
                              title="Reenviar"
                              className="h-6 w-6 text-muted-foreground hover:text-blue-400"
                              onClick={() => handleRetry(msg.id!)}
                            >
                              <RefreshCw className="h-3.5 w-3.5" />
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="icon"
                            title="Excluir"
                            className="h-6 w-6 text-muted-foreground hover:text-red-400"
                            onClick={() => handleDelete(msg.id!)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                    </ListRow>
                  )
                })}
              </div>
            )}
          </CardContent>
        </GlassCard>
      </div>
    </div>
  )
}
