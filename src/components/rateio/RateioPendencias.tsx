import { AlertTriangle } from 'lucide-react'
import { fmt, fmtNum } from '@/lib/rateio/format'
import {
  ordenarPendencias,
  pendenciaCritica,
  pendenciaPortalDivergente,
  tituloPendencia,
} from '@/lib/rateio/pendencias'
import type { RateioPendencia, RateioResumo } from '@/services/rateio/rateio-service'

interface RateioPendenciasProps {
  pendencias: RateioPendencia[]
  resumo?: RateioResumo | null
}

// Explica em uma frase por que o portal por unidade saiu diferente do contratado. Usa os
// números do resumo quando o motor os devolve; senão, a descrição da própria pendência.
function explicacaoPortal(pendencia: RateioPendencia, r?: RateioResumo | null): string {
  const cobrados = r?.portal_qtde_planilha
  const divididos = r?.portal_qtde_cadastro
  const total = r?.portal_total_planilha
  if (cobrados && divididos && total) {
    const contrato = r?.portal_valor_unitario ? ` de ${fmt(r.portal_valor_unitario)}` : ''
    const origem =
      r?.portal_fonte === 'CADASTRO'
        ? ' A lista de quem tem portal veio do cadastro porque a aba PORTAL da planilha não foi encontrada: cole nela a lista exportada da Mobilemed e gere o rateio de novo.'
        : ' Confira a aba PORTAL da planilha e gere o rateio de novo.'
    return (
      `A Mobilemed cobra ${fmtNum(cobrados)} portais${contrato} (${fmt(total)}), mas o rateio dividiu ` +
      `entre ${fmtNum(divididos)} unidades — ${fmt(total / divididos)} por unidade.${origem}`
    )
  }
  return (
    pendencia.descricao || 'O portal por unidade não bate com a fatura da Mobilemed. Confira a aba PORTAL da planilha.'
  )
}

// Pendências devolvidas pelo motor do rateio. A divergência de portal ganha um alerta
// próprio no topo porque muda o valor cobrado de cada unidade; as demais aparecem com
// título, unidade/referência e a explicação do motor.
export function RateioPendencias({ pendencias, resumo }: RateioPendenciasProps) {
  if (!pendencias.length) return null

  const ordenadas = ordenarPendencias(pendencias)
  const nCriticas = pendencias.filter(pendenciaCritica).length
  const portalDivergente = pendenciaPortalDivergente(pendencias)

  return (
    <div className="space-y-3">
      {portalDivergente && (
        <div role="alert" className="rounded-xl border border-destructive/40 bg-destructive/10 p-5">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-destructive">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            Portal dividido errado — não use este rateio antes de corrigir
          </h3>
          <p className="mt-1.5 text-sm text-destructive/90">{explicacaoPortal(portalDivergente, resumo)}</p>
        </div>
      )}

      <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-5">
        <h3 className="mb-2 text-sm font-semibold text-amber-600">
          ⚠ {pendencias.length} pendência{pendencias.length > 1 ? 's' : ''}
          {nCriticas > 0 ? ` (${nCriticas} afeta${nCriticas > 1 ? 'm' : ''} o valor)` : ''} — revise o cadastro
        </h3>
        <ul className="max-h-72 space-y-2 overflow-y-auto text-xs">
          {ordenadas.map((p, i) => {
            const critica = pendenciaCritica(p)
            return (
              <li key={i} className={critica ? 'text-destructive' : 'text-amber-600/90'}>
                <p>
                  • <span className="font-medium">{tituloPendencia(p.tipo)}</span>
                  {p.referencia ? `: ${p.referencia}` : ''}
                </p>
                {p.descricao && <p className="ml-3 mt-0.5 opacity-80">{p.descricao}</p>}
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}
