import { ArrowLeft, ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { PainelDeOrganizacao } from '@/components/email/PainelDeOrganizacao'
import { EmailActionsBar } from './EmailActionsBar'
import { CrossChannelPanel } from './CrossChannelPanel'
import { AiSuggestionPanel } from './AiSuggestionPanel'
import { EmailThread } from './EmailThread'
import { useConversaDoEmail } from './useConversaDoEmail'
import type { Email, EmailState } from '@/lib/supabase/email-types'
import type { Contact, AiPrompt } from '@/lib/supabase/types'
import type { Fixado } from '@/services/email_fixados'

/* O corpo (iframe, imagens, histórico citado) mora em `CorpoDoEmail`; o bloco de
   cada mensagem, em `BlocoDeEmail`; e os anexos, em `AnexosDoEmail`. O leitor
   ficou com a moldura: barra de ações, assunto, painéis e a conversa. */

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
  /** O pin visível para este e-mail (meu ou de um colega compartilhado) — `null` se ninguém fixou. */
  fixado?: Fixado | null
  /** O pin acima é MEU? Só decide o texto da dica no botão — ver `EmailActionsBar`. */
  souMeuPin?: boolean
  /** Nome de quem é o dono hoje (`email_states.assigned_to`) — `null` se ninguém. */
  donoNome?: string | null
  /** Fecha a mensagem e traz a lista de volta — ela some enquanto se lê. */
  onVoltar: () => void
  onReply: (email: Email) => void
  onForward: (email: Email) => void
  onClose: (emailId: string) => void
  onArchive: (emailId: string) => void
  onToggleStar: (emailId: string) => void
  onSetWaiting: (emailId: string) => void
  onUseSuggestion: (text: string) => void
  onFixar: () => void
  onAtribuir: () => void
}

export function EmailReader({
  email,
  state,
  contact,
  aiPrompts,
  carregandoCorpo = false,
  setorDaCaixa = null,
  fixado = null,
  souMeuPin = false,
  donoNome = null,
  onVoltar,
  onReply,
  onForward,
  onClose,
  onArchive,
  onToggleStar,
  onSetWaiting,
  onUseSuggestion,
  onFixar,
  onAtribuir,
}: Props) {
  /*
    A conversa inteira do e-mail aberto, em blocos (ver `EmailThread`).

    O leitor deixou de ser "uma mensagem num iframe": o assunto aparece UMA vez
    aqui em cima, e cada mensagem da conversa é um bloco com quem escreveu, dia e
    hora. A barra de ações continua valendo para `email` — a mensagem que foi
    aberta —, exatamente como antes.
  */
  const conversa = useConversaDoEmail(email)
  const totalDeMensagens = conversa.mensagens.length

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
            fixado={fixado}
            souMeuPin={souMeuPin}
            donoNome={donoNome}
            onReply={() => onReply(email)}
            onForward={() => onForward(email)}
            onClose={() => onClose(email.id)}
            onArchive={() => onArchive(email.id)}
            onToggleStar={() => onToggleStar(email.id)}
            onSetWaiting={() => onSetWaiting(email.id)}
            onFixar={onFixar}
            onAtribuir={onAtribuir}
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

        {/* Assunto UMA vez, e quantas mensagens a conversa tem. */}
        <div className="space-y-1">
          <h2 className="text-2xl font-semibold leading-snug tracking-tight text-foreground">
            {email.subject || '(sem assunto)'}
          </h2>
          {totalDeMensagens > 1 && (
            <p className="text-sm text-muted-foreground">{totalDeMensagens} mensagens nesta conversa</p>
          )}
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

        {/* A conversa: um bloco por mensagem, a mais nova em cima. */}
        <EmailThread email={email} carregandoCorpo={carregandoCorpo} conversa={conversa} />

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
