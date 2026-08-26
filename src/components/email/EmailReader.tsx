import { useEffect, useRef, useState } from 'react'
import {
  Download, ArrowLeft, ExternalLink, ChevronDown,
  FileText, FileSpreadsheet, FileImage, File as FileIcon,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useToast } from '@/hooks/use-toast'
import {
  getAttachments, baixarAnexo, tipoDoAnexo, tamanhoLegivel,
} from '@/services/email_attachments'
import type { EmailAttachmentRow } from '@/lib/supabase/email-types'
import { PainelDeOrganizacao } from '@/components/email/PainelDeOrganizacao'

/** Ícone por tipo de arquivo, no espírito do Outlook. */
const ICONE_DO_ANEXO: Record<string, React.ElementType> = {
  pdf: FileText,
  imagem: FileImage,
  planilha: FileSpreadsheet,
  documento: FileText,
  arquivo: FileIcon,
}
import { ScrollArea } from '@/components/ui/scroll-area'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { EmailActionsBar } from './EmailActionsBar'
import { CrossChannelPanel } from './CrossChannelPanel'
import { AiSuggestionPanel } from './AiSuggestionPanel'
import type { Email, EmailState } from '@/lib/supabase/email-types'
import type { Contact, AiPrompt } from '@/lib/supabase/types'

function sanitizeHtml(html: string): string {
  // Remove scripts e elementos potencialmente perigosos, mantém layout
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, '')
    .replace(/on\w+="[^"]*"/gi, '')
    .replace(/javascript:/gi, '')
}

