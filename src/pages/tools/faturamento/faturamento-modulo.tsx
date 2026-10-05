// Faturamento por Unidade — ferramenta do Central Whats (aberta pelo ToolHost).
// Telas: Configuração, Unidade, Gerar relatório, Relatórios e Relatório. As telas
// vieram do app de testes (repositório PRN-faturamento-unidades); os dados ficam
// no schema `faturamento_unidades` e o cálculo na Edge Function fat-simular.
// A troca de tela é estado interno (ver navegacao.tsx), não URL.
//
// As telas foram desenhadas em tema claro (cores fixas, sem `dark:`). Por isso o
// conteúdo fica num painel claro próprio — no tema escuro do app o texto claro
// do app sumiria sobre os cartões brancos.
import { useMemo, useState } from 'react'
import { cn } from '@/lib/utils'
import { NavegacaoFat, type Tela } from './navegacao'
import Configuracao from './pages/Configuracao'
import Unidade from './pages/Unidade'
import Simular from './pages/Simular'
import Simulacoes from './pages/Simulacoes'
import Simulacao from './pages/Simulacao'

const ABAS: { tela: Tela; label: string; ativaEm: Tela['nome'][] }[] = [
  { tela: { nome: 'config' }, label: 'Configuração', ativaEm: ['config', 'unidade'] },
  { tela: { nome: 'gerar' }, label: 'Gerar relatório', ativaEm: ['gerar'] },
  { tela: { nome: 'relatorios' }, label: 'Relatórios', ativaEm: ['relatorios', 'relatorio'] },
]

function Conteudo({ tela }: { tela: Tela }) {
  switch (tela.nome) {
    case 'unidade': return <Unidade key={tela.id} />
    case 'gerar': return <Simular />
    case 'relatorios': return <Simulacoes />
    case 'relatorio': return <Simulacao key={tela.id} />
    default: return <Configuracao />
  }
}

export default function FaturamentoModulo() {
  const [tela, setTela] = useState<Tela>({ nome: 'config' })
  const nav = useMemo(() => ({ tela, ir: setTela }), [tela])
  return (
    <NavegacaoFat.Provider value={nav}>
      <div className="space-y-4 rounded-xl bg-slate-50 p-4 text-slate-900 shadow-sm [color-scheme:light] md:p-6">
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 pb-3">
          <h1 className="mr-4 text-xl font-semibold">Faturamento por Unidade</h1>
          {ABAS.map(a => (
            <button key={a.label} type="button" onClick={() => setTela(a.tela)}
              className={cn('rounded-md px-3 py-1.5 text-sm', a.ativaEm.includes(tela.nome) ? 'bg-[#1f4e78] text-white' : 'text-slate-700 hover:bg-slate-200')}>
              {a.label}
            </button>
          ))}
        </div>
        <Conteudo tela={tela} />
      </div>
    </NavegacaoFat.Provider>
  )
}
