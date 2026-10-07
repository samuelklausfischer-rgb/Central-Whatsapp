import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { File as IconeArquivo, Image as IconeImagem, Mic, Paperclip, Send, Smile, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useGravadorDeAudio } from '@/components/chat-interno/hooks'
import { useToast } from '@/hooks/use-toast'
import { TOP_EMOJIS, getEmojiImageUrl } from '@/lib/emojis'
import { minutosESegundos } from '@/lib/chat-interno'
import { formatFileSize } from '@/lib/file-size'
import type { DadosDoEnvio } from '@/lib/supabase/chat-interno-types'
import { cn } from '@/lib/utils'
import { TAMANHO_MAXIMO_DO_ANEXO } from '@/services/chat_interno'
// Rascunho por conversa: trocar de conversa e voltar não apaga o que estava sendo
// digitado. O mapa mora na store (e não aqui) para o logout poder zerá-lo.
import { rascunhosDoChatInterno as rascunhos } from '@/stores/chatInterno'

const MAXIMO_DE_ARQUIVOS_POR_VEZ = 10
const LINHAS_MAXIMAS = 5

interface AnexoEscolhido {
  chave: string
  arquivo: File
  /** `blob:` da miniatura, só para imagens. */
  previa?: string
}

export interface PropsDoComposer {
  conversaId: string
  /** Motivo de não poder escrever aqui (ex.: a outra pessoa foi desativada). */
  bloqueioMotivo?: string | null
  respondendo: { id: string; autor: string; texto: string } | null
  aoCancelarResposta: () => void
  /** Cria o balão na hora e envia; os erros aparecem no próprio balão ("Tentar de novo"). */
  aoEnviar: (dados: DadosDoEnvio) => void
  /** O foco volta para o campo quando isto muda (abrir conversa, escolher "responder"). */
  focoNaChave: string
  /** Celular: o texto-guia cabe em uma linha só (o campo é estreito e a quebra deixaria o compositor alto). */
  compacto?: boolean
}

/**
 * Compositor do Chat interno: texto (Enter envia, Shift+Enter quebra linha),
 * emoji, anexos (foto e arquivo, vários de uma vez) e áudio gravado.
 *
 * Limpa SÍNCRONO ao enviar e nunca devolve o texto se o envio falhar: a falha
 * vira um balão vermelho com "Tentar de novo" (mesmo `client_id`). Devolver o
 * texto ao campo duplicaria a mensagem quando o reenvio é automático, e limpar só
 * depois do `await` deixava o campo "travado" por 1-3 s — os dois já aconteceram
 * no compositor do WhatsApp.
 */
