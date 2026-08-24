import { useEffect, useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from '@/components/ui/accordion'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Sparkles, Lightbulb } from 'lucide-react'
import { releaseNotes, classificarNota, type ReleaseNote } from '@/data/release-notes'
import { getBundleVersion } from '@/lib/app-info'

function groupByVersion(notes: ReleaseNote[]) {
  const map = new Map<string, ReleaseNote[]>()
  for (const note of notes) {
    const list = map.get(note.version) || []
    list.push(note)
    map.set(note.version, list)
  }
  return Array.from(map.entries()).sort((a, b) => b[0].localeCompare(a[0], undefined, { numeric: true }))
}

/** Uma linha da lista: ícone à esquerda, texto à direita — o corte já usado. */
function LinhaDeNota({ detalhe }: { detalhe: string }) {
  return (
    <li className="text-sm text-muted-foreground leading-relaxed flex items-start gap-2">
      <span className="mt-0.5 shrink-0">{detalhe.slice(0, 2)}</span>
      <span>{detalhe.slice(2).trim()}</span>
    </li>
  )
}

/**
 * ITEM 4: as notas de uma versão, separadas em o que chegou e o que foi
 * consertado. Antes era uma lista só, e uma correção de bug tinha o mesmo peso
 * visual de uma função nova — quem abria para saber "o que mudou" tinha que ler
 * tudo para descobrir.
 *
 * Um grupo com zero itens não vira título vazio.
 */
function NotasSeparadas({ note }: { note: ReleaseNote }) {
  const novidades = note.details.filter((d) => classificarNota(d) === 'novidade')
  const correcoes = note.details.filter((d) => classificarNota(d) === 'correcao')

  return (
    <div className="space-y-3 pb-1">
      {novidades.length > 0 && (
        <div>
          {correcoes.length > 0 && (
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/70">
              Novidades
            </p>
          )}
          <ul className="space-y-1.5">
            {novidades.map((d, i) => (
              <LinhaDeNota key={i} detalhe={d} />
            ))}
          </ul>
        </div>
      )}

      {correcoes.length > 0 && (
        <div>
          {novidades.length > 0 && (
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/70">
              Correções
            </p>
          )}
          <ul className="space-y-1.5">
            {correcoes.map((d, i) => (
              <LinhaDeNota key={i} detalhe={d} />
            ))}
          </ul>
        </div>
      )}

      {note.usabilidade && (
        <div className="flex items-start gap-2 rounded-lg border border-border/60 bg-accent/40 p-2.5">
          <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <p className="text-sm leading-relaxed text-muted-foreground">{note.usabilidade}</p>
        </div>
      )}
    </div>
  )
}

/**
 * `open`/`onOpenChange` são OPCIONAIS: sem eles o diálogo continua trazendo o
 * próprio botão de brilho, como sempre fez no desktop. Com eles, o botão some e
 * quem manda é de fora — é assim que ele vira uma linha da folha "Mais" do
 * celular, onde um botão-ícone solto não teria sentido.
 *
 * Mesma forma que `NotificationsDialog` já usa.
 *
 * `versaoEmDestaque` abre aquela versão já expandida; é o que o aviso
 * automático usa para a pessoa cair direto no que mudou, sem ter que procurar.
 */
export function ReleaseNotesDialog({
  open,
  onOpenChange,
  versaoEmDestaque,
}: { open?: boolean; onOpenChange?: (v: boolean) => void; versaoEmDestaque?: string | null } = {}) {
  const groups = groupByVersion(releaseNotes)
  const controlado = onOpenChange !== undefined

  return (
    <Dialog {...(controlado ? { open, onOpenChange } : {})}>
      {!controlado && (
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
      )}
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
                  Versão {version}
                </Badge>
                <Accordion
                  type="multiple"
                  className="space-y-2"
                  defaultValue={
                    versaoEmDestaque === version ? notes.map((_, i) => `${version}-${i}`) : undefined
                  }
                >
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
                        <NotasSeparadas note={note} />
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

const CHAVE_VERSAO_VISTA = 'central-whats:ultima-versao-vista'

/**
 * ITEM 4: mostra as novidades UMA vez, quando a pessoa entra depois de uma
 * atualização. Depois disso só pelo botão de sempre.
 *
 * **Não aparece para quem nunca abriu o app.** Sem versão guardada não houve
 * atualização nenhuma — houve uma primeira vez, que é outra coisa. Isso também
 * evita que o aviso e o tour de boas-vindas disputem a tela no mesmo instante.
 *
 * O `localStorage` é por navegador e por aparelho, de propósito: quem usa o app
 * no computador e no celular vê o aviso nos dois, que é o comportamento certo —
 * são duas instalações que atualizaram.
 *
 * Tudo dentro de `try`: em janela anônima com armazenamento bloqueado, o acesso
 * lança, e ficar sem o aviso é muito melhor que derrubar o app na abertura.
 */
export function NovidadesDaVersao() {
  const [aberto, setAberto] = useState(false)
  const [versao, setVersao] = useState<string | null>(null)

  useEffect(() => {
    const atual = getBundleVersion()
    if (!atual) return
    try {
      const vista = localStorage.getItem(CHAVE_VERSAO_VISTA)
      if (vista === atual) return
      if (vista === null) {
        // Primeira vez: registra em silêncio e não interrompe ninguém.
        localStorage.setItem(CHAVE_VERSAO_VISTA, atual)
        return
      }
      setVersao(atual)
      setAberto(true)
    } catch {
      /* armazenamento indisponível — segue sem avisar */
    }
  }, [])

  const aoTrocar = (v: boolean) => {
    setAberto(v)
    // Marca como visto ao FECHAR, e não ao abrir: fechado sem querer numa
    // recarga acidental, o aviso ainda volta na próxima entrada.
    if (!v && versao) {
      try {
        localStorage.setItem(CHAVE_VERSAO_VISTA, versao)
      } catch {
        /* idem */
      }
    }
  }

  if (!aberto) return null
  return <ReleaseNotesDialog open={aberto} onOpenChange={aoTrocar} versaoEmDestaque={versao} />
}
