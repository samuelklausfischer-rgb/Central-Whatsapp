import { useEffect, useState } from 'react'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { AlertTriangle, CalendarIcon, Loader2, PinOff, Users, X } from 'lucide-react'
import { Dialog, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { GlassDialogContent } from '@/components/ui/glass-dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Calendar } from '@/components/ui/calendar'
import { cn } from '@/lib/utils'
import { toast } from '@/hooks/use-toast'
import { fixarEmail, desfixarEmail, type EtiquetaFixado, type Fixado } from '@/services/email_fixados'
import type { Email } from '@/lib/supabase/email-types'

/**
 * As três etiquetas foram fechadas com o Samuel em 25/09/2026 — o banco tem um
 * `CHECK` para exatamente estes três valores (ver a migration de
 * `email_fixados`), então a lista aqui não é um capricho de estilo: um quarto
 * valor sem alterar o banco quebraria o `insert`.
 */
const ETIQUETAS: { valor: EtiquetaFixado; rotulo: string; cor: string }[] = [
  { valor: 'urgente', rotulo: 'Urgente', cor: '#dc2626' },
  { valor: 'importante', rotulo: 'Importante', cor: '#d97706' },
  { valor: 'ler_depois', rotulo: 'Ler depois', cor: '#6b7280' },
]

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  email: Email
  /**
   * O MEU pin neste e-mail, se eu já tiver um — `null` quando eu ainda não
   * fixei (mesmo que um colega tenha fixado e compartilhado; o pin dele não
   * é editável por mim, então nunca preenche este formulário).
   */
  meuFixado: Fixado | null
  /** Chamado depois de fixar/atualizar, para o `EmailHub` atualizar o mapa sem recarregar a pasta inteira. */
  onSalvo: (fixado: Fixado) => void
  /** Chamado depois de remover o pin. */
  onRemovido: () => void
}