export function ComposerInterno({ conversaId, bloqueioMotivo, respondendo, aoCancelarResposta, aoEnviar, focoNaChave, compacto }: PropsDoComposer) {
  const { toast } = useToast()
  const [texto, setTexto] = useState(() => rascunhos.get(conversaId) ?? '')
  const [anexos, setAnexos] = useState<AnexoEscolhido[]>([])
  const [emojiAberto, setEmojiAberto] = useState(false)
  const campoRef = useRef<HTMLTextAreaElement>(null)
  const entradaDeFotoRef = useRef<HTMLInputElement>(null)
  const entradaDeArquivoRef = useRef<HTMLInputElement>(null)
  const anexosRef = useRef(anexos)
  anexosRef.current = anexos
  const gravador = useGravadorDeAudio()

  // Guarda o rascunho a cada tecla; vazio apaga a entrada.
  useEffect(() => {
    if (texto) rascunhos.set(conversaId, texto)
    else rascunhos.delete(conversaId)
  }, [conversaId, texto])

  // Miniaturas são `blob:` — soltar ao sair, senão ficam na memória.
  useEffect(
    () => () => {
      anexosRef.current.forEach((a) => a.previa && URL.revokeObjectURL(a.previa))
    },
    [],
  )

  useEffect(() => {
    campoRef.current?.focus()
  }, [focoNaChave])

  // Cresce com o texto até `LINHAS_MAXIMAS` e então rola dentro do campo.
  useLayoutEffect(() => {
    const el = campoRef.current
    if (!el) return
    el.style.height = 'auto'
    const linha = 20
    el.style.height = `${Math.min(el.scrollHeight, linha * LINHAS_MAXIMAS + 24)}px`
  }, [texto, gravador.gravando])

  const adicionarArquivos = useCallback(
    (lista: File[]) => {
      if (lista.length === 0) return
      const aceitos: AnexoEscolhido[] = []
      for (const arquivo of lista) {
        if (arquivo.size === 0) {
          toast({ title: `"${arquivo.name}" está vazio`, variant: 'destructive' })
          continue
        }
        if (arquivo.size > TAMANHO_MAXIMO_DO_ANEXO) {
          toast({
            title: `"${arquivo.name}" passa de ${formatFileSize(TAMANHO_MAXIMO_DO_ANEXO)}`,
            description: 'Escolha um arquivo menor.',
            variant: 'destructive',
          })
          continue
        }
        aceitos.push({
          chave: crypto.randomUUID(),
          arquivo,
          previa: arquivo.type.startsWith('image/') ? URL.createObjectURL(arquivo) : undefined,
        })
      }
      if (aceitos.length === 0) return
      setAnexos((atual) => {
        const vaga = MAXIMO_DE_ARQUIVOS_POR_VEZ - atual.length
        if (aceitos.length > vaga) {
          aceitos.slice(Math.max(vaga, 0)).forEach((a) => a.previa && URL.revokeObjectURL(a.previa))
          toast({ title: `Até ${MAXIMO_DE_ARQUIVOS_POR_VEZ} arquivos por vez`, variant: 'destructive' })
        }
        return [...atual, ...aceitos.slice(0, Math.max(vaga, 0))]
      })
      campoRef.current?.focus()
    },
    [toast],
  )

  const removerAnexo = (chave: string) =>
    setAnexos((atual) => {
      atual.filter((a) => a.chave === chave).forEach((a) => a.previa && URL.revokeObjectURL(a.previa))
      return atual.filter((a) => a.chave !== chave)
    })

  const temConteudo = texto.trim().length > 0 || anexos.length > 0

  const enviar = () => {
    const conteudo = texto.trim()
    if (!conteudo && anexos.length === 0) return
    const lista = anexos
    // A resposta vale para a primeira mensagem do lote.
    const respondeA = respondendo?.id ?? null

    // Limpa ANTES de enviar — ver o comentário do componente.
    setTexto('')
    rascunhos.delete(conversaId)
    setAnexos([])
    aoCancelarResposta()

    if (lista.length === 0) {
      aoEnviar({ tipo: 'texto', conteudo, respondeA })
      return
    }
    lista.forEach((a, i) => {
      const ehImagem = a.arquivo.type.startsWith('image/')
      aoEnviar({
        tipo: ehImagem ? 'imagem' : 'arquivo',
        // A legenda vai na primeira; as demais seguem sem texto.
        conteudo: i === 0 && conteudo ? conteudo : null,
        respondeA: i === 0 ? respondeA : null,
        arquivo: a.arquivo,
        nomeDoArquivo: a.arquivo.name || (ehImagem ? 'imagem' : 'arquivo'),
        mime: a.arquivo.type || 'application/octet-stream',
        tamanho: a.arquivo.size,
      })
      // O balão do envio guarda a própria prévia; a miniatura do tray já cumpriu o papel.
      if (a.previa) URL.revokeObjectURL(a.previa)
    })
  }

  const inserirEmoji = (emoji: string) => {
    const el = campoRef.current
    if (!el) {
      setTexto((t) => t + emoji)
      return
    }
    const inicio = el.selectionStart ?? texto.length
    const fim = el.selectionEnd ?? texto.length
    const proximo = texto.slice(0, inicio) + emoji + texto.slice(fim)
    setTexto(proximo)
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(inicio + emoji.length, inicio + emoji.length)
    })
  }

  const comecarGravacao = async () => {
    const erro = await gravador.iniciar()
    if (erro) toast({ title: erro, variant: 'destructive' })
  }

  const enviarGravacao = async () => {
    const resultado = await gravador.parar()
    if (!resultado) return
    if (resultado.erro || !resultado.audio) {
      toast({ title: resultado.erro ?? 'Não foi possível gravar o áudio', variant: 'destructive' })
      return
    }
    const { blob, mime, extensao, duracaoSeg } = resultado.audio
    const respondeA = respondendo?.id ?? null
    aoCancelarResposta()
    aoEnviar({
      tipo: 'audio',
      conteudo: null,
      respondeA,
      arquivo: blob,
      nomeDoArquivo: `audio-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.${extensao}`,
      mime,
      tamanho: blob.size,
      duracaoSeg,
    })
  }

  if (bloqueioMotivo) {
    return (
      <div className="relative z-10 flex flex-shrink-0 items-center justify-center border-t border-chat-border bg-chat-composer px-4 py-4 shadow-chat">
        <p className="text-center text-sm text-chat-muted">{bloqueioMotivo}</p>
      </div>
    )
  }

  return (
    <div className="relative z-10 flex flex-shrink-0 flex-col border-t border-chat-border bg-chat-composer px-4 py-3 shadow-chat">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-2.5">
        {respondendo && (
          <div className="flex items-start gap-2 rounded-xl border border-chat-border bg-chat-panel py-2 pl-3 pr-2">
            <div className="min-w-0 flex-1 border-l-4 border-emerald-600/70 pl-2">
              <p className="truncate text-[12.5px] font-medium text-emerald-700 dark:text-emerald-400">{respondendo.autor}</p>
              <p className="truncate text-[13px] text-chat-muted">{respondendo.texto}</p>
            </div>
            <button
              type="button"
              onClick={aoCancelarResposta}
              aria-label="Cancelar resposta"
              title="Cancelar resposta"
              className="rounded-full p-1 text-chat-muted transition-colors hover:bg-chat-hover hover:text-chat-text"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {anexos.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-chat-border bg-chat-panel px-3 py-2">
            {anexos.map((a) =>
              a.previa ? (
                <div key={a.chave} className="group relative">
                  <img src={a.previa} alt={a.arquivo.name} className="h-16 w-16 rounded-lg border border-chat-border object-cover" />
                  <button
                    type="button"
                    onClick={() => removerAnexo(a.chave)}
                    aria-label={`Tirar ${a.arquivo.name}`}
                    className="absolute -right-1.5 -top-1.5 rounded-full bg-chat-panel p-0.5 text-chat-muted shadow ring-1 ring-chat-border transition-colors hover:text-red-400"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ) : (
                <div key={a.chave} className="flex items-center gap-2 rounded-md bg-chat-hover px-2.5 py-1.5 text-xs text-chat-text">
                  <IconeArquivo className="h-3.5 w-3.5 opacity-70" />
                  <span className="max-w-[160px] truncate">{a.arquivo.name}</span>
                  <span className="text-chat-muted">{formatFileSize(a.arquivo.size)}</span>
                  <button
                    type="button"
                    onClick={() => removerAnexo(a.chave)}
                    aria-label={`Tirar ${a.arquivo.name}`}
                    className="text-chat-muted transition-colors hover:text-red-400"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ),
            )}
          </div>
        )}

        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            enviar()
          }}
        >
          <input
            ref={entradaDeFotoRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => {
              adicionarArquivos(Array.from(e.target.files ?? []))
              e.target.value = ''
            }}
          />
          <input
            ref={entradaDeArquivoRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              adicionarArquivos(Array.from(e.target.files ?? []))
              e.target.value = ''
            }}
          />

          {gravador.gravando ? (
            <div className="flex min-h-[48px] flex-1 items-center gap-3 overflow-hidden rounded-2xl border border-chat-border bg-chat-panel px-4">
              <span className="h-2.5 w-2.5 flex-shrink-0 animate-pulse rounded-full bg-red-500" aria-hidden />
              <span className="font-mono text-sm tabular-nums text-foreground/80" aria-live="off">
                {minutosESegundos(gravador.segundos)}
              </span>
              <span className="flex-1 text-sm text-chat-muted">Gravando...</span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                title="Descartar gravação"
                aria-label="Descartar gravação"
                onClick={gravador.cancelar}
                className="h-8 w-8 rounded-full text-chat-muted hover:bg-red-500/10 hover:text-red-400"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
              <Button
                type="button"
                size="icon"
                title="Enviar áudio"
                aria-label="Enviar áudio"
                onClick={() => void enviarGravacao()}
                className="h-9 w-9 rounded-full"
              >
                <Send className="h-4 w-4" />
              </Button>
            </div>
          ) : (
            <>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    title="Anexar"
                    aria-label="Anexar"
                    className="h-11 w-11 flex-shrink-0 text-chat-muted transition-all duration-300 hover:scale-110 hover:bg-transparent hover:text-chat-text active:scale-95"
                  >
                    <Paperclip className="h-5 w-5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" side="top" className="w-44 border-chat-border bg-chat-panel text-chat-text">
                  <DropdownMenuItem className="cursor-pointer" onSelect={() => entradaDeFotoRef.current?.click()}>
                    <IconeImagem className="mr-2 h-4 w-4 text-sky-500" /> Foto
                  </DropdownMenuItem>
                  <DropdownMenuItem className="cursor-pointer" onSelect={() => entradaDeArquivoRef.current?.click()}>
                    <IconeArquivo className="mr-2 h-4 w-4 text-violet-500" /> Arquivo
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              <div className="flex min-w-0 flex-1 items-end rounded-2xl border border-chat-border bg-chat-panel">
                <textarea
                  ref={campoRef}
                  value={texto}
                  rows={1}
                  maxLength={10000}
                  placeholder={compacto ? 'Mensagem' : 'Digite uma mensagem...'}
                  aria-label="Mensagem"
                  onChange={(e) => setTexto(e.target.value)}
                  onKeyDown={(e) => {
                    // Esc com uma resposta em andamento cancela a RESPOSTA — e só isso: o
                    // `preventDefault` impede o `ChatHub` de tratar o mesmo Esc como "sair da conversa".
                    if (e.key === 'Escape' && respondendo) {
                      e.preventDefault()
                      aoCancelarResposta()
                      return
                    }
                    // `isComposing`: Enter que fecha a composição de teclado (IME) não envia.
                    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                      e.preventDefault()
                      enviar()
                    }
                  }}
                  onPaste={(e) => {
                    const imagens = Array.from(e.clipboardData?.items ?? [])
                      .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
                      .map((item) => item.getAsFile())
                      .filter((f): f is File => !!f)
                    if (imagens.length === 0) return
                    e.preventDefault()
                    adicionarArquivos(imagens)
                  }}
                  className="custom-scrollbar min-h-[44px] flex-1 resize-none border-none bg-transparent px-4 py-3 text-[15px] leading-5 text-chat-text transition-[height] duration-150 ease-out placeholder:text-chat-muted focus-visible:outline-none"
                />
                <Popover open={emojiAberto} onOpenChange={setEmojiAberto}>
                  <PopoverTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      title="Emojis"
                      aria-label="Emojis"
                      className="h-11 w-11 flex-shrink-0 text-chat-muted transition-all duration-300 hover:scale-110 hover:bg-transparent hover:text-chat-text active:scale-95"
                    >
                      <Smile className="h-5 w-5" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent align="end" side="top" className="w-72 border-chat-border bg-chat-panel p-2">
                    <div className="grid grid-cols-8 gap-0.5">
                      {TOP_EMOJIS.map((emoji, idx) => (
                        <button
                          key={`${emoji}-${idx}`}
                          type="button"
                          onClick={() => inserirEmoji(emoji)}
                          title={emoji}
                          className="flex h-8 w-8 items-center justify-center rounded-lg transition-colors hover:bg-chat-hover"
                        >
                          <img
                            src={getEmojiImageUrl(emoji)}
                            alt={emoji}
                            draggable={false}
                            className="pointer-events-none h-5 w-5"
                            onError={(e) => {
                              const span = document.createElement('span')
                              span.textContent = emoji
                              span.className = 'text-xl leading-none'
                              e.currentTarget.replaceWith(span)
                            }}
                          />
                        </button>
                      ))}
                    </div>
                  </PopoverContent>
                </Popover>
              </div>

              {temConteudo ? (
                <Button type="submit" size="icon" title="Enviar" aria-label="Enviar" className="h-11 w-11 flex-shrink-0 rounded-full">
                  <Send className="h-5 w-5" />
                </Button>
              ) : (
                <Button
                  type="button"
                  size="icon"
                  title="Gravar áudio"
                  aria-label="Gravar áudio"
                  onClick={() => void comecarGravacao()}
                  className={cn('h-11 w-11 flex-shrink-0 rounded-full')}
                >
                  <Mic className="h-5 w-5" />
                </Button>
              )}
            </>
          )}
        </form>
      </div>
    </div>
  )
}
