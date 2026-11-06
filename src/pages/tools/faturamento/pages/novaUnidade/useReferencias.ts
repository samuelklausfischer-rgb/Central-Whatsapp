import { useEffect, useState } from 'react'
import { db } from '../../lib/supabase'
import { paginar } from '../../lib/pool'
import type { NomeExistente, UnidadeExistente } from '../../lib/unidadeNova'

export interface UnidadeLista extends UnidadeExistente { id: string; orgao: string | null }
export interface Referencias {
  unidades: UnidadeLista[]
  nomes: NomeExistente[]
  ignorados: string[]
}

/** Unidades, nomes da Mobilemed e nomes ignorados que já existem (para validar unicidade ao vivo). */
export function useReferencias(versao = 0): { ref: Referencias | null; erro: string | null } {
  const [ref, setRef] = useState<Referencias | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  useEffect(() => {
    let vivo = true
    ;(async () => {
      try {
        const [us, as, ig] = await Promise.all([
          paginar<UnidadeLista>((de, ate) => db.from('unidade').select('id, empresa, pasta, orgao').order('pasta').order('id').range(de, ate)),
          paginar<{ nome_bruto: string; unidade_id: string }>((de, ate) => db.from('alias').select('nome_bruto, unidade_id').order('nome_bruto').range(de, ate)),
          paginar<{ nome_bruto: string }>((de, ate) => db.from('nome_ignorado').select('nome_bruto').order('nome_bruto').range(de, ate)),
        ])
        if (!vivo) return
        const pasta = new Map(us.map(u => [u.id, u.pasta]))
        setRef({ unidades: us, nomes: as.map(a => ({ nome_bruto: a.nome_bruto, pasta: pasta.get(a.unidade_id) ?? null })), ignorados: ig.map(i => i.nome_bruto) })
      } catch (e) { if (vivo) setErro(e instanceof Error ? e.message : String(e)) }
    })()
    return () => { vivo = false }
  }, [versao])
  return { ref, erro }
}
