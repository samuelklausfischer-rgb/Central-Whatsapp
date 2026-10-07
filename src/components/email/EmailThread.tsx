import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { BlocoDeEmail, type CorpoDoBloco } from './BlocoDeEmail'
import type { ConversaDoEmail } from './useConversaDoEmail'
import { getEmail } from '@/services/emails'
import type { Email } from '@/lib/supabase/email-types'

interface Props {
  /** A mensagem ABERTA (a que a barra de ações atinge). Traz o corpo quando ele já chegou. */
  email: Email
  /** O `EmailHub` ainda está buscando o corpo de `email`. */
  carregandoCorpo: boolean
  conversa: ConversaDoEmail
}

/**
 * A conversa em blocos: uma mensagem por bloco, a mais nova no topo.
 *
 * Regras de abertura:
 *  - a mais nova e a que foi clicada na lista vêm abertas; as outras, recolhidas;
 *  - clicar no cabeçalho de um bloco alterna (a escolha manual vale sobre o padrão);
 *  - o corpo das demais só é pedido quando o bloco abre (`getEmail`) e fica
 *    guardado aqui até a conversa mudar.
 *
 * A mensagem clicada é rolada para a vista quando não é a primeira — numa
 * conversa de 20 e-mails ela pode estar bem embaixo.
 */
