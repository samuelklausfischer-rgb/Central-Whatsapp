import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useAuth } from '@/hooks/use-auth'
import { getMyTools, hasRelatoriosProfile } from '@/services/tool_access'

interface ToolAccessValue {
  /** Sistema de Relatórios — liberado para quem tem perfil em relatorios.profiles. */
  relatorios: boolean
  /** PRN Licitações — liberado pela chave em public.tool_access. */
  licitacoes: boolean
  /** Proposta Comercial — liberada pela chave em public.tool_access. */
  propostaComercial: boolean
  /** PRN Hub (ITEM 2) — liberado pela chave em public.tool_access. */
  prnHub: boolean
  loading: boolean
}

const ToolAccessContext = createContext<ToolAccessValue>({
  relatorios: false,
  licitacoes: false,
  propostaComercial: false,
  prnHub: false,
  loading: true,
})

/**
 * Uma consulta só para a lateral e para os guards de rota. Sem isso, cada
 * consumidor faria a própria ida ao banco e a lateral piscaria os itens.
 *
 * É porteiro de UI, não de segurança: quem manda mesmo é a RLS de cada projeto
 * e a checagem que a `licitacao-bridge` refaz no servidor.
 */
export function ToolAccessProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const userId = user?.id
  const [relatorios, setRelatorios] = useState(false)
  const [licitacoes, setLicitacoes] = useState(false)
  const [propostaComercial, setPropostaComercial] = useState(false)
  const [prnHub, setPrnHub] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!userId) {
      setRelatorios(false)
      setLicitacoes(false)
      setPropostaComercial(false)
      setPrnHub(false)
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
      const liberadas = tools.status === 'fulfilled' ? tools.value : []
      setRelatorios(perfil.status === 'fulfilled' && perfil.value)
      setLicitacoes(liberadas.includes('licitacoes'))
      setPropostaComercial(liberadas.includes('proposta-comercial'))
      setPrnHub(liberadas.includes('prn-hub'))
      setLoading(false)
    })

    return () => {
      mounted = false
    }
  }, [userId])

  const value = useMemo(
    () => ({ relatorios, licitacoes, propostaComercial, prnHub, loading }),
    [relatorios, licitacoes, propostaComercial, prnHub, loading],
  )

  return <ToolAccessContext.Provider value={value}>{children}</ToolAccessContext.Provider>
}

export const useToolAccess = () => useContext(ToolAccessContext)
