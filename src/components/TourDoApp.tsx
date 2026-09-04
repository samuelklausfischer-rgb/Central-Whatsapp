import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Button } from '@/components/ui/button'
import { X } from 'lucide-react'

/**
 * Exportada porque o aviso de novidades precisa saber se o tour ainda está
 * pendente para ceder a vez. Repetir a string nos dois arquivos faria uma
 * mudança aqui virar um bug silencioso lá.
 */
export const CHAVE_TOUR_VISTO = 'central-whats:tour-visto'

/** O tour já foi visto por esta pessoa neste navegador? */
export function tourJaFoiVisto(): boolean {
  try {
    return localStorage.getItem(CHAVE_TOUR_VISTO) === '1'
  } catch {
    // Sem armazenamento não dá para saber, e o tour tambem nao roda — tratar
    // como "já visto" evita segurar o aviso de novidades para sempre.
    return true
  }
}
const EVENTO_INICIAR = 'prnhub:iniciar-tour'

/** Abre o tour de qualquer lugar, sem precisar de contexto nem prop. */
export function iniciarTour() {
  window.dispatchEvent(new CustomEvent(EVENTO_INICIAR))
}

interface PassoDoTour {
  /** Valor do `data-tour` no elemento que o passo aponta. */
  alvo: string
  titulo: string
  texto: string
  /** O "como usar" — a parte que o relato pedia junto do "onde fica". */
  comoUsar?: string
}

/**
 * ITEM 5: o roteiro.
 *
 * Aponta para `data-tour`, e não para classe ou posição, porque classe muda com
 * qualquer ajuste de estilo e posição muda entre computador e celular. Os
 * destinos usam a própria URL como valor, então o Header e a barra do celular
 * respondem pelo MESMO seletor sem o tour saber qual das duas está montada.
 *
 * Passo cujo alvo não está na tela é DESCARTADO na hora de começar. É o que faz
 * o tour respeitar permissão sem repetir nenhuma regra: quem não enxerga
 * Ferramentas simplesmente não tem o elemento, e o passo some.
 */
const PASSOS: PassoDoTour[] = [
  {
    alvo: '/dashboard',
    titulo: 'Painel',
    texto: 'A visão geral do dia: suas tarefas, anotações, aparelhos conectados e o volume de conversas.',
    comoUsar: 'É por onde o app abre. Use para saber o que está pendente antes de entrar nas conversas.',
  },
  {
    alvo: '/chat',
    titulo: 'Conversas',
    texto: 'O WhatsApp da empresa. Todas as instâncias num lugar só, com etiquetas, filtros e busca.',
    comoUsar: 'Dentro de uma conversa, segure o Ctrl e aperte F para procurar uma mensagem antiga sem rolar tudo.',
  },
  {
    alvo: '/email',
    titulo: 'Email',
    texto: 'A caixa de entrada corporativa, com a mesma cara das conversas.',
    comoUsar: 'Dá para responder e encaminhar daqui, sem abrir o Outlook.',
  },
  {
    alvo: '/agenda',
    titulo: 'Agenda',
    texto: 'Compromissos seus, do seu setor e dos grupos de que você participa.',
    comoUsar: 'Alterne entre "Só meus", "Setor", "Grupos" e "Tudo" para enxergar só o que interessa naquele momento.',
  },
  {
    alvo: 'ferramentas',
    // O botão passou a se chamar "Mais" em 04/09 (era "Ferramentas"). O título
    // do passo acompanha, senão o tour aponta para um botão com outro nome.
    titulo: 'Mais',
    texto:
      'Tarefas, anotações, atalhos de mensagem, agendamentos e os sistemas da PRN liberados para você.',
    comoUsar: 'O que aparece aqui muda por pessoa: se um sistema não está na lista, é porque ainda não foi liberado para o seu usuário.',
  },
  {
    alvo: 'conta',
    titulo: 'Sua conta',
    texto: 'Notificações, configurações, assinatura de e-mail — e este tour, para rever quando quiser.',
    comoUsar: 'É aqui que você volta a ver esta apresentação, sem precisar de ninguém.',
  },
]

const MARGEM_DO_FOCO = 8

interface Retangulo {
  top: number
  left: number
  width: number
  height: number
}

function medir(alvo: string): Retangulo | null {
  const el = document.querySelector(`[data-tour="${alvo}"]`)
  if (!el) return null
  const r = el.getBoundingClientRect()
  if (r.width === 0 && r.height === 0) return null
  return { top: r.top, left: r.left, width: r.width, height: r.height }
}

