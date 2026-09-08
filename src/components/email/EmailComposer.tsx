import { useState, useEffect, useRef } from 'react'
import { X, Send, Paperclip, ChevronDown, ChevronRight, Reply, Forward, PenSquare } from 'lucide-react'
import { Dialog, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { GlassDialogContent } from '@/components/ui/glass-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useToast } from '@/hooks/use-toast'
import { useAuth } from '@/hooks/use-auth'
import { getEmailPrefs } from '@/services/email_prefs'
import { paraPrevia } from '@/lib/email/assinatura-embutida'
import { sendEmail, type AnexoParaEnviar, type ModoDeEnvio } from '@/services/emails'
import { getEmailTemplates, applyTemplateVariables } from '@/services/email_templates'
import type { EmailAccount, Email, EmailTemplate } from '@/lib/supabase/email-types'
import { cn } from '@/lib/utils'

/**
 * Teto dos anexos, conferido AQUI antes de subir.
 *
 * O mesmo número vale do lado da edge function, que é quem realmente decide —
 * mas deixar a pessoa esperar o upload de 8 MB para só então ouvir "não deu" é
 * grosseria. Base64 infla o binário em ~33%, e o limite de uma requisição ao
 * Graph é ~4 MB, então o teto útil de arquivo original fica em 3 MB.
 */
const TETO_ANEXOS_BYTES = 3 * 1024 * 1024

function formatarTamanho(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/** Texto do usuário virando HTML, com `<` e `&` neutralizados. */
function textoParaHtml(texto: string): string {
  const escapado = texto
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
  return escapado.replace(/\r?\n/g, '<br>')
}

/** Lê o arquivo e devolve só o base64, sem o prefixo `data:...;base64,`. */
function lerComoBase64(arquivo: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const leitor = new FileReader()
    leitor.onerror = () => reject(new Error(`Não consegui ler ${arquivo.name}.`))
    leitor.onload = () => {
      const r = String(leitor.result ?? '')
      const virgula = r.indexOf(',')
      resolve(virgula >= 0 ? r.slice(virgula + 1) : r)
    }
    leitor.readAsDataURL(arquivo)
  })
}

interface Props {
  open: boolean
  onClose: () => void
  account: EmailAccount | null
  replyTo?: Email | null
  forwardFrom?: Email | null
  initialBody?: string
  /** Avisa que saiu. Não recebe o e-mail: ver a nota sobre a cópia local abaixo. */
  onSent?: () => void
}

