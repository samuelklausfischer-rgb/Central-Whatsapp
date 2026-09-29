import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  X,
  Download,
  ZoomIn,
  ZoomOut,
  Loader2,
  Star,
  ChevronLeft,
  ChevronRight,
  Play,
  FileText,
  FileSpreadsheet,
  FileArchive,
  MessageSquareText,
  Reply,
  Smile,
  Forward,
  MoreVertical,
  Info,
} from 'lucide-react'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import * as XLSX from 'xlsx'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { MenuRadialDeReacoes } from '@/components/chat/MenuRadialDeReacoes'
import { downloadFile, nomeParaDownload, type TipoArquivoDownload } from '@/lib/download'
import { baixarComoZip } from '@/lib/zip'
import { toast } from '@/hooks/use-toast'

/**
 * `'sticker'` é tratado como imagem em tudo (zoom, pan, download) — o que muda é
 * só a ação a mais de guardar na coleção. Existe como tipo próprio, e não como
 * `'image'` com uma flag, porque é o tipo que decide se o botão "Salvar
 * figurinha" aparece: uma foto de exame não vai para a bandeja de figurinhas.
 */
export type ViewerMedia = {
  url: string
  type: 'image' | 'video' | 'pdf' | 'excel' | 'sticker'
  name?: string
  /** Habilita as ações de mensagem (ir, responder, reagir, encaminhar, info). */
  messageId?: string
  /** "Você" ou o nome do contato. */
  autor?: string
  /** ISO; exibido como "dd/MM/yyyy às HH:mm". */
  enviadaEm?: string
  /** Já renderizado pelo pai (SmartAvatar). */
  avatar?: React.ReactNode
  /** 1-based; mostra "atual de total" abaixo da mídia. */
  album?: { atual: number; total: number }
  /**
   * Id do álbum a que o item pertence (id da 1ª mensagem do álbum). Itens
   * soltos ficam sem. É o que limita o "Baixar álbum (.zip)" ao álbum, e não à
   * conversa inteira que vem em `lista`.
   */
  grupoId?: string
}

/** Ações de mensagem que o pai libera no visualizador. Todas opcionais. */
export type AcoesDoVisualizador = {
  aoIrParaMensagem?: (messageId: string) => void
  aoResponder?: (messageId: string) => void
  aoReagir?: (messageId: string, emoji: string) => Promise<void> | void
  aoEncaminhar?: (messageId: string) => void
  aoVerInfo?: (messageId: string) => void
  /** Repassado ao MenuRadialDeReacoes (`{emoji: vezes}`). */
  usoDeReacoes?: Record<string, number>
}

const EXCEL_ROW_LIMIT = 500

type ExcelWorkbookPreview = {
  sheetNames: string[]
  sheets: Record<string, unknown[][]>
}

const MIN_SCALE = 1
const MAX_SCALE = 5
const STEP = 0.25

const clamp = (v: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.round(v * 100) / 100))

/** Prende um deslocamento ao intervalo [-limite, +limite]. */
const prender = (v: number, limite: number) => Math.max(-limite, Math.min(limite, v))

/**
 * Estado do transform da imagem, num objeto só.
 *
 * Zoom e deslocamento mudam JUNTOS — ampliar num ponto exige recalcular o
 * deslocamento na mesma passada. Com três estados separados era preciso chamar
 * `setTx` de dentro do updater do `setScale`, o que faz efeito colateral dentro
 * de reducer e roda duas vezes em modo estrito.
 */
type Vista = { scale: number; tx: number; ty: number }

const VISTA_INICIAL: Vista = { scale: MIN_SCALE, tx: 0, ty: 0 }

/** Mapeia o tipo do visualizador para a categoria usada no nome padrão de download. */
function tipoParaDownload(tipo: ViewerMedia['type']): TipoArquivoDownload {
  if (tipo === 'video') return 'video'
  // Figurinha junto de imagem: baixar uma figurinha com nome de "documento"
  // daria um arquivo `.webp` chamado documento-….
  if (tipo === 'image' || tipo === 'sticker') return 'imagem'
  return 'documento'
}

/** Nome do arquivo dentro do zip: o mesmo que o botão "Baixar" daria, com extensão garantida. */
function nomeNoZip(m: ViewerMedia): string {
  const nome = nomeParaDownload(m.name, tipoParaDownload(m.type))
  if (/\.[a-z0-9]{1,8}$/i.test(nome)) return nome
  // Nome genérico sem extensão: tenta a do endereço do arquivo, para o zip não
  // ficar cheio de arquivos que o sistema não sabe abrir.
  try {
    const ext = /\.([a-z0-9]{1,8})$/i.exec(new URL(m.url, window.location.href).pathname)?.[1]
    if (ext) return `${nome}.${ext.toLowerCase()}`
  } catch {
    /* URL inválida: fica sem extensão */
  }
  return nome
}

/** Nome do .zip: "fotos" se só há imagens, "midias" se há mistura, mais o carimbo local. */
function nomeDoZipDe(lista: ViewerMedia[]): string {
  const p = (n: number) => String(n).padStart(2, '0')
  const d = new Date()
  const carimbo = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
  const soImagens = lista.every((m) => m.type === 'image' || m.type === 'sticker')
  return `${soImagens ? 'fotos' : 'midias'}-whatsapp-${carimbo}.zip`
}

