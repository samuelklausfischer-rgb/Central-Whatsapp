import { useEffect, useState } from 'react'
import { Dialog, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { GlassDialogContent } from '@/components/ui/glass-dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from '@/components/ui/accordion'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Sparkles, Lightbulb } from 'lucide-react'
import { format, parseISO } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { releaseNotes, classificarNota, type ReleaseNote } from '@/data/release-notes'
import { getBundleVersion } from '@/lib/app-info'
import { tourJaFoiVisto } from '@/components/TourDoApp'

function groupByVersion(notes: ReleaseNote[]) {
  const map = new Map<string, ReleaseNote[]>()
  for (const note of notes) {
    const list = map.get(note.version) || []
    list.push(note)
    map.set(note.version, list)
  }
  return Array.from(map.entries()).sort((a, b) => b[0].localeCompare(a[0], undefined, { numeric: true }))
}

/**
 * "24 de agosto". O horário sai de propósito: `note.date` guarda
 * `2026-08-24 18:10`, e saber o minuto do build nunca ajudou ninguém a entender
 * o que mudou — só ocupava a linha do título.
 */
function dataPorExtenso(date: string): string {
  try {
    return format(parseISO(date.replace(' ', 'T')), "d 'de' MMMM", { locale: ptBR })
  } catch {
    return date.split(' ')[0] ?? date
  }
}

/**
 * Uma linha da nota: emoji numa coluna de largura FIXA, texto ao lado.
 *
 * `w-6 shrink-0` no emoji porque eles têm larguras diferentes (📅 é mais largo
 * que ✅) e, sem a coluna, cada item começava num ponto distinto — o que fazia a
 * lista parecer torta sem ninguém saber dizer por quê.
 *
 * `min-w-0` no texto é o que permite ele encolher dentro do flex. Sem isso um
 * filho de flex se recusa a ficar menor que o próprio conteúdo e volta a
 * estourar a caixa — é a outra metade da causa do texto cortado, junto com o
 * `display: table` que o `ScrollArea` impunha.
 */
function LinhaDeNota({ detalhe }: { detalhe: string }) {
  return (
    <li className="flex items-start gap-3">
      <span className="w-6 shrink-0 text-center text-base leading-6" aria-hidden="true">
        {detalhe.slice(0, 2)}
      </span>
      <span className="min-w-0 flex-1 break-words text-sm leading-relaxed text-muted-foreground">
        {detalhe.slice(2).trim()}
      </span>
    </li>
  )
}

/** Título de seção: discreto, mas com respiro em volta para criar hierarquia. */
function TituloDeBloco({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/60">
      {children}
    </p>
  )
}

/**
 * O conteúdo de uma versão: novidades e corrigidos como DOIS blocos com peso,
 * em vez de uma lista só onde uma correção de bug pesava igual a uma função
 * nova. Bloco vazio não vira título solto.
 */
function ConteudoDaVersao({ notes }: { notes: ReleaseNote[] }) {
  const detalhes = notes.flatMap((n) => n.details)
  const novidades = detalhes.filter((d) => classificarNota(d) === 'novidade')
  const correcoes = detalhes.filter((d) => classificarNota(d) === 'correcao')
  const usabilidade = notes.find((n) => n.usabilidade)?.usabilidade

  return (
    <div className="min-w-0 space-y-5">
      {novidades.length > 0 && (
        <div className="min-w-0">
          <TituloDeBloco>Novidades</TituloDeBloco>
          <ul className="space-y-2.5">
            {novidades.map((d, i) => (
              <LinhaDeNota key={i} detalhe={d} />
            ))}
          </ul>
        </div>
      )}

      {correcoes.length > 0 && (
        <div className="min-w-0">
          <TituloDeBloco>Corrigidos</TituloDeBloco>
          <ul className="space-y-2.5">
            {correcoes.map((d, i) => (
              <LinhaDeNota key={i} detalhe={d} />
            ))}
          </ul>
        </div>
      )}

      {usabilidade && (
        <div className="flex min-w-0 items-start gap-3 rounded-xl border border-primary/20 bg-primary/5 p-3.5">
          <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
          <div className="min-w-0">
            <p className="mb-0.5 text-[11px] font-medium uppercase tracking-wider text-primary/80">
              Como usar
            </p>
            <p className="break-words text-sm leading-relaxed text-muted-foreground">{usabilidade}</p>
          </div>
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
 * A versão MAIS NOVA é sempre o destaque do topo, tanto no aviso automático
 * quanto ao abrir pelo botão: quem abre "últimas atualizações" quer ver a
 * última, não escolher uma numa lista. O histórico fica recolhido no fim, que é
 * onde ele deixa de competir com o que interessa.
 */
export function ReleaseNotesDialog({
  open,
  onOpenChange,
}: { open?: boolean; onOpenChange?: (v: boolean) => void } = {}) {
  const grupos = groupByVersion(releaseNotes)
  const controlado = onOpenChange !== undefined

  const [versaoAtual, notasAtuais] = grupos[0] ?? ['', [] as ReleaseNote[]]
  const anteriores = grupos.slice(1)
  const dataAtual = notasAtuais[0]?.date

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

      {/*
        `GlassDialogContent` em vez de repetir as classes do vidro na mão: é o
        mesmo componente que Agenda, Tarefas, Gestão de Equipe e Configurações
        usam. Assim "combinar com o app" para de depender de alguém lembrar de
        copiar as classes certas na próxima tela.
      */}
      <GlassDialogContent className="max-h-[85vh] max-w-xl gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b border-border/50 px-6 pb-4 pt-6">
          <DialogTitle className="flex items-center gap-2 text-base font-medium">
            <Sparkles className="h-4 w-4 text-primary" aria-hidden="true" />
            Últimas atualizações
          </DialogTitle>
        </DialogHeader>

        <ScrollArea className="max-h-[68vh]">
          <div className="min-w-0 px-6 py-5">
            {/* A versão nova como manchete, e não como mais um item de lista. */}
            <div className="mb-5 min-w-0">
              <div className="mb-1.5 flex flex-wrap items-center gap-2">
                <Badge variant="secondary" className="font-mono text-xs tracking-tight">
                  Versão {versaoAtual}
                </Badge>
                {dataAtual && (
                  <span className="text-xs text-muted-foreground/70">{dataPorExtenso(dataAtual)}</span>
                )}
              </div>
              <h2 className="min-w-0 break-words font-display text-xl font-semibold leading-tight text-foreground">
                {notasAtuais[0]?.title}
              </h2>
            </div>

            <ConteudoDaVersao notes={notasAtuais} />

            {anteriores.length > 0 && (
              <Accordion type="single" collapsible className="mt-6 border-t border-border/50 pt-2">
                <AccordionItem value="anteriores" className="border-none">
                  <AccordionTrigger className="py-2 text-sm text-muted-foreground hover:text-foreground hover:no-underline">
                    Ver versões anteriores
                  </AccordionTrigger>
                  <AccordionContent>
                    <div className="min-w-0 space-y-6 pt-2">
                      {anteriores.map(([versao, notas]) => (
                        <div key={versao} className="min-w-0">
                          <div className="mb-2 flex flex-wrap items-baseline gap-x-2 gap-y-1">
                            <span className="font-mono text-xs text-muted-foreground">{versao}</span>
                            {notas[0]?.date && (
                              <span className="text-xs text-muted-foreground/60">
                                {dataPorExtenso(notas[0].date)}
                              </span>
                            )}
                            <span className="min-w-0 break-words text-sm font-medium text-foreground">
                              {notas[0]?.title}
                            </span>
                          </div>
                          <ConteudoDaVersao notes={notas} />
                        </div>
                      ))}
                    </div>
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            )}
          </div>
        </ScrollArea>
      </GlassDialogContent>
    </Dialog>
  )
}

const CHAVE_VERSAO_VISTA = 'central-whats:ultima-versao-vista'

/**
 * ITEM 4: mostra as novidades UMA vez, quando a pessoa entra depois de uma
 * atualização. Depois disso só pelo botão de sempre.
 *
 * A PRIMEIRA VERSÃO DISTO NÃO APARECIA PARA NINGUÉM, e vale registrar por quê:
 * ela gravava a versão EM SILÊNCIO quando não havia nenhuma guardada, para não
 * disputar a tela com o tour de boas-vindas. Só que a versão anunciada sai de
 * `releaseNotes[0].version`, e o app foi publicado sem entrada nova nas notas —
 * então todo mundo gravou a MESMA versão que já estava rodando, e a condição
 * "mudou de versão" nunca mais pôde ser verdadeira.
 *
 * A disputa com o tour agora é resolvida de frente: se o tour ainda está
 * pendente, ele tem a vez e este aviso **não grava nada** — volta na entrada
 * seguinte, quando o tour já terá sido visto. Ninguém perde o anúncio.
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
    // O tour de boas-vindas vem primeiro. Sem gravar nada: o aviso volta na
    // próxima entrada em vez de ser engolido.
    if (!tourJaFoiVisto()) return
    try {
      const vista = localStorage.getItem(CHAVE_VERSAO_VISTA)
      if (vista === atual) return
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
  return <ReleaseNotesDialog open={aberto} onOpenChange={aoTrocar} />
}
