import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useAuth } from '@/hooks/use-auth'
import { getMyTools, hasRelatoriosProfile } from '@/services/tool_access'
import {
  CATALOGO_DE_FERRAMENTAS,
  podeUsarFerramenta,
  type PerfilDeAcesso,
} from '@/lib/ferramentas/catalogo'

interface ToolAccessValue {
  /**
   * Quem pode usar cada ferramenta, POR SLUG — as mesmas chaves de
   * `FERRAMENTAS_HOSPEDADAS` e das rotas.
   *
   * Passou a ser um registro em 09/09/2026. Antes eram booleanos nomeados, um
   * por ferramenta, e cada ferramenta nova exigia acrescentar um campo aqui,
   * outro no `AcessoFerramentasExternas` e outro na união do guard de rota —
   * três lugares para a mesma informação, que foi como `prn-hub` e
   * `controle-mensagens` acabaram funcionando sem ninguém conseguir liberá-los
   * pela tela.
   */
  podeUsar: Record<string, boolean>
  /** Sistema de Relatórios — não sai de `tool_access` e sim de `relatorios.profiles`. */
  relatorios: boolean
  loading: boolean
}

const ToolAccessContext = createContext<ToolAccessValue>({
  podeUsar: {},
  relatorios: false,
  loading: true,
})

/**
 * Uma consulta só para a lateral e para os guards de rota. Sem isso, cada
 * consumidor faria a própria ida ao banco e a lateral piscaria os itens.
 *
 * É porteiro de UI, não de segurança: quem manda mesmo é a RLS de cada projeto,
 * a checagem que a `licitacao-bridge` refaz no servidor e — na Gestão Médica —
 * a função `gestao_medica._pode_usar()`, que espelha esta mesma regra.
 */
export function ToolAccessProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const userId = user?.id
  const [relatorios, setRelatorios] = useState(false)
  const [excecoes, setExcecoes] = useState<Map<string, boolean>>(new Map())
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!userId) {
      setRelatorios(false)
      setExcecoes(new Map())
      setLoading(false)
      return
    }

    let mounted = true
    setLoading(true)

    // allSettled: uma das duas falhar (schema fora do ar, RLS) não pode esconder
    // a outra ferramenta — cada uma responde por si.
    // `getMyTools` traz TODAS as chaves de uma vez: cada ferramenta nova sai
    // desta mesma resposta, sem outra ida ao banco.
    Promise.allSettled([hasRelatoriosProfile(userId), getMyTools(userId)]).then(([perfil, tools]) => {
      if (!mounted) return
      const linhas = tools.status === 'fulfilled' ? tools.value : []

      // ⚠️ FALHA DE LEITURA VIRA "SEM EXCEÇÃO", NÃO "SEM ACESSO". Com o mapa
      // vazio, as ferramentas de setor caem no padrão — quem é do Financeiro
      // continua vendo Cruzar Contas mesmo se esta consulta falhar. Um bloqueio
      // não aplicado por falha de rede é bem menos danoso que o app inteiro
      // fechar as portas porque o banco piscou.
      setExcecoes(new Map(linhas.map((l) => [l.tool, l.permitido])))

      // O cadastro no Sistema de Relatórios deixou de ser o PORTEIRO e virou o
      // PADRÃO do Gestor de Tarefas (09/09): ele decide quando não há exceção
      // gravada. Liberar sem o cadastro existir do outro lado continua abrindo
      // uma tela que o outro sistema recusa — e a Gestão de Equipe avisa isso.
      setRelatorios(perfil.status === 'fulfilled' && perfil.value)
      setLoading(false)
    })

    return () => {
      mounted = false
    }
    // `is_super_admin` e `department` entram junto com o id: se o perfil chegasse
    // depois (ou mudasse de setor), o efeito não rodaria de novo e a pessoa
    // ficaria presa no estado antigo, sem nada indicando por quê.
  }, [userId, user?.is_super_admin, user?.department, user?.is_admin])

  const value = useMemo(() => {
    const perfil: PerfilDeAcesso | null = user
      ? {
          is_admin: user.is_admin,
          department: user.department,
          is_super_admin: user.is_super_admin,
        }
      : null

    const podeUsar = Object.fromEntries(
      CATALOGO_DE_FERRAMENTAS.map((f) => [
        f.slug,
        podeUsarFerramenta(f.slug, perfil, excecoes, relatorios),
      ]),
    )

    return { podeUsar, relatorios, loading }
  }, [user, excecoes, relatorios, loading])

  return <ToolAccessContext.Provider value={value}>{children}</ToolAccessContext.Provider>
}

export const useToolAccess = () => useContext(ToolAccessContext)
