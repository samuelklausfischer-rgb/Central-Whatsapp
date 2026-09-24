import { useCallback, useEffect, useState } from 'react'
import supabase from '@/lib/supabase/client'
import { useAuth } from '@/hooks/use-auth'

/**
 * Modo "atribuir a mim ao responder".
 *
 * ── O que ele controla, e onde ──
 *
 * NADA no cliente. A atribuição automática mora no banco, no gatilho
 * `tg_atribuir_conversa_ao_responder` de `messages`: responder um contato SEM
 * DONO pelo app faz esse contato passar a ser de quem respondeu. Este hook só lê
 * e grava `profiles.atribuir_ao_responder` — quem consulta a coluna é o gatilho,
 * já com a mensagem gravada.
 *
 * É por isso que a preferência precisou ir para o servidor em vez de virar um
 * `useState` ao lado do toggle "sem assinatura": um estado só de React seria
 * invisível para quem decide.
 *
 * ── Por que é um modo, e não uma escolha por conversa ──
 *
 * Decidido com o Samuel em 24/09/2026: vale para todas as conversas, em todos os
 * aparelhos e navegadores. Mesmo desenho de `profiles.notification_prefs`, e
 * pelo mesmo motivo — configuração guardada no cliente é uma por navegador, e
 * quem silenciou no desktop reabria na web e encontrava tudo ligado de novo.
 *
 * ── Por que a falha não é silenciosa ──
 *
 * `use-notification-prefs` engole erro de escrita de propósito: lá o espelho
 * local já garante o comportamento certo naquele aparelho. Aqui não há espelho —
 * se o UPDATE falhar e ninguém avisar, a pessoa desliga o toggle, vê a chavinha
 * apagada e continua herdando todo contato que responder. Por isso `definir`
 * reverte o estado e devolve `false`, para a tela poder reclamar.
 *
 * ── Por que NÃO chamamos `refreshProfile()` depois de salvar ──
 *
 * Seria o caminho óbvio para o `user` do contexto acompanhar a escrita, e é o
 * que `GeneralSettings` e `AdminPage` fazem. Mas `refreshProfile` liga o
 * `loading` do `useAuth`, e o `ProtectedRoute` de `App.tsx` troca TODA a árvore
 * pela tela "Entrando…" enquanto ele estiver ligado. Numa tela de ajustes isso
 * passa; num interruptor do compositor significaria a conversa aberta fechando
 * no meio do atendimento.
 *
 * Não custa nada deixar de chamar: o único consumidor de verdade desta coluna é
 * o gatilho no banco, que lê a linha atualizada na próxima mensagem. O `user` do
 * contexto se alinha sozinho na próxima carga de perfil (todo `TOKEN_REFRESHED`
 * roda `loadUserData`).
 */

/** Sem valor = ligado. Espelha o `not null default true` da coluna. */
const PADRAO = true

export function useAtribuicaoAutomatica() {
  const { user } = useAuth()
  const doPerfil = user?.atribuir_ao_responder

  const [ligado, setLigado] = useState<boolean>(doPerfil ?? PADRAO)
  const [salvando, setSalvando] = useState(false)

  /**
   * Resincroniza quando o perfil chega ou muda.
   *
   * O `useState` acima só roda o inicializador uma vez, e este hook monta dentro
   * do `ChatWindow`, que pode existir antes de a sessão resolver. Sem isto o
   * toggle ficaria preso no padrão até um F5 — e `loadUserData` roda de novo a
   * cada `TOKEN_REFRESHED`, então é também por aqui que a mudança feita em outra
   * aba aparece nesta.
   */
  useEffect(() => {
    setLigado(doPerfil ?? PADRAO)
  }, [doPerfil])

  /**
   * Grava a preferência. Devolve `true` se o servidor aceitou.
   *
   * Otimista: a chavinha vira na hora, porque esperar o round-trip para uma
   * chave de liga/desliga dá a sensação de travamento. Se a escrita falhar o
   * estado volta ao que era, e é o valor do SERVIDOR que volta (`doPerfil`), não
   * o oposto do que foi pedido — assim uma segunda tentativa parte do lugar
   * certo.
   *
   * O `.select()` no fim NÃO é enfeite. Um UPDATE barrado pela RLS não devolve
   * erro no PostgREST: devolve sucesso tendo escrito ZERO linhas. Sem pedir as
   * linhas de volta, uma policy mal ajustada apareceria como "salvou" e a pessoa
   * só descobriria ao herdar o próximo contato. Com o `.select()`, lista vazia
   * é tratada como falha, igual a erro.
   */
  const definir = useCallback(
    async (valor: boolean): Promise<boolean> => {
      if (!user?.id) return false

      setLigado(valor)
      setSalvando(true)
      try {
        const { data, error } = await supabase
          .from('profiles')
          .update({ atribuir_ao_responder: valor })
          .eq('id', user.id)
          .select('id')

        if (error || !data?.length) {
          setLigado(doPerfil ?? PADRAO)
          console.error(
            '[atribuicao] não foi possível salvar a preferência:',
            error?.message ?? 'nenhuma linha atualizada (RLS?)',
          )
          return false
        }

        return true
      } finally {
        setSalvando(false)
      }
    },
    [user?.id, doPerfil],
  )

  return { ligado, salvando, definir }
}
