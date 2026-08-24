import { useCallback } from 'react'
import supabase from '@/lib/supabase/client'
import { appEnv } from '@/lib/env'
import { ToolFrame } from '@/components/tools/ToolFrame'
import type { EmbedCredential } from '@/lib/tool-embed'

/**
 * ITEM 2: o PRN-hub embutido como ferramenta.
 *
 * Roda no MESMO projeto Supabase do Central Whats, então segue o desenho do
 * Sistema de Relatórios e não o do Licitações: a sessão aberta aqui já vale lá,
 * e não há ponte de OTP no meio.
 *
 * Iframe apontando para o app publicado — e não uma cópia das telas aqui dentro
 * — é o que cumpre o "sempre vir atualizado quando o projeto for atualizado":
 * publicou o contêiner do PRN-hub, mudou aqui, sem build do Central Whats.
 *
 * PENDÊNCIA CONHECIDA: o handshake tem duas pontas, e a do filho ainda não
 * existe. `src/lib/tool-embed.ts` é espelhado como `src/lib/embed.ts` nos apps
 * embutidos, e o PRN-hub não tem esse arquivo. Enquanto não tiver, o iframe
 * abre pedindo login próprio em vez de aproveitar a sessão — funciona, mas com
 * um login a mais. No Electron, onde o pai roda em `file://` e não há sessão
 * compartilhada por origem, é obrigatório.
 *
 * Como no Relatórios, quem renova a sessão é só o PAI. O Supabase rotaciona o
 * refresh token: se as duas pontas renovassem a mesma sessão, a segunda a
 * tentar seria deslogada. Por isso o `watch` reenvia o token a cada renovação.
 */
export default function PrnHub() {
  const getCredential = useCallback(async (): Promise<EmbedCredential> => {
    const {
      data: { session },
    } = await supabase.auth.getSession()

    if (!session?.access_token || !session?.refresh_token) {
      throw new Error('Sessão não encontrada. Saia e entre novamente no PRN Hub.')
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
      title="PRN Hub"
      baseUrl={appEnv.VITE_PRN_HUB_APP_URL}
      envVarName="VITE_PRN_HUB_APP_URL"
      getCredential={getCredential}
      watch={watch}
    />
  )
}
