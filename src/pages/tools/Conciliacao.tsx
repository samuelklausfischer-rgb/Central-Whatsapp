import { useCallback } from 'react'
import supabase from '@/lib/supabase/client'
import { appEnv } from '@/lib/env'
import { ToolFrame } from '@/components/tools/ToolFrame'
import type { EmbedCredential } from '@/lib/tool-embed'

/**
 * Conciliação bancária (extrato do banco × Omie, com sugestão de nota) embutida
 * como ferramenta, repositório `PRN-conciliacao-financeira`.
 *
 * Mesmo desenho do PRN Hub e da Gestão Médica: roda no MESMO projeto Supabase
 * do Central Whats, então a sessão aberta aqui vale lá (handshake
 * `central-whats-embed`, credencial `supabase-session`) e não há ponte de OTP.
 * Quem decide o acesso de verdade é o servidor do app embutido, lendo
 * `public.tool_access` com `tool = 'conciliacao'` — a mesma chave do catálogo.
 *
 * Quem renova a sessão é só o PAI: o Supabase rotaciona o refresh token, e se as
 * duas pontas renovassem a mesma sessão a segunda seria deslogada. Por isso o
 * `watch` reenvia o token a cada renovação.
 */
export default function Conciliacao() {
  const getCredential = useCallback(async (): Promise<EmbedCredential> => {
    const {
      data: { session },
    } = await supabase.auth.getSession()

    if (!session?.access_token || !session?.refresh_token) {
      throw new Error('Sessão não encontrada. Saia e entre novamente na Conciliação.')
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
      title="Conciliação"
      baseUrl={appEnv.VITE_CONCILIACAO_APP_URL}
      envVarName="VITE_CONCILIACAO_APP_URL"
      getCredential={getCredential}
      watch={watch}
    />
  )
}
