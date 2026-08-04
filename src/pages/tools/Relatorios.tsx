import { useCallback } from 'react'
import supabase from '@/lib/supabase/client'
import { appEnv } from '@/lib/env'
import { ToolFrame } from '@/components/tools/ToolFrame'
import type { EmbedCredential } from '@/lib/tool-embed'

/**
 * Sistema de Relatórios embutido. Roda no MESMO projeto Supabase do Central
 * Whats (schema `relatorios`), então não há ponte: a sessão que já está aberta
 * aqui é a mesma que vale lá.
 *
 * O filho recebe os tokens mas NÃO renova sozinho (o cliente dele em modo embed
 * sobe com autoRefreshToken/persistSession desligados). O Supabase rotaciona
 * refresh token: se as duas pontas renovassem a mesma sessão, a segunda a tentar
 * seria deslogada. Por isso o dono da renovação é só o pai, que reenvia o token
 * novo a cada TOKEN_REFRESHED.
 */
export default function Relatorios() {
  const getCredential = useCallback(async (): Promise<EmbedCredential> => {
    const {
      data: { session },
    } = await supabase.auth.getSession()

    if (!session?.access_token || !session?.refresh_token) {
      throw new Error('Sessão não encontrada. Saia e entre novamente no Central Whats.')
    }

    return {
      kind: 'supabase-session',
      access_token: session.access_token,
      refresh_token: session.refresh_token,
    }
  }, [])

  const watch = useCallback((send: (credential: EmbedCredential) => void) => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (event !== 'TOKEN_REFRESHED' && event !== 'SIGNED_IN') return
      if (!session?.access_token || !session?.refresh_token) return
      send({
        kind: 'supabase-session',
        access_token: session.access_token,
        refresh_token: session.refresh_token,
      })
    })

    return () => subscription.unsubscribe()
  }, [])

  return (
    <ToolFrame
      title="Sistema de Relatórios"
      baseUrl={appEnv.VITE_RELATORIOS_APP_URL}
      envVarName="VITE_RELATORIOS_APP_URL"
      getCredential={getCredential}
      watch={watch}
    />
  )
}
