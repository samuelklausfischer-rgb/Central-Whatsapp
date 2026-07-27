import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { type User, type Session } from '@supabase/supabase-js'
import supabase from '@/lib/supabase/client'
import { supabaseFinanceiro } from '@/lib/supabase/client-financeiro'
import { useAuth } from '@/hooks/use-auth'

const AUTH_TIMEOUT_MS = 10000

interface FinanceiroAuthContextValue {
  user: User | null
  session: Session | null
  loading: boolean
  error: string | null
  retry: () => void
}

const FinanceiroAuthContext = createContext<FinanceiroAuthContextValue | null>(null)

// Ponte silenciosa: troca a sessão do app principal por uma sessão no projeto
// Supabase Financeiro, sem exigir email/senha separados. Ver supabase/functions
// financeiro-bridge (projeto Financeiro) para a verificação/provisionamento.
async function bridgeSignIn() {
  const {
    data: { session: mainSession },
  } = await supabase.auth.getSession()

  if (!mainSession?.access_token) {
    throw new Error('Sessão principal não encontrada.')
  }

  const { data, error, response } = await supabaseFinanceiro.functions.invoke('financeiro-bridge', {
    headers: { Authorization: `Bearer ${mainSession.access_token}` },
  })

  if (error) {
    let detail: string | undefined
    try {
      const body = await response?.json()
      detail = body?.reason || body?.error
    } catch {
      // resposta ausente ou não-JSON (ex.: falha de rede) — segue sem detalhe extra
    }
    throw new Error(
      detail
        ? `Não foi possível liberar seu acesso ao módulo financeiro (${detail}).`
        : 'Não foi possível liberar seu acesso ao módulo financeiro.',
    )
  }

  const tokenHash = data?.hashed_token
  const verificationType = data?.verification_type || 'magiclink'
  if (!tokenHash) {
    throw new Error('Resposta inválida ao liberar acesso financeiro.')
  }

  const { error: verifyError } = await supabaseFinanceiro.auth.verifyOtp({
    token_hash: tokenHash,
    type: verificationType,
  })

  if (verifyError) {
    throw new Error('Não foi possível confirmar seu acesso financeiro.')
  }
}

export function FinanceiroAuthProvider({ children }: { children: ReactNode }) {
  const { user: mainUser } = useAuth()
  const [user, setUser] = useState<User | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [retryNonce, setRetryNonce] = useState(0)

  useEffect(() => {
    let mounted = true
    let resolved = false
    let bridging = false

    const runBridge = () => {
      if (bridging) return
      bridging = true
      bridgeSignIn()
        .catch((err) => {
          if (!mounted) return
          setError(err instanceof Error ? err.message : 'Não foi possível liberar seu acesso financeiro.')
        })
        .finally(() => {
          bridging = false
          if (mounted) setLoading(false)
        })
    }

    // Não chamar getSession() aqui: disparar getSession() e onAuthStateChange
    // concorrentemente no mesmo GoTrueClient pode travar (mesma classe de
    // deadlock já corrigida em use-auth.tsx, commit c3d5198). O primeiro
    // disparo de onAuthStateChange já traz a sessão resolvida (INITIAL_SESSION),
    // então basta depender dele — e disparar a ponte quando ele vier vazio.
    const {
      data: { subscription },
    } = supabaseFinanceiro.auth.onAuthStateChange((_event, nextSession) => {
      if (!mounted) return
      resolved = true

      const belongsToMainUser =
        !mainUser?.email ||
        !nextSession?.user?.email ||
        mainUser.email.toLowerCase() === nextSession.user.email.toLowerCase()

      if (nextSession && !belongsToMainUser) {
        // Sessão financeira de outra pessoa (ex.: aparelho compartilhado) — descarta e refaz a ponte.
        setUser(null)
        setSession(null)
        supabaseFinanceiro.auth.signOut().finally(runBridge)
        return
      }

      setSession(nextSession)
      setUser(nextSession?.user ?? null)

      if (nextSession) {
        setError(null)
        setLoading(false)
        return
      }

      runBridge()
    })

    // Rede de segurança: se por algum motivo o callback nunca disparar, não
    // deixar o usuário preso na tela de carregando para sempre.
    const timeoutId = setTimeout(() => {
      if (!mounted || resolved) return
      setLoading(false)
      setError('Não foi possível verificar sua sessão financeira. Tente novamente.')
    }, AUTH_TIMEOUT_MS)

    return () => {
      mounted = false
      clearTimeout(timeoutId)
      subscription.unsubscribe()
    }
  }, [retryNonce, mainUser?.email])

  const retry = () => {
    setError(null)
    setLoading(true)
    setRetryNonce((n) => n + 1)
  }

  return (
    <FinanceiroAuthContext.Provider value={{ user, session, loading, error, retry }}>
      {children}
    </FinanceiroAuthContext.Provider>
  )
}

export function useFinanceiroAuth() {
  const ctx = useContext(FinanceiroAuthContext)
  if (!ctx) throw new Error('useFinanceiroAuth must be used within FinanceiroAuthProvider')
  return ctx
}
