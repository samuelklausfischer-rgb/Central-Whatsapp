import { useEffect, useState } from 'react'
import { Paperclip, Star, Search, X, Users, Pin } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import type { Email } from '@/lib/supabase/email-types'
import type { Fixado, EtiquetaFixado } from '@/services/email_fixados'

function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMin = Math.floor(diffMs / 60000)
  const diffH = Math.floor(diffMs / 3600000)
  const diffD = Math.floor(diffMs / 86400000)

  if (diffMin < 1) return 'agora'
  if (diffMin < 60) return `${diffMin}m`
  if (diffH < 24) return `${diffH}h`
  if (diffD < 7) return `${diffD}d`
  return date.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })
}

function getInitials(name: string | null, email: string): string {
  const source = name || email
  return source.slice(0, 2).toUpperCase()
}

const sentimentColors: Record<string, string> = {
  urgente: 'bg-red-500',
  reclamacao: 'bg-orange-500',
  positivo: 'bg-green-500',
  // Token em vez de cor fixa (`bg-gray-400`): sem isso o ponto "neutro" some
  // no tema escuro, muito próximo do fundo.
  neutro: 'bg-muted-foreground',
}

/** Mesma paleta do `EmailPinDialog` e da `EmailActionsBar` — as três etiquetas fechadas com o Samuel em 25/09/2026. */
const COR_DA_ETIQUETA: Record<EtiquetaFixado, string> = {
  urgente: '#dc2626',
  importante: '#d97706',
  ler_depois: '#6b7280',
}
const ROTULO_DA_ETIQUETA: Record<EtiquetaFixado, string> = {
  urgente: 'Urgente',
  importante: 'Importante',
  ler_depois: 'Ler depois',
}

type NivelPiscar = 'nenhum' | 'suave' | 'forte'

/**
 * Calcula o quanto um fixado deve chamar atenção, a partir de `ler_em`.
 *
 * `agoraMs` vem de FORA (um carimbo de tempo atualizado a cada ~30s pelo
 * `EmailHub`) e não de `Date.now()` chamado aqui dentro — recalcular isto a
 * cada render (ou a cada segundo, com um timer próprio) faria a lista inteira
 * re-renderizar sem necessidade nenhuma; ninguém precisa de precisão de
 * segundo para saber que "falta pouco" ou "já passou".
 */
function calcularNivelPiscar(lerEm: string | null | undefined, agoraMs: number): NivelPiscar {
  if (!lerEm) return 'nenhum'
  const diffMin = (new Date(lerEm).getTime() - agoraMs) / 60000
  if (diffMin <= 0) return 'forte'
  if (diffMin <= 15) return 'suave'
  return 'nenhum'
}

/**
 * `prefers-reduced-motion` — quem pediu menos animação no sistema operacional
 * recebe destaque FIXO (cor/opacidade), nunca a piscada. Uma lista de e-mail
 * piscando é agressivo para quem configurou o SO para evitar justamente isso.
 */
function usePrefereReduzirMovimento(): boolean {
  const [reduzido, setReduzido] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  )
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const ouvir = () => setReduzido(mq.matches)
    mq.addEventListener('change', ouvir)
    return () => mq.removeEventListener('change', ouvir)
  }, [])
  return reduzido
}

/**
 * As duas piscadas (suave/forte) precisam de amplitudes DIFERENTES de
 * opacidade — o `animate-pulse` do Tailwind é uma amplitude só (1 → .5) e
 * este arquivo não tem permissão para mexer em `main.css` ou no
 * `tailwind.config`. A saída é declarar as duas aqui dentro, no próprio
 * componente: nada fora da lista de arquivos autorizados desta tarefa muda.
 */
const PISCAR_CSS = `
@keyframes email-piscar-suave { 0%, 100% { opacity: 1 } 50% { opacity: .55 } }
@keyframes email-piscar-forte { 0%, 100% { opacity: 1 } 50% { opacity: .2 } }
`

