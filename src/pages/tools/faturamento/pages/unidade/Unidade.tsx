import { useParams } from '../../navegacao'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import { useStatusPorExame } from '../../components/ComoFatura'
import { useMemo } from 'react'
import { nomeExibicao } from '../../lib/format'
import { Botao, Carregando, Vazio } from '../../components/ui'
import { contarValoresPorItem } from './EditorPrecos'
import { useUnidade } from './useUnidade'
import { HeroUnidade } from './HeroUnidade'
import { SecaoCabecalho } from './SecaoCabecalho'
import { SecaoComoFatura } from './SecaoComoFatura'
import { FormRegras } from './SecaoRegras'
import { SecaoNomes } from './SecaoNomes'
import { SecaoPrecos } from './SecaoPrecos'
import { SecaoAditivos } from './SecaoAditivos'
import { SecaoPendencias } from './SecaoPendencias'
import { SecaoObservacoes } from './SecaoObservacoes'
import { IndiceSecoes, SaudeCadastro } from './LeituraLateral'
import { ZonaPerigoUnidade } from '../../components/ZonaPerigoUnidade'
import ErrosDaUnidade from '../../components/ErrosDaUnidade'

export default function Unidade() {
  const { id } = useParams<{ id: string }>()
  const d = useUnidade(id)
  const statusPorExame = useStatusPorExame()
  const { u, regras } = d
  const valoresPorItem = useMemo(() => contarValoresPorItem(d.eventos), [d.eventos])

  if (d.erro) {
    return (
      <div className="min-h-full bg-slate-50 p-6">
        <Vazio icone={AlertTriangle} titulo="Não foi possível carregar esta unidade" texto={d.erro}
          acao={<Botao variante="primario" icone={RefreshCw} onClick={d.tentarDeNovo}>Tentar de novo</Botao>} />
      </div>
    )
  }
  if (!u || !regras) {
    return (
      <div className="min-h-full bg-slate-50 p-6">
        <div className="mx-auto max-w-6xl rounded-xl border border-slate-200 bg-white p-5 shadow-sm"><Carregando linhas={5} rotulo="Carregando a unidade…" /></div>
      </div>
    )
  }

  return (
    <div className="min-h-full bg-slate-50">
      <div className="mx-auto max-w-7xl space-y-6 p-4 sm:p-6">
        <HeroUnidade u={u} itens={d.itens} papeis={d.papeis} pend={d.pend} />

        <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
          <div className="min-w-0 space-y-6">
            <SecaoCabecalho u={u} onSalvarSituacao={d.salvarSituacao} onSalvarContrato={d.salvarContrato} onCarregarPastas={d.carregarPastasConfig} />
            <div id="regras" className="scroll-mt-20">
              <FormRegras u={u} regras={regras} itens={d.itens.map(i => ({ papel: d.papeis.get(i.item_preco_id) ?? "normal" }))} statusPorExame={statusPorExame}
                onSalvar={d.salvarRegras} />
            </div>
            <SecaoPrecos porHospital={d.nomes.some(n => !!n.subunidade)} itens={d.itens} completos={d.itensCompletos} valoresPorItem={valoresPorItem} pastaExibida={nomeExibicao(u.pasta)}
              dataRef={d.dataRef} onDataRef={d.setDataRef} onSalvarItens={d.salvarItens} onApagarItem={d.apagarItem} onRecarregar={d.recarregar} alvoId={d.alvoId} />
            <SecaoAditivos eventos={d.eventos} itens={d.itensCompletos} pastaExibida={nomeExibicao(u.pasta)} alvoId={d.alvoId}
              onCriar={d.criarAditivo} onSalvar={d.salvarTermo} onApagar={d.apagarTermo} onRecarregar={d.recarregar} />
            <div id="nomes" className="scroll-mt-20">
              <SecaoNomes nomes={d.nomes} empresa={u.empresa} temFixo={[...d.papeis.values()].includes('fixo')} unidadeId={u.id} alvoId={d.alvoId}
                onAdicionar={d.adicionarNome}
                onRemover={d.removerNome}
                onPrincipal={d.marcarPrincipal}
                onGrupo={d.mudarGrupo}
                onEditar={d.editarNome}
                onMover={d.moverNome}
                onListarUnidades={d.listarUnidades}
                onRecarregar={d.recarregar} />
            </div>
            <SecaoPendencias pend={d.pend} alvoId={d.alvoId} onResolver={d.resolverPendencia} onCriar={d.criarPendencia} onReabrir={d.reabrirPendencia}
              onEditarNota={d.editarNotaPendencia} onApagar={d.apagarPendencia} onRecarregar={d.recarregar} />
            <SecaoObservacoes observacoes={u.observacoes} />
            <ZonaPerigoUnidade unidade={u} onMudou={() => { void d.recarregar() }} />
          </div>

          <aside className="order-first space-y-6 lg:order-last lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:self-start lg:overflow-y-auto" aria-label="Resumo da unidade">
            <SecaoComoFatura u={u} regras={regras} statusPorExame={statusPorExame} />
            <IndiceSecoes />
            <ErrosDaUnidade unidadeId={u.id} versao={d.versao} />
            <SaudeCadastro u={u} pend={d.pend} itens={d.itens} papeis={d.papeis} />
          </aside>
        </div>
      </div>
    </div>
  )
}
