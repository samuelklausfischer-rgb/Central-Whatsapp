import { useEffect, useState } from 'react'
import { Link } from '../navegacao'
import { db } from '../lib/supabase'
import { brl } from '../lib/format'
import { Pill } from '../components/Pill'
import type { Simulacao } from '../lib/tipos'

export const STATUS_SIM: Record<string, { rotulo: string; cor: string }> = {
  processando: { rotulo: 'Processando', cor: 'bg-sky-100 text-sky-800' },
  concluida: { rotulo: 'Concluída', cor: 'bg-emerald-100 text-emerald-800' },
  erro: { rotulo: 'Com erros', cor: 'bg-rose-100 text-rose-800' },
}

export function competenciaBR(c: string): string { return `${c.slice(5, 7)}/${c.slice(0, 4)}` }

export default function Simulacoes() {
  const [lista, setLista] = useState<Simulacao[] | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    db.from('simulacao').select('*').order('criada_em', { ascending: false }).then(({ data, error }) => {
      if (error) setErro(error.message); else setLista((data ?? []) as Simulacao[])
    })
  }, [])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Relatórios das unidades</h1>
        <Link to="/faturamento/gerar" className="rounded bg-[#1f4e78] px-3 py-1.5 text-sm text-white">Gerar novo relatório</Link>
      </div>
      {erro && <p className="text-rose-700">Erro: {erro}</p>}
      {lista === null && !erro && <p className="text-sm text-slate-500">Carregando…</p>}
      {lista && lista.length === 0 && <p className="text-sm text-slate-500">Nenhum relatório ainda. Clique em “Gerar novo relatório”.</p>}
      {lista && lista.length > 0 && (
        <table className="w-full rounded-lg border bg-white text-sm">
          <thead className="bg-slate-100 text-left text-xs text-slate-500">
            <tr><th className="p-2">Criada em</th><th>Competência</th><th>Arquivo</th><th>Status</th><th className="text-right">Nomes</th><th className="text-right">Exames</th><th className="text-right">Total</th><th></th></tr>
          </thead>
          <tbody>
            {lista.map(s => (
              <tr key={s.id} className="border-t">
                <td className="p-2">{new Date(s.criada_em).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</td>
                <td>{competenciaBR(s.competencia)}</td>
                <td className="max-w-[220px] truncate" title={s.arquivo_nome ?? ''}>{s.arquivo_nome ?? '—'}</td>
                <td><Pill texto={STATUS_SIM[s.status]?.rotulo ?? s.status} cor={STATUS_SIM[s.status]?.cor ?? ''} /></td>
                <td className="text-right">{s.nomes_feitos}/{s.total_nomes ?? '—'}</td>
                <td className="text-right">{s.total_exames?.toLocaleString('pt-BR') ?? '—'}</td>
                <td className="text-right">{brl(s.total_valor)}</td>
                <td className="pr-2 text-right"><Link to={`/faturamento/relatorio/${s.id}`} className="text-[#1f4e78] underline">abrir</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
