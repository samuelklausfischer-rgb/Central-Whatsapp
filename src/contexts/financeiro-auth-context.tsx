import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { type User, type Session } from '@supabase/supabase-js'
import { supabaseFinanceiro } from '@/lib/supabase/client-financeiro'

const AUTH_TIMEOUT_MS = 6000

interface FinanceiroAuthContextValue {
  user: User | null
  session: Session | null
  loading: boolean
  error: string | null
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>
  signOut: () => Promise<void>
  retry: () => void
}

const FinanceiroAuthContext = createContext<FinanceiroAuthContextValue | null>(null)

export function FinanceiroAuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [retryNonce, setRetryNonce] = useState(0)

  useEffect(() => {
    let mounted = true
    let resolved = false

    // Não chamar getSession() aqui: disparar getSession() e onAuthStateChange
    // concorrentemente no mesmo GoTrueClient pode travar (disputa do lock interno
    // do supabase-js) — mesma classe de deadlock já corrigida em use-auth.tsx
    // (commit c3d5198). O primeiro disparo de onAuthStateChange já traz a sessão
    // resolvida (evento INITIAL_SESSION), então basta depender dele.
    const {
      data: { subscription },
    } = supabaseFinanceiro.auth.onAuthStateChange((_event, session) => {
      if (!mounted) return
      resolved = true
      setSession(session)
      setUser(session?.user ?? null)
      setLoading(false)
      setError(null)
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
  }, [retryNonce])

  const retry = () => {
    setError(null)
    setLoading(true)
    setRetryNonce((n) => n + 1)
  }

  const signIn = async (email: string, password: string) => {
    const { error } = await supabaseFinanceiro.auth.signInWithPassword({ email, password })
    return { error: error as Error | null }
  }

  const signOut = async () => {
    await supabaseFinanceiro.auth.signOut()
  }

  return (
    <FinanceiroAuthContext.Provider value={{ user, session, loading, error, signIn, signOut, retry }}>
      {children}
    </FinanceiroAuthContext.Provider>
  )
}

export function useFinanceiroAuth() {
  const ctx = useContext(FinanceiroAuthContext)
  if (!ctx) throw new Error('useFinanceiroAuth must be used within FinanceiroAuthProvider')
  return ctx
}
