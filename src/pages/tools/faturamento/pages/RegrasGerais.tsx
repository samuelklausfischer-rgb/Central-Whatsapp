import { useCallback, useEffect, useState } from 'react'
import { Link } from '../navegacao'
import { AlertTriangle, RefreshCw, XCircle } from 'lucide-react'
import { Botao, Carregando } from '../components/ui'
import { carregarCadastro } from '../lib/cadastroCompleto'
import type { Cadastro } from '../lib/diagnostico'
import { CHAVES_GLOBAIS, CHAVES_PASTAS } from './regrasGerais/regras'
import { CartaoRegraGlobal } from './regrasGerais/CartaoRegraGlobal'
import { CartaoPastas } from './regrasGerais/CartaoPastas'
import { CartaoIgnorados } from './regrasGerais/CartaoIgnorados'
import { CartaoNfOrfas } from './regrasGerais/CartaoNfOrfas'

export default function RegrasGerais() {
  const [c, setC] = useState<Cadastro | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [carregando, setCarregando] = useState(true)

  const carregar = useCallback(async () => {
    setCarregando(true); setErro(null)
    try { setC(await carregarCadastro()) } catch (e) { setErro(e instanceof Error ? e.message : String(e)) } finally { setCarregando(false) }
  }, [])
  useEffect(() => { void carregar() }, [carregar])

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm"><Link to="/faturamento" className="text-[#1f4e78] hover:underline">← Unidades</Link> · <Link to="/faturamento/diagnostico" className="text-[#1f4e78] hover:underline">Erros de configuração</Link></p>
          <h1 className="text-xl font-bold text-slate-900">Regras gerais</h1>
          <p className="text-sm text-slate-600">Valem para todas as unidades (ou para as que você escolher). Mexa com cuidado: a mudança aparece no próximo relatório gerado.</p>
        </div>
        <Botao icone={RefreshCw} disabled={carregando} onClick={() => void carregar()}>Atualizar</Botao>
      </header>

      {erro && (
        <div role="alert" className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">
          <XCircle className="mt-0.5 size-4 shrink-0 text-rose-600" aria-hidden="true" />
          <div className="flex-1"><p className="font-semibold">Não foi possível carregar as regras.</p><p>{erro}</p></div>
          <Botao tamanho="pequeno" onClick={() => void carregar()}>Tentar de novo</Botao>
        </div>
      )}
      {carregando && !c && <Carregando linhas={5} />}

      {c && (
        <>
          <section className="space-y-4" aria-label="Regras de todas as unidades">
            <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900"><AlertTriangle className="size-4 text-rose-600" aria-hidden="true" />Regras de todas as unidades</h2>
            {CHAVES_GLOBAIS.map(info => <CartaoRegraGlobal key={info.chave} info={info} config={c.config} totalUnidades={c.unidades.length} onSalvo={() => void carregar()} />)}
          </section>

          <section className="space-y-4" aria-label="Regras de relatório por unidade">
            <h2 className="text-base font-semibold text-slate-900">Regras de relatório por unidade</h2>
            {CHAVES_PASTAS.map(info => <CartaoPastas key={info.chave} info={info} config={c.config} unidades={c.unidades} onSalvo={() => void carregar()} />)}
          </section>

          <CartaoIgnorados ignorados={c.ignorados} aliases={c.aliases} unidades={c.unidades} onMudou={() => void carregar()} />
          <CartaoNfOrfas instrucoes={c.instrucoes} />
        </>
      )}
    </div>
  )
}