export function EmailComposer({
  open,
  onClose,
  account,
  replyTo,
  forwardFrom,
  initialBody = '',
  onSent,
}: Props) {
  const [to, setTo] = useState('')
  const [cc, setCc] = useState('')
  const [bcc, setBcc] = useState('')
  const [mostrarCopias, setMostrarCopias] = useState(false)
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [paraTodos, setParaTodos] = useState(false)
  const [anexos, setAnexos] = useState<{ arquivo: File; base64: string }[]>([])
  const [mostrarOriginal, setMostrarOriginal] = useState(false)
  const [templates, setTemplates] = useState<EmailTemplate[]>([])
  const [isSending, setIsSending] = useState(false)
  const inputArquivo = useRef<HTMLInputElement>(null)
  const { toast } = useToast()
  const { user } = useAuth()
  /*
    A assinatura mostrada aqui é SÓ PRÉVIA. Quem realmente a anexa é a rota
    `enviar` da edge function, lendo o perfil de quem chamou — como a do WhatsApp,
    que é aplicada dentro da RPC. Repetir a colagem aqui faria a assinatura sair
    duas vezes.
  */
  const [assinaturaHtml, setAssinaturaHtml] = useState('')

  const original = replyTo ?? forwardFrom ?? null
  const modo: ModoDeEnvio = forwardFrom
    ? 'encaminhar'
    : replyTo
      ? paraTodos
        ? 'responder_todos'
        : 'responder'
      : 'novo'

  /**
   * O ASSUNTO E OS DESTINATÁRIOS DE UMA RESPOSTA SÃO DO OUTLOOK, NÃO NOSSOS.
   *
   * Responder e encaminhar vão pelas rotas `/reply`, `/replyAll` e `/forward` do
   * Graph, e é ELE quem costura a conversa e resolve o assunto. Por isso o campo
   * de assunto fica só de leitura nesses modos: escrever ali daria a impressão de
   * mandar em algo que não mandamos.
   *
   * Em "responder a todos" o destinatário também é dele — é justamente o que
   * conserta o defeito antigo, em que responder descartava todo mundo que estava
   * em cópia e mandava só para o remetente.
   */
  const assuntoEhDoOutlook = modo !== 'novo'
  const destinatarioEhDoOutlook = modo === 'responder_todos'

  useEffect(() => {
    if (!open) return
    setAnexos([])
    setMostrarOriginal(false)
    setBcc('')
    setMostrarCopias(false)
    setParaTodos(false)

    if (replyTo) {
      setTo(replyTo.from_email)
      setCc('')
      setSubject(replyTo.subject?.startsWith('Re:') ? replyTo.subject : `Re: ${replyTo.subject || ''}`)
    } else if (forwardFrom) {
      setTo('')
      setCc('')
      setSubject(`Enc: ${forwardFrom.subject || ''}`)
    } else {
      setTo('')
      setCc('')
      setSubject('')
    }
    // A citação NÃO entra mais na caixa de escrita.
    //
    // Antes ela era enfiada aqui como texto com tags literais, e a pessoa via
    // `<b>` e `</b>` escritos na tela. Pior: era montada a partir de `body_text`,
    // que é nulo na maioria dos e-mails HTML, então quase sempre vinha vazia — e
    // ainda cortada em 500 caracteres. Agora o original fica logo abaixo, inteiro
    // e só de leitura, e o Graph anexa a citação de verdade no envio.
    setBody(initialBody || '')

    getEmailTemplates().then(setTemplates).catch(() => {})
    if (user?.id) {
      getEmailPrefs(user.id)
        // `paraPrevia` devolve as imagens para `data:`. O que está guardado usa
        // `cid:`, que só existe dentro de um e-mail montado — no navegador ele
        // não resolve nada e a assinatura apareceria com quadrado quebrado.
        .then((p) => setAssinaturaHtml(paraPrevia(p.assinatura_html ?? '', p.assinatura_imagens)))
        .catch(() => setAssinaturaHtml(''))
    }
  }, [open, replyTo, forwardFrom, initialBody, user?.id])

  function applyTemplate(templateId: string) {
    const t = templates.find((t) => t.id === templateId)
    if (!t) return
    const vars: Record<string, string> = {}
    setBody(applyTemplateVariables(t.body_html, vars))
    if (t.subject_template) setSubject(applyTemplateVariables(t.subject_template, vars))
  }

  const totalAnexos = anexos.reduce((s, a) => s + a.arquivo.size, 0)

  async function escolherArquivos(lista: FileList | null) {
    if (!lista?.length) return
    const novos: { arquivo: File; base64: string }[] = []
    let soma = totalAnexos
    for (const arquivo of Array.from(lista)) {
      soma += arquivo.size
      if (soma > TETO_ANEXOS_BYTES) {
        toast({
          title: 'Anexo grande demais',
          description: `O limite é ${formatarTamanho(TETO_ANEXOS_BYTES)} no total. Mande um link em vez do arquivo.`,
          variant: 'destructive',
        })
        return
      }
      try {
        novos.push({ arquivo, base64: await lerComoBase64(arquivo) })
      } catch (err) {
        toast({
          title: 'Não consegui ler o arquivo',
          description: err instanceof Error ? err.message : arquivo.name,
          variant: 'destructive',
        })
        return
      }
    }
    setAnexos((atuais) => [...atuais, ...novos])
  }

  /** Fechar com texto escrito pede confirmação — um Esc apagava tudo em silêncio. */
  function tentarFechar() {
    if (isSending) return
    const temConteudo = body.trim() || anexos.length > 0
    if (temConteudo && !window.confirm('Descartar este email? O que você escreveu será perdido.')) {
      return
    }
    onClose()
  }

  async function handleSend() {
    if (!account) {
      toast({ title: 'Selecione uma conta de email', variant: 'destructive' })
      return
    }
    const listaPara = to.split(/[,;]/).map((e) => e.trim()).filter(Boolean)
    if (!destinatarioEhDoOutlook && listaPara.length === 0) {
      toast({ title: 'Informe pelo menos um destinatário', variant: 'destructive' })
      return
    }
    if (modo === 'novo' && !subject.trim()) {
      toast({ title: 'Informe o assunto', variant: 'destructive' })
      return
    }
    if (!body.trim() && anexos.length === 0) {
      toast({ title: 'Escreva a mensagem ou anexe um arquivo', variant: 'destructive' })
      return
    }

    setIsSending(true)
    try {
      const paraEnviar: AnexoParaEnviar[] = anexos.map((a) => ({
        nome: a.arquivo.name,
        tipo: a.arquivo.type || 'application/octet-stream',
        base64: a.base64,
      }))

      await sendEmail({
        account_id: account.id,
        modo,
        // Em "responder a todos" quem decide é o Graph; mandar lista aqui seria
        // discordar dele e reintroduzir o defeito que estamos consertando.
        to: destinatarioEhDoOutlook ? undefined : listaPara,
        cc: cc ? cc.split(/[,;]/).map((e) => e.trim()).filter(Boolean) : undefined,
        bcc: bcc ? bcc.split(/[,;]/).map((e) => e.trim()).filter(Boolean) : undefined,
        subject: modo === 'novo' ? subject : undefined,
        body_html: `<div>${textoParaHtml(body)}</div>`,
        reply_to_email_id: original?.id,
        anexos: paraEnviar.length ? paraEnviar : undefined,
      })

      toast({
        title: 'Email enviado',
        description: 'Já está em Itens Enviados no Outlook.',
      })
      onSent?.()
      onClose()
    } catch (err) {
      toast({
        title: 'Não consegui enviar',
        description: err instanceof Error ? err.message : 'Tente novamente',
        variant: 'destructive',
      })
    } finally {
      setIsSending(false)
    }
  }

  const titulo =
    modo === 'encaminhar'
      ? 'Encaminhar email'
      : modo === 'responder_todos'
        ? 'Responder a todos'
        : modo === 'responder'
          ? 'Responder email'
          : 'Novo email'

  const IconeDoModo = modo === 'encaminhar' ? Forward : modo === 'novo' ? PenSquare : Reply

  /** Uma linha de endereço: rótulo estreito à esquerda, campo colado nele. */
  function Campo({
    rotulo,
    children,
    acao,
  }: {
    rotulo: string
    children: React.ReactNode
    acao?: React.ReactNode
  }) {
    return (
      <div className="flex items-center gap-3 rounded-xl px-3 py-2 transition-colors focus-within:bg-foreground/[0.04] hover:bg-foreground/[0.02]">
        <Label className="w-14 flex-shrink-0 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          {rotulo}
        </Label>
        <div className="min-w-0 flex-1">{children}</div>
        {acao}
      </div>
    )
  }

  const estiloCampo =
    'border-0 bg-transparent p-0 h-auto text-sm shadow-none focus-visible:ring-0 placeholder:text-muted-foreground/60'

  return (
    <Dialog open={open} onOpenChange={(v) => !v && tentarFechar()}>
      {/*
        `GlassDialogContent` é o vidro padrão do PRN Hub — o mesmo diálogo da
        Agenda, do CRM e das configurações. O compositor usava o `DialogContent`
        cru, sólido, e destoava do resto do app.

        `p-0` porque o espaçamento é gerenciado aqui dentro: são cabeçalho, corpo
        rolável e rodapé fixo, e o padding do componente base empurraria os três
        de uma vez.
      */}
      <GlassDialogContent className="sm:max-w-2xl gap-0 overflow-hidden p-0">
        <DialogHeader className="space-y-0 border-b border-border/60 px-5 py-4">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <IconeDoModo className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <DialogTitle className="text-[15px] leading-tight">{titulo}</DialogTitle>
              {/* Por qual caixa está saindo. Numa empresa com cinco caixas
                  compartilhadas, mandar pela errada é o engano mais caro — e
                  antes essa informação era só mais uma linha no meio do formulário. */}
              <p className="truncate text-xs text-muted-foreground">
                {account ? `por ${account.label} · ${account.email}` : 'nenhuma conta selecionada'}
              </p>
            </div>
          </div>
        </DialogHeader>

        <div className="max-h-[65vh] overflow-y-auto px-5 py-3">
          <div className="space-y-0.5">
            <Campo
              rotulo="Para"
              acao={
                <button
                  type="button"
                  onClick={() => setMostrarCopias((v) => !v)}
                  className={cn(
                    'flex-shrink-0 rounded-lg px-2 py-1 text-[11px] font-medium transition-colors',
                    mostrarCopias
                      ? 'bg-primary/10 text-primary'
                      : 'text-muted-foreground hover:bg-foreground/5 hover:text-foreground',
                  )}
                >
                  Cc/Cco
                </button>
              }
            >
              {destinatarioEhDoOutlook ? (
                <span className="text-sm text-muted-foreground">
                  todos os participantes da conversa
                </span>
              ) : (
                <Input
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                  placeholder="destinatario@email.com"
                  className={estiloCampo}
                />
              )}
            </Campo>

            {mostrarCopias && (
              <>
                <Campo rotulo="Cc">
                  <Input
                    value={cc}
                    onChange={(e) => setCc(e.target.value)}
                    placeholder="quem recebe cópia"
                    className={estiloCampo}
                  />
                </Campo>
                <Campo rotulo="Cco">
                  <Input
                    value={bcc}
                    onChange={(e) => setBcc(e.target.value)}
                    placeholder="cópia que ninguém mais enxerga"
                    className={estiloCampo}
                  />
                </Campo>
              </>
            )}

            <Campo rotulo="Assunto">
              {assuntoEhDoOutlook ? (
                <span className="block truncate text-sm font-medium text-foreground">{subject}</span>
              ) : (
                <Input
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="Sobre o que é este email"
                  className={cn(estiloCampo, 'font-medium')}
                />
              )}
            </Campo>
          </div>

          {replyTo && (
            <label className="mt-1 flex cursor-pointer items-center gap-2 rounded-xl px-3 py-2 transition-colors hover:bg-foreground/[0.02]">
              <input
                type="checkbox"
                checked={paraTodos}
                onChange={(e) => setParaTodos(e.target.checked)}
                className="h-3.5 w-3.5 accent-primary"
              />
              <span className="text-xs text-muted-foreground">
                Responder a todos que estavam na conversa
              </span>
            </label>
          )}

          {templates.length > 0 && (
            <div className="mt-1 px-3">
              <Select onValueChange={applyTemplate}>
                <SelectTrigger className="h-8 border-dashed border-border/70 bg-transparent text-xs">
                  <SelectValue placeholder="Aplicar um modelo pronto..." />
                </SelectTrigger>
                <SelectContent>
                  {templates.map((t) => (
                    <SelectItem key={t.id} value={t.id} className="text-sm">
                      {t.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/*
            A área de escrita ganha superfície própria.

            É onde a pessoa passa quase todo o tempo, e antes ela era só mais uma
            faixa entre linhas divisórias iguais às dos campos de endereço — o
            olho não achava onde escrever.
          */}
          <div className="mt-3 rounded-2xl border border-border/60 bg-foreground/[0.03] p-4">
            <Textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Escreva sua mensagem..."
              className="min-h-[180px] resize-none border-0 bg-transparent p-0 text-sm leading-relaxed shadow-none focus-visible:ring-0 placeholder:text-muted-foreground/60"
            />

            {/*
              A assinatura da PESSOA, não a da conta.

              Antes isto lia `account.signature` — uma coluna que está nula nas
              seis contas, que nenhuma tela jamais escreveu, e que em caixa de
              setor seria a mesma para todo mundo. A sua vem do seu perfil e vale
              em qualquer caixa que você use.

              `dangerouslySetInnerHTML` aqui é aceitável porque o HTML passou por
              `sanitizarAssinatura` antes de ser salvo, e porque é o SEU próprio
              conteúdo — ninguém escreve a assinatura de outra pessoa.
            */}
            {assinaturaHtml && (
              <div className="mt-3 border-t border-dashed border-border/60 pt-3">
                <p className="mb-1.5 text-[10px] uppercase tracking-wider text-muted-foreground/70">
                  Sua assinatura
                </p>
                <div
                  className="overflow-x-auto rounded-lg bg-white p-3 text-xs text-neutral-900 [&_a]:text-blue-700 [&_a]:underline"
                  dangerouslySetInnerHTML={{ __html: assinaturaHtml }}
                />
              </div>
            )}
          </div>

          {anexos.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {anexos.map((a, i) => (
                <span
                  key={`${a.arquivo.name}-${i}`}
                  className="inline-flex items-center gap-2 rounded-xl border border-border/60 bg-foreground/[0.04] py-1.5 pl-2.5 pr-1.5 text-xs"
                >
                  <Paperclip className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
                  <span className="max-w-[180px] truncate font-medium">{a.arquivo.name}</span>
                  <span className="text-muted-foreground">{formatarTamanho(a.arquivo.size)}</span>
                  <button
                    type="button"
                    onClick={() => setAnexos((atuais) => atuais.filter((_, j) => j !== i))}
                    aria-label={`Tirar ${a.arquivo.name}`}
                    className="rounded-md p-0.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
          )}

          {original && (
            <div className="mt-3">
              <button
                type="button"
                onClick={() => setMostrarOriginal((v) => !v)}
                className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
              >
                {mostrarOriginal ? (
                  <ChevronDown className="h-3.5 w-3.5" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5" />
                )}
                Mensagem original
              </button>
              {mostrarOriginal && (
                <div className="mt-2 rounded-2xl border border-border/60 bg-foreground/[0.02] p-4 text-xs text-muted-foreground">
                  <p className="mb-1.5 font-medium text-foreground">
                    {original.from_name || original.from_email}
                    <span className="ml-2 font-normal text-muted-foreground">
                      {new Date(original.received_at).toLocaleString('pt-BR')}
                    </span>
                  </p>
                  <p className="line-clamp-[12] whitespace-pre-line leading-relaxed">
                    {original.body_text || original.body_preview || '(sem prévia)'}
                  </p>
                  {modo === 'encaminhar' && (
                    <p className="mt-2 text-[11px] italic">
                      Os anexos do original vão junto automaticamente.
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-border/60 px-5 py-3.5">
          <div className="flex items-center gap-2">
            <input
              ref={inputArquivo}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => {
                void escolherArquivos(e.target.files)
                e.target.value = ''
              }}
            />
            <Button
              variant="ghost"
              size="sm"
              onClick={() => inputArquivo.current?.click()}
              disabled={isSending}
              className="gap-1.5 text-muted-foreground hover:text-foreground"
            >
              <Paperclip className="h-4 w-4" />
              Anexar
            </Button>
            {totalAnexos > 0 && (
              <span className="text-xs tabular-nums text-muted-foreground">
                {formatarTamanho(totalAnexos)}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={tentarFechar} disabled={isSending}>
              Cancelar
            </Button>
            <Button onClick={handleSend} disabled={isSending} size="sm" className="gap-1.5 px-4">
              {isSending ? (
                <>
                  <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
                  Enviando...
                </>
              ) : (
                <>
                  <Send className="h-3.5 w-3.5" />
                  Enviar
                </>
              )}
            </Button>
          </div>
        </div>
      </GlassDialogContent>
    </Dialog>
  )
}
