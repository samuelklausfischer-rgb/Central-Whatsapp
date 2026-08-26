import { useState } from 'react'
import { Paperclip, Star, Search, X, Users } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import type { Email } from '@/lib/supabase/email-types'

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
}

export function EmailList({
  emails, selectedEmailId, onSelect, onSearch, isLoading, marcadores = {},
}: Props) {
  const [searchValue, setSearchValue] = useState('')

  function handleSearchChange(value: string) {
    setSearchValue(value)
    onSearch(value)
  }

  return (
    // Sem `border-r` aqui: o painel pai (`EmailHub.tsx`) já desenha a divisão
    // entre as colunas — duplicar a borda deixava uma linha dupla exatamente
    // onde fica o handle de redimensionar.
    <div className="flex flex-col h-full">
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
          <div className="flex flex-col items-center justify-center h-32 gap-2 text-sm text-muted-foreground">
            <p>Nenhum email encontrado</p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {emails.map((email) => {
              const isSelected = selectedEmailId === email.id
              return (
                <button
                  key={email.id}
                  onClick={() => onSelect(email.id)}
                  className={`w-full text-left px-4 py-3 transition-colors hover:bg-accent/50 ${
                    isSelected ? 'bg-accent' : ''
                  }`}
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
                      <div className="flex items-center gap-2 mt-1">
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
                        {email.ai_category && (
                          <Badge variant="outline" className="text-[10px] px-1 py-0 h-4">
                            {email.ai_category}
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </ScrollArea>
    </div>
  )
}
