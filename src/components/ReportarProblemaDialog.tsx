import { useState } from 'react'
import { MessageSquarePlus, MessageSquareWarning, Lightbulb } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useAuth } from '@/hooks/use-auth'
import { useToast } from '@/hooks/use-toast'
import { enviarHubReport, type HubReportTipo } from '@/services/hub_reports'
import { releaseNotes } from '@/data/release-notes'

const tipos: { value: HubReportTipo; label: string; icon: React.ElementType; hint: string }[] = [
  { value: 'problema', label: 'Problema', icon: MessageSquareWarning, hint: 'Algo não está funcionando' },
  { value: 'ideia', label: 'Ideia', icon: Lightbulb, hint: 'Sugestão de melhoria' },
]

export function ReportarProblemaDialog() {
  const { user } = useAuth()
  const { toast } = useToast()
  const [open, setOpen] = useState(false)
  const [tipo, setTipo] = useState<HubReportTipo>('problema')
  const [titulo, setTitulo] = useState('')
  const [descricao, setDescricao] = useState('')
  const [enviando, setEnviando] = useState(false)

  // O Header só renderiza autenticado, mas sem usuário não há como identificar
  // quem reportou — e a identificação é o ponto do recurso.
  if (!user) return null

  const nome = user.name || user.username || 'Usuário sem nome'
  const reportadoPor = user.email ? `${nome} (${user.email})` : nome

  function resetar() {
    setTipo('problema')
    setTitulo('')
    setDescricao('')
  }

  async function handleEnviar() {
    const tituloLimpo = titulo.trim()
    const descricaoLimpa = descricao.trim()

    if (!tituloLimpo || !descricaoLimpa) {
      toast({ title: 'Preencha o título e a descrição', variant: 'destructive' })
      return
    }

    setEnviando(true)
    try {
      await enviarHubReport({
        tipo,
        titulo: tituloLimpo,
        descricao: descricaoLimpa,
        reportadoPor,
        metadata: {
          user_id: user!.id,
          user_email: user!.email,
          app_version: releaseNotes[0]?.version ?? null,
          user_agent: navigator.userAgent,
        },
      })
      toast({ title: tipo === 'ideia' ? 'Ideia enviada. Obrigado!' : 'Problema reportado. Obrigado!' })
      resetar()
      setOpen(false)
    } catch (error) {
      toast({
        title: error instanceof Error ? error.message : 'Erro ao enviar o report',
        variant: 'destructive',
      })
    } finally {
      setEnviando(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v)
        if (!v) resetar()
      }}
    >
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="rounded-full text-muted-foreground hover:text-foreground"
          title="Reportar problema ou sugerir ideia"
        >
          <MessageSquarePlus className="h-5 w-5" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md bg-background/95 backdrop-blur-xl border-muted">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg">
            <MessageSquarePlus className="h-5 w-5 text-primary" />
            Reportar problema ou sugerir ideia
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Tipo</Label>
            <div className="grid grid-cols-2 gap-2">
              {tipos.map((t) => {
                const ativo = tipo === t.value
                return (
                  <button
                    key={t.value}
                    type="button"
                    onClick={() => setTipo(t.value)}
                    className={`flex flex-col items-start gap-0.5 rounded-lg border p-3 text-left transition-all duration-200 ${
                      ativo
                        ? 'border-primary bg-primary/10 text-foreground'
                        : 'border-border text-muted-foreground hover:bg-accent hover:text-foreground'
                    }`}
                  >
                    <span className="flex items-center gap-1.5 text-sm font-medium">
                      <t.icon className="h-4 w-4" />
                      {t.label}
                    </span>
                    <span className="text-[11px] text-muted-foreground">{t.hint}</span>
                  </button>
                )
              })}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="report-titulo">Título</Label>
            <Input
              id="report-titulo"
              value={titulo}
              onChange={(e) => setTitulo(e.target.value)}
              maxLength={200}
              placeholder="Resumo em uma linha"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="report-descricao">Descrição</Label>
            <Textarea
              id="report-descricao"
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              rows={5}
              placeholder={
                tipo === 'ideia'
                  ? 'Descreva a ideia e o que ela resolveria'
                  : 'Descreva o que aconteceu, em que tela e o que você esperava'
              }
            />
          </div>

          <Button className="w-full" onClick={handleEnviar} disabled={enviando}>
            {enviando ? 'Enviando...' : 'Enviar'}
          </Button>

          <p className="text-center text-[11px] text-muted-foreground">
            Enviado como <span className="text-foreground">{nome}</span> para a fila do PRN Hub
          </p>
        </div>
      </DialogContent>
    </Dialog>
  )
}
