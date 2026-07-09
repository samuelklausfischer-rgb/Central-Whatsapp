import { useState } from 'react'
import { Loader2, Download, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { fmt, fmtNum, baixarBase64 } from '@/lib/rateio/format'
import { fetchRateioArquivo, type RateioHistoricoItem } from '@/services/rateio/rateio-service'
import { useToast } from '@/hooks/use-toast'

function formatDataHora(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

interface RateioHistoricoPanelProps {
  historico: RateioHistoricoItem[] | null
  loading: boolean
  error: string | null
  onDelete: (id: string) => Promise<void>
}

// Painel lateral com o histórico de execuções do rateio (mais recente primeiro).
// Cada item permite baixar novamente o Excel gerado naquela execução ou excluí-la.
export function RateioHistoricoPanel({ historico, loading, error, onDelete }: RateioHistoricoPanelProps) {
  const [baixandoId, setBaixandoId] = useState<string | null>(null)
  const [itemToDelete, setItemToDelete] = useState<RateioHistoricoItem | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const { toast } = useToast()

  async function handleBaixar(item: RateioHistoricoItem) {
    setBaixandoId(item.id)
    try {
      const arq = await fetchRateioArquivo(item.id)
      if (!arq?.resultado_xlsx_base64) throw new Error('Arquivo não disponível para esta execução')
      baixarBase64(
        arq.resultado_xlsx_nome || 'Ratiado.xlsx',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        arq.resultado_xlsx_base64,
      )
    } catch (err) {
      toast({
        title: 'Não foi possível baixar este arquivo',
        description: (err as Error).message,
        variant: 'destructive',
      })
    } finally {
      setBaixandoId(null)
    }
  }

  async function confirmDelete() {
    if (!itemToDelete) return
    setIsDeleting(true)
    try {
      await onDelete(itemToDelete.id)
    } finally {
      setIsDeleting(false)
      setItemToDelete(null)
    }
  }

  return (
    <>
    <aside className="flex w-80 shrink-0 flex-col border-l border-border bg-card">
      <div className="border-b border-border px-4 py-3.5">
        <h2 className="text-sm font-semibold text-foreground">Histórico de rateios</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">Execuções mais recentes primeiro</p>
      </div>

      <div className="flex-1 space-y-2 overflow-y-auto p-3">
        {loading && (
          <p className="px-1 py-6 text-center text-xs text-muted-foreground">Carregando histórico...</p>
        )}
        {error && <p className="px-1 py-6 text-center text-xs text-destructive">Erro ao carregar: {error}</p>}
        {!loading && !error && (!historico || historico.length === 0) && (
          <p className="px-1 py-6 text-center text-xs text-muted-foreground">
            Nenhum rateio gerado ainda para esta empresa.
          </p>
        )}

        {historico?.map((item) => (
          <div
            key={item.id}
            className="rounded-lg border border-border p-3 transition-colors hover:border-foreground/20"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-medium text-muted-foreground">{formatDataHora(item.criado_em)}</span>
              <div className="flex shrink-0 items-center gap-1">
                {item.n_pendencias > 0 && (
                  <Badge variant="outline" className="border-amber-500/40 text-[10px] text-amber-500">
                    {item.n_pendencias} pend.
                  </Badge>
                )}
                <button
                  type="button"
                  onClick={() => setItemToDelete(item)}
                  disabled={baixandoId === item.id}
                  aria-label="Excluir rateio do histórico"
                  className="rounded-md p-1 text-muted-foreground/60 transition-colors hover:bg-destructive/10 hover:text-destructive disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>

            <p className="mt-1 truncate text-xs text-muted-foreground" title={item.arquivo_nome}>
              {item.arquivo_nome || 'arquivo.xlsx'}
            </p>

            <p className="mt-1 text-lg font-bold text-foreground">{fmt(item.total_geral)}</p>

            <p className="mt-0.5 text-[11px] text-muted-foreground">
              {fmtNum(item.n_unidades)} unidades · {fmtNum(item.total_exames)} exames
            </p>

            <button
              onClick={() => handleBaixar(item)}
              disabled={baixandoId === item.id}
              className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-md border border-border py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-primary hover:text-primary disabled:cursor-wait disabled:opacity-50"
            >
              {baixandoId === item.id ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Download className="h-3 w-3" />
              )}
              {baixandoId === item.id ? 'Baixando…' : 'Baixar planilha'}
            </button>
          </div>
        ))}
      </div>
    </aside>

    <AlertDialog open={!!itemToDelete} onOpenChange={(open) => !open && setItemToDelete(null)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Excluir rateio do histórico</AlertDialogTitle>
          <AlertDialogDescription>
            Você realmente deseja excluir o rateio de {itemToDelete && formatDataHora(itemToDelete.criado_em)}
            {itemToDelete?.arquivo_nome ? ` (${itemToDelete.arquivo_nome})` : ''}? Esta ação não pode ser desfeita.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Não</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault()
              confirmDelete()
            }}
            disabled={isDeleting}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {isDeleting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Sim, excluir'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  )
}