/**
 * Visualizador in-app de imagem/vídeo (lightbox).
 * - Imagem: zoom (roda do mouse + botões +/−, duplo-clique alterna) e pan (arrastar quando zoom > 1).
 * - Vídeo: player com controles + autoplay.
 * - Fechar (X / clique no fundo / ESC) e baixar.
 * - Com `lista` (> 1 item): navega entre os itens (botões, setas do teclado,
 *   faixa de miniaturas) e ganha "Baixar todas" em .zip.
 */
export function MediaViewer({
  media: mediaProp,
  lista,
  indiceInicial,
  acoes,
  onClose,
  aoSalvarFigurinha,
}: {
  media: ViewerMedia | null
  /**
   * Itens navegáveis. Opcional: sem ela (ou com 1 item) o visualizador é o de
   * sempre. O item inicial é o de `media` (achado pela `url`; 0 se não achar).
   */
  lista?: ViewerMedia[]
  /**
   * Posição de abertura dentro de `lista`. Se vier (inteiro válido), tem
   * precedência sobre a busca por `url` — necessário quando itens repetem URL.
   */
  indiceInicial?: number
  /** Ações de mensagem (ir, responder, reagir, encaminhar, info). Sem elas, a barra só tem zoom/baixar/fechar. */
  acoes?: AcoesDoVisualizador
  onClose: () => void
  /**
   * Guardar a figurinha na coleção da pessoa. Opcional: quem abre o
   * visualizador para uma foto ou um PDF não passa nada, e o botão nem existe.
   */
  aoSalvarFigurinha?: (media: ViewerMedia) => void
}) {
  const temLista = !!lista && lista.length > 1
  const total = temLista ? lista.length : 1
  // O índice é guardado JUNTO do `media` a que se refere. Quando o pai abre o
  // visualizador em outra mídia, `nav.para !== mediaProp` e o índice inicial é
  // recalculado no próprio render — sem efeito, então não há um quadro
  // mostrando o item da abertura anterior. E como só `mediaProp` entra na
  // comparação, o pai pode passar um array novo a cada render sem zerar a
  // navegação.
  const [nav, setNav] = useState<{ para: ViewerMedia | null; i: number }>({ para: null, i: 0 })
  // `indiceInicial` do pai vence a busca por URL: duas mensagens podem apontar
  // para a mesma URL (foto reencaminhada), e o findIndex cairia na primeira.
  const indiceDeAbertura = !temLista
    ? 0
    : Number.isInteger(indiceInicial) && indiceInicial! >= 0 && indiceInicial! < total
      ? indiceInicial!
      : Math.max(0, lista.findIndex((m) => m.url === mediaProp?.url))
  const indice = nav.para === mediaProp ? Math.min(nav.i, total - 1) : indiceDeAbertura
  const media = temLista ? lista[indice] : mediaProp

  const irPara = useCallback(
    (novo: number) => setNav({ para: mediaProp, i: Math.max(0, Math.min(total - 1, novo)) }),
    [mediaProp, total],
  )

  const faixaRef = useRef<HTMLDivElement>(null)
  const [zipando, setZipando] = useState(false)
  const [aviso, setAviso] = useState<string | null>(null)
  /**
   * Número da "abertura" atual. O componente nunca desmonta (só devolve null),
   * então `zipando`/`aviso`/`nav` sobreviveriam ao fechamento: fechar no meio
   * de um zip e reabrir deixaria o botão travado. Ao fechar, zera-se tudo e
   * incrementa-se este número; um zip que termina depois vê que o número mudou
   * e descarta o resultado.
   */
  const sessaoRef = useRef(0)
  useEffect(() => {
    if (mediaProp) return
    sessaoRef.current += 1
    setZipando(false)
    setAviso(null)
    setNav({ para: null, i: 0 })
    setMenuReacao(false)
    setMenuMais(false)
    zipAbortRef.current?.abort()
    zipAbortRef.current = null
    faixaRolouRef.current = false
  }, [mediaProp])

  /** Menu radial de reações aberto (ancorado no botão da barra). */
  const [menuReacao, setMenuReacao] = useState(false)
  /** Menu ⋮ (baixar todas / informações) aberto. */
  const [menuMais, setMenuMais] = useState(false)
  /** Instante em que o menu de reações fechou: evita fechar-e-reabrir no clique do botão. */
  const menuReacaoFechouEmRef = useRef(0)
  /** O menu de reações estava aberto quando o ponteiro desceu? (ver `aoClicarFundo`) */
  const menuReacaoAbertoNoDownRef = useRef(false)
  /** Aborta o zip em andamento quando o visualizador fecha. */
  const zipAbortRef = useRef<AbortController | null>(null)
  /** Já rolou a faixa nesta abertura? A 1ª rolagem é instantânea; as seguintes, suaves. */
  const faixaRolouRef = useRef(false)
  const fecharMenuReacao = useCallback(() => {
    menuReacaoFechouEmRef.current = Date.now()
    setMenuReacao(false)
  }, [])

  /**
   * CLIQUE NO FUNDO FECHA — sem engolir o clique nos contêineres.
   *
   * Antes, cada contêiner ao redor da mídia dava `stopPropagation`, e o fundo
   * "de verdade" só existia nas bordas. Agora nada engole o clique: quem NÃO
   * deve fechar leva o atributo `data-nao-fecha` (barras, setas, miniaturas,
   * a própria mídia, os menus) e é reconhecido aqui por `closest`. Isso vale
   * também para o menu ⋮, que vive num portal mas borbulha pela árvore do React.
   *
   * ARRASTO: com zoom, o pan começa na imagem e pode terminar no fundo, e o
   * navegador então dispara `click` no fundo. Guardamos onde o ponteiro desceu
   * e só fechamos se o clique terminou a menos de 5px de lá.
   */
  const inicioCliqueRef = useRef<{ x: number; y: number } | null>(null)
  const aoPressionarFundo = (e: React.PointerEvent) => {
    inicioCliqueRef.current = { x: e.clientX, y: e.clientY }
    // O menu de reações fecha no `mousedown` (que vem DEPOIS do pointerdown);
    // quando o `click` chega ao fundo ele já está fechado. Por isso o estado é
    // gravado aqui: clique que FECHOU o menu não pode fechar o visualizador.
    menuReacaoAbertoNoDownRef.current = menuReacao
  }
  const aoClicarFundo = (e: React.MouseEvent) => {
    const inicio = inicioCliqueRef.current
    inicioCliqueRef.current = null
    const fechavaMenu =
      menuReacaoAbertoNoDownRef.current || Date.now() - menuReacaoFechouEmRef.current < 400
    menuReacaoAbertoNoDownRef.current = false
    if (fechavaMenu) return
    if ((e.target as Element | null)?.closest?.('[data-nao-fecha]')) return
    if (inicio && Math.hypot(e.clientX - inicio.x, e.clientY - inicio.y) >= 5) return
    onClose()
  }

  const [vista, setVista] = useState<Vista>(VISTA_INICIAL)
  /** Verdadeiro enquanto há dedo/botão pressionado — desliga a transição. */
  const [interagindo, setInteragindo] = useState(false)
  const arrastandoRef = useRef(false)
  const ultimoRef = useRef({ x: 0, y: 0 })
  const wrapRef = useRef<HTMLDivElement>(null)
  const imgRef = useRef<HTMLImageElement>(null)
  /** Ponteiros ativos por id: é o que permite reconhecer a pinça de dois dedos. */
  const ponteirosRef = useRef(new Map<number, { x: number; y: number }>())
  /** Distância e escala no instante em que a pinça começou. */
  const pincaRef = useRef<{ distancia: number; escala: number } | null>(null)

  // Figurinha desenha e se comporta como imagem — só o botão a mais é diferente.
  const isImage = media?.type === 'image' || media?.type === 'sticker'
  const isPdf = media?.type === 'pdf'
  const isExcel = media?.type === 'excel'
  const url = media?.url

  const [excelWorkbook, setExcelWorkbook] = useState<ExcelWorkbookPreview | null>(null)
  const [activeSheet, setActiveSheet] = useState<string | null>(null)
  const [excelLoading, setExcelLoading] = useState(false)
  const [excelError, setExcelError] = useState<string | null>(null)

  // Reseta o transform sempre que a mídia muda (inclui trocar de item da lista).
  useEffect(() => {
    setVista(VISTA_INICIAL)
    setMenuReacao(false)
  }, [url, indice])

  // Miniatura atual sempre visível na faixa. Na ABERTURA o salto é instantâneo:
  // uma rolagem suave do início até a atual passaria por dezenas de miniaturas
  // e dispararia o carregamento (lazy) de todas elas em tamanho cheio. Suave só
  // quando a pessoa navega de um item para o vizinho.
  useEffect(() => {
    if (!mediaProp || !temLista) return
    const primeira = !faixaRolouRef.current
    faixaRolouRef.current = true
    faixaRef.current
      ?.querySelector('[data-atual="true"]')
      ?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: primeira ? 'auto' : 'smooth' })
  }, [mediaProp, indice, temLista])

  // Aviso do zip some sozinho.
  useEffect(() => {
    if (!aviso) return
    const t = setTimeout(() => setAviso(null), 7000)
    return () => clearTimeout(t)
  }, [aviso])

  /**
   * Até onde dá para arrastar: metade do que a imagem ESCALADA sobra para fora
   * do contêiner (o transform tem origem no centro). Quando a imagem cabe
   * inteira, o limite é zero e o arrasto simplesmente não sai do lugar.
   *
   * Sem isso o arrasto era ilimitado — bastava puxar um pouco com zoom baixo
   * para a foto sumir da tela e não haver como trazê-la de volta.
   */
  const limitesDoPan = useCallback((escala: number) => {
    const img = imgRef.current
    const wrap = wrapRef.current
    if (!img || !wrap) return { x: 0, y: 0 }
    return {
      x: Math.max(0, (img.clientWidth * escala - wrap.clientWidth) / 2),
      y: Math.max(0, (img.clientHeight * escala - wrap.clientHeight) / 2),
    }
  }, [])

  /**
   * Novo zoom mantendo fixo o ponto (px, py) da TELA — o que está sob o cursor,
   * ou no meio dos dois dedos, continua ali depois de ampliar.
   *
   * A conta sai de `tela - centro = imagem * escala + deslocamento`: isolando o
   * ponto da imagem antes e depois, o deslocamento novo é
   * `(P - c) - (P - c - t) * (escala nova / escala velha)`.
   *
   * Antes só a escala mudava e o deslocamento ficava parado: o trecho que a
   * pessoa queria ver fugia do cursor, e ao reduzir o zoom a imagem saltava
   * para longe porque o deslocamento seguia com a magnitude do zoom anterior.
   * Agora o clamp cuida disso sozinho — em escala 1 o limite é 0 e o
   * deslocamento volta ao centro sem precisar de caso especial.
   */
  const zoomAncorado = useCallback(
    (alvo: number | ((atual: number) => number), px?: number, py?: number) => {
      setVista((v) => {
        const escala = clamp(typeof alvo === 'function' ? alvo(v.scale) : alvo)
        if (escala === v.scale) return v
        const wrap = wrapRef.current
        if (!wrap) return { scale: escala, tx: 0, ty: 0 }
        const r = wrap.getBoundingClientRect()
        const cx = r.left + r.width / 2
        const cy = r.top + r.height / 2
        const ax = px ?? cx
        const ay = py ?? cy
        const fator = escala / v.scale
        const lim = limitesDoPan(escala)
        return {
          scale: escala,
          tx: prender(ax - cx - (ax - cx - v.tx) * fator, lim.x),
          ty: prender(ay - cy - (ay - cy - v.ty) * fator, lim.y),
        }
      })
    },
    [limitesDoPan],
  )

  // Busca e faz o parse da planilha quando o preview é de Excel.
  useEffect(() => {
    if (!isExcel || !url) {
      setExcelWorkbook(null)
      setActiveSheet(null)
      setExcelError(null)
      return
    }
    let cancelled = false
    setExcelLoading(true)
    setExcelError(null)
    fetch(url)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.arrayBuffer()
      })
      .then((buffer) => {
        if (cancelled) return
        const wb = XLSX.read(buffer, { type: 'array' })
        const sheets: Record<string, unknown[][]> = {}
        for (const name of wb.SheetNames) {
          sheets[name] = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true }) as unknown[][]
        }
        setExcelWorkbook({ sheetNames: wb.SheetNames, sheets })
        setActiveSheet(wb.SheetNames[0] ?? null)
      })
      .catch((err) => {
        if (!cancelled) setExcelError(err?.message || 'Não foi possível ler a planilha')
      })
      .finally(() => {
        if (!cancelled) setExcelLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [isExcel, url])

  // ESC fecha o visualizador — e SÓ ele. O ChatHub também escuta Esc para
  // fechar a conversa, mas respeita `defaultPrevented`; por isso este listener
  // roda na fase de CAPTURA (chega antes) e marca o evento como tratado.
  // Com o menu ⋮ aberto não fazemos nada: o Radix fecha o menu por conta própria.
  useEffect(() => {
    if (!mediaProp) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (menuMais) return
      e.preventDefault()
      if (menuReacao) fecharMenuReacao()
      else onClose()
    }
    window.addEventListener('keydown', onKey, { capture: true })
    return () => window.removeEventListener('keydown', onKey, { capture: true })
  }, [mediaProp, onClose, menuReacao, menuMais, fecharMenuReacao])

  // ← → navegam na lista. Listener próprio, para não misturar com o do Esc.
  useEffect(() => {
    if (!mediaProp || !temLista) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
      // Com o menu ⋮ aberto as setas são do menu (Radix), não da lista.
      if (menuMais) return
      // Em vídeo, a seta é do player (voltar/avançar); em campo de texto, do cursor.
      const alvo = e.target as HTMLElement | null
      if (
        alvo &&
        (alvo.tagName === 'VIDEO' || alvo.tagName === 'INPUT' || alvo.tagName === 'TEXTAREA' || alvo.isContentEditable)
      ) {
        return
      }
      irPara(indice + (e.key === 'ArrowRight' ? 1 : -1))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [mediaProp, temLista, indice, irPara, menuMais])

  // Zoom pela roda do mouse (listener não-passivo p/ permitir preventDefault).
  // Ancorado no cursor: a roda amplia o que está debaixo do ponteiro.
  useEffect(() => {
    const el = wrapRef.current
    if (!el || !isImage) return
    const handler = (e: WheelEvent) => {
      e.preventDefault()
      const delta = e.deltaY < 0 ? STEP : -STEP
      zoomAncorado((s) => s + delta, e.clientX, e.clientY)
    }
    el.addEventListener('wheel', handler, { passive: false })
    return () => el.removeEventListener('wheel', handler)
  }, [isImage, url, zoomAncorado])

  if (!media || !mediaProp) return null

  // O zip é do ÁLBUM (itens com o mesmo `grupoId`), não da lista inteira: a lista
  // é a conversa toda e o botão baixaria centenas de arquivos sem querer.
  const itensDoAlbum =
    lista && media.grupoId ? lista.filter((m) => m.grupoId === media.grupoId) : []
  const temAlbumZip = itensDoAlbum.length > 1
  const rotuloAlbum = `Baixar álbum (.zip) — ${itensDoAlbum.length} ${
    itensDoAlbum.every((m) => m.type === 'image' || m.type === 'sticker') ? 'fotos' : 'arquivos'
  }`

  /** Baixa os itens do álbum num .zip; avisa se algum não veio. */
  const baixarAlbum = async () => {
    if (!temAlbumZip || zipando) return
    const sessao = sessaoRef.current
    const controle = new AbortController()
    zipAbortRef.current = controle
    setZipando(true)
    setAviso(null)
    try {
      const { baixados, total: n } = await baixarComoZip(
        itensDoAlbum.map((m) => ({ url: m.url, nome: nomeNoZip(m) })),
        nomeDoZipDe(itensDoAlbum),
        controle.signal,
      )
      if (sessao !== sessaoRef.current) return
      if (baixados < n) {
        const texto = `${baixados} de ${n} arquivos baixados`
        setAviso(texto)
        // O toast fica atrás do visualizador (z-100 contra z-200), por isso o
        // aviso também aparece aqui dentro; o toast segue valendo depois de fechar.
        toast({ title: texto, description: 'Alguns arquivos não puderam ser baixados.' })
      }
    } catch (err) {
      // Abortado porque o visualizador fechou: nada a avisar.
      if (controle.signal.aborted || sessao !== sessaoRef.current) return
      const texto = err instanceof Error ? err.message : 'Não foi possível gerar o zip'
      setAviso(texto)
      toast({ title: 'Falha ao baixar', description: texto, variant: 'destructive' })
    } finally {
      // Só solta o botão se ainda é a mesma abertura; se fechou, o efeito acima já zerou.
      if (sessao === sessaoRef.current) setZipando(false)
    }
  }

  /** Botões +/− do topo: sem ponto de âncora, ampliam pelo centro. */
  const zoomBy = (delta: number) => zoomAncorado((s) => s + delta)

  const onPointerDown = (e: React.PointerEvent) => {
    if (!isImage) return
    ponteirosRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    setInteragindo(true)
    try {
      ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }

    // Dois dedos: começa pinça e cancela qualquer arrasto em curso. Guardamos a
    // distância e a escala do INÍCIO do gesto, para o zoom acompanhar a razão
    // entre as distâncias em vez de acumular incrementos.
    if (ponteirosRef.current.size === 2) {
      const [a, b] = [...ponteirosRef.current.values()]
      pincaRef.current = { distancia: Math.hypot(a.x - b.x, a.y - b.y), escala: vista.scale }
      arrastandoRef.current = false
      return
    }

    if (vista.scale > MIN_SCALE) {
      arrastandoRef.current = true
      ultimoRef.current = { x: e.clientX, y: e.clientY }
    }
  }

  const onPointerMove = (e: React.PointerEvent) => {
    if (!isImage) return
    if (!ponteirosRef.current.has(e.pointerId)) return
    ponteirosRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY })

    const pinca = pincaRef.current
    if (ponteirosRef.current.size >= 2 && pinca && pinca.distancia > 0) {
      const [a, b] = [...ponteirosRef.current.values()]
      const distancia = Math.hypot(a.x - b.x, a.y - b.y)
      zoomAncorado(pinca.escala * (distancia / pinca.distancia), (a.x + b.x) / 2, (a.y + b.y) / 2)
      return
    }

    if (!arrastandoRef.current) return
    const dx = e.clientX - ultimoRef.current.x
    const dy = e.clientY - ultimoRef.current.y
    ultimoRef.current = { x: e.clientX, y: e.clientY }
    setVista((v) => {
      const lim = limitesDoPan(v.scale)
      return { ...v, tx: prender(v.tx + dx, lim.x), ty: prender(v.ty + dy, lim.y) }
    })
  }

  const encerrarPonteiro = (e: React.PointerEvent) => {
    ponteirosRef.current.delete(e.pointerId)
    // Sobrando menos de dois dedos não há mais pinça. O dedo que ficou NÃO
    // vira arrasto no meio do gesto: quem quiser arrastar levanta e toca de novo.
    if (ponteirosRef.current.size < 2) pincaRef.current = null
    if (ponteirosRef.current.size === 0) {
      arrastandoRef.current = false
      setInteragindo(false)
    }
  }

  /** Botão redondo das barras (tema do app, sem fundo próprio até o hover). */
  const barBtn =
    'flex h-10 w-10 items-center justify-center rounded-full text-chat-text transition-colors hover:bg-chat-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent'
  /** Setas laterais: círculos que se destacam da mídia. */
  const setaBtn =
    'absolute top-1/2 z-10 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-chat-panel/90 text-chat-text shadow-chat transition-colors hover:bg-chat-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600'

  const messageId = media.messageId
  const podeIr = !!messageId && !!acoes?.aoIrParaMensagem
  const podeResponder = !!messageId && !!acoes?.aoResponder
  const podeReagir = !!messageId && !!acoes?.aoReagir
  const podeEncaminhar = !!messageId && !!acoes?.aoEncaminhar
  const podeVerInfo = !!messageId && !!acoes?.aoVerInfo
  // No celular (< sm) "Ir para a mensagem" e "Encaminhar" saem da barra e vão
  // para o ⋮, senão a barra passa da largura da tela e o ✕ some.
  const temItensMaisDesktop = temAlbumZip || podeVerInfo
  const temMenuMais = temItensMaisDesktop || podeIr || podeEncaminhar

  /** Ir/Responder/Encaminhar/Info levam a pessoa de volta à conversa: chama e fecha. */
  const chamarEFechar = (fn?: (id: string) => void) => {
    if (!messageId || !fn) return
    fn(messageId)
    onClose()
  }

  /** Reagir NÃO fecha o visualizador: a pessoa segue vendo a foto. */
  const reagir = async (emoji: string) => {
    if (!messageId || !acoes?.aoReagir) return
    const sessao = sessaoRef.current
    try {
      await acoes.aoReagir(messageId, emoji)
    } catch (err) {
      if (sessao === sessaoRef.current) {
        const texto = err instanceof Error ? err.message : 'Não foi possível reagir'
        setAviso(texto)
        toast({ title: 'Falha ao reagir', description: texto, variant: 'destructive' })
      }
    } finally {
      if (sessao === sessaoRef.current) setMenuReacao(false)
    }
  }

  const dataFormatada = (() => {
    if (!media.enviadaEm) return null
    const d = new Date(media.enviadaEm)
    return Number.isNaN(d.getTime()) ? null : format(d, "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })
  })()
  const temIdentificacao = !!(media.avatar || media.autor || dataFormatada)

  // Texto embaixo da mídia: "atual de total" do álbum tem prioridade; sem ele,
  // a posição na lista (galeria), para a pessoa saber onde está.
  const posicao = media.album
    ? `${media.album.atual} de ${media.album.total}`
    : temLista
      ? `${indice + 1} de ${total}`
      : null

  const textoAviso = aviso ?? (zipando ? 'Gerando zip…' : null)

  return createPortal(
    <div
      // Sem preto: só desfoque com uma tinta leve do tema, para a conversa
      // continuar visível (borrada) atrás. O clique em qualquer lugar que não
      // seja marcado com `data-nao-fecha` fecha (ver `aoClicarFundo`).
      role="dialog"
      aria-modal="true"
      aria-label="Visualizador de mídia"
      // Regra da casa (main.css, `.superficie-vidro`): desfoque de no máximo 12px
      // e NUNCA aninhado — já travou a rolagem no Windows. Por isso só a raiz
      // desfoca; as barras abaixo são sólidas.
      className="fixed inset-0 z-[200] flex flex-col bg-chat-conversation/25 text-chat-text backdrop-blur-md animate-in fade-in duration-200"
      onPointerDown={aoPressionarFundo}
      onClick={aoClicarFundo}
    >
      <div
        data-nao-fecha
        className="relative z-20 flex flex-shrink-0 items-center justify-between gap-2 border-b border-chat-border/60 bg-chat-panel px-3 py-2"
      >
        <div className="flex min-w-0 flex-1 items-center gap-3">
          {temIdentificacao ? (
            <>
              {media.avatar && (
                <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center overflow-hidden rounded-full">
                  {media.avatar}
                </div>
              )}
              <div className="min-w-0 leading-tight">
                {media.autor && <div className="truncate text-[15px] font-semibold text-chat-text">{media.autor}</div>}
                {dataFormatada && <div className="truncate text-[13px] text-chat-muted">{dataFormatada}</div>}
              </div>
            </>
          ) : (
            <span className="min-w-0 truncate text-sm font-medium text-chat-muted">{media.name || ''}</span>
          )}
        </div>
        <div className="flex min-w-0 items-center gap-0.5">
          {isImage && (
            <>
              <button
                type="button"
                onClick={() => zoomBy(-STEP)}
                disabled={vista.scale <= MIN_SCALE}
                title="Diminuir zoom"
                aria-label="Diminuir zoom"
                className={`${barBtn} max-sm:hidden`}
              >
                <ZoomOut className="h-[22px] w-[22px]" />
              </button>
              <button
                type="button"
                onClick={() => zoomBy(STEP)}
                disabled={vista.scale >= MAX_SCALE}
                title="Aumentar zoom"
                aria-label="Aumentar zoom"
                className={`${barBtn} max-sm:hidden`}
              >
                <ZoomIn className="h-[22px] w-[22px]" />
              </button>
            </>
          )}
          {podeIr && (
            <button
              type="button"
              onClick={() => chamarEFechar(acoes?.aoIrParaMensagem)}
              title="Ir para a mensagem"
              aria-label="Ir para a mensagem"
              className={`${barBtn} max-sm:hidden`}
            >
              <MessageSquareText className="h-[22px] w-[22px]" />
            </button>
          )}
          {podeResponder && (
            <button
              type="button"
              onClick={() => chamarEFechar(acoes?.aoResponder)}
              title="Responder"
              aria-label="Responder"
              className={barBtn}
            >
              <Reply className="h-[22px] w-[22px]" />
            </button>
          )}
          {podeReagir && (
            // `relative` + `h-0 w-0` abaixo: o menu radial se posiciona a partir
            // do centro do pai e abre um arco PARA CIMA — na barra do topo isso
            // sairia da tela. Por isso o ponto de origem fica ~90px abaixo do
            // botão, e o arco (que sobe ~80px) cai logo abaixo da barra.
            <div className="relative">
              <button
                type="button"
                onClick={() => {
                  // O menu fecha no mousedown "fora"; sem esta guarda o clique
                  // no próprio botão fecharia e reabriria na mesma hora.
                  if (Date.now() - menuReacaoFechouEmRef.current < 300) return
                  setMenuReacao((v) => !v)
                }}
                title="Reagir"
                aria-label="Reagir"
                aria-haspopup="menu"
                aria-expanded={menuReacao}
                className={barBtn}
              >
                <Smile className="h-[22px] w-[22px]" />
              </button>
              {menuReacao && (
                <div className="absolute left-1/2 top-full h-0 w-0" style={{ marginTop: 90 }}>
                  <MenuRadialDeReacoes
                    usoPorEmoji={acoes?.usoDeReacoes}
                    paraEsquerda
                    aoEscolher={reagir}
                    aoFechar={fecharMenuReacao}
                  />
                </div>
              )}
            </div>
          )}
          {podeEncaminhar && (
            <button
              type="button"
              onClick={() => chamarEFechar(acoes?.aoEncaminhar)}
              title="Encaminhar"
              aria-label="Encaminhar"
              className={`${barBtn} max-sm:hidden`}
            >
              <Forward className="h-[22px] w-[22px]" />
            </button>
          )}
          {media.type === 'sticker' && aoSalvarFigurinha && (
            <button
              type="button"
              onClick={() => aoSalvarFigurinha(media)}
              title="Salvar figurinha"
              aria-label="Salvar figurinha"
              className={barBtn}
            >
              <Star className="h-[22px] w-[22px]" />
            </button>
          )}
          <button
            type="button"
            onClick={() => downloadFile(media.url, nomeParaDownload(media.name, tipoParaDownload(media.type)))}
            title="Baixar"
            aria-label="Baixar"
            className={barBtn}
          >
            <Download className="h-[22px] w-[22px]" />
          </button>
          {temMenuMais && (
            <DropdownMenu open={menuMais} onOpenChange={setMenuMais}>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  title="Mais opções"
                  aria-label="Mais opções"
                  className={`${barBtn}${temItensMaisDesktop ? '' : ' sm:hidden'}`}
                >
                  {zipando ? (
                    <Loader2 className="h-[22px] w-[22px] animate-spin" />
                  ) : (
                    <MoreVertical className="h-[22px] w-[22px]" />
                  )}
                </button>
              </DropdownMenuTrigger>
              {/* z acima do visualizador (z-[200]); `data-nao-fecha` porque o
                  clique num item borbulha pela árvore do React até o fundo. */}
              <DropdownMenuContent align="end" data-nao-fecha className="z-[300]">
                {podeIr && (
                  <DropdownMenuItem className="sm:hidden" onSelect={() => chamarEFechar(acoes?.aoIrParaMensagem)}>
                    <MessageSquareText className="mr-2 h-4 w-4" />
                    Ir para a mensagem
                  </DropdownMenuItem>
                )}
                {podeEncaminhar && (
                  <DropdownMenuItem className="sm:hidden" onSelect={() => chamarEFechar(acoes?.aoEncaminhar)}>
                    <Forward className="mr-2 h-4 w-4" />
                    Encaminhar
                  </DropdownMenuItem>
                )}
                {temAlbumZip && (
                  <DropdownMenuItem disabled={zipando} onSelect={() => void baixarAlbum()}>
                    {zipando ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <FileArchive className="mr-2 h-4 w-4" />
                    )}
                    {zipando ? 'Gerando zip…' : rotuloAlbum}
                  </DropdownMenuItem>
                )}
                {podeVerInfo && (
                  <DropdownMenuItem onSelect={() => chamarEFechar(acoes?.aoVerInfo)}>
                    <Info className="mr-2 h-4 w-4" />
                    Informações da mensagem
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          <button
            type="button"
            onClick={onClose}
            title="Fechar"
            aria-label="Fechar"
            className={`${barBtn} flex-shrink-0`}
          >
            <X className="h-[22px] w-[22px]" />
          </button>
        </div>
      </div>

      {/* Contêiner relativo só para ancorar as setas ◀ ▶ nas laterais da área da mídia. */}
      <div className="relative flex min-h-0 flex-1 flex-col">
      {temLista && indice > 0 && (
        <button
          type="button"
          data-nao-fecha
          onClick={() => irPara(indice - 1)}
          title="Anterior"
          aria-label="Anterior"
          className={`${setaBtn} left-2 sm:left-4`}
        >
          <ChevronLeft className="h-6 w-6" />
        </button>
      )}
      {temLista && indice < total - 1 && (
        <button
          type="button"
          data-nao-fecha
          onClick={() => irPara(indice + 1)}
          title="Próxima"
          aria-label="Próxima"
          className={`${setaBtn} right-2 sm:right-4`}
        >
          <ChevronRight className="h-6 w-6" />
        </button>
      )}
      {textoAviso && (
        <div
          role="status"
          data-nao-fecha
          className="absolute left-1/2 top-2 z-10 flex -translate-x-1/2 items-center gap-2 rounded-md bg-chat-panel px-3 py-1.5 text-sm text-chat-text shadow-chat ring-1 ring-chat-border"
        >
          {zipando && !aviso && <Loader2 className="h-4 w-4 animate-spin" />}
          {textoAviso}
        </div>
      )}
      {/* Sem stopPropagation aqui: o espaço em volta da mídia é fundo e fecha.
          Só a própria mídia (img/video/iframe/planilha) leva `data-nao-fecha`. */}
      <div
        ref={wrapRef}
        className={
          isPdf || isExcel
            ? 'flex min-h-0 flex-1 overflow-hidden p-2 sm:p-4'
            : 'flex min-h-0 flex-1 items-center justify-center overflow-hidden p-4 sm:p-8'
        }
      >
        {isImage ? (
          <img
            ref={imgRef}
            data-nao-fecha
            src={media.url}
            alt={media.name || 'Imagem'}
            draggable={false}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={encerrarPonteiro}
            onPointerCancel={encerrarPonteiro}
            onDoubleClick={(e) =>
              zoomAncorado(vista.scale > MIN_SCALE ? MIN_SCALE : 2, e.clientX, e.clientY)
            }
            style={{
              transform: `translate(${vista.tx}px, ${vista.ty}px) scale(${vista.scale})`,
              cursor: vista.scale > MIN_SCALE ? 'grab' : 'zoom-in',
              // `interagindo` é estado, e não ref: a transição precisa sumir no
              // MESMO render em que o arrasto começa, senão cada quadro do gesto
              // ficaria perseguindo uma animação de 150ms e o arrasto vira borracha.
              transition: interagindo ? 'none' : 'transform 150ms ease-out',
              // Sem isto o navegador trata pinça e arrasto como gesto da página
              // (rolar, dar zoom no documento) e o visualizador nunca recebe os
              // eventos de ponteiro.
              touchAction: 'none',
            }}
            className="max-h-full max-w-full select-none object-contain"
          />
        ) : isPdf ? (
          <iframe
            data-nao-fecha
            src={media.url}
            title={media.name || 'PDF'}
            className="h-full w-full rounded bg-white"
          />
        ) : isExcel ? (
          <div data-nao-fecha className="flex h-full w-full min-h-0 flex-col rounded bg-white">
            {excelLoading ? (
              <div className="flex flex-1 items-center justify-center gap-2 text-sm text-chat-muted">
                <Loader2 className="h-4 w-4 animate-spin" />
                Carregando planilha…
              </div>
            ) : excelError ? (
              <div className="flex flex-1 items-center justify-center text-sm text-red-500">
                Não foi possível abrir a planilha: {excelError}
              </div>
            ) : excelWorkbook ? (
              <>
                {excelWorkbook.sheetNames.length > 1 && (
                  <div className="flex flex-shrink-0 gap-1 overflow-x-auto border-b border-gray-200 bg-gray-50 px-2 py-1.5">
                    {excelWorkbook.sheetNames.map((name) => (
                      <button
                        key={name}
                        type="button"
                        onClick={() => setActiveSheet(name)}
                        className={
                          'flex-shrink-0 rounded px-2.5 py-1 text-xs font-medium transition-colors ' +
                          (activeSheet === name
                            ? 'bg-primary text-primary-foreground'
                            : 'text-gray-600 hover:bg-gray-200')
                        }
                      >
                        {name}
                      </button>
                    ))}
                  </div>
                )}
                <div className="min-h-0 flex-1 overflow-auto">
                  <table className="min-w-full border-collapse text-xs">
                    <tbody>
                      {(excelWorkbook.sheets[activeSheet || ''] || [])
                        .slice(0, EXCEL_ROW_LIMIT)
                        .map((row, rowIdx) => (
                          <tr key={rowIdx} className={rowIdx === 0 ? 'bg-gray-100 font-semibold' : 'odd:bg-white even:bg-gray-50'}>
                            {(row as unknown[]).map((cell, cellIdx) => (
                              <td key={cellIdx} className="whitespace-nowrap border border-gray-200 px-2 py-1 text-gray-800">
                                {cell === null || cell === undefined ? '' : String(cell)}
                              </td>
                            ))}
                          </tr>
                        ))}
                    </tbody>
                  </table>
                  {(excelWorkbook.sheets[activeSheet || ''] || []).length > EXCEL_ROW_LIMIT && (
                    <div className="p-2 text-center text-xs text-chat-muted">
                      Mostrando as primeiras {EXCEL_ROW_LIMIT} linhas — baixe o arquivo para ver tudo.
                    </div>
                  )}
                </div>
              </>
            ) : null}
          </div>
        ) : (
          <video data-nao-fecha key={media.url} src={media.url} controls autoPlay className="max-h-full max-w-full rounded object-contain" />
        )}
      </div>
      {posicao && (
        <div
          data-nao-fecha
          className="mb-2 self-center rounded-full bg-chat-panel/85 px-2.5 py-0.5 text-[13px] text-chat-muted"
        >
          {posicao}
        </div>
      )}
      </div>

      {temLista && lista && (
        <div
          ref={faixaRef}
          data-nao-fecha
          className="flex flex-shrink-0 gap-1.5 overflow-x-auto border-t border-chat-border/60 bg-chat-panel p-3"
        >
          {lista.map((m, i) => (
            <button
              key={`${m.url}-${i}`}
              type="button"
              data-atual={i === indice ? 'true' : undefined}
              onClick={() => irPara(i)}
              title={m.name || `Item ${i + 1}`}
              aria-label={m.name || `Item ${i + 1}`}
              aria-current={i === indice ? 'true' : undefined}
              className={
                'relative h-14 w-14 flex-shrink-0 overflow-hidden rounded-md bg-chat-hover transition ' +
                (i === indice
                  ? 'opacity-100 ring-2 ring-emerald-600'
                  : 'opacity-70 hover:opacity-100')
              }
            >
              {m.type === 'image' || m.type === 'sticker' ? (
                <img
                  src={m.url}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  draggable={false}
                  className="h-full w-full object-cover"
                />
              ) : (
                // Vídeo/PDF/planilha: sem miniatura de verdade (carregar o
                // arquivo inteiro só para a faixa seria caro), só o ícone do tipo.
                <span className="flex h-full w-full items-center justify-center bg-chat-hover text-chat-text">
                  {m.type === 'video' ? (
                    <Play className="h-6 w-6 fill-current" />
                  ) : m.type === 'excel' ? (
                    <FileSpreadsheet className="h-6 w-6" />
                  ) : (
                    <FileText className="h-6 w-6" />
                  )}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>,
    document.body,
  )
}
