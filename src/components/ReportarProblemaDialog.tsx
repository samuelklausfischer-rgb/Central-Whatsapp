import { useState, useSyncExternalStore } from 'react'
import { useLocation } from 'react-router-dom'
import { MessageSquarePlus, MessageSquareWarning, Lightbulb } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { useAuth } from '@/hooks/use-auth'
import { useToast } from '@/hooks/use-toast'
import { enviarHubReport, type HubReportTipo } from '@/services/hub_reports'
import { releaseNotes } from '@/data/release-notes'
import { MeusHubReports } from '@/components/MeusHubReports'
import { subscreverFerramentas, lerFerramentas } from '@/stores/ferramentasVivas'
import { descobrirOndeEstou, comEtiqueta, NOME_DO_PROJETO } from '@/lib/hub/onde-estou'

const tipos: { value: HubReportTipo; label: string; icon: React.ElementType; hint: string }[] = [
  { value: 'problema', label: 'Problema', icon: MessageSquareWarning, hint: 'Algo não está funcionando' },
  { value: 'ideia', label: 'Ideia', icon: Lightbulb, hint: 'Sugestão de melhoria' },
]

/**
 * `open`/`onOpenChange` são OPCIONAIS: sem eles o diálogo traz o próprio botão,
 * como sempre fez no desktop. Com eles, o botão some e quem manda é de fora —
 * é assim que ele vira uma linha da folha "Mais" do celular.
 *
 * Mesma forma que `NotificationsDialog` já usa.
 */
export function ReportarProblemaDialog({
  open: openExterno,
  onOpenChange,
}: { open?: boolean; onOpenChange?: (v: boolean) => void } = {}) {
  /*
    De onde a pessoa está reportando.

    `ativa` da store, e nunca `vivas[0]`: até três ferramentas ficam montadas ao
    mesmo tempo, e só `ativa` responde "onde estou agora". O `pathname` cobre as
    telas que não são ferramenta.
  */
  const { ativa } = useSyncExternalStore(subscreverFerramentas, lerFerramentas, lerFerramentas)
  const { pathname } = useLocation()
  const onde = descobrirOndeEstou(ativa, pathname)
  const { user } = useAuth()
  const { toast } = useToast()
  const [openInterno, setOpenInterno] = useState(false)
  const controlado = onOpenChange !== undefined
  const open = controlado ? !!openExterno : openInterno
  const setOpen = controlado ? onOpenChange : setOpenInterno
  const [tipo, setTipo] = useState<HubReportTipo>('problema')
  const [titulo, setTitulo] = useState('')
  const [descricao, setDescricao] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [aba, setAba] = useState<'reportar' | 'meus'>('reportar')

  // O Header só renderiza autenticado, mas sem usuário não há como identificar
  // quem reportou — e a identificação é o ponto do recurso.
  if (!user) return null

  const nome = user.name || user.username || 'Usuário sem nome'
  const reportadoPor = user.email ? `${nome} (${user.email})` : nome

  // Mesma condição que `comEtiqueta` aplica no envio — quem já escreveu a
  // própria etiqueta não ganha uma segunda, e o selo some para mostrar isso.
  const selo = onde.etiqueta && !titulo.trim().startsWith('[') ? onde.etiqueta : null

  function resetar() {
    setTipo('problema')
    setTitulo('')
    setDescricao('')
    setAba('reportar')
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
        // `[Agenda] não consigo criar evento`. A mesma função monta o selo que
        // aparece ao lado do campo, para prévia e envio não divergirem.
        titulo: comEtiqueta(tituloLimpo, onde),
        // A linha de contexto vai no CORPO, não só nos metadados: quem lê a fila
        // no Hub vê a descrição, e raramente abre o json.
        descricao: `${descricaoLimpa}

— Reportado de: ${onde.lugar}
— Página: ${window.location.href}`,
        reportadoPor,
        projetoSlug: onde.projeto,
        metadata: {
          user_id: user!.id,
          user_email: user!.email,
          app_version: releaseNotes[0]?.version ?? null,
          user_agent: navigator.userAgent,
          ferramenta_slug: onde.ferramentaSlug,
          ferramenta_titulo: onde.lugar,
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
      {!controlado && (
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
      )}
      <DialogContent className="max-w-md bg-background/95 backdrop-blur-xl border-muted">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg">
            <MessageSquarePlus className="h-5 w-5 text-primary" />
            Reportar problema ou sugerir ideia
          </DialogTitle>
        </DialogHeader>

        <Tabs value={aba} onValueChange={(v) => setAba(v as 'reportar' | 'meus')}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="reportar">Reportar</TabsTrigger>
            <TabsTrigger value="meus">Meus reportes</TabsTrigger>
          </TabsList>

          <TabsContent value="reportar" className="space-y-4">
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
            {/*
              O SELO APARECE ANTES DE ENVIAR, pelo mesmo motivo do destino logo
              abaixo: a fila do Central Whats mistura Agenda, Whats, Tarefas,
              Assinaturas e mais — sem o nome na frente, o título chega solto e
              só o link diz de onde veio. Vendo o selo, a pessoa percebe na hora
              quando ele estiver errado.
            */}
            <div className="flex items-center gap-2">
              {selo && (
                <span
                  title={`Este relato vai para a fila com "[${selo}]" na frente do título`}
                  className="shrink-0 max-w-[45%] truncate rounded-md border border-primary/30 bg-primary/10 px-2 py-1.5 text-xs font-medium text-foreground"
                >
                  [{selo}]
                </span>
              )}
              <Input
                id="report-titulo"
                value={titulo}
                onChange={(e) => setTitulo(e.target.value)}
                maxLength={200}
                placeholder="Resumo em uma linha"
                className="flex-1"
              />
            </div>
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

          {/*
            O DESTINO PRECISA APARECER ANTES DE ENVIAR.

            Até 08/09 isto dizia só "para a fila do PRN Hub", e todo relato caía
            no projeto Central Whats — inclusive os escritos de dentro do PRN Hub
            Dev ou da Proposta, que têm fila própria. Agora o destino é escolhido
            sozinho, e mostrar qual é permite a pessoa perceber quando estiver
            errado, em vez de descobrir dias depois na fila de outro projeto.

            "De" mudou de sentido na mesma tarde: antes só quatro telas eram
            reconhecidas e o resto do app aparecia aqui como "Central Whats".
          */}
          <p className="text-center text-[11px] leading-relaxed text-muted-foreground">
            Enviado como <span className="text-foreground">{nome}</span>, de{' '}
            <span className="text-foreground">{onde.lugar}</span>
            <br />
            Vai para a fila de{' '}
            <span className="font-medium text-foreground">{NOME_DO_PROJETO[onde.projeto]}</span>
          </p>
          </TabsContent>

          <TabsContent value="meus">
            <MeusHubReports ativo={aba === 'meus'} userId={user.id} userEmail={user.email} />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