interface Props {
  emails: Email[]
  selectedEmailId: string | null
  onSelect: (id: string) => void
  onSearch: (query: string) => void
  isLoading?: boolean
  /**
   * O que a equipe registrou sobre cada e-mail, para a lista mostrar sem abrir.
   *
   * Chave é o id do e-mail; `cor` é a da classificação e `pessoas` quantas
   * foram marcadas. Se essa informação só existisse dentro do e-mail aberto,
   * ninguém a veria ao varrer a caixa — e organizar não teria serventia.
   */
  marcadores?: Record<string, { cor: string | null; pessoas: number }>
  /** Ids em seleção múltipla (para ações em massa) — não confundir com `selectedEmailId`, que é o e-mail ABERTO na leitura. */
  selectedIds?: Set<string>
  /**
   * Alterna a seleção de um e-mail para a barra de ações em massa.
   *
   * `shiftKey` vem do próprio evento de clique no checkbox: com ele marcado,
   * quem decide o intervalo (do último clicado até este) é o chamador, que é
   * quem conhece a ordem completa da lista.
   */
  onToggleSelect?: (id: string, shiftKey: boolean) => void
  /**
   * Pins visíveis para os e-mails desta lista (o meu, ou o de um colega que
   * compartilhou — ver `services/email_fixados.ts`). Quem já vem ordenado com
   * os fixados primeiro é o `EmailHub` (`emailsOrdenados`); aqui só se separa
   * visualmente o que já chegou nessa ordem.
   */
  pins?: Record<string, Fixado>
  /** Carimbo de tempo (ms) para calcular a piscada — ver `calcularNivelPiscar`. */
  agora?: number
  /**
   * De quem é cada e-mail (item 3, 25/09/2026) — `email_id -> nome` de quem
   * está em `email_states.assigned_to`. Já vem resolvido do `EmailHub`
   * (que é quem conhece a lista de pessoas); aqui só se reduz a iniciais,
   * igual ao avatar do remetente. E-mail sem dono não aparece no mapa e não
   * mostra nada — silêncio é a leitura certa de "ninguém pegou ainda".
   */
  donos?: Record<string, string>
  /** Mensagem do estado vazio, no lugar do genérico "Nenhum email encontrado" — usado pela aba "Minhas". */
  mensagemVazia?: string
}

