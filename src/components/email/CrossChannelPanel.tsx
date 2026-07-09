import { useEffect, useState } from 'react'
import { MessageSquare, CheckSquare, StickyNote, ExternalLink } from 'lucide-react'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Button } from '@/components/ui/button'
import { ChevronDown } from 'lucide-react'
import { supabase } from '@/lib/supabase/client'
import { useNavigate } from 'react-router-dom'
import type { Contact } from '@/lib/supabase/types'

interface Props {
  contact: Contact
}

interface CrossChannelData {
  whatsappCount: number
  tasksCount: number
  notesCount: number
}

export function CrossChannelPanel({ contact }: Props) {
  const [open, setOpen] = useState(true)
  const [data, setData] = useState<CrossChannelData>({ whatsappCount: 0, tasksCount: 0, notesCount: 0 })
  const navigate = useNavigate()

  useEffect(() => {
    async function load() {
      const [whatsapp, tasks, notes] = await Promise.all([
        supabase
          .from('messages')
          .select('id', { count: 'exact', head: true })
          .eq('remote_sender', contact.remote_jid),
        supabase
          .from('tasks')
          .select('id', { count: 'exact', head: true })
          .eq('contact_id', contact.id),
        supabase
          .from('notes')
          .select('id', { count: 'exact', head: true })
          .eq('contact_jid', contact.remote_jid),
      ])

      setData({
        whatsappCount: whatsapp.count ?? 0,
        tasksCount: tasks.count ?? 0,
        notesCount: notes.count ?? 0,
      })
    }

    load()
  }, [contact.id, contact.remote_jid])

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="border border-border rounded-lg overflow-hidden">
        <CollapsibleTrigger asChild>
          <button className="w-full flex items-center justify-between px-3 py-2.5 bg-muted/30 hover:bg-muted/50 transition-colors">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Contexto — {contact.name || contact.remote_jid}
            </span>
            <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`} />
          </button>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <div className="grid grid-cols-3 divide-x divide-border border-t border-border">
            {/* WhatsApp */}
            <Button
              variant="ghost"
              className="flex flex-col items-center gap-1 h-auto py-3 rounded-none"
              onClick={() => navigate(`/chat?jid=${contact.remote_jid}`)}
            >
              <div className="flex items-center gap-1">
                <MessageSquare className="h-4 w-4 text-green-500" />
                <span className="text-base font-bold">{data.whatsappCount}</span>
              </div>
              <span className="text-[10px] text-muted-foreground">WhatsApp</span>
            </Button>

            {/* Tarefas */}
            <Button
              variant="ghost"
              className="flex flex-col items-center gap-1 h-auto py-3 rounded-none"
              onClick={() => navigate('/crm')}
            >
              <div className="flex items-center gap-1">
                <CheckSquare className="h-4 w-4 text-blue-500" />
                <span className="text-base font-bold">{data.tasksCount}</span>
              </div>
              <span className="text-[10px] text-muted-foreground">Tarefas</span>
            </Button>

            {/* Notas */}
            <Button
              variant="ghost"
              className="flex flex-col items-center gap-1 h-auto py-3 rounded-none"
              onClick={() => navigate('/notes')}
            >
              <div className="flex items-center gap-1">
                <StickyNote className="h-4 w-4 text-yellow-500" />
                <span className="text-base font-bold">{data.notesCount}</span>
              </div>
              <span className="text-[10px] text-muted-foreground">Notas</span>
            </Button>
          </div>

          {data.whatsappCount > 0 && (
            <div className="px-3 py-2 border-t border-border">
              <Button
                variant="link"
                size="sm"
                className="h-auto p-0 text-xs text-primary"
                onClick={() => navigate(`/chat?jid=${contact.remote_jid}`)}
              >
                <ExternalLink className="h-3 w-3 mr-1" />
                Abrir conversa no Chat Hub
              </Button>
            </div>
          )}
        </CollapsibleContent>
      </div>
    </Collapsible>
  )
}
