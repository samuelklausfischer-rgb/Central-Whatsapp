import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Filter, X } from 'lucide-react'
import type { Label as EtiquetaLabel } from '@/lib/supabase/types'

interface ConversationFiltersProps {
  periodFilter: string
  statusFilter: string
  showUnresponded: boolean
  showArchived: boolean
  labels: EtiquetaLabel[]
  labelFilter: string
  onPeriodFilterChange: (v: string) => void
  onStatusFilterChange: (v: string) => void
  onUnrespondedChange: (v: boolean) => void
  onArchivedChange: (v: boolean) => void
  onLabelFilterChange: (v: string) => void
  onClearAll: () => void
  isMobile: boolean
  filterCount: number
}

export default function ConversationFilters({
  periodFilter,
  statusFilter,
  showUnresponded,
  showArchived,
  labels,
  labelFilter,
  onPeriodFilterChange,
  onStatusFilterChange,
  onUnrespondedChange,
  onArchivedChange,
  onLabelFilterChange,
  onClearAll,
  isMobile,
  filterCount,
}: ConversationFiltersProps) {
  const content = (
    <div className="space-y-5">
      <div>
        <h4 className="text-sm font-medium mb-2.5">Período</h4>
        <ToggleGroup type="single" value={periodFilter} onValueChange={(v) => v && onPeriodFilterChange(v)} className="flex-wrap justify-start gap-1.5">
          <ToggleGroupItem value="all" size="sm" variant="outline" className="text-xs h-7 px-2.5">Todos</ToggleGroupItem>
          <ToggleGroupItem value="today" size="sm" variant="outline" className="text-xs h-7 px-2.5">Hoje</ToggleGroupItem>
          <ToggleGroupItem value="yesterday" size="sm" variant="outline" className="text-xs h-7 px-2.5">Ontem</ToggleGroupItem>
          <ToggleGroupItem value="last3" size="sm" variant="outline" className="text-xs h-7 px-2.5">Últimos 3 dias</ToggleGroupItem>
          <ToggleGroupItem value="last7" size="sm" variant="outline" className="text-xs h-7 px-2.5">Últimos 7 dias</ToggleGroupItem>
        </ToggleGroup>
      </div>
      <div>
        <h4 className="text-sm font-medium mb-2.5">Status</h4>
        <ToggleGroup type="single" value={statusFilter} onValueChange={(v) => v && onStatusFilterChange(v)} className="flex-wrap justify-start gap-1.5">
          <ToggleGroupItem value="all" size="sm" variant="outline" className="text-xs h-7 px-2.5">Todos</ToggleGroupItem>
          <ToggleGroupItem value="unread" size="sm" variant="outline" className="text-xs h-7 px-2.5">Não lidos</ToggleGroupItem>
          <ToggleGroupItem value="pinned" size="sm" variant="outline" className="text-xs h-7 px-2.5">Fixados</ToggleGroupItem>
        </ToggleGroup>
      </div>
      <div>
        <h4 className="text-sm font-medium mb-2.5">Etiqueta</h4>
        <ToggleGroup type="single" value={labelFilter} onValueChange={(v) => v && onLabelFilterChange(v)} className="flex-wrap justify-start gap-1.5">
          <ToggleGroupItem value="all" size="sm" variant="outline" className="text-xs h-7 px-2.5">Todas</ToggleGroupItem>
          {labels.map((label) => (
            <ToggleGroupItem key={label.id} value={label.id} size="sm" variant="outline" className="text-xs h-7 px-2.5 gap-1.5">
              <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: label.color }} />
              {label.name}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        {labels.length === 0 && (
          <p className="text-xs text-muted-foreground">Nenhuma etiqueta cadastrada ainda.</p>
        )}
      </div>
      <div className="border-t border-border pt-4 space-y-2.5">
        <label className="flex items-center gap-2.5 text-sm cursor-pointer">
          <input
            type="checkbox"
            checked={showUnresponded}
            onChange={(e) => onUnrespondedChange(e.target.checked)}
            className="rounded border-muted-foreground/30 accent-primary"
          />
          <span>Não respondidas</span>
        </label>
        <label className="flex items-center gap-2.5 text-sm cursor-pointer">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(e) => onArchivedChange(e.target.checked)}
            className="rounded border-muted-foreground/30 accent-primary"
          />
          <span>Arquivadas</span>
        </label>
      </div>
      {filterCount > 0 && (
        <div className="border-t border-border pt-4">
          <Button variant="outline" size="sm" onClick={onClearAll} className="text-xs w-full gap-1.5">
            <X className="h-3.5 w-3.5" />
            Remover todos os filtros
          </Button>
        </div>
      )}
    </div>
  )

  if (isMobile) {
    return (
      <Sheet>
        <SheetTrigger asChild>
          <Button variant="outline" size="sm" className="text-xs gap-1.5">
            <Filter className="h-3.5 w-3.5" />
            Filtros
            {filterCount > 0 && (
              <span className="h-4 min-w-4 rounded-full bg-primary text-primary-foreground text-[10px] font-bold flex items-center justify-center px-1">
                {filterCount}
              </span>
            )}
          </Button>
        </SheetTrigger>
        <SheetContent side="bottom" className="rounded-t-xl">
          <SheetHeader>
            <SheetTitle className="text-left">Filtros</SheetTitle>
          </SheetHeader>
          <div className="mt-4 max-h-[65vh] overflow-y-auto pb-4">
            {content}
          </div>
        </SheetContent>
      </Sheet>
    )
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="text-xs gap-1.5">
          <Filter className="h-3.5 w-3.5" />
          Filtros
          {filterCount > 0 && (
            <span className="h-4 min-w-4 rounded-full bg-primary text-primary-foreground text-[10px] font-bold flex items-center justify-center px-1">
              {filterCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72" align="start" sideOffset={8}>
        {content}
      </PopoverContent>
    </Popover>
  )
}
