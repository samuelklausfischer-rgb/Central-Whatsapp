// Navegação interna do Faturamento.
//
// POR QUE NÃO USA ROTAS DE URL
// A ferramenta vive no ToolHost: continua montada (escondida) quando a pessoa vai
// ao WhatsApp. Sub-rotas de URL (`/ferramentas/faturamento/gerar`) seriam lidas de
// novo a cada troca de tela do app — e voltar pela barra lateral (que aponta para
// a raiz da ferramenta) jogaria fora o relatório aberto. Aqui a tela atual é estado
// da própria ferramenta, então sobrevive à ida e volta.
//
// `Link` e `useParams` imitam os do react-router com os mesmos caminhos que as
// telas já usavam ('/faturamento/relatorio/<id>' etc.), para elas mudarem só o import.
import { createContext, useContext, type ReactNode } from 'react'

export type Tela =
  | { nome: 'config' }
  | { nome: 'unidade'; id: string }
  | { nome: 'gerar' }
  | { nome: 'relatorios' }
  | { nome: 'relatorio'; id: string }

export function telaDoCaminho(caminho: string): Tela {
  const partes = caminho.replace(/^\/faturamento\/?/, '').split('/').filter(Boolean)
  if (partes[0] === 'unidade' && partes[1]) return { nome: 'unidade', id: partes[1] }
  if (partes[0] === 'relatorio' && partes[1]) return { nome: 'relatorio', id: partes[1] }
  if (partes[0] === 'gerar') return { nome: 'gerar' }
  if (partes[0] === 'relatorios') return { nome: 'relatorios' }
  return { nome: 'config' }
}

interface Navegacao { tela: Tela; ir: (t: Tela) => void }
export const NavegacaoFat = createContext<Navegacao | null>(null)

function useNavegacao(): Navegacao {
  const n = useContext(NavegacaoFat)
  if (!n) throw new Error('Faturamento: tela fora do NavegacaoFat')
  return n
}

export function useParams<T extends Record<string, string | undefined> = { id?: string }>(): T {
  const { tela } = useNavegacao()
  return ('id' in tela ? { id: tela.id } : {}) as T
}

export function Link({ to, className, children }: { to: string; className?: string; children: ReactNode }) {
  const { ir } = useNavegacao()
  return (
    <a
      href="#"
      className={className}
      onClick={(e) => { e.preventDefault(); ir(telaDoCaminho(to)) }}
    >
      {children}
    </a>
  )
}