export function EmailThread({ email, carregandoCorpo, conversa }: Props) {
  const { mensagens, carregando, erro, recarregar } = conversa
  const varias = mensagens.length > 1
  const maisNovoId = mensagens[0]?.id

  // O que identifica "esta conversa" para efeitos de zerar estado. Sem
  // `conversation_id` a conversa é a própria mensagem.
  const chaveDaConversa = email.conversation_id
    ? `${email.account_id}:${email.conversation_id}`
    : `solta:${email.id}`

  /** Abriu/fechou na mão: `id → aberto`. Ausente = vale o padrão. */
  const [escolhas, setEscolhas] = useState<Record<string, boolean>>({})
  /** Corpos das mensagens já buscadas (ou em busca), por id. */
  const [corpos, setCorpos] = useState<Record<string, CorpoDoBloco>>({})
  /** Quem já foi pedido — impede o efeito de pedir duas vezes o mesmo corpo. */
  const pedidosRef = useRef<Set<string>>(new Set())
  /** Sobe a cada conversa nova; resposta atrasada de uma conversa antiga é descartada. */
  const geracaoRef = useRef(0)
  const blocosRef = useRef<Map<string, HTMLDivElement>>(new Map())
  const rolouParaRef = useRef<string | null>(null)

  // Conversa nova: começa do zero. (Declarado ANTES dos outros efeitos de
  // propósito — num mesmo commit eles rodam na ordem de declaração.)
  useEffect(() => {
    geracaoRef.current += 1
    pedidosRef.current.clear()
    rolouParaRef.current = null
    setEscolhas({})
    setCorpos({})
  }, [chaveDaConversa])

  // Trocar a mensagem aberta DENTRO da mesma conversa: a nova abre, mesmo que
  // a pessoa a tivesse recolhido antes.
  useEffect(() => {
    setEscolhas((antes) => {
      if (!(email.id in antes)) return antes
      const { [email.id]: _descartado, ...resto } = antes
      return resto
    })
  }, [email.id])

  // O corpo da aberta já está em mãos (veio do `EmailHub`): guarda, para que ela
  // não volte ao esqueleto se a pessoa abrir outra mensagem da conversa.
  useEffect(() => {
    if (!email.body_html && !email.body_text) return
    setCorpos((antes) =>
      antes[email.id]?.estado === 'pronto'
        ? antes
        : { ...antes, [email.id]: { estado: 'pronto', html: email.body_html, texto: email.body_text } },
    )
  }, [email.id, email.body_html, email.body_text])

  const estaAberto = (id: string) => escolhas[id] ?? (id === maisNovoId || id === email.id)

  // Busca o corpo das mensagens abertas que ainda não o têm.
  useEffect(() => {
    for (const m of mensagens) {
      if (!estaAberto(m.id)) continue
      if (corpos[m.id] || pedidosRef.current.has(m.id)) continue
      // A aberta tem o corpo vindo pelo `EmailHub`: espera ele terminar. Só se
      // terminar SEM corpo (falha ou realmente vazio) é que esta tela tenta uma vez.
      if (m.id === email.id && (carregandoCorpo || m.body_html || m.body_text)) continue

      pedidosRef.current.add(m.id)
      const geracao = geracaoRef.current
      setCorpos((antes) => ({ ...antes, [m.id]: { estado: 'carregando' } }))
      getEmail(m.id)
        .then((completo) => {
          if (geracao !== geracaoRef.current) return
          setCorpos((antes) => ({
            ...antes,
            [m.id]: completo
              ? { estado: 'pronto', html: completo.body_html, texto: completo.body_text }
              : { estado: 'erro', mensagem: 'A mensagem não foi encontrada.' },
          }))
        })
        .catch((e) => {
          console.error('corpo do email (bloco):', e)
          if (geracao !== geracaoRef.current) return
          setCorpos((antes) => ({
            ...antes,
            [m.id]: { estado: 'erro', mensagem: e instanceof Error ? e.message : '' },
          }))
        })
    }
    // `estaAberto` é recriada a cada render; o que ela lê já está nas dependências.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mensagens, escolhas, corpos, email.id, carregandoCorpo, maisNovoId])

  const tentarDeNovo = useCallback((id: string) => {
    pedidosRef.current.delete(id)
    setCorpos((antes) => {
      const { [id]: _descartado, ...resto } = antes
      return resto
    })
  }, [])

  // Rola até a mensagem clicada quando ela não é a do topo. Espera o corpo dela
  // chegar: antes disso o bloco tem altura de esqueleto e a rolagem erraria o alvo.
  useEffect(() => {
    // Mensagem do topo não precisa de rolagem — e NÃO se marca como "já rolou":
    // a lista das outras ainda pode chegar com mensagens mais novas por cima.
    if (!varias || carregandoCorpo || maisNovoId === email.id) return
    if (rolouParaRef.current === email.id) return
    const alvo = blocosRef.current.get(email.id)
    if (!alvo) return
    rolouParaRef.current = email.id
    requestAnimationFrame(() => alvo.scrollIntoView({ block: 'start', behavior: 'smooth' }))
  }, [varias, carregandoCorpo, maisNovoId, email.id, mensagens])

  const corpoDe = (m: Email): CorpoDoBloco => {
    if (m.id === email.id) {
      if (m.body_html || m.body_text) return { estado: 'pronto', html: m.body_html, texto: m.body_text }
      if (carregandoCorpo) return { estado: 'carregando' }
    }
    // `?? carregando`: o efeito acima pede o corpo no commit seguinte, e "(sem
    // conteúdo)" só pode aparecer depois da resposta — nunca nesse intervalo.
    return corpos[m.id] ?? { estado: 'carregando' }
  }

  return (
    <div className="space-y-3">
      {mensagens.map((m) => (
        <div
          key={m.id}
          ref={(el) => {
            if (el) blocosRef.current.set(m.id, el)
            else blocosRef.current.delete(m.id)
          }}
          className="scroll-mt-3"
        >
          <BlocoDeEmail
            mensagem={m}
            corpo={corpoDe(m)}
            aberto={estaAberto(m.id)}
            recolhivel={varias}
            destacar={varias && m.id === email.id}
            cortarHistorico={varias}
            onAlternar={() => setEscolhas((antes) => ({ ...antes, [m.id]: !estaAberto(m.id) }))}
            onTentarDeNovo={() => tentarDeNovo(m.id)}
          />
        </div>
      ))}

      {carregando && (
        <div
          className="flex items-center gap-3 rounded-xl border border-border/50 px-4 py-3"
          aria-label="Carregando as outras mensagens da conversa"
        >
          <div className="h-9 w-9 animate-pulse rounded-full bg-muted" />
          <div className="flex-1 space-y-2">
            <div className="h-3 w-1/3 animate-pulse rounded bg-muted" />
            <div className="h-3 w-2/3 animate-pulse rounded bg-muted" />
          </div>
        </div>
      )}

      {erro && !carregando && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <span>Não deu para carregar o resto da conversa.</span>
          <Button size="sm" variant="outline" onClick={recarregar}>
            Tentar de novo
          </Button>
        </div>
      )}
    </div>
  )
}
