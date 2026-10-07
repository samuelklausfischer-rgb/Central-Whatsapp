import { memo } from 'react'
import { BrandLogo } from '@/components/BrandLogo'
import { ChatInternoList } from '@/components/chat-interno/ChatInternoList'
import { ChatInternoWindow } from '@/components/chat-interno/ChatInternoWindow'

/** Painel da direita quando nenhuma conversa está aberta (só no desktop — no celular a lista ocupa a tela). */
function PainelVazio() {
  return (
    <div className="relative hidden h-full flex-1 flex-col items-center justify-center overflow-hidden bg-chat-conversation/80 backdrop-blur-sm md:flex">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(59,130,246,0.04),transparent_70%)]" />
      <div className="relative z-10 flex max-w-sm flex-col items-center px-8 text-center">
        <BrandLogo className="mb-8 h-20 w-auto object-contain drop-shadow-lg" />
        <p className="text-[15px] leading-relaxed text-chat-text/70">
          Selecione uma conversa ou comece uma nova com alguém da equipe.
        </p>
      </div>
    </div>
  )
}

export interface PropsDosPaineis {
  isMobile: boolean
  /** Largura da coluna da lista no desktop (a mesma do WhatsApp, redimensionável). */
  larguraDaLista: number
  aoArrastarDivisoria: (e: React.PointerEvent) => void
  devices: any[]
  onSelectDevice: (deviceId: string) => void
  conversaId: string | null
  onSelecionar: (conversaId: string) => void
  onFecharConversa: () => void
}

/**
 * As duas colunas do Chat interno (lista + janela), no mesmo molde do `ChatHub`:
 * no celular uma ou outra, no desktop lado a lado com a divisória arrastável.
 *
 * Isto é um módulo à parte, carregado sob demanda (`lazy`) pelo `ChatHub`: quem só
 * usa o WhatsApp não baixa nem executa uma linha do Chat interno.
 */
function ChatInternoPaineis({
  isMobile,
  larguraDaLista,
  aoArrastarDivisoria,
  devices,
  onSelectDevice,
  conversaId,
  onSelecionar,
  onFecharConversa,
}: PropsDosPaineis) {
  return (
    <>
      {(!isMobile || !conversaId) &&
        (isMobile ? (
          <ChatInternoList
            devices={devices}
            onSelectDevice={onSelectDevice}
            conversaId={conversaId}
            onSelecionar={onSelecionar}
            isMobile
          />
        ) : (
          <div className="relative flex h-full flex-shrink-0 flex-col border-r border-chat-border bg-chat-sidebar" style={{ width: larguraDaLista }}>
            <ChatInternoList
              devices={devices}
              onSelectDevice={onSelectDevice}
              conversaId={conversaId}
              onSelecionar={onSelecionar}
              isMobile={false}
            />
            <div
              className="absolute -right-[6px] bottom-0 top-0 z-10 flex w-[14px] cursor-col-resize items-center justify-center"
              onPointerDown={aoArrastarDivisoria}
            >
              <div className="mx-auto h-3/5 w-1 rounded-full transition-colors hover:bg-blue-400/40 active:bg-blue-500/50" />
            </div>
          </div>
        ))}
      {(!isMobile || conversaId) &&
        (conversaId ? (
          // `key`: cada conversa nasce com estado limpo (rolagem, resposta, diálogos).
          <ChatInternoWindow key={conversaId} conversaId={conversaId} onFechar={onFecharConversa} isMobile={isMobile} />
        ) : (
          <PainelVazio />
        ))}
    </>
  )
}

export default memo(ChatInternoPaineis)
