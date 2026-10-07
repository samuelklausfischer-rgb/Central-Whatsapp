import { memo, useRef, useState, type ReactNode } from 'react'
import { AlertCircle, Ban, Check, ChevronDown, Clock, Copy, Download, File, Loader2, Reply, Trash2 } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { AudioMessage } from '@/components/chat/AudioMessage'
import { ChatImage } from '@/components/chat/ChatImage'
import { RabinhoDaBolha } from '@/components/chat/RabinhoDaBolha'
import { TextoComLerMais } from '@/components/chat/TextoComLerMais'
import { AvatarInterno } from '@/components/chat-interno/AvatarInterno'
import { corDoAutor, horaDoBalao, siglaDoArquivo } from '@/lib/chat-interno'
import { formatFileSize } from '@/lib/file-size'
import type { MensagemInterna, MensagemPendente } from '@/lib/supabase/chat-interno-types'
import { cn } from '@/lib/utils'

/** O que o balão mostra da mensagem citada (resposta). */
export interface CitacaoVisual {
  autor: string
  texto: string
  /** Mensagem encontrada e já na tela: o clique rola até ela. */
  navegavel: boolean
  icone?: ReactNode
}

export interface PropsDoBalao {
  msg: MensagemInterna | MensagemPendente
  minha: boolean
  inicioDeSequencia: boolean
  ehGrupo: boolean
  nomeDoAutor?: string
  avatarDoAutor?: string | null
  citacao?: CitacaoVisual | null
  /** URL assinada do anexo (ou prévia local `blob:` de um envio em andamento). */
  urlDoAnexo?: string
  destacada?: boolean
  aoResponder: (msg: MensagemInterna) => void
  aoApagar: (msg: MensagemInterna) => void
  aoReenviar: (msg: MensagemPendente) => void
  aoDescartar: (msg: MensagemPendente) => void
  aoAbrirImagem: (msg: MensagemInterna) => void
  aoBaixar: (msg: MensagemInterna) => void
  aoIrParaCitada: (id: string) => void
  /** Devolve o foco ao campo de texto (depois de "Responder", quando o menu já fechou). */
  aoFocarCampo: () => void
}

const REGEX_DE_LINK = /(https?:\/\/[^\s<>]+)/g

/**
 * Texto com links clicáveis. Só `http(s)` — `javascript:` e afins nunca viram
 * `<a>`. A pontuação colada no fim ("veja https://x.com.") fica FORA do link.
 */
function TextoComLinks({ texto }: { texto: string }) {
  const partes = texto.split(REGEX_DE_LINK)
  return (
    <>
      {partes.map((parte, i) => {
        if (i % 2 === 0) return parte
        const m = /[.,;:!?)\]]+$/.exec(parte)
        const url = m ? parte.slice(0, parte.length - m[0].length) : parte
        const resto = m ? m[0] : ''
        return (
          <span key={i}>
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="break-all text-sky-600 underline decoration-sky-600/40 hover:decoration-sky-600 dark:text-sky-400"
            >
              {url}
            </a>
            {resto}
          </span>
        )
      })}
    </>
  )
}

function CartaoDeArquivo({
  msg,
  aoBaixar,
}: {
  msg: MensagemInterna
  aoBaixar: (msg: MensagemInterna) => void
}) {
  const nome = msg.anexo_nome ?? 'arquivo'
  const sigla = siglaDoArquivo(nome)
  const meta = [sigla, msg.anexo_tamanho ? formatFileSize(msg.anexo_tamanho) : null].filter(Boolean).join(' • ')
  return (
    <button
      type="button"
      onClick={() => aoBaixar(msg)}
      className="block w-[300px] max-w-full overflow-hidden rounded-[6px] bg-black/[0.04] text-left transition-opacity hover:opacity-90 dark:bg-white/[0.05]"
      title={`Baixar ${nome}`}
    >
      <span className="flex items-center gap-2.5 p-2.5">
        <span className="relative flex h-8 w-8 flex-shrink-0 items-center justify-center text-chat-muted">
          <File className="h-8 w-8" strokeWidth={1.5} />
          <span className="absolute bottom-[5px] text-[8px] font-bold leading-none">{sigla}</span>
        </span>
        <span className="min-w-0 flex-1">
          <span className="line-clamp-2 break-all text-[14.2px] leading-[19px] text-chat-text">{nome}</span>
          <span className="block truncate text-[12px] text-chat-muted">{meta}</span>
        </span>
        <Download className="h-[22px] w-[22px] flex-shrink-0 text-chat-muted" aria-hidden />
      </span>
    </button>
  )
}

