import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from '@/components/ui/accordion'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Sparkles } from 'lucide-react'
import { releaseNotes, type ReleaseNote } from '@/data/release-notes'

function groupByVersion(notes: ReleaseNote[]) {
  const map = new Map<string, ReleaseNote[]>()
  for (const note of notes) {
    const list = map.get(note.version) || []
    list.push(note)
    map.set(note.version, list)
  }
  return Array.from(map.entries()).sort((a, b) => b[0].localeCompare(a[0], undefined, { numeric: true }))
}

export function ReleaseNotesDialog() {
  const groups = groupByVersion(releaseNotes)

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="rounded-full text-muted-foreground hover:text-foreground"
          title="Últimas atualizações"
        >
          <Sparkles className="h-5 w-5" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg max-h-[85vh] p-0 gap-0 overflow-hidden bg-background/95 backdrop-blur-xl border-muted">
        <DialogHeader className="px-6 pt-6 pb-3 border-b border-border/50">
          <DialogTitle className="flex items-center gap-2 text-lg">
            <Sparkles className="h-5 w-5 text-primary" />
            Últimas atualizações
          </DialogTitle>
        </DialogHeader>
        <ScrollArea className="px-6 py-4 max-h-[65vh]">
          <div className="relative space-y-0">
            <div className="absolute left-[11px] top-2 bottom-2 w-px bg-border/50" />
            {groups.map(([version, notes]) => (
              <div key={version} className="relative pl-8 pb-6 last:pb-2">
                <div className="absolute left-0 top-1.5 w-6 h-6 rounded-full bg-primary/10 border-2 border-primary/30 flex items-center justify-center">
                  <div className="w-2 h-2 rounded-full bg-primary" />
                </div>
                <Badge variant="secondary" className="mb-2 text-xs font-mono tracking-tight">
                  v{version}
                </Badge>
                <Accordion type="multiple" className="space-y-2">
                  {notes.map((note, i) => (
                    <AccordionItem key={i} value={`${version}-${i}`} className="border rounded-lg px-3 border-border/60 bg-accent/30">
                      <AccordionTrigger className="py-2.5 text-sm font-medium hover:no-underline [&>svg]:text-muted-foreground gap-2">
                        <div className="flex items-center gap-2 min-w-0 text-left">
                          <span className="text-xs text-muted-foreground shrink-0 font-mono tabular-nums">
                            {note.date.split(' ')[1]}
                          </span>
                          <span className="truncate">{note.title}</span>
                        </div>
                      </AccordionTrigger>
                      <AccordionContent>
                        <ul className="space-y-1.5 pb-1">
                          {note.details.map((detail, j) => (
                            <li key={j} className="text-sm text-muted-foreground leading-relaxed flex items-start gap-2">
                              <span className="mt-0.5 shrink-0">{detail.slice(0, 2)}</span>
                              <span>{detail.slice(2).trim()}</span>
                            </li>
                          ))}
                        </ul>
                      </AccordionContent>
                    </AccordionItem>
                  ))}
                </Accordion>
              </div>
            ))}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  )
}