export function TourDoApp() {
  const [passos, setPassos] = useState<PassoDoTour[]>([])
  const [indice, setIndice] = useState(0)
  const [area, setArea] = useState<Retangulo | null>(null)
  const jaAvaliouRef = useRef(false)

  const comecar = useCallback(() => {
    // Descarta na hora de começar o que não está na tela: permissão, casca do
    // celular, ferramenta ainda não publicada — tudo cai aqui sem regra própria.
    const disponiveis = PASSOS.filter((p) => medir(p.alvo) !== null)
    if (disponiveis.length === 0) return
    setPassos(disponiveis)
    setIndice(0)
  }, [])

  // Primeira vez de cada pessoa. Um `requestAnimationFrame` duplo dá tempo de o
  // Header e a barra do celular montarem — sem isso todos os alvos ainda não
  // existem e o tour se descartaria inteiro.
  useEffect(() => {
    if (jaAvaliouRef.current) return
    jaAvaliouRef.current = true
    let visto = true
    try {
      visto = localStorage.getItem(CHAVE_TOUR_VISTO) === '1'
    } catch {
      return
    }
    if (visto) return
    const id = requestAnimationFrame(() => requestAnimationFrame(comecar))
    return () => cancelAnimationFrame(id)
  }, [comecar])

  useEffect(() => {
    const abrir = () => comecar()
    window.addEventListener(EVENTO_INICIAR, abrir)
    return () => window.removeEventListener(EVENTO_INICIAR, abrir)
  }, [comecar])

  const passoAtual = passos[indice]

  // Mede o alvo do passo atual, e remede quando a janela mexe. `useLayoutEffect`
  // para o recorte já nascer no lugar certo, sem um quadro de buraco deslocado.
  useLayoutEffect(() => {
    if (!passoAtual) {
      setArea(null)
      return
    }
    const atualizar = () => setArea(medir(passoAtual.alvo))
    atualizar()
    window.addEventListener('resize', atualizar)
    window.addEventListener('scroll', atualizar, true)
    return () => {
      window.removeEventListener('resize', atualizar)
      window.removeEventListener('scroll', atualizar, true)
    }
  }, [passoAtual])

  const encerrar = useCallback(() => {
    setPassos([])
    setIndice(0)
    try {
      localStorage.setItem(CHAVE_TOUR_VISTO, '1')
    } catch {
      /* sem armazenamento: o tour volta na próxima, e tudo bem */
    }
  }, [])

  // Esc fecha, como em todo o resto do app.
  useEffect(() => {
    if (!passoAtual) return
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === 'Escape') encerrar()
    }
    window.addEventListener('keydown', aoTeclar)
    return () => window.removeEventListener('keydown', aoTeclar)
  }, [passoAtual, encerrar])

  if (!passoAtual || !area) return null

  const ultimo = indice === passos.length - 1
  const foco = {
    top: area.top - MARGEM_DO_FOCO,
    left: area.left - MARGEM_DO_FOCO,
    width: area.width + MARGEM_DO_FOCO * 2,
    height: area.height + MARGEM_DO_FOCO * 2,
  }

  // O cartão vai abaixo do alvo, salvo quando não couber — aí sobe. Largura fixa
  // e presa às bordas para não vazar da tela em alvo de canto.
  const abaixo = foco.top + foco.height + 12
  const cabeAbaixo = abaixo + 210 < window.innerHeight
  const largura = Math.min(340, window.innerWidth - 24)
  const esquerda = Math.max(
    12,
    Math.min(window.innerWidth - largura - 12, foco.left + foco.width / 2 - largura / 2),
  )

  return createPortal(
    <div className="fixed inset-0 z-[300]" role="dialog" aria-label={`Tour: ${passoAtual.titulo}`}>
      {/*
        O recorte é UM elemento com sombra gigante: `box-shadow` de 9999px
        escurece tudo em volta e deixa o alvo limpo, sem precisar de quatro
        divs para formar a moldura. `pointer-events-none` porque o overlay não
        deve capturar clique — quem fecha são os botões do cartão.
      */}
      <div
        className="pointer-events-none absolute rounded-xl ring-2 ring-primary/70 transition-all duration-300"
        style={{
          top: foco.top,
          left: foco.left,
          width: foco.width,
          height: foco.height,
          boxShadow: '0 0 0 9999px rgba(0,0,0,0.65)',
        }}
      />

      <div
        className="absolute rounded-xl border border-border bg-popover p-4 shadow-xl backdrop-blur-xl"
        style={{
          width: largura,
          left: esquerda,
          top: cabeAbaixo ? abaixo : undefined,
          bottom: cabeAbaixo ? undefined : window.innerHeight - foco.top + 12,
        }}
      >
        <div className="mb-1 flex items-start justify-between gap-2">
          <p className="text-sm font-semibold text-foreground">{passoAtual.titulo}</p>
          <button
            type="button"
            onClick={encerrar}
            aria-label="Fechar o tour"
            className="-mr-1 -mt-1 rounded-full p-1 text-muted-foreground transition-colors hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <p className="text-sm leading-relaxed text-muted-foreground">{passoAtual.texto}</p>

        {passoAtual.comoUsar && (
          <p className="mt-2 rounded-lg bg-accent/50 p-2 text-[13px] leading-relaxed text-muted-foreground">
            {passoAtual.comoUsar}
          </p>
        )}

        <div className="mt-3 flex items-center justify-between gap-2">
          <span className="text-xs tabular-nums text-muted-foreground">
            {indice + 1} de {passos.length}
          </span>
          <div className="flex items-center gap-2">
            {indice > 0 && (
              <Button variant="ghost" size="sm" onClick={() => setIndice((i) => i - 1)}>
                Voltar
              </Button>
            )}
            <Button size="sm" onClick={() => (ultimo ? encerrar() : setIndice((i) => i + 1))}>
              {ultimo ? 'Entendi' : 'Próximo'}
            </Button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