/**
 * Um balão do Chat interno. Memoizado: a lista re-renderiza a cada mensagem que
 * chega, e só o balão que mudou precisa redesenhar — por isso os callbacks vêm
 * estáveis de quem usa e nada aqui depende de estado de fora.
 *
 * O visual é o do `ChatWindow` (cores `chat-bubble-*`, rabinho, "Ler mais",
 * horário no canto) — sem reaproveitar o balão dele, que é todo feito para
 * mensagem de WhatsApp.
 */
export const BalaoInterno = memo(function BalaoInterno({
  msg,
  minha,
  inicioDeSequencia,
  ehGrupo,
  nomeDoAutor,
  avatarDoAutor,
  citacao,
  urlDoAnexo,
  destacada,
  aoResponder,
  aoApagar,
  aoReenviar,
  aoDescartar,
  aoAbrirImagem,
  aoBaixar,
  aoIrParaCitada,
  aoFocarCampo,
}: PropsDoBalao) {
  const [menuAberto, setMenuAberto] = useState(false)
  const respondeuRef = useRef(false)
  const pendente = 'situacao' in msg ? (msg as MensagemPendente) : null
  const apagada = !!msg.apagada_em

  // Mensagem de sistema: pílula centralizada, sem autor nem menu.
  if (msg.tipo === 'sistema') {
    return (
      <div id={`msg-${msg.id}`} className="mt-3 flex justify-center px-2">
        <span className="max-w-[88%] rounded-[7.5px] bg-chat-bubble-in px-3 py-1 text-center text-[12.5px] leading-[17px] text-chat-muted shadow-chat-bubble">
          {msg.conteudo}
        </span>
      </div>
    )
  }

  const temLegenda = !!msg.conteudo?.trim()
  const imagemSemLegenda = !apagada && msg.tipo === 'imagem' && !temLegenda
  const audioSemLegenda = !apagada && msg.tipo === 'audio' && !temLegenda
  const arquivoSemLegenda = !apagada && msg.tipo === 'arquivo' && !temLegenda
  const corDoRodape = imagemSemLegenda ? 'text-white' : 'text-chat-muted'

  const rodape = (
    <span className={cn('inline-flex items-center gap-1 text-[11px] leading-none', corDoRodape)}>
      {pendente?.situacao === 'falhou' ? (
        <AlertCircle className="h-3 w-3 text-red-400" aria-label="Não enviada" />
      ) : pendente ? (
        <Clock className="h-3 w-3 shrink-0" aria-label="Enviando" />
      ) : null}
      <span className="tabular-nums">{horaDoBalao(msg.criado_em)}</span>
      {minha && !pendente && !apagada && <Check className="h-3.5 w-3.5 shrink-0" aria-label="Enviada" />}
    </span>
  )

  const mensagemReal = !pendente ? (msg as MensagemInterna) : null
  const podeAgir = !apagada && !pendente
  const podeCopiar = podeAgir && temLegenda
  const podeApagar = podeAgir && minha

  const anexoPronto = !!urlDoAnexo
  const nomeDoArquivo = msg.anexo_nome ?? 'arquivo'

  return (
    <div id={`msg-${msg.id}`} className={cn('flex flex-col', minha ? 'items-end' : 'items-start', inicioDeSequencia ? 'mt-3' : 'mt-0.5')}>
      <div className={cn('flex w-full items-end gap-2.5', minha ? 'justify-end' : 'justify-start')}>
        {!minha && ehGrupo &&
          (inicioDeSequencia ? (
            <AvatarInterno
              nome={nomeDoAutor}
              url={avatarDoAutor}
              className="mb-1 hidden h-7 w-7 flex-shrink-0 shadow-sm sm:flex"
              fallbackClassName="text-[10px]"
            />
          ) : (
            <div className="mb-1 hidden h-7 w-7 flex-shrink-0 sm:block" />
          ))}

        <div
          className={cn(
            'group relative max-w-[88%] rounded-[7.5px] text-chat-text shadow-chat-bubble transition-all duration-150 sm:max-w-[65%]',
            imagemSemLegenda ? 'p-[3px]' : audioSemLegenda ? 'px-1.5 pb-1 pt-1.5' : arquivoSemLegenda ? 'p-[3px] pb-1' : 'pb-2 pl-[9px] pr-[7px] pt-1.5',
            minha ? 'bg-chat-bubble-out' : 'bg-chat-bubble-in',
            inicioDeSequencia && (minha ? 'rounded-tr-none' : 'rounded-tl-none'),
            pendente?.situacao === 'falhou' && 'ring-1 ring-red-500/50',
            destacada && 'ring-2 ring-primary/70',
          )}
        >
          {inicioDeSequencia && (
            <RabinhoDaBolha lado={minha ? 'direita' : 'esquerda'} className={minha ? 'text-chat-bubble-out' : 'text-chat-bubble-in'} />
          )}

          {(podeAgir || podeCopiar) && (
            <DropdownMenu open={menuAberto} onOpenChange={setMenuAberto}>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label="Opções da mensagem"
                  onClick={(e) => e.stopPropagation()}
                  className={cn(
                    // Degradê da cor do próprio balão: a setinha fica legível sem
                    // tampar o texto com um bloco sólido — o truque do WhatsApp.
                    'absolute right-0.5 top-0.5 z-10 flex h-4 w-8 items-start justify-end rounded-tr-[7.5px] pr-1 transition-opacity duration-150',
                    imagemSemLegenda
                      ? 'bg-gradient-to-bl from-black/40 to-transparent text-white'
                      : cn(
                          'text-chat-muted',
                          minha
                            ? 'bg-[linear-gradient(to_left,hsl(var(--chat-bubble-out))_55%,transparent)]'
                            : 'bg-[linear-gradient(to_left,hsl(var(--chat-bubble-in))_55%,transparent)]',
                        ),
                    menuAberto
                      ? 'opacity-100'
                      : 'pointer-events-none opacity-0 focus-visible:pointer-events-auto focus-visible:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100',
                  )}
                >
                  <ChevronDown className="-mt-0.5 h-[18px] w-[18px]" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align={minha ? 'end' : 'start'}
                className="min-w-[170px] border-chat-border bg-chat-panel text-chat-text"
                // Ao fechar, o Radix devolve o foco ao botão do menu — e quem escolheu
                // "Responder" vai digitar. Nesse caso o foco vai para o campo de texto.
                onCloseAutoFocus={(e) => {
                  if (!respondeuRef.current) return
                  respondeuRef.current = false
                  e.preventDefault()
                  aoFocarCampo()
                }}
              >
                {podeAgir && (
                  <DropdownMenuItem
                    onSelect={() => {
                      respondeuRef.current = true
                      if (mensagemReal) aoResponder(mensagemReal)
                    }}
                    className="cursor-pointer"
                  >
                    <Reply className="mr-2 h-4 w-4" /> Responder
                  </DropdownMenuItem>
                )}
                {podeCopiar && (
                  <DropdownMenuItem
                    onClick={() => void navigator.clipboard?.writeText(msg.conteudo ?? '').catch(() => {})}
                    className="cursor-pointer"
                  >
                    <Copy className="mr-2 h-4 w-4" /> Copiar texto
                  </DropdownMenuItem>
                )}
                {podeAgir && msg.anexo_path && (msg.tipo === 'arquivo' || msg.tipo === 'audio' || msg.tipo === 'imagem') && (
                  <DropdownMenuItem onClick={() => mensagemReal && aoBaixar(mensagemReal)} className="cursor-pointer">
                    <Download className="mr-2 h-4 w-4" /> Baixar
                  </DropdownMenuItem>
                )}
                {podeApagar && (
                  <>
                    <DropdownMenuSeparator className="bg-chat-border" />
                    <DropdownMenuItem
                      onClick={() => mensagemReal && aoApagar(mensagemReal)}
                      className="cursor-pointer text-red-500 focus:text-red-500"
                    >
                      <Trash2 className="mr-2 h-4 w-4" /> Apagar para todos
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          {ehGrupo && !minha && inicioDeSequencia && !!nomeDoAutor && (
            <div className={cn('mb-0.5 truncate pr-6 text-[12.8px] font-medium leading-[18px]', corDoAutor(msg.autor_id))}>{nomeDoAutor}</div>
          )}

          {citacao && !apagada && (
            <button
              type="button"
              disabled={!citacao.navegavel}
              onClick={() => msg.responde_a && aoIrParaCitada(msg.responde_a)}
              className={cn(
                'mb-1 block w-full min-w-[160px] rounded-md border-l-4 border-emerald-600/70 bg-black/[0.06] px-2 py-1 text-left dark:bg-white/[0.07]',
                citacao.navegavel ? 'cursor-pointer hover:bg-black/10 dark:hover:bg-white/10' : 'cursor-default',
              )}
            >
              <span className="block truncate text-[12.5px] font-medium text-emerald-700 dark:text-emerald-400">{citacao.autor}</span>
              <span className="flex items-center gap-1 truncate text-[12.5px] leading-[17px] text-chat-muted">
                {citacao.icone}
                <span className="truncate">{citacao.texto}</span>
              </span>
            </button>
          )}

          {apagada ? (
            <div className="relative flex items-center gap-1.5 pr-14 text-[13.5px] italic text-chat-muted/80">
              <Ban className="h-3.5 w-3.5 shrink-0" aria-hidden />
              Mensagem apagada
              <span className="absolute bottom-0 right-0 inline-flex translate-y-[3px] items-center gap-1 whitespace-nowrap leading-none">{rodape}</span>
            </div>
          ) : (
            <>
              {msg.tipo === 'imagem' && (
                anexoPronto ? (
                  <button
                    type="button"
                    onClick={() => mensagemReal && aoAbrirImagem(mensagemReal)}
                    disabled={!mensagemReal}
                    className={cn(
                      'relative block cursor-zoom-in overflow-hidden transition-opacity duration-200 hover:opacity-95 disabled:cursor-default',
                      imagemSemLegenda ? 'min-h-[120px] max-w-[330px] rounded-[6px] bg-chat-muted/10' : 'mb-1 max-w-[320px] rounded-md',
                    )}
                  >
                    <ChatImage src={urlDoAnexo!} alt={nomeDoArquivo} className="pointer-events-none h-auto w-full object-contain" />
                    {pendente?.situacao === 'enviando' && (
                      <span className="absolute inset-0 flex items-center justify-center bg-black/25">
                        <Loader2 className="h-6 w-6 animate-spin text-white" aria-label="Enviando imagem" />
                      </span>
                    )}
                  </button>
                ) : (
                  <div className={cn('h-[160px] w-[240px] max-w-full animate-pulse rounded-md bg-chat-muted/10', !imagemSemLegenda && 'mb-1')} aria-label="Carregando imagem" />
                )
              )}

              {msg.tipo === 'audio' &&
                (anexoPronto ? (
                  <AudioMessage
                    src={urlDoAnexo!}
                    isMe={minha}
                    msgId={msg.id}
                    downloadName={nomeDoArquivo}
                    rodape={audioSemLegenda ? rodape : undefined}
                  />
                ) : (
                  <div className="h-[44px] w-[300px] max-w-full animate-pulse rounded-md bg-chat-muted/10" aria-label="Carregando áudio" />
                ))}

              {msg.tipo === 'arquivo' && mensagemReal && <CartaoDeArquivo msg={mensagemReal} aoBaixar={aoBaixar} />}
              {msg.tipo === 'arquivo' && pendente && (
                <div className="flex w-[300px] max-w-full items-center gap-2.5 rounded-[6px] bg-black/[0.04] p-2.5 dark:bg-white/[0.05]">
                  <File className="h-8 w-8 flex-shrink-0 text-chat-muted" strokeWidth={1.5} />
                  <span className="min-w-0 flex-1">
                    <span className="line-clamp-2 break-all text-[14.2px] leading-[19px] text-chat-text">{nomeDoArquivo}</span>
                    <span className="block text-[12px] text-chat-muted">
                      {pendente.situacao === 'falhou' ? 'Não enviado' : 'Enviando...'}
                    </span>
                  </span>
                </div>
              )}

              {temLegenda && (
                <div className={cn('relative whitespace-pre-wrap break-words text-[14.2px] leading-[19px]', msg.tipo !== 'texto' && 'mt-1')}>
                  <TextoComLerMais
                    reserva={
                      <span aria-hidden className="invisible inline-flex items-center gap-1 whitespace-nowrap pl-2 align-bottom text-[11px]">
                        {rodape}
                      </span>
                    }
                  >
                    <TextoComLinks texto={msg.conteudo ?? ''} />
                  </TextoComLerMais>
                  <span className="absolute bottom-0 right-0 inline-flex translate-y-[3px] items-center gap-1 whitespace-nowrap leading-none">{rodape}</span>
                </div>
              )}

              {!temLegenda && !audioSemLegenda &&
                (imagemSemLegenda ? (
                  <>
                    {/* Degradê escuro no pé da foto para o horário branco ler sobre qualquer imagem. */}
                    <div className="pointer-events-none absolute inset-x-[3px] bottom-[3px] h-7 rounded-b-[6px] bg-gradient-to-t from-black/50 to-transparent" />
                    <div className="pointer-events-none absolute bottom-[7px] right-[9px] z-[1] flex items-center gap-1 whitespace-nowrap leading-none">{rodape}</div>
                  </>
                ) : (
                  <div className={cn('flex items-center justify-end gap-1', arquivoSemLegenda ? 'mt-0.5 pr-1' : 'mt-1.5')}>{rodape}</div>
                ))}
            </>
          )}
        </div>
      </div>

      {pendente?.situacao === 'falhou' && (
        <div className={cn('mt-1 flex max-w-[88%] flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] sm:max-w-[65%]', minha ? 'mr-1 justify-end' : 'ml-1')}>
          <span className="text-red-400">{pendente.erro ?? 'Não foi possível enviar.'}</span>
          <button type="button" onClick={() => aoReenviar(pendente)} className="font-medium text-red-400 underline-offset-2 hover:text-red-300 hover:underline">
            Tentar de novo
          </button>
          <button type="button" onClick={() => aoDescartar(pendente)} className="text-chat-muted underline-offset-2 hover:text-chat-text hover:underline">
            Descartar
          </button>
        </div>
      )}
    </div>
  )
})
