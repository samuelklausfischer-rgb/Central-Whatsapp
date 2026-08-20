import { useEffect, useState, useCallback } from 'react'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { CalendarClock, CheckCircle2, Circle, Loader2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { EstadoPainel } from '@/components/ui/estado-painel'
import {
  listarMeusHubReports,
  type HubMeuReport,
  type HubReportStatus,
} from '@/services/hub_reports'

/**
 * Rótulo + cor de cada status, em português e humano — o mesmo valor cru do
 * enum (`em_analise`, `nao_aplicado`...) não é o que a pessoa que reportou
 * deve ler. `nao_aplicado` vira "Não será feito" de propósito: é mais direto
 * e menos burocrático do que o nome da coluna no banco.
 */
const STATUS_INFO: Record<HubReportStatus, { label: string; className: string }> = {
  novo: { label: 'Recebido', className: 'border-transparent bg-muted text-muted-foreground' },
  em_analise: { label: 'Em análise', className: 'border-transparent bg-sky-500/15 text-sky-600 dark:text-sky-400' },
  em_andamento: { label: 'Em andamento', className: 'border-transparent bg-amber-500/15 text-amber-600 dark:text-amber-400' },
  resolvido: { label: 'Resolvido', className: 'border-transparent bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' },
  melhoramento: { label: 'Em aprimoramento', className: 'border-transparent bg-violet-500/15 text-violet-600 dark:text-violet-400' },
  nao_aplicado: { label: 'Não será feito', className: 'border-transparent bg-muted text-muted-foreground' },
  arquivado: { label: 'Arquivado', className: 'border-transparent bg-muted text-muted-foreground' },
}

function formatarData(iso: string) {
  try {
    return format(new Date(iso), "dd/MM/yyyy", { locale: ptBR })
  } catch {
    return iso
  }
}

const CHECKLIST_ICON: Record<HubMeuReport['checklist'][number]['status'], React.ElementType> = {
  feito: CheckCircle2,
  fazendo: Loader2,
  pendente: Circle,
}

function ChecklistItem({ item }: { item: HubMeuReport['checklist'][number] }) {
  const Icon = CHECKLIST_ICON[item.status]
  return (
    <li className="flex items-start gap-1.5 text-xs">
      <Icon
        className={`h-3.5 w-3.5 mt-0.5 shrink-0 ${
          item.status === 'feito'
            ? 'text-emerald-500'
            : item.status === 'fazendo'
              ? 'text-amber-500 animate-spin'
              : 'text-muted-foreground'
        }`}
      />
      <span className={item.status === 'feito' ? 'text-muted-foreground line-through' : 'text-foreground'}>
        {item.texto}
      </span>
    </li>
  )
}

function ReportCard({ report }: { report: HubMeuReport }) {
  const status = STATUS_INFO[report.status] ?? { label: report.status, className: '' }
  return (
    <div className="rounded-lg border border-border p-3 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium leading-snug">{report.titulo}</p>
        <Badge className={status.className}>{status.label}</Badge>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        <span>{report.tipo === 'ideia' ? 'Ideia' : 'Problema'}</span>
        <span>Reportado em {formatarData(report.criado_em)}</span>
        {report.prazo && (
          <span className="flex items-center gap-1">
            <CalendarClock className="h-3 w-3" />
            Prazo {formatarData(report.prazo)}
          </span>
        )}
      </div>

      {report.checklist.length > 0 && (
        <ul className="space-y-1 pt-1 border-t border-border/60 mt-1">
          {report.checklist.map((item) => (
            <ChecklistItem key={item.id} item={item} />
          ))}
        </ul>
      )}
    </div>
  )
}

/**
 * "Meus reportes": a pessoa vê o que ela mesma já mandou pra fila do Hub, com
 * status/prazo/checklist — pra sentir que faz parte do desenvolvimento, não
 * que gritou num buraco. Sem Realtime nessas tabelas (confirmado no
 * levantamento): recarrega só quando a aba é aberta, sem polling.
 */
export function MeusHubReports({
  ativo,
  userId,
  userEmail,
}: {
  ativo: boolean
  userId?: string | null
  userEmail?: string | null
}) {
  const [reports, setReports] = useState<HubMeuReport[] | null>(null)
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState(false)

  const carregar = useCallback(async () => {
    setCarregando(true)
    setErro(false)
    try {
      const dados = await listarMeusHubReports({ userId, userEmail })
      setReports(dados)
    } catch {
      setErro(true)
    } finally {
      setCarregando(false)
    }
  }, [userId, userEmail])

  useEffect(() => {
    if (ativo) void carregar()
    // Recarrega toda vez que a aba fica ativa de novo (ex: reabrir o
    // diálogo) — não há Realtime nessas tabelas, então é a única forma de
    // ver um status novo sem dar F5 no app inteiro.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ativo])

  if (!ativo) return null

  const vazio = (reports?.length ?? 0) === 0

  return (
    <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
      <EstadoPainel
        carregando={carregando}
        erro={erro}
        vazio={!carregando && !erro && vazio}
        mensagemVazio="Você ainda não reportou nada. Quando reportar um problema ou sugerir uma ideia, o andamento aparece aqui."
        aoTentarDeNovo={carregar}
      />
      {!carregando && !erro && !vazio && (
        <div className="space-y-2">
          {reports!.map((report) => (
            <ReportCard key={report.id} report={report} />
          ))}
        </div>
      )}
    </div>
  )
}
