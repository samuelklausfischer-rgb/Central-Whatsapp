import { Search, X, ChevronUp, ChevronDown } from 'lucide-react'
import { Input } from '@/components/ui/input'

interface MessageSearchBarProps {
  query: string
  onQueryChange: (value: string) => void
  currentIndex: number
  totalMatches: number
  onNext: () => void
  onPrev: () => void
  onClose: () => void
  inputRef: React.RefObject<HTMLInputElement>
}

export function MessageSearchBar({
  query,
  onQueryChange,
  currentIndex,
  totalMatches,
  onNext,
  onPrev,
  onClose,
  inputRef,
}: MessageSearchBarProps) {
  const hasQuery = query.trim().length > 0
  const noMatches = hasQuery && totalMatches === 0
  const counterText = !hasQuery ? '' : noMatches ? '0 de 0' : `${currentIndex + 1} de ${totalMatches}`

  return (
    <div className="flex items-center gap-2 px-3 h-12">
      <div className="relative flex-1 min-w-0">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-chat-muted" />
        <Input
          ref={inputRef}
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Buscar na conversa..."
          className="pl-9 pr-9 bg-chat-panel border-chat-border text-chat-text placeholder:text-chat-muted h-9"
        />
        {query && (
          <button
            onClick={() => onQueryChange('')}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-chat-muted hover:text-chat-text transition-colors"
            title="Limpar busca"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      <span
        className={`text-xs font-medium tabular-nums whitespace-nowrap shrink-0 ${
          noMatches ? 'text-red-400' : 'text-chat-muted'
        }`}
      >
        {counterText}
      </span>

      <div className="flex items-center gap-0.5 shrink-0">
        <button
          onClick={onPrev}
          disabled={totalMatches === 0}
          title="Anterior (Shift+Enter)"
          className="p-1.5 rounded-full text-chat-muted hover:text-chat-text hover:bg-chat-hover transition-colors disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent"
        >
          <ChevronUp className="h-4 w-4" />
        </button>
        <button
          onClick={onNext}
          disabled={totalMatches === 0}
          title="Próxima (Enter)"
          className="p-1.5 rounded-full text-chat-muted hover:text-chat-text hover:bg-chat-hover transition-colors disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent"
        >
          <ChevronDown className="h-4 w-4" />
        </button>
      </div>

      <button
        onClick={onClose}
        title="Fechar (Esc)"
        className="p-1.5 rounded-full text-chat-muted hover:text-chat-text hover:bg-chat-hover transition-colors shrink-0"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  )
}