function horaDeISO(iso: string): string {
  const d = new Date(iso)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** Junta data + hora locais num ISO. `null` se faltar qualquer uma das duas. */
function combinarLembrete(data: Date | undefined, hora: string): string | null {
  if (!data || !hora) return null
  const [h, m] = hora.split(':').map(Number)
  if (Number.isNaN(h) || Number.isNaN(m)) return null
  const combinado = new Date(data)
  combinado.setHours(h, m, 0, 0)
  return combinado.toISOString()
}

export function EmailPinDialog({ open, onOpenChange, email, meuFixado, onSalvo, onRemovido }: Props) {
  const [etiqueta, setEtiqueta] = useState<EtiquetaFixado>('ler_depois')
  const [data, setData] = useState<Date | undefined>(undefined)
  const [hora, setHora] = useState('')
  const [compartilhado, setCompartilhado] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const [removendo, setRemovendo] = useState(false)

  // Preenche o formulário com o MEU pin ao abrir — ou zera para um pin novo.
  useEffect(() => {
    if (!open) return
    if (meuFixado) {
      setEtiqueta(meuFixado.etiqueta)
      setCompartilhado(meuFixado.compartilhado)
      if (meuFixado.ler_em) {
        setData(new Date(meuFixado.ler_em))
        setHora(horaDeISO(meuFixado.ler_em))
      } else {
        setData(undefined)
        setHora('')
      }
    } else {
      setEtiqueta('ler_depois')
      setCompartilhado(false)
      setData(undefined)
      setHora('')
    }
  }, [open, meuFixado])

  // Preenchimento pela metade (só data, ou só hora): não vira lembrete
  // nenhum, mas a pessoa pode achar que marcou algo. Avisa em vez de fingir
  // que está tudo certo.
  const lembretePelaMetade = (Boolean(data) && !hora) || (!data && Boolean(hora))

  async function salvar() {
    setSalvando(true)
    try {
      const ler_em = combinarLembrete(data, hora)
      const fixado = await fixarEmail({
        email_id: email.id,
        etiqueta,
        ler_em,
        compartilhado,
      })
      onSalvo(fixado)
      toast({
        title: ler_em ? 'Fixado com lembrete' : 'Fixado sem lembrete',
        description: ler_em
          ? undefined
          : 'Sem horário marcado, ninguém avisa você — o e-mail só fica em destaque no topo.',
      })
      onOpenChange(false)
    } catch (err) {
      toast({
        title: 'Não consegui fixar',
        description: err instanceof Error ? err.message : 'Tente novamente',
        variant: 'destructive',
      })
    } finally {
      setSalvando(false)
    }
  }

  async function remover() {
    setRemovendo(true)
    try {
      await desfixarEmail(email.id)
      onRemovido()
      toast({ title: 'Pin removido' })
      onOpenChange(false)
    } catch (err) {
      toast({
        title: 'Não consegui remover o pin',
        description: err instanceof Error ? err.message : 'Tente novamente',
        variant: 'destructive',
      })
    } finally {
      setRemovendo(false)
    }
  }

  const ocupado = salvando || removendo

  return (
    <Dialog open={open} onOpenChange={(v) => !ocupado && onOpenChange(v)}>
      <GlassDialogContent className="sm:max-w-md gap-0 overflow-hidden p-0">
        <DialogHeader className="space-y-0 border-b border-border/60 px-5 py-4">
          <DialogTitle className="text-[15px] leading-tight">
            {meuFixado ? 'Editar pin' : 'Fixar e-mail'}
          </DialogTitle>
          <p className="truncate text-xs text-muted-foreground" title={email.subject ?? undefined}>
            {email.subject || '(sem assunto)'}
          </p>
        </DialogHeader>

        <div className="space-y-4 px-5 py-4">
          {/* Etiqueta de urgência */}
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Etiqueta</Label>
            <div className="flex gap-2">
              {ETIQUETAS.map((opt) => {
                const selecionada = etiqueta === opt.valor
                return (
                  <button
                    key={opt.valor}
                    type="button"
                    onClick={() => setEtiqueta(opt.valor)}
                    disabled={ocupado}
                    className={cn(
                      'flex-1 rounded-lg border px-2 py-2 text-xs font-medium transition-colors',
                      selecionada ? 'border-transparent text-white' : 'border-border text-muted-foreground hover:bg-muted/50',
                    )}
                    style={selecionada ? { backgroundColor: opt.cor } : undefined}
                  >
                    {opt.rotulo}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Data e hora do lembrete — as duas OPCIONAIS. */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label className="text-xs text-muted-foreground">Lembrete (opcional)</Label>
              {(data || hora) && (
                <button
                  type="button"
                  onClick={() => {
                    setData(undefined)
                    setHora('')
                  }}
                  disabled={ocupado}
                  className="flex items-center gap-0.5 text-[11px] text-muted-foreground hover:text-foreground"
                >
                  <X className="h-3 w-3" />
                  Limpar
                </button>
              )}
            </div>
            <div className="flex gap-2">
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={ocupado}
                    className={cn('flex-1 justify-start gap-1.5 text-left font-normal', !data && 'text-muted-foreground')}
                  >
                    <CalendarIcon className="h-3.5 w-3.5 shrink-0" />
                    {data ? format(data, 'PPP', { locale: ptBR }) : 'Sem data'}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar mode="single" selected={data} onSelect={setData} initialFocus />
                </PopoverContent>
              </Popover>
              <input
                type="time"
                value={hora}
                onChange={(e) => setHora(e.target.value)}
                disabled={ocupado}
                className="h-8 w-28 rounded-md border border-input bg-background px-2 text-sm"
                aria-label="Hora do lembrete"
              />
            </div>

            {/* ⚠️ O aviso que evita a maior confusão desta tela: fixar não é
                pedir lembrete. Sem data E hora marcadas, ninguém é avisado —
                só o destaque na lista continua valendo. */}
            {lembretePelaMetade ? (
              <p className="flex items-start gap-1.5 text-[11px] text-amber-600 dark:text-amber-400">
                <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                Falta a {data ? 'hora' : 'data'} — sem as duas, isso fica só como destaque, sem aviso.
              </p>
            ) : (
              <p className="text-[11px] text-muted-foreground">
                {data && hora
                  ? 'Você recebe um aviso 15 min antes, na hora, e de novo no dia seguinte se continuar sem ler.'
                  : 'Sem horário, este e-mail só fica destacado no topo — ninguém avisa você.'}
              </p>
            )}
          </div>

          {/* Compartilhar é MOSTRAR, não dar acesso de escrita. */}
          <div className="flex items-start justify-between gap-3 rounded-lg border border-border/60 p-3">
            <div className="flex items-start gap-2">
              <Users className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <div>
                <p className="text-xs font-medium">Compartilhar com quem tem acesso a esta caixa</p>
                <p className="text-[11px] text-muted-foreground">
                  Colegas veem o pin, mas só você pode editá-lo ou removê-lo.
                </p>
              </div>
            </div>
            <Switch checked={compartilhado} onCheckedChange={setCompartilhado} disabled={ocupado} />
          </div>
        </div>

        <DialogFooter className="flex items-center justify-between gap-2 border-t border-border/60 px-5 py-3.5 sm:justify-between">
          {meuFixado ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={remover}
              disabled={ocupado}
              className="gap-1.5 text-muted-foreground hover:text-destructive"
            >
              {removendo ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PinOff className="h-3.5 w-3.5" />}
              Remover pin
            </Button>
          ) : (
            <span />
          )}
          <Button onClick={salvar} disabled={ocupado} size="sm" className="gap-1.5 px-4">
            {salvando && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {meuFixado ? 'Salvar' : 'Fixar'}
          </Button>
        </DialogFooter>
      </GlassDialogContent>
    </Dialog>
  )
}
