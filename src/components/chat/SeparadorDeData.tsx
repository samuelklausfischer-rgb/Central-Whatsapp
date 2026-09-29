/**
 * Separador de dia da conversa (a "pílula" do WhatsApp). Um componente só
 * porque o balão normal e a mensagem fixada precisam do mesmo visual.
 */
export function SeparadorDeData({ rotulo }: { rotulo: string }) {
  return (
    <div className="mt-3 flex justify-center">
      <span className="rounded-[7.5px] bg-chat-bubble-in px-3 pb-1.5 pt-[5px] text-[12.5px] text-chat-muted shadow-chat-bubble">
        {rotulo}
      </span>
    </div>
  )
}
