import { useEffect, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { cn } from '@/lib/utils'
import { CorpoDoEmail } from './CorpoDoEmail'
import { AnexosDoEmail } from './AnexosDoEmail'
import type { Email } from '@/lib/supabase/email-types'

/** Em que pé está o corpo desta mensagem (a lista da conversa não o traz). */
export type CorpoDoBloco =
  | { estado: 'carregando' }
  | { estado: 'erro'; mensagem: string }
  | { estado: 'pronto'; html: string | null; texto: string | null }

/**
 * "ter., 06/10/2026 às 14:32" — dia da semana, data e hora no fuso do navegador.
 *
 * Os dois pedaços são formatados separados porque `toLocaleString` do pt-BR
 * junta com vírgula ("06/10/2026 14:32"), e o "às" é o que a equipe lê.
 */
export function dataEHoraLegivel(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const data = d.toLocaleDateString('pt-BR', {
    weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric',
  })
  const hora = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  return `${data} às ${hora}`
}

/** "João Silva" → "JS"; só o e-mail → as duas primeiras letras dele. */
function iniciaisDe(nome: string | null, email: string): string {
  const palavras = (nome ?? '').split(/\s+/).filter((p) => /\p{L}/u.test(p))
  if (palavras.length >= 2) {
    return (palavras[0][0] + palavras[palavras.length - 1][0]).toUpperCase()
  }
  return (palavras[0] ?? email).replace(/[^\p{L}\p{N}]/gu, '').slice(0, 2).toUpperCase() || '?'
}

interface Props {
  mensagem: Email
  corpo: CorpoDoBloco
  aberto: boolean
  /** Falso quando a conversa tem uma mensagem só — não há o que recolher. */
  recolhivel: boolean
  /**
   * É a mensagem que a barra de ações (responder, encaminhar, fixar…) atinge?
   * Só é destacada quando há mais de uma na conversa; sozinha, seria ruído.
   */
  destacar: boolean
  cortarHistorico: boolean
  onAlternar: () => void
  onTentarDeNovo: () => void
}

/**
 * UMA mensagem da conversa: quem escreveu, dia e hora, e o conteúdo.
 *
 * Fechada, vira uma linha com a prévia — é o que permite ler uma conversa de 20
 * mensagens sem rolar por vinte corpos. O corpo só é pedido quando o bloco abre.
 */
export function BlocoDeEmail({
  mensagem, corpo, aberto, recolhivel, destacar, cortarHistorico, onAlternar, onTentarDeNovo,
}: Props) {
  // Destinatários dobrados por padrão. Uma mensagem com 20 pessoas em cópia
  // empurraria o corpo para fora da tela — o Outlook resume e abre no clique.
  const [destinatariosAbertos, setDestinatariosAbertos] = useState(false)
  useEffect(() => setDestinatariosAbertos(false), [mensagem.id])

  const para = mensagem.to_emails ?? []
  const copia = mensagem.cc_emails ?? []
  const nome = mensagem.from_name || mensagem.from_email
  const previa = (mensagem.body_preview ?? '').replace(/\s+/g, ' ').trim()

  const cabecalho = (
    <>
      <Avatar className="h-9 w-9 flex-shrink-0">
        <AvatarFallback className="bg-primary/10 text-xs font-semibold text-primary">
          {iniciaisDe(mensagem.from_name, mensagem.from_email)}
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-sm font-semibold">{nome}</span>
          {mensagem.from_name && (
            <span className="truncate text-xs text-muted-foreground">&lt;{mensagem.from_email}&gt;</span>
          )}
          {mensagem.direction === 'outbound' && (
            <span className="rounded-full bg-primary/10 px-1.5 py-px text-[10px] font-medium text-primary">
              Enviado
            </span>
          )}
        </div>
        {!aberto && (
          <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
            {previa || '(sem prévia)'}
          </p>
        )}
      </div>
      <span className="ml-2 flex-shrink-0 whitespace-nowrap text-xs text-muted-foreground">
        {dataEHoraLegivel(mensagem.received_at)}
      </span>
      {recolhivel && (
        <ChevronDown
          className={cn(
            'h-4 w-4 flex-shrink-0 text-muted-foreground transition-transform',
            aberto && 'rotate-180',
          )}
        />
      )}
    </>
  )

  return (
    <article
      className={cn(
        'overflow-hidden rounded-xl border bg-card/40',
        destacar ? 'border-primary/40 ring-1 ring-primary/20' : 'border-border/70',
      )}
      aria-label={`Mensagem de ${nome}`}
    >
      {recolhivel ? (
        <button
          type="button"
          onClick={onAlternar}
          aria-expanded={aberto}
          className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/40"
        >
          {cabecalho}
        </button>
      ) : (
        <div className="flex w-full items-start gap-3 px-4 py-3">{cabecalho}</div>
      )}

      {aberto && (
        <div className="space-y-3 px-4 pb-4">
          <button
            type="button"
            onClick={() => setDestinatariosAbertos((v) => !v)}
            className="flex items-center gap-1 text-left text-xs text-muted-foreground hover:text-foreground"
          >
            <span className={destinatariosAbertos ? '' : 'line-clamp-1'}>
              Para: {para.join(', ') || '(ninguém)'}
              {copia.length > 0 && ` · CC: ${copia.join(', ')}`}
            </span>
            <ChevronDown
              className={`h-3 w-3 shrink-0 transition-transform ${destinatariosAbertos ? 'rotate-180' : ''}`}
            />
          </button>

          {corpo.estado === 'carregando' && (
            /* Esqueleto enquanto o corpo vem. "(sem conteúdo)" só quando for
               verdade — não enquanto ainda está a caminho. */
            <div
              className="space-y-3 rounded-lg border border-border/70 bg-white p-5"
              aria-label="Carregando o conteúdo"
            >
              <div className="h-3 w-3/4 animate-pulse rounded bg-neutral-200" />
              <div className="h-3 w-full animate-pulse rounded bg-neutral-200" />
              <div className="h-3 w-5/6 animate-pulse rounded bg-neutral-200" />
              <div className="h-3 w-2/3 animate-pulse rounded bg-neutral-200" />
            </div>
          )}

          {corpo.estado === 'erro' && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              <span>Não deu para carregar esta mensagem. {corpo.mensagem}</span>
              <Button size="sm" variant="outline" onClick={onTentarDeNovo}>
                Tentar de novo
              </Button>
            </div>
          )}

          {corpo.estado === 'pronto' && (
            /*
              O corpo num cartão BRANCO, sempre — inclusive no tema escuro.

              É o que o Outlook faz: o HTML é do remetente e vem com cor fixa
              (assinatura com logo, tabela colorida, boleto). Adaptar ao tema
              produziria texto preto em fundo preto em boa parte das mensagens, e
              só se descobre quando acontece. A moldura arredondada com sombra
              deixa claro que o branco é proposital, e separa "o que ele
              escreveu" da nossa interface.
            */
            <CorpoDoEmail
              emailId={mensagem.id}
              html={corpo.html}
              texto={corpo.texto}
              cortarHistorico={cortarHistorico}
            />
          )}

          <AnexosDoEmail emailId={mensagem.id} temAnexos={mensagem.has_attachments} />
        </div>
      )}
    </article>
  )
}
