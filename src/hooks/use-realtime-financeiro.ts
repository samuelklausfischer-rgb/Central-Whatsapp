import { useEffect, useRef } from 'react'
import { supabaseFinanceiro } from '@/lib/supabase/client-financeiro'

/**
 * Confirma que o `setAuth()` anterior realmente aplicou o token no socket
 * do Realtime (mesma checagem de `garantirTokenRealtime` em
 * `src/hooks/use-realtime.ts` — ver o comentário lá para o mecanismo
 * completo do achado da revisão adversarial: `getSession()` pode rejeitar
 * por timeout de lock entre abas, e `RealtimeClient._performAuth` engole
 * essa rejeição em silêncio, fazendo `setAuth()` "resolver com sucesso"
 * sem aplicar nada). Duplicada aqui (em vez de importada) porque este
 * arquivo usa um client Supabase DIFERENTE (`supabaseFinanceiro`, projeto
 * Financeiro) do `use-realtime.ts` (projeto Central Whats) — comparar
 * `accessTokenValue` com sessão do client errado não detectaria nada.
 */
async function garantirTokenRealtimeFinanceiro(): Promise<void> {
  try {
    const { data } = await supabaseFinanceiro.auth.getSession()
    const session = data.session
    if (!session) return // deslogado: accessTokenValue null é o certo, não é falha
    if (supabaseFinanceiro.realtime.accessTokenValue === session.access_token) return

    console.warn(
      '[use-realtime-financeiro] token não aplicado ao socket; canal pode nascer mudo — tentando setAuth() mais uma vez',
    )
    try {
      await supabaseFinanceiro.realtime.setAuth()
    } catch (erroRetry) {
      console.error(
        '[use-realtime-financeiro] segunda tentativa de setAuth também falhou; seguindo mesmo assim',
        erroRetry,
      )
    }
  } catch (erro) {
    console.error(
      '[use-realtime-financeiro] não foi possível confirmar a sessão após setAuth; seguindo mesmo assim',
      erro,
    )
  }
}

export function useRealtime(
  tableName: string,
  callback: (data: any) => void,
  enabled: boolean = true,
) {
  const callbackRef = useRef(callback)
  callbackRef.current = callback

  useEffect(() => {
    if (!enabled) return

    // Mesmo bug e mesma correção do `src/hooks/use-realtime.ts` (canal
    // Realtime preso em claims_role='anon'): `RealtimeChannel.subscribe()`
    // lê `accessTokenValue` de forma SÍNCRONA, e o supabase-js só chama
    // `realtime.setAuth(token)` em TOKEN_REFRESHED/SIGNED_IN — nunca em
    // INITIAL_SESSION, e sem esperar. A RLS de `analises_duplicidade`
    // exige role 'authenticated' (`auth.role() = 'authenticated'`), então
    // um join que saia como anon fica SUBSCRIBED e mudo para sempre.
    // `setAuth()` sem argumento reexecuta o callback que aguarda
    // `getSession()`, garantindo o token certo ANTES da leitura síncrona.
    let cancelado = false
    let channel: ReturnType<typeof supabaseFinanceiro.channel> | null = null

    void (async () => {
      // try/catch envolvendo TUDO: `.subscribe()` chama `socket.connect()`
      // por baixo, que pode lançar SÍNCRONO (ex.: URL malformada). Sem este
      // catch a exceção escaparia como unhandled promise rejection — o
      // `void` na frente da IIFE descarta a referência, mas não trata
      // rejeição nenhuma.
      try {
        try {
          await supabaseFinanceiro.realtime.setAuth()
        } catch (erro) {
          // Não pode derrubar a assinatura — degradado é melhor que mudo.
          console.error(
            '[use-realtime-financeiro] setAuth falhou; seguindo mesmo assim',
            erro,
          )
        }

        // setAuth() pode ter "resolvido com sucesso" sem aplicar nada — ver
        // comentário de garantirTokenRealtimeFinanceiro acima.
        await garantirTokenRealtimeFinanceiro()

        // O efeito pode ter sido desmontado enquanto esperávamos a sessão
        // resolver — sem este re-check abriríamos canal para um efeito já
        // encerrado (e o cleanup abaixo, que já rodou, nunca o fecharia).
        if (cancelado) return

        channel = supabaseFinanceiro
          .channel(`realtime:${tableName}:${Math.random().toString(36).slice(2)}`)
          .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: tableName },
            (payload) => {
              callbackRef.current(payload)
            },
          )
          .subscribe()
      } catch (erro) {
        channel = null
        console.error(
          '[use-realtime-financeiro] falha ao abrir canal; sem canal até o próximo mount',
          erro,
        )
      }
    })()

    return () => {
      cancelado = true
      if (channel) void supabaseFinanceiro.removeChannel(channel)
    }
  }, [tableName, enabled])
}
