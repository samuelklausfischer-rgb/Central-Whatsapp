import { useMemo, useState } from 'react'
import { Check, Loader2, Search, X } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { AvatarInterno } from '@/components/chat-interno/AvatarInterno'
import { normalizarParaBusca } from '@/lib/chat-interno'
import type { ColegaDoDiretorio } from '@/lib/supabase/chat-interno-types'
import { cn } from '@/lib/utils'

/**
 * Lista de colegas com busca, para escolher uma pessoa (nova conversa) ou várias
 * (grupo, adicionar ao grupo). Mesmo molde do seletor de membros da Agenda
 * (`DialogoDeGrupos`): busca no topo, linha clicável com marca.
 *
 * No modo `unico` clicar na linha já escolhe; no `multiplo` a linha alterna a
 * marca e quem chama confirma depois.
 */
export function SeletorDePessoas({
  pessoas,
  carregando,
  erro,
  onTentarDeNovo,
  modo,
  selecionados,
  onAlternar,
  onEscolher,
  ocupado,
  textoVazio = 'Nenhuma pessoa disponível.',
  alturaMaxima = 'max-h-[320px]',
}: {
  pessoas: ColegaDoDiretorio[]
  carregando: boolean
  erro: boolean
  onTentarDeNovo: () => void
  modo: 'unico' | 'multiplo'
  selecionados?: Set<string>
  onAlternar?: (id: string) => void
  onEscolher?: (id: string) => void
  /** Id que está sendo aberto agora (modo único): mostra um spinner nele e trava o resto. */
  ocupado?: string | null
  textoVazio?: string
  alturaMaxima?: string
}) {
  const [busca, setBusca] = useState('')

  const visiveis = useMemo(() => {
    const termo = normalizarParaBusca(busca.trim())
    if (!termo) return pessoas
    return pessoas.filter(
      (p) => normalizarParaBusca(p.nome).includes(termo) || normalizarParaBusca(p.setor ?? '').includes(termo),
    )
  }, [pessoas, busca])

  return (
    <div className="flex min-h-0 flex-col gap-2">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-chat-muted" />
        <Input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Procurar por nome ou setor..."
          aria-label="Procurar pessoa"
          className="h-10 border-chat-border bg-chat-sidebar pl-9 pr-9 text-chat-text placeholder:text-chat-muted"
        />
        {busca && (
          <button
            type="button"
            onClick={() => setBusca('')}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-chat-muted transition-colors hover:text-chat-text"
            aria-label="Limpar busca"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      <div className={cn('overflow-y-auto rounded-lg border border-chat-border bg-chat-sidebar custom-scrollbar', alturaMaxima)}>
        {carregando && pessoas.length === 0 ? (
          <div className="flex flex-col gap-0.5 p-1" aria-busy="true" aria-label="Carregando pessoas">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 px-2.5 py-2.5">
                <div className="h-9 w-9 shrink-0 animate-pulse rounded-full bg-chat-muted/10" />
                <div className="h-3 flex-1 animate-pulse rounded bg-chat-muted/10" style={{ maxWidth: `${50 + ((i * 13) % 30)}%` }} />
              </div>
            ))}
          </div>
        ) : erro && pessoas.length === 0 ? (
          <div className="flex flex-col items-center gap-3 px-6 py-8 text-center">
            <p className="text-sm text-chat-muted">Não foi possível carregar as pessoas.</p>
            <Button type="button" variant="outline" size="sm" onClick={onTentarDeNovo}>
              Tentar de novo
            </Button>
          </div>
        ) : visiveis.length === 0 ? (
          <p className="px-6 py-8 text-center text-sm text-chat-muted">
            {busca.trim() ? 'Ninguém encontrado com esse termo.' : textoVazio}
          </p>
        ) : (
          <ul className="flex flex-col gap-0.5 p-1">
            {visiveis.map((p) => {
              const marcado = selecionados?.has(p.id) ?? false
              const abrindo = ocupado === p.id
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    disabled={!!ocupado}
                    onClick={() => (modo === 'unico' ? onEscolher?.(p.id) : onAlternar?.(p.id))}
                    aria-pressed={modo === 'multiplo' ? marcado : undefined}
                    className={cn(
                      'flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left transition-colors hover:bg-chat-hover disabled:cursor-wait disabled:opacity-60',
                      marcado && 'bg-chat-active',
                    )}
                  >
                    <AvatarInterno nome={p.nome} url={p.avatar_url} className="h-9 w-9" fallbackClassName="text-xs" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-chat-text">{p.nome || 'Sem nome'}</span>
                      {p.setor && <span className="block truncate text-xs text-chat-muted">{p.setor}</span>}
                    </span>
                    {/* Marca só VISUAL: a linha inteira já é o botão (`aria-pressed`). Um
                        `<Checkbox>` aqui seria um botão dentro de botão — HTML inválido. */}
                    {modo === 'multiplo' && (
                      <span
                        aria-hidden
                        className={cn(
                          'flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border border-primary',
                          marcado && 'bg-primary text-primary-foreground',
                        )}
                      >
                        {marcado && <Check className="h-3.5 w-3.5" />}
                      </span>
                    )}
                    {abrindo && <Loader2 className="h-4 w-4 animate-spin text-chat-muted" />}
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
