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
  /** Disparador em massa — liberado pela chave em public.tool_access. */
  disparador: boolean
  loading: boolean
}

const ToolAccessContext = createContext<ToolAccessValue>({
  relatorios: false,
  licitacoes: false,
  propostaComercial: false,
  prnHub: false,
  disparador: false,
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
  const [disparador, setDisparador] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!userId) {
      setRelatorios(false)
      setLicitacoes(false)
      setPropostaComercial(false)
      setPrnHub(false)
      setDisparador(false)
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

      // SUPER-ADMIN ENXERGA TUDO QUE SAI DE `tool_access`, sem precisar de linha.
      //
      // Antes, cada ferramenta nova exigia lembrar de inserir uma linha para ele —
      // e foi exatamente o que falhou quando o Disparador em massa entrou: a
      // ferramenta existia, ele tinha direito de usá-la (`pode_disparar()` já
      // devolve true para admin), mas o item nem aparecia no menu porque o porteiro
      // da TELA olhava só a tabela.
      //
      // Não é regra nova: `can_access_device` no banco já trata `is_super_admin`
      // como "tem tudo". Isto só faz o cliente concordar com o servidor.
      //
      // `relatorios` fica DE FORA de propósito: ele não vem de `tool_access` e sim
      // de um perfil no schema `relatorios`. Liberar o menu sem o perfil existir do
      // outro lado abriria uma tela que o outro sistema recusa — porta que bate na
      // cara é pior que porta que não aparece.
      const tudo = !!user?.is_super_admin

      setRelatorios(perfil.status === 'fulfilled' && perfil.value)
      setLicitacoes(tudo || liberadas.includes('licitacoes'))
      setPropostaComercial(tudo || liberadas.includes('proposta-comercial'))
      setPrnHub(tudo || liberadas.includes('prn-hub'))
      setDisparador(tudo || liberadas.includes('disparador-em-massa'))
      setLoading(false)
    })

    return () => {
      mounted = false
    }
    // `is_super_admin` entra nas dependências junto com o id: se o perfil chegasse
    // depois (ou mudasse), o efeito não rodaria de novo e o super-admin ficaria
    // preso no `false` inicial — sem ver as ferramentas e sem nada indicando por quê.
  }, [userId, user?.is_super_admin])

  const value = useMemo(
    () => ({ relatorios, licitacoes, propostaComercial, prnHub, disparador, loading }),
    [relatorios, licitacoes, propostaComercial, prnHub, disparador, loading],
  )

  return <ToolAccessContext.Provider value={value}>{children}</ToolAccessContext.Provider>
}

export const useToolAccess = () => useContext(ToolAccessContext)