export function EmailList({
  emails, selectedEmailId, onSelect, onSearch, isLoading, marcadores = {},
  selectedIds = new Set(), onToggleSelect, pins = {}, agora = Date.now(),
  donos = {}, mensagemVazia,
}: Props) {
  const [searchValue, setSearchValue] = useState('')
  const reduzirMovimento = usePrefereReduzirMovimento()

  function handleSearchChange(value: string) {
    setSearchValue(value)
    onSearch(value)
  }

  // Separação visual fixados/resto. `emails` já chega ORDENADO do `EmailHub`
  // (fixados primeiro) — filtrar aqui de novo é só para desenhar a divisória
  // no lugar certo, não para decidir a ordem.
  const pinnedEmails = emails.filter((e) => pins[e.id])
  const restEmails = emails.filter((e) => !pins[e.id])

  function renderLinha(email: Email) {
    const isSelected = selectedEmailId === email.id
    const isChecked = selectedIds.has(email.id)
    const fixado = pins[email.id]
    const nivel = fixado ? calcularNivelPiscar(fixado.ler_em, agora) : 'nenhum'
    const cor = fixado ? COR_DA_ETIQUETA[fixado.etiqueta] : null

    return (
      // Linha vira um `<div>`, não mais um único `<button>`: um
      // Checkbox aninhado dentro de um `<button>` gera `<button>`
      // dentro de `<button>` (HTML inválido) e o clique no checkbox
      // acabava também disparando o `onSelect` da linha. Aqui os
      // dois são IRMÃOS — clicar num não aciona o outro.
      <div
        key={email.id}
        className={`flex items-stretch transition-colors hover:bg-accent/50 ${
          isSelected ? 'bg-accent' : isChecked ? 'bg-primary/5' : ''
        }`}
        style={cor ? { borderLeft: `3px solid ${cor}` } : undefined}
      >
        {onToggleSelect && (
          <div className="flex items-center pl-3 pr-1 flex-shrink-0">
            <Checkbox
              checked={isChecked}
              // `onClick` (não `onCheckedChange`): é o evento nativo
              // que carrega `shiftKey`, necessário para a seleção
              // por intervalo. O estado marcado/desmarcado já é
              // 100% controlado pelo pai via `checked` acima.
              onClick={(e) => onToggleSelect(email.id, e.shiftKey)}
              aria-label={`Selecionar email de ${email.from_name || email.from_email}`}
            />
          </div>
        )}
        <button
          onClick={() => onSelect(email.id)}
          className="flex-1 min-w-0 text-left px-4 py-3"
        >
          <div className="flex items-start gap-3">
            {/* Indicador não lido */}
            <div className="flex flex-col items-center gap-1.5 pt-1 flex-shrink-0">
              {!email.is_read && (
                <span className="h-2 w-2 rounded-full bg-blue-500" />
              )}
              {email.ai_sentiment && (
                <span
                  className={`h-1.5 w-1.5 rounded-full ${sentimentColors[email.ai_sentiment] ?? 'bg-muted-foreground/70'}`}
                  title={email.ai_sentiment}
                />
              )}
            </div>

            {/* Avatar */}
            <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 text-xs font-semibold text-primary">
              {getInitials(email.from_name, email.from_email)}
            </div>

            {/* Conteúdo */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <span className={`text-sm truncate ${!email.is_read ? 'font-semibold text-foreground' : 'text-foreground'}`}>
                  {email.from_name || email.from_email}
                </span>
                <span className="text-xs text-muted-foreground flex-shrink-0">
                  {formatRelativeTime(email.received_at)}
                </span>
              </div>

              <p className={`text-sm truncate mt-0.5 ${!email.is_read ? 'font-medium text-foreground' : 'text-muted-foreground'}`}>
                {email.subject || '(sem assunto)'}
              </p>

              {/*
                `body_preview` vem pronto do Graph e existe para TODA
                mensagem. Antes a prévia saía de `body_text`, que só é
                preenchido quando o e-mail é texto puro — ou seja, a
                maioria ficava sem prévia nenhuma.
              */}
              {email.ai_summary || email.body_preview || email.body_text ? (
                <p className="text-xs text-muted-foreground truncate mt-0.5">
                  {email.ai_summary ?? email.body_preview ?? email.body_text?.slice(0, 120)}
                </p>
              ) : null}

              {/* Footer: ícones */}
              <div className="flex flex-wrap items-center gap-2 mt-1">
                {/* `has_attachments` vem do Graph; o jsonb `attachments`
                    ficou sem uso desde a migration 20260826140000. */}
                {email.has_attachments && (
                  <Paperclip className="h-3 w-3 text-muted-foreground" />
                )}
                {email.importance === 'high' && (
                  <span
                    className="text-[11px] font-bold leading-none text-red-500"
                    title="Alta importância"
                  >
                    !
                  </span>
                )}
                {/* O que a equipe registrou: cor da classificação e
                    quantas pessoas estão cuidando. */}
                {marcadores[email.id]?.cor && (
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: marcadores[email.id].cor! }}
                    title="Classificado pela equipe"
                  />
                )}
                {(marcadores[email.id]?.pessoas ?? 0) > 0 && (
                  <span
                    className="flex items-center gap-0.5 text-[10px] text-muted-foreground"
                    title="Pessoas cuidando deste e-mail"
                  >
                    <Users className="h-3 w-3" />
                    {marcadores[email.id].pessoas}
                  </span>
                )}
                {email.is_starred && (
                  <Star className="h-3 w-3 text-yellow-500 fill-yellow-500" />
                )}
                {/*
                  Dono do e-mail (item 3, 25/09/2026) — discreto, iniciais só,
                  no rodapé junto dos outros ícones. Some por completo quando
                  não há dono (`donos[email.id]` ausente): a intenção é dar um
                  sinal rápido pra quem varre a caixa, não decorar a lista.
                */}
                {donos[email.id] && (
                  <span
                    className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[9px] font-semibold text-primary"
                    title={`Atribuído a ${donos[email.id]}`}
                  >
                    {getInitials(donos[email.id], '')}
                  </span>
                )}
                {email.ai_category && (
                  <Badge variant="outline" className="text-[10px] px-1 py-0 h-4">
                    {email.ai_category}
                  </Badge>
                )}
                {/*
                  A etiqueta do pin, na cor da urgência. Pisca em dois
                  níveis (ver `calcularNivelPiscar`) — SUAVE quando faltam
                  até 15 min para `ler_em`, FORTE (opacidade mais funda)
                  quando já passou. Sem `prefers-reduced-motion`, os dois
                  usam as keyframes locais (`PISCAR_CSS`); com ele ligado,
                  a piscada vira destaque parado — nada de `animate-*`.
                */}
                {fixado && (
                  <span
                    className={cn(
                      'flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium',
                      !reduzirMovimento && nivel === 'suave' && 'animate-[email-piscar-suave_2s_ease-in-out_infinite]',
                      !reduzirMovimento && nivel === 'forte' && 'animate-[email-piscar-forte_1s_ease-in-out_infinite]',
                    )}
                    style={{
                      backgroundColor: `${COR_DA_ETIQUETA[fixado.etiqueta]}22`,
                      color: COR_DA_ETIQUETA[fixado.etiqueta],
                      // Reduzido: nada de animação — "forte" fica sempre
                      // opaco (destaque fixo), "suave" fica um pouco mais
                      // translúcido, mas parado.
                      opacity: reduzirMovimento ? (nivel === 'forte' ? 1 : nivel === 'suave' ? 0.85 : 1) : undefined,
                    }}
                    title={
                      `Fixado — ${ROTULO_DA_ETIQUETA[fixado.etiqueta]}` +
                      (nivel === 'forte' ? ' (atrasado)' : nivel === 'suave' ? ' (quase na hora)' : '')
                    }
                  >
                    <Pin className="h-2.5 w-2.5" />
                    {ROTULO_DA_ETIQUETA[fixado.etiqueta]}
                  </span>
                )}
              </div>
            </div>
          </div>
        </button>
      </div>
    )
  }

  return (
    // Sem `border-r` aqui: o painel pai (`EmailHub.tsx`) já desenha a divisão
    // entre as colunas — duplicar a borda deixava uma linha dupla exatamente
    // onde fica o handle de redimensionar.
    <div className="flex flex-col h-full">
      {/* As keyframes da piscada — uma vez só, não por linha. */}
      <style>{PISCAR_CSS}</style>

      {/* Barra de busca */}
      <div className="p-3 border-b border-border">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input
            value={searchValue}
            onChange={(e) => handleSearchChange(e.target.value)}
            placeholder="Buscar emails..."
            className="pl-8 pr-8 h-9 text-sm"
          />
          {searchValue && (
            <button
              onClick={() => handleSearchChange('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {/* Lista */}
      <ScrollArea className="flex-1">
        {isLoading ? (
          <div className="flex items-center justify-center h-32 text-sm text-muted-foreground">
            Carregando emails...
          </div>
        ) : emails.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 gap-2 px-6 text-center text-sm text-muted-foreground">
            <p>{mensagemVazia ?? 'Nenhum email encontrado'}</p>
          </div>
        ) : (
          <div>
            {/* Fixados no topo, com divisória e rótulo — separados do resto
                da caixa, não misturados por data. */}
            {pinnedEmails.length > 0 && (
              <div className="divide-y divide-border border-b-2 border-border">
                <div className="bg-muted/40 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Fixados
                </div>
                {pinnedEmails.map(renderLinha)}
              </div>
            )}
            <div className="divide-y divide-border">
              {restEmails.map(renderLinha)}
            </div>
          </div>
        )}
      </ScrollArea>
    </div>
  )
}
