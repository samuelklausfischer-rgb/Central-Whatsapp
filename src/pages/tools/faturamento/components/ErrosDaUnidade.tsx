import { useEffect, useState } from 'react'
import { Link } from '../navegacao'
import { CheckCircle2, ShieldAlert } from 'lucide-react'
import { Cartao, Selo } from './ui'
import { cn } from './ui/cn'
import { carregarCadastro } from '../lib/cadastroCompleto'
import { contarPorSeveridade, diagnosticar, ROTULO_SEVERIDADE, type Problema } from '../lib/diagnostico'
import { alvoPara } from '../lib/irPara'
import { COR_SEV, FAIXA_SEV, ICONE_SEV, LINK_CORRIGIR } from '../pages/diagnostico/estilo'

const LIMITE = 5

/** Cartão lateral "Erros desta unidade": carrega só a unidade e recalcula quando `versao` muda. */
export default function ErrosDaUnidade({ unidadeId, versao }: { unidadeId: string; versao: number }) {
  const [problemas, setProblemas] = useState<Problema[] | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    let vivo = true
    carregarCadastro({ unidadeId })
      .then(c => { if (vivo) { setProblemas(diagnosticar(c)); setErro(null) } })
      .catch(e => { if (vivo) setErro(e instanceof Error ? e.message : String(e)) })
    return () => { vivo = false }
  }, [unidadeId, versao])

  const n = problemas ? contarPorSeveridade(problemas) : null
  const mostrados = problemas?.slice(0, LIMITE) ?? []
  return (
    <Cartao titulo="Erros desta unidade" icone={ShieldAlert} cor="amber" id="erros-da-unidade"
      descricao={n && problemas!.length ? `${n.bloqueia} bloqueiam · ${n.valor} podem errar valor · ${n.aviso} avisos` : undefined}>
      {erro && <p role="alert" className="text-sm text-rose-800">Não foi possível conferir: {erro}</p>}
      {!erro && !problemas && <p role="status" className="text-sm text-slate-600">Conferindo…</p>}
      {problemas && problemas.length === 0 && (
        <p className="flex items-center gap-2 text-sm font-medium text-emerald-800"><CheckCircle2 className="size-4 text-emerald-600" aria-hidden="true" />Nenhum erro encontrado</p>
      )}
      {problemas && problemas.length > 0 && (
        <>
          <ul className="space-y-2">
            {mostrados.map((p, i) => {
              const Icone = ICONE_SEV[p.severidade]
              const geral = !p.unidadeId || p.secao === 'regras-gerais'
              return (
                <li key={`${p.id}-${p.alvoId ?? ''}-${i}`} className={cn('rounded-lg border border-slate-200 border-l-4 p-2.5', FAIXA_SEV[p.severidade])}>
                  <div className="flex items-center gap-1.5">
                    <Selo cor={COR_SEV[p.severidade]} icone={Icone}>{ROTULO_SEVERIDADE[p.severidade]}</Selo>
                  </div>
                  <p className="mt-1 text-sm font-semibold text-slate-900">{p.titulo}</p>
                  <p className="mt-0.5 text-xs text-slate-700">{p.detalhe}</p>
                  <div className="mt-1.5">
                    {geral
                      ? <Link to="/faturamento/regras-gerais" className={LINK_CORRIGIR}>Corrigir</Link>
                      : <a href={`#${p.secao}`} className={LINK_CORRIGIR} onClick={e => { e.preventDefault(); alvoPara(unidadeId, p.secao as Parameters<typeof alvoPara>[1], p.alvoId); document.getElementById(p.secao)?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }}>Corrigir</a>}
                  </div>
                </li>
              )
            })}
          </ul>
          {problemas.length > LIMITE && (
            <p className="mt-2 text-xs text-slate-600">e mais {problemas.length - LIMITE} — <Link to="/faturamento/diagnostico" className="font-medium text-[#1f4e78] hover:underline">ver todos</Link></p>
          )}
        </>
      )}
    </Cartao>
  )
}
export { ErrosDaUnidade }
