import { useEffect, useState } from 'react'
import { db } from '../lib/supabase'
import type { RegrasUnidade } from '../lib/tipos'
import { comoFatura, statusAceitos } from '../lib/config'

const PADRAO = ['Assinado', 'Reassinado']
type RegrasComo = Parameters<typeof comoFatura>[1]

/** Lê config.status_por_exame (CSV) uma vez; se falhar, usa o padrão. */
export function useStatusPorExame(): string[] {
  const [lista, setLista] = useState<string[]>(PADRAO)
  useEffect(() => {
    let vivo = true
    ;(async () => {
      try {
        const { data, error } = await db.from('config').select('chave, valor').eq('chave', 'status_por_exame').maybeSingle()
        if (error || !data?.valor) return
        const l = String(data.valor).split(',').map(s => s.trim()).filter(Boolean)
        if (vivo && l.length) setLista(l)
      } catch { /* fica no padrão */ }
    })()
    return () => { vivo = false }
  }, [])
  return lista
}

/** Linhas "Como fatura" já com a lista de status vinda da config. */
export function linhasComoFatura(modelo: string, regras: RegrasComo | (RegrasUnidade & RegrasComo) | undefined, statusPorExame: string[]) {
  return comoFatura(modelo, regras).map(l => l.rotulo === 'Status aceitos'
    ? { ...l, texto: statusAceitos({ modelo_cobranca: modelo, todos_status: regras?.todos_status, criterio_data: regras?.criterio_data }, statusPorExame).texto }
    : l)
}

export function ComoFaturaLista({ modelo, regras, statusPorExame }: { modelo: string; regras: RegrasComo | undefined; statusPorExame: string[] }) {
  return (
    <dl className="space-y-0.5">
      {linhasComoFatura(modelo, regras, statusPorExame).map(l => (
        <div key={l.rotulo} className="flex gap-2"><dt className="w-40 shrink-0 text-slate-600">{l.rotulo}</dt><dd>{l.texto}</dd></div>
      ))}
    </dl>
  )
}