function formatDateTime(dateStr: string): string {
  return new Date(dateStr).toLocaleString('pt-BR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/* `bytesToHuman` saiu daqui: virou `tamanhoLegivel` em `services/email_attachments`,
   junto do resto que lida com anexo. */

interface Props {
  email: Email
  state: EmailState | null
  contact: Contact | null
  aiPrompts: AiPrompt[]
  /**
   * O corpo ainda está sendo buscado.
   *
   * A lista não traz mais o corpo, então entre abrir a mensagem e ele chegar há
   * um intervalo curto. Sem este aviso o leitor anunciava "(sem conteúdo)"
   * nesse meio-tempo — que é justamente o que parecia o defeito.
   */
  carregandoCorpo?: boolean
  /**
   * Setor da caixa que recebeu. Serve para o seletor de responsáveis mostrar
   * primeiro a gente daquele setor — numa caixa `financeiro@`, é do Financeiro
   * que se escolhe em quase toda vez.
   */
  setorDaCaixa?: string | null
  /** Fecha a mensagem e traz a lista de volta — ela some enquanto se lê. */
  onVoltar: () => void
  onReply: (email: Email) => void
  onForward: (email: Email) => void
  onClose: (emailId: string) => void
  onArchive: (emailId: string) => void
  onToggleStar: (emailId: string) => void
  onSetWaiting: (emailId: string) => void
  onUseSuggestion: (text: string) => void
}

export function EmailReader({
  email,
  state,
  contact,
  aiPrompts,
  carregandoCorpo = false,
  setorDaCaixa = null,
  onVoltar,
  onReply,
  onForward,
  onClose,
  onArchive,
  onToggleStar,
  onSetWaiting,
  onUseSuggestion,
}: Props) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  /*
    Imagens externas começam BLOQUEADAS, como no Outlook.

    Não é frescura de segurança: carregar a imagem avisa o remetente de que você
    abriu a mensagem, a que horas e de qual endereço IP — é assim que funciona o
    "pixel de rastreamento" de quem dispara e-mail em massa. O Outlook bloqueia
    por padrão e mostra a faixa "clique para baixar imagens"; aqui é igual.

    Reseta a cada e-mail: liberar uma mensagem não pode liberar a próxima.
  */
  const [imagensLiberadas, setImagensLiberadas] = useState(false)
  useEffect(() => setImagensLiberadas(false), [email.id])

  const { toast } = useToast()
  const [destinatariosAbertos, setDestinatariosAbertos] = useState(false)
  const [anexos, setAnexos] = useState<EmailAttachmentRow[]>([])
  const [baixandoId, setBaixandoId] = useState<string | null>(null)

  useEffect(() => {
    setDestinatariosAbertos(false)
    setAnexos([])
    // Só consulta quando o Graph disse que há anexo — evita uma ida ao banco
    // por mensagem aberta, e a maioria não tem nenhum.
    if (!email.has_attachments) return
    let valido = true
    getAttachments(email.id)
      .then((lista) => valido && setAnexos(lista))
      .catch((e) => console.error('anexos:', e))
    return () => {
      valido = false
    }
  }, [email.id, email.has_attachments])

  const baixar = async (att: EmailAttachmentRow) => {
    setBaixandoId(att.id)
    try {
      await baixarAnexo(att)
    } catch (e) {
      toast({
        title: 'Não deu para baixar o anexo',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      })
    } finally {
      setBaixandoId(null)
    }
  }

  const temImagemExterna = Boolean(email.body_html && /<img[^>]+src=["']https?:/i.test(email.body_html))

  // Injetar HTML sanitizado no iframe
  useEffect(() => {
    const iframe = iframeRef.current
    if (!iframe || !email.body_html) return

    const doc = iframe.contentDocument || iframe.contentWindow?.document
    if (!doc) return

    let sanitized = sanitizeHtml(email.body_html)
    if (!imagensLiberadas) {
      // Troca o `src` por `data-src`: a imagem não é baixada, mas o HTML
      // continua inteiro para quando a pessoa liberar.
      sanitized = sanitized.replace(/(<img[^>]+)src=(["'])(https?:[^"']*)\2/gi, '$1data-src=$2$3$2')
    }
    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <style>
            * { box-sizing: border-box; }
            body {
              font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
              font-size: 14px;
              line-height: 1.6;
              color: #1a1a1a;
              margin: 0;
              padding: 16px;
              word-break: break-word;
            }
            img { max-width: 100%; height: auto; }
            a { color: #3B82F6; }
            table { max-width: 100%; }
            pre { white-space: pre-wrap; }
          </style>
        </head>
        <body>${sanitized}</body>
      </html>
    `
    doc.open()
    doc.write(html)
    doc.close()

    // Ajustar altura dinamicamente
    const resize = () => {
      if (iframe.contentDocument?.body) {
        iframe.style.height = iframe.contentDocument.body.scrollHeight + 32 + 'px'
      }
    }
    iframe.onload = resize
    setTimeout(resize, 200)
  }, [email.body_html, imagensLiberadas])

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/*
        Barra de comandos FIXA no topo.

        Antes ela rolava junto com o texto: num e-mail longo, responder exigia
        subir tudo de volta. No outlook.com essa barra nunca sai da tela — e,
        como a lista some ao abrir a mensagem, é aqui que mora o caminho de
        volta.
      */}
      <div className="flex items-center gap-2 border-b border-border/60 bg-background/80 px-4 py-2 backdrop-blur-sm">
        <Button variant="ghost" size="sm" className="gap-1.5 shrink-0" onClick={onVoltar}>
          <ArrowLeft className="h-4 w-4" />
          Voltar
        </Button>
        <div className="h-5 w-px bg-border/70" />
        <div className="min-w-0 flex-1">
          <EmailActionsBar
            email={email}
            state={state}
            onReply={() => onReply(email)}
            onForward={() => onForward(email)}
            onClose={() => onClose(email.id)}
            onArchive={() => onArchive(email.id)}
            onToggleStar={() => onToggleStar(email.id)}
            onSetWaiting={() => onSetWaiting(email.id)}
          />
        </div>
        {email.web_link && (
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5 shrink-0"
            onClick={() => window.open(email.web_link!, '_blank', 'noopener,noreferrer')}
            title="Abrir esta mensagem no Outlook"
          >
            <ExternalLink className="h-4 w-4" />
            <span className="hidden lg:inline">Outlook</span>
          </Button>
        )}
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="mx-auto max-w-4xl space-y-4 p-6">

        {/* Cabeçalho do email */}
        <div className="space-y-3">
          <h2 className="text-2xl font-semibold leading-snug tracking-tight text-foreground">
            {email.subject || '(sem assunto)'}
          </h2>

          {/* Remetente */}
          <div className="flex items-start gap-3">
            <Avatar className="h-10 w-10 flex-shrink-0">
              <AvatarFallback className="bg-primary/10 text-primary text-sm font-semibold">
                {(email.from_name || email.from_email).slice(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline gap-2 flex-wrap">
                <span className="text-sm font-semibold">{email.from_name || email.from_email}</span>
                {email.from_name && (
                  <span className="text-xs text-muted-foreground">&lt;{email.from_email}&gt;</span>
                )}
                <span className="ml-auto text-xs text-muted-foreground">
                  {formatDateTime(email.received_at)}
                </span>
              </div>
              {/*
                Destinatários dobrados por padrão. Uma mensagem com 20 pessoas
                em cópia empurraria o corpo do e-mail para fora da tela — o
                Outlook resume e abre no clique, igual.
              */}
              <button
                onClick={() => setDestinatariosAbertos((v) => !v)}
                className="mt-0.5 flex items-center gap-1 text-left text-xs text-muted-foreground hover:text-foreground"
              >
                <span className={destinatariosAbertos ? '' : 'line-clamp-1'}>
                  Para: {email.to_emails.join(', ')}
                  {email.cc_emails?.length > 0 && ` · CC: ${email.cc_emails.join(', ')}`}
                </span>
                <ChevronDown
                  className={`h-3 w-3 shrink-0 transition-transform ${destinatariosAbertos ? 'rotate-180' : ''}`}
                />
              </button>
            </div>
          </div>
        </div>

        {/* O que a equipe registrou sobre este e-mail. Fica ANTES do corpo de
            propósito: é a decisão de quem já olhou, e quem abre depois precisa
            ver isso antes de reler tudo. */}
        <PainelDeOrganizacao emailId={email.id} setorDaCaixa={setorDaCaixa} />

        {/* Classificação IA */}
        {(email.ai_category || email.ai_sentiment || email.ai_summary) && (
          <div className="flex flex-wrap gap-2 text-xs">
            {email.ai_category && (
              <span className="px-2 py-1 rounded-full bg-muted text-muted-foreground capitalize">
                {email.ai_category}
              </span>
            )}
            {email.ai_sentiment && (
              <span
                className={`px-2 py-1 rounded-full font-medium ${
                  email.ai_sentiment === 'urgente'
                    ? 'bg-red-500/10 text-red-600 dark:text-red-400'
                    : email.ai_sentiment === 'reclamacao'
                      ? 'bg-orange-500/10 text-orange-600 dark:text-orange-400'
                      : email.ai_sentiment === 'positivo'
                        ? 'bg-green-500/10 text-green-600 dark:text-green-400'
                        : 'bg-muted text-muted-foreground'
                }`}
              >
                {email.ai_sentiment}
              </span>
            )}
            {email.ai_summary && (
              <span className="text-muted-foreground italic">{email.ai_summary}</span>
            )}
          </div>
        )}

        {/* Contexto cross-canal */}
        {contact && <CrossChannelPanel contact={contact} />}

        {/* Faixa de imagens bloqueadas, igual à do Outlook */}
        {temImagemExterna && !imagensLiberadas && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
            <span>Imagens bloqueadas para proteger sua privacidade.</span>
            <Button size="sm" variant="outline" onClick={() => setImagensLiberadas(true)}>
              Mostrar imagens
            </Button>
          </div>
        )}

        {/*
          O corpo num cartão BRANCO, sempre — inclusive no tema escuro.

          É o que o Outlook faz: o HTML é do remetente e vem com cor fixa
          (assinatura com logo, tabela colorida, boleto). Adaptar ao tema
          produziria texto preto em fundo preto em boa parte das mensagens, e só
          se descobre quando acontece. A moldura arredondada com sombra deixa
          claro que o branco é proposital, e separa "o que ele escreveu" da
          nossa interface.
        */}
        <div className="overflow-hidden rounded-xl border border-border/70 bg-white shadow-sm">
          {email.body_html ? (
            <iframe
              ref={iframeRef}
              sandbox="allow-same-origin"
              className="block w-full min-h-[240px]"
              title="Conteúdo do email"
            />
          ) : carregandoCorpo ? (
            /* Esqueleto enquanto o corpo vem. "(sem conteúdo)" só quando for
               verdade — não enquanto ainda está a caminho. */
            <div className="space-y-3 p-6" aria-label="Carregando o conteúdo">
              <div className="h-3 w-3/4 animate-pulse rounded bg-neutral-200" />
              <div className="h-3 w-full animate-pulse rounded bg-neutral-200" />
              <div className="h-3 w-5/6 animate-pulse rounded bg-neutral-200" />
              <div className="h-3 w-2/3 animate-pulse rounded bg-neutral-200" />
            </div>
          ) : (
            <div className="whitespace-pre-wrap p-6 text-sm leading-relaxed text-neutral-900">
              {email.body_text || '(sem conteúdo)'}
            </div>
          )}
        </div>

        {/*
          Anexos vindos de `email_attachments`.

          Antes esta seção lia `email.attachments` (jsonb), que deixou de ser
          preenchido na migration 20260826140000 — e-mail com anexo não mostrava
          anexo nenhum, sem erro. O conteúdo continua na Microsoft: o botão
          busca na hora.
        */}
        {anexos.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {anexos.length === 1 ? '1 anexo' : `${anexos.length} anexos`}
            </p>
            <div className="flex flex-wrap gap-2">
              {anexos.map((att) => {
                const Icone = ICONE_DO_ANEXO[tipoDoAnexo(att.mime_type, att.name)]
                const baixando = baixandoId === att.id
                return (
                  <button
                    key={att.id}
                    onClick={() => baixar(att)}
                    disabled={baixando}
                    className="group flex items-center gap-3 rounded-lg border border-border bg-muted/30 px-3 py-2 text-left text-sm transition-colors hover:bg-muted/60 disabled:opacity-60"
                    title={`Baixar ${att.name}`}
                  >
                    <Icone className="h-5 w-5 flex-shrink-0 text-muted-foreground" />
                    <span className="min-w-0">
                      <span className="block max-w-[220px] truncate">{att.name}</span>
                      {att.size ? (
                        <span className="block text-xs text-muted-foreground">
                          {tamanhoLegivel(att.size)}
                        </span>
                      ) : null}
                    </span>
                    <Download
                      className={`h-4 w-4 flex-shrink-0 text-muted-foreground ${baixando ? 'animate-pulse' : ''}`}
                    />
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {/* Sugestão IA */}
        {aiPrompts.length > 0 && (
          <AiSuggestionPanel
            email={email}
            prompts={aiPrompts}
            onUseSuggestion={onUseSuggestion}
          />
        )}
        </div>
      </ScrollArea>
    </div>
  )
}
