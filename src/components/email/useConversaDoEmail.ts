import { useCallback, useEffect, useMemo, useState } from 'react'
import { getMensagensDaConversa } from '@/services/emails'
import type { Email } from '@/lib/supabase/email-types'

/** Da mensagem mais nova para a mais antiga; empate de horário decide pelo registro mais recente. */
export function maisNovaPrimeiro(a: Email, b: Email): number {
  const porRecebimento = Date.parse(b.received_at) - Date.parse(a.received_at)
  if (porRecebimento) return porRecebimento
  return Date.parse(b.created_at) - Date.parse(a.created_at) || 0
}

export interface ConversaDoEmail {
  /** Mais nova primeiro. Sempre inclui `email` (a aberta), mesmo antes da lista chegar. */
  mensagens: Email[]
  /** A lista das OUTRAS mensagens ainda está vindo. */
  carregando: boolean
  erro: string | null
  recarregar: () => void
}

/**
 * Todas as mensagens da conversa do e-mail aberto.
 *
 * A mensagem aberta entra na lista desde o primeiro render, vinda de `email`, e
 * não da busca: assim o leitor mostra o que a pessoa clicou NA HORA e as demais
 * se juntam quando chegam, em vez de a tela esperar a busca terminar.
 *
 * E é `email` — não a linha que veio do banco — que vale para a mensagem aberta:
 * é ela quem carrega o corpo e as atualizações de Realtime já mescladas
 * (`mesclarSemPerderCorpo`, em `EmailHub`).
 *
 * Sem `conversation_id` não há como agrupar: a "conversa" é só a própria mensagem.
 */
export function useConversaDoEmail(email: Email): ConversaDoEmail {
  const contaId = email.account_id
  const conversaId = email.conversation_id
  // Pasta do e-mail aberto: decide se Itens Excluídos/Lixo entram na conversa
  // (só entram quando a pessoa abriu algo que está numa dessas pastas).
  const pastaDaAberta = email.folder_id
  const [doBanco, setDoBanco] = useState<{ chave: string; lista: Email[] } | null>(null)
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [tentativa, setTentativa] = useState(0)

  const chave = conversaId ? `${contaId}:${conversaId}` : null

  useEffect(() => {
    if (!conversaId || !chave) {
      setCarregando(false)
      setErro(null)
      return
    }
    let valido = true
    setCarregando(true)
    setErro(null)
    getMensagensDaConversa(contaId, conversaId, pastaDaAberta)
      .then((lista) => {
        if (valido) setDoBanco({ chave, lista })
      })
      .catch((e) => {
        console.error('conversa do email:', e)
        if (valido) setErro(e instanceof Error ? e.message : 'Falha ao carregar a conversa.')
      })
      .finally(() => {
        if (valido) setCarregando(false)
      })
    return () => {
      valido = false
    }
  }, [contaId, conversaId, pastaDaAberta, chave, tentativa])

  const mensagens = useMemo(() => {
    // Lista de OUTRA conversa (a pessoa trocou de e-mail e a busca nova não
    // voltou) não pode aparecer aqui.
    const lista = doBanco && doBanco.chave === chave ? doBanco.lista : []
    return [email, ...lista.filter((m) => m.id !== email.id)].sort(maisNovaPrimeiro)
  }, [doBanco, chave, email])

  const recarregar = useCallback(() => setTentativa((t) => t + 1), [])

  return { mensagens, carregando, erro, recarregar }
}
