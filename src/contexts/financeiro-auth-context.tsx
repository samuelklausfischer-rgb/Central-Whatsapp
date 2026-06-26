import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { type User, type Session } from '@supabase/supabase-js'
import { supabaseFinanceiro } from '@/lib/supabase/client-financeiro'

interface FinanceiroAuthContextValue {
  user: User | null
  session: Session | null
  loading: boolean
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>
  signOut: () => Promise<void>
}

const FinanceiroAuthContext = createContext<FinanceiroAuthContextValue | null>(null)

export function FinanceiroAuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabaseFinanceiro.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setUser(session?.user ?? null)
      setLoading(false)
    })

    const {
      data: { subscription },
    } = supabaseFinanceiro.auth.onAuthStateChange((_event, session) => {
      setSession(session)
      setUser(session?.user ?? null)
    })

    return () => subscription.unsubscribe()
  }, [])

  const signIn = async (email: string, password: string) => {
    const { error } = await supabaseFinanceiro.auth.signInWithPassword({ email, password })
    return { error: error as Error | null }
  }

  const signOut = async () => {
    await supabaseFinanceiro.auth.signOut()
  }

  return (
    <FinanceiroAuthContext.Provider value={{ user, session, loading, signIn, signOut }}>
      {children}
    </FinanceiroAuthContext.Provider>
  )
}

export function useFinanceiroAuth() {
  const ctx = useContext(FinanceiroAuthContext)
  if (!ctx) throw new Error('useFinanceiroAuth must be used within FinanceiroAuthProvider')
  return ctx
}
