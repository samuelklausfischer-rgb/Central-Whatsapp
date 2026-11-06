// Filtros e agrupamento da página Diagnóstico (lógica pura).
import { CATALOGO, ROTULO_SEVERIDADE, SEVERIDADES, type Problema, type Severidade, type UnidadeCad } from '../../lib/diagnostico'
import { nomeExibicao, semAcentoMin } from './texto'

export interface FiltrosDiag { severidade: Severidade | ''; regra: string; empresa: string; busca: string }
export const FILTROS_VAZIOS: FiltrosDiag = { severidade: '', regra: '', empresa: '', busca: '' }
export type Agrupamento = 'unidade' | 'tipo'

export function nomeDaUnidade(u: UnidadeCad | undefined): string { return u ? nomeExibicao(u.pasta) : '' }

export function filtrar(ps: Problema[], unidades: Map<string, UnidadeCad>, f: FiltrosDiag): Problema[] {
  const q = semAcentoMin(f.busca.trim())
  return ps.filter(p => {
    if (f.severidade && p.severidade !== f.severidade) return false
    if (f.regra && p.id !== f.regra) return false
    const u = p.unidadeId ? unidades.get(p.unidadeId) : undefined
    if (f.empresa && u?.empresa !== f.empresa) return false
    if (q) {
      const alvo = semAcentoMin(`${u?.pasta ?? ''} ${p.titulo} ${p.detalhe} ${p.id}`)
      if (!alvo.includes(q)) return false
    }
    return true
  })
}

export interface GrupoProblemas { chave: string; titulo: string; subtitulo?: string; problemas: Problema[] }

export function agruparProblemas(ps: Problema[], unidades: Map<string, UnidadeCad>, por: Agrupamento): GrupoProblemas[] {
  const m = new Map<string, GrupoProblemas>()
  for (const p of ps) {
    let chave: string, titulo: string, subtitulo: string | undefined
    if (por === 'tipo') {
      chave = p.id; titulo = `${p.id} · ${CATALOGO[p.id]?.titulo ?? p.titulo}`; subtitulo = ROTULO_SEVERIDADE[CATALOGO[p.id]?.severidade ?? p.severidade]
    } else {
      const u = p.unidadeId ? unidades.get(p.unidadeId) : undefined
      chave = u ? u.id : 'sem-unidade'
      titulo = u ? nomeExibicao(u.pasta) : 'Sem unidade (cadastro geral)'
      subtitulo = u?.empresa === 'MEDIMAGEM' ? 'Medimagem' : u ? 'PRN' : undefined
    }
    const g = m.get(chave)
    if (g) g.problemas.push(p); else m.set(chave, { chave, titulo, subtitulo, problemas: [p] })
  }
  const pior = (g: GrupoProblemas) => Math.min(...g.problemas.map(p => SEVERIDADES.indexOf(p.severidade)))
  return [...m.values()].sort((a, b) =>
    por === 'tipo' ? a.chave.localeCompare(b.chave) : (a.chave === 'sem-unidade' ? 1 : b.chave === 'sem-unidade' ? -1 : 0) || pior(a) - pior(b) || a.titulo.localeCompare(b.titulo, 'pt-BR'))
}
