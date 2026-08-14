import { useCallback } from 'react'
import supabase from '@/lib/supabase/client'
import { appEnv } from '@/lib/env'
import { ToolFrame } from '@/components/tools/ToolFrame'
import type { EmbedCredential } from '@/lib/tool-embed'

/**
 * PRN Licitações embutido. Vive em OUTRO projeto Supabase, então a sessão do
 * Central Whats não vale lá: a edge function `licitacao-bridge` valida o
 * chamador, provisiona a conta por e-mail e devolve um OTP de uso único.
 *
 * Só esse OTP cruza a fronteira de origem — o access token do Central Whats
 * nunca entra no iframe. Mesmo desenho da ponte do módulo financeiro
 * (src/contexts/financeiro-auth-context.tsx).
 */
export default function Licitacoes() {
  const getCredential = useCallback(async (): Promise<EmbedCredential> => {
    const {
      data: { session },
    } = await supabase.auth.getSession()

    if (!session?.access_token) {
      throw new Error('Sessão não encontrada. Saia e entre novamente no PRN Hub.')
    }

    const resp = await fetch(`${appEnv.VITE_LICITACAO_SUPABASE_URL}/functions/v1/licitacao-bridge`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
      },
    })

    const body = await resp.json().catch(() => null)

    if (!resp.ok) {
      const detalhe = body?.reason || body?.error
      throw new Error(
        resp.status === 403
          ? 'Seu usuário não tem acesso ao Licitações. Peça a um administrador para liberar em Gestão de Equipe.'
          : detalhe
            ? `Não foi possível liberar seu acesso ao Licitações (${detalhe}).`
            : 'Não foi possível liberar seu acesso ao Licitações.',
      )
    }

    if (!body?.hashed_token) {
      throw new Error('Resposta inválida ao liberar acesso ao Licitações.')
    }

    return {
      kind: 'otp',
      token_hash: body.hashed_token,
      verification_type: body.verification_type || 'magiclink',
    }
  }, [])

  return (
    <ToolFrame
      title="PRN Licitações"
      baseUrl={appEnv.VITE_LICITACAO_APP_URL}
      envVarName="VITE_LICITACAO_APP_URL"
      getCredential={getCredential}
    />
  )
}
