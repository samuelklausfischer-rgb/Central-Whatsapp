interface BotaoDoWhatsapp {
  label: string
  url: string | null
}

interface Props {
  body: string
  footer?: string | null
  buttons: BotaoDoWhatsapp[]
}

/**
 * Balão de "botões" do WhatsApp (buttonsMessage/templateMessage) no chat.
 *
 * Modelado em cima de `ListMessageBubble`: mesmo cartão, mesma paleta. A
 * diferença é que aqui os botões vieram PRONTOS do aparelho de quem mandou —
 * não são uma ação do nosso app, e por isso não têm o mesmo tratamento de um
 * botão nosso.
 *
 * Só o botão COM `url` vira link de verdade (abre em nova aba, como qualquer
 * link do balão de texto). Sem `url` é rótulo puro — o WhatsApp tem botões de
 * resposta rápida que só fazem sentido dentro do próprio aplicativo dele, e
 * aqui não há como responder por eles. Por isso ele PARECE inerte de propósito:
 * sem cursor de mão, sem hover de botão. Fingir que é clicável seria pior do
 * que deixar claro que não é.
 */
export function ButtonsMessageBubble({ body, footer, buttons }: Props) {
  return (
    <div className="w-full max-w-[280px] overflow-hidden rounded-xl border border-chat-border bg-chat-panel/60">
      {(body || footer) && (
        <div className="p-3">
          {body && (
            <p className="whitespace-pre-wrap text-sm text-chat-text">{body}</p>
          )}
          {footer && (
            <p className="mt-1 text-xs text-chat-muted">{footer}</p>
          )}
        </div>
      )}
      {buttons.length > 0 && (
        <div className="flex flex-col divide-y divide-chat-border border-t border-chat-border">
          {buttons.map((botao, idx) =>
            botao.url ? (
              <a
                key={idx}
                href={botao.url}
                target="_blank"
                rel="noopener noreferrer"
                className="px-3 py-2 text-center text-sm font-medium text-blue-400 transition-colors hover:bg-chat-hover"
              >
                {botao.label}
              </a>
            ) : (
              // Sem `url`: só rótulo. Nada de `hover:` nem `cursor-pointer` —
              // é o que faz este item PARECER, e não só ser, não clicável.
              <div
                key={idx}
                className="cursor-default select-text px-3 py-2 text-center text-sm font-medium text-chat-muted"
              >
                {botao.label}
              </div>
            ),
          )}
        </div>
      )}
    </div>
  )
}
