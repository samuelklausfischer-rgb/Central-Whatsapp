import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  BellOff,
  Bell,
  ChevronDown,
  ChevronLeft,
  Image as IconeImagem,
  LogOut,
  Mic,
  MoreVertical,
  Paperclip,
  Pencil,
  Users,
} from 'lucide-react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { MediaViewer, type ViewerMedia } from '@/components/chat/MediaViewer'
import { SeparadorDeData } from '@/components/chat/SeparadorDeData'
import { ehInicioDeSequencia, rotuloDaData } from '@/components/chat/visualConversa'
import { AvatarInterno } from '@/components/chat-interno/AvatarInterno'
import { BalaoInterno, type CitacaoVisual } from '@/components/chat-interno/BalaoInterno'
import { ComposerInterno } from '@/components/chat-interno/ComposerInterno'
import { ConfirmarSaidaDoGrupo, DialogoParticipantes, DialogoRenomearGrupo } from '@/components/chat-interno/DialogosDoGrupo'
import { useJanelaEmPrimeiroPlano, useUrlsDosAnexos } from '@/components/chat-interno/hooks'
import { useAuth } from '@/hooks/use-auth'
import { useToast } from '@/hooks/use-toast'
import { previewDaMensagem } from '@/lib/chat-interno'
import { downloadFile, nomeParaDownload } from '@/lib/download'
import type { DadosDoEnvio, MensagemInterna, MensagemPendente } from '@/lib/supabase/chat-interno-types'
import { cn } from '@/lib/utils'
import { buscarMensagensPorId, mensagemDoErro, silenciar, urlParaBaixar } from '@/services/chat_interno'
import {
  apagarMinhaMensagem,
  carregarMaisAntigas,
  carregarMembros,
  carregarResumo,
  carregarUltimas,
  definirEmFoco,
  definirSilenciadaLocal,
  descartarPendente,
  enviarNaConversa,
  garantirConversaCarregada,
  marcarComoLida,
  reenviarPendente,
  useChatInternoStore,
} from '@/stores/chatInterno'

const SEM_MENSAGENS: MensagemInterna[] = []
const SEM_PENDENTES: MensagemPendente[] = []
/** Quanto de distância do fim ainda conta como "estou lendo o fim". */
const MARGEM_DO_FIM_PX = 80
/** Rolou até aqui do topo: hora de buscar a página anterior. */
const MARGEM_DO_TOPO_PX = 160

type Linha = {
  chave: string
  msg: MensagemInterna | MensagemPendente
  separador: string | null
  inicio: boolean
}

function chaveDaMensagem(m: MensagemInterna | MensagemPendente, meuId: string | undefined) {
  // Mensagem minha usa o `client_id`: o balão otimista e a linha confirmada têm a
  // MESMA chave, então a confirmação não remonta o balão (nem refaz a animação).
  return m.autor_id === meuId && m.client_id ? `c-${m.client_id}` : `i-${m.id}`
}

/**
 * Janela de uma conversa do Chat interno (coluna da direita).
 *
 * Montada com `key={conversaId}` por quem a usa: todo estado daqui (rolagem,
 * resposta em andamento, diálogo aberto) é POR CONVERSA e nasce limpo ao trocar —
 * a lição do `ChatWindow` do WhatsApp, que não desmonta ao trocar e já deu três
 * bugs de estado de uma conversa vazando para a outra.
 */
export function ChatInternoWindow({
  conversaId,
  onFechar,
  isMobile,
}: {
  conversaId: string
  onFechar: () => void
  isMobile: boolean
}) {
  const { user } = useAuth()
  const meuId = user?.id
  const { toast } = useToast()

  const conversa = useChatInternoStore((e) => e.resumo.find((r) => r.id === conversaId))
  const resumoEstado = useChatInternoStore((e) => e.resumoEstado)
  const dados = useChatInternoStore((e) => e.conversas[conversaId])
  const pessoas = useChatInternoStore((e) => e.pessoas)
  const membrosEntrada = useChatInternoStore((e) => e.membros[conversaId])
  const emPrimeiroPlano = useJanelaEmPrimeiroPlano()

  const mensagens = dados?.mensagens ?? SEM_MENSAGENS
  const pendentes = dados?.pendentes ?? SEM_PENDENTES
  const jaCarregou = !!dados?.jaCarregou

  // ── Carga ────────────────────────────────────────────────────────────────
  useEffect(() => {
    void garantirConversaCarregada(conversaId)
  }, [conversaId, dados?.desatualizada])

  // Membros: nomes e fotos de quem fala. Relê quando uma mensagem de sistema
  // (entrou, saiu, promoveu) marcou o cache como obsoleto.
  useEffect(() => {
    if (!membrosEntrada || membrosEntrada.obsoleto) void carregarMembros(conversaId).catch(() => {})
  }, [conversaId, membrosEntrada])

  // ── A conversa existe para mim? ───────────────────────────────────────────
  // Deep link e "fui adicionado agora" podem chegar antes de a lista conhecer a
  // conversa: relê UMA vez antes de desistir. E se eu a tinha e deixou de existir
  // na lista (removido do grupo), a janela fecha em vez de ficar apontando para o nada.
  const [verificouLista, setVerificouLista] = useState(false)
  const tinhaConversaRef = useRef(false)
  /** Saí do grupo por vontade própria: a conversa some da lista e isso não é "fui removido". */
  const saiuDeLivreVontadeRef = useRef(false)
  useEffect(() => {
    if (conversa) {
      tinhaConversaRef.current = true
      return
    }
    if (resumoEstado !== 'pronto') return
    if (tinhaConversaRef.current) {
      if (!saiuDeLivreVontadeRef.current) toast({ title: 'Você não participa mais desta conversa' })
      onFechar()
      return
    }
    if (!verificouLista) {
      void carregarResumo({ forcar: true }).finally(() => setVerificouLista(true))
      return
    }
    // Já relemos a lista e ela não existe para mim (link velho, conversa guardada
    // da sessão anterior e da qual saí): volta para a lista em vez de ficar num beco.
    toast({ title: 'Esta conversa não está mais disponível' })
    onFechar()
  }, [conversa, resumoEstado, verificouLista, onFechar, toast])

  // ── Linhas da lista ───────────────────────────────────────────────────────
  const itens = useMemo(() => [...mensagens, ...pendentes] as (MensagemInterna | MensagemPendente)[], [mensagens, pendentes])

  const linhas = useMemo<Linha[]>(() => {
    const out: Linha[] = []
    let anterior: MensagemInterna | MensagemPendente | undefined
    for (const msg of itens) {
      const mudouODia = !anterior || new Date(anterior.criado_em).toDateString() !== new Date(msg.criado_em).toDateString()
      const minima = (m: MensagemInterna | MensagemPendente) => ({
        sender_id: m.autor_id,
        remote_sender: m.autor_id ?? 'removido',
        created_at: m.criado_em,
      })
      const inicio = ehInicioDeSequencia(
        minima(msg),
        anterior ? minima(anterior) : undefined,
        mudouODia || anterior?.tipo === 'sistema',
        meuId,
      )
      out.push({
        chave: chaveDaMensagem(msg, meuId),
        msg,
        separador: mudouODia ? rotuloDaData(msg.criado_em) : null,
        inicio,
      })
      anterior = msg
    }
    return out
  }, [itens, meuId])

  // ── Nomes, citações e anexos ──────────────────────────────────────────────
  const membrosCarregados = membrosEntrada?.estado === 'pronto'
  const nomeDe = useCallback(
    (id: string | null) => {
      if (!id) return 'Usuário removido'
      if (id === meuId) return 'Você'
      return pessoas[id]?.nome ?? (membrosCarregados ? 'Usuário removido' : '')
    },
    [pessoas, meuId, membrosCarregados],
  )

  const porId = useMemo(() => new Map(itens.map((m) => [m.id, m])), [itens])

  // Respostas a mensagens fora da página carregada: busca as citadas de uma vez.
  const [citadasExtras, setCitadasExtras] = useState<Record<string, MensagemInterna | null>>({})
  const pedidasRef = useRef(new Set<string>())
  const faltando = useMemo(
    () => [...new Set(itens.map((m) => m.responde_a).filter((id): id is string => !!id && !porId.has(id)))].filter((id) => !(id in citadasExtras)),
    [itens, porId, citadasExtras],
  )
  const chaveFaltando = faltando.join('|')
  useEffect(() => {
    const novas = faltando.filter((id) => !pedidasRef.current.has(id))
    if (novas.length === 0) return
    novas.forEach((id) => pedidasRef.current.add(id))
    void buscarMensagensPorId(novas)
      .then((linhasBuscadas) =>
        setCitadasExtras((atual) => {
          const proximo = { ...atual }
          for (const id of novas) proximo[id] = linhasBuscadas.find((m) => m.id === id) ?? null
          return proximo
        }),
      )
      .catch(() => setCitadasExtras((atual) => Object.fromEntries([...Object.entries(atual), ...novas.map((id) => [id, null] as const)])))
    // `faltando` é derivado da chave; listar o array refaria o efeito a cada render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chaveFaltando])

  const citacaoDe = useCallback(
    (msg: MensagemInterna | MensagemPendente): CitacaoVisual | null => {
      if (!msg.responde_a) return null
      const alvo = porId.get(msg.responde_a) ?? citadasExtras[msg.responde_a]
      if (!alvo) return { autor: 'Mensagem anterior', texto: msg.responde_a in citadasExtras ? 'Mensagem indisponível' : 'Carregando...', navegavel: false }
      const icone =
        alvo.tipo === 'imagem' ? <IconeImagem className="h-3.5 w-3.5 shrink-0" /> : alvo.tipo === 'audio' ? <Mic className="h-3.5 w-3.5 shrink-0" /> : alvo.tipo === 'arquivo' ? <Paperclip className="h-3.5 w-3.5 shrink-0" /> : undefined
      return {
        autor: nomeDe(alvo.autor_id),
        texto: previewDaMensagem(alvo) || 'Mensagem',
        navegavel: porId.has(alvo.id),
        icone: alvo.apagada_em ? undefined : icone,
      }
    },
    [porId, citadasExtras, nomeDe],
  )

  const caminhosDosAnexos = useMemo(() => {
    const lista: string[] = []
    for (const m of mensagens) if (m.anexo_path && !m.apagada_em && (m.tipo === 'imagem' || m.tipo === 'audio')) lista.push(m.anexo_path)
    return lista
  }, [mensagens])
  const urlDe = useUrlsDosAnexos(caminhosDosAnexos)

  // ── Rolagem ───────────────────────────────────────────────────────────────
  const rolagemRef = useRef<HTMLDivElement>(null)
  const conteudoRef = useRef<HTMLDivElement>(null)
  const noFimRef = useRef(true)
  const [noFim, setNoFim] = useState(true)
  const [novasAbaixo, setNovasAbaixo] = useState(0)
  /** Altura/posição antes de carregar a página anterior, para o texto não "pular". */
  const ancoraRef = useRef<{ altura: number; topo: number } | null>(null)
  const primeiraRolagemFeitaRef = useRef(false)
  const ultimaChaveRef = useRef<string | null>(null)

  /**
   * Onde NÓS deixamos a rolagem na última vez que colamos no fim.
   *
   * Sem isto, `aoRolar` reavaliava a posição já com o conteúdo maior (foto que carregou
   * entre a atribuição e o evento, que chega no quadro seguinte), concluía "não estou no
   * fim" e desligava a ancoragem — e a conversa ficava para trás do fim sem ninguém ter
   * rolado nada. O evento de uma rolagem NOSSA não diz o que a pessoa quer.
   *
   * É uma POSIÇÃO e não um "ignore o próximo evento": rolagens nossas seguidas viram um
   * evento só (ou nenhum), e um ignorar-uma-vez que sobrasse engoliria a primeira rolagem
   * de verdade da pessoa.
   */
  const topoNossoRef = useRef<number | null>(null)

  const colarNoFim = useCallback(() => {
    const el = rolagemRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
    noFimRef.current = true
    topoNossoRef.current = el.scrollTop
  }, [])

  const rolarParaOFim = useCallback((suave = false) => {
    const el = rolagemRef.current
    if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior: suave ? 'smooth' : 'auto' })
  }, [])

  const aoRolar = useCallback(() => {
    const el = rolagemRef.current
    if (!el) return
    if (topoNossoRef.current !== null) {
      // Evento que só reporta o lugar onde nós deixamos a rolagem: não é a pessoa.
      if (Math.abs(el.scrollTop - topoNossoRef.current) <= 1) return
      // Outro lugar: a pessoa rolou. Daqui em diante vale a leitura normal.
      topoNossoRef.current = null
    }
    const perto = el.scrollHeight - el.scrollTop - el.clientHeight < MARGEM_DO_FIM_PX
    noFimRef.current = perto
    setNoFim((atual) => (atual === perto ? atual : perto))
    if (perto) setNovasAbaixo(0)
    if (el.scrollTop < MARGEM_DO_TOPO_PX && dados?.jaCarregou && dados.temMais && !dados.carregandoMais && !ancoraRef.current) {
      ancoraRef.current = { altura: el.scrollHeight, topo: el.scrollTop }
      void carregarMaisAntigas(conversaId)
    }
  }, [conversaId, dados?.jaCarregou, dados?.temMais, dados?.carregandoMais])

  // Depois de cada mudança na lista: ancora (página anterior), cola no fim (mensagem
  // minha ou já estava no fim) ou conta como "nova abaixo".
  useLayoutEffect(() => {
    const el = rolagemRef.current
    if (!el) return
    const ancora = ancoraRef.current
    if (ancora) {
      if (dados?.carregandoMais) return
      el.scrollTop = el.scrollHeight - ancora.altura + ancora.topo
      ancoraRef.current = null
      return
    }
    if (!primeiraRolagemFeitaRef.current) {
      if (jaCarregou && linhas.length > 0) {
        primeiraRolagemFeitaRef.current = true
        ultimaChaveRef.current = linhas[linhas.length - 1].chave
        colarNoFim()
        // Janela muito alta: as 50 mensagens cabem sem rolar, então nenhum evento de
        // rolagem pediria a página anterior. Pede aqui.
        if (el.scrollHeight <= el.clientHeight && dados?.temMais && !dados.carregandoMais) {
          ancoraRef.current = { altura: el.scrollHeight, topo: el.scrollTop }
          void carregarMaisAntigas(conversaId)
        }
      }
      return
    }
    const ultima = linhas[linhas.length - 1]
    if (!ultima || ultima.chave === ultimaChaveRef.current) return
    ultimaChaveRef.current = ultima.chave
    const ehMinha = ultima.msg.autor_id === meuId
    if (ehMinha || noFimRef.current) {
      colarNoFim()
      setNoFim(true)
    } else if (ultima.msg.tipo !== 'sistema') {
      setNovasAbaixo((n) => n + 1)
    }
  }, [linhas, jaCarregou, dados?.carregandoMais, dados?.temMais, conversaId, meuId, colarNoFim])

  // Dois motivos para a altura mudar DEPOIS de a conversa já ter rolado: foto/áudio
  // que termina de carregar (o CONTEÚDO cresce) e a área visível encolher/crescer —
  // teclado do celular abrindo, janela redimensionada (o CONTÊINER muda). Nos dois,
  // quem estava lendo o fim é reancorado nele. Encolher não dispara evento de
  // rolagem, então sem observar o contêiner as últimas mensagens ficariam escondidas
  // atrás do compositor.
  useEffect(() => {
    const conteudo = conteudoRef.current
    const conteiner = rolagemRef.current
    if (!conteudo || !conteiner || typeof ResizeObserver === 'undefined') return
    const observador = new ResizeObserver(() => {
      if (noFimRef.current && !ancoraRef.current) colarNoFim()
    })
    observador.observe(conteudo)
    observador.observe(conteiner)
    return () => observador.disconnect()
  }, [jaCarregou, colarNoFim])

  // ── Leitura ───────────────────────────────────────────────────────────────
  // A store precisa saber QUAL conversa está na tela e se estou lendo o fim: é
  // isso que decide se mensagem nova conta como não lida e se avisa com som.
  useEffect(() => {
    definirEmFoco({ id: conversaId, noFim })
  }, [conversaId, noFim])
  useEffect(() => () => definirEmFoco(null), [])

  const ultimaReal = mensagens[mensagens.length - 1]
  const ultimaMarcadaRef = useRef<string | null>(null)
  const naoLidas = conversa?.nao_lidas ?? 0
  useEffect(() => {
    if (!ultimaReal || !jaCarregou) return
    const jaTinha = ultimaMarcadaRef.current
    if (naoLidas === 0 && jaTinha === null) {
      // Abri uma conversa sem pendência: nada a marcar até chegar mensagem nova.
      ultimaMarcadaRef.current = ultimaReal.criado_em
      return
    }
    if (naoLidas === 0 && (ultimaReal.autor_id === meuId || ultimaReal.tipo === 'sistema')) {
      // O envio já move a minha marca de leitura no banco, e sistema não conta.
      ultimaMarcadaRef.current = ultimaReal.criado_em
      return
    }
    if (!emPrimeiroPlano || !noFim) return
    if (jaTinha === ultimaReal.criado_em && naoLidas === 0) return
    // Debounce: uma rajada de mensagens vira UMA chamada, com a última exibida.
    const t = setTimeout(() => {
      ultimaMarcadaRef.current = ultimaReal.criado_em
      void marcarComoLida(conversaId, ultimaReal.criado_em)
    }, 350)
    return () => clearTimeout(t)
  }, [ultimaReal, jaCarregou, naoLidas, emPrimeiroPlano, noFim, conversaId, meuId])

  // ── Ações ─────────────────────────────────────────────────────────────────
  const [respondendoA, setRespondendoA] = useState<MensagemInterna | null>(null)
  const [destacada, setDestacada] = useState<string | null>(null)
  const [paraApagar, setParaApagar] = useState<MensagemInterna | null>(null)
  const [apagando, setApagando] = useState(false)
  const [dialogo, setDialogo] = useState<'participantes' | 'renomear' | 'sair' | null>(null)
  const [visualizadorId, setVisualizadorId] = useState<string | null>(null)
  const [pedidoDeFoco, setPedidoDeFoco] = useState(0)
  const focarCampo = useCallback(() => setPedidoDeFoco((n) => n + 1), [])

  const aoEnviar = useCallback(
    (dadosDoEnvio: DadosDoEnvio) => {
      void enviarNaConversa(conversaId, dadosDoEnvio).then((r) => {
        if (!r.ok && r.erro?.naoSouMembro) toast({ title: r.erro.message, variant: 'destructive' })
      })
    },
    [conversaId, toast],
  )

  const aoSairDoGrupo = useCallback(() => {
    saiuDeLivreVontadeRef.current = true
    onFechar()
  }, [onFechar])

  const aoResponder = useCallback((msg: MensagemInterna) => setRespondendoA(msg), [])
  const aoReenviar = useCallback((m: MensagemPendente) => void reenviarPendente(conversaId, m.client_id!), [conversaId])
  const aoDescartar = useCallback((m: MensagemPendente) => descartarPendente(conversaId, m.client_id!), [conversaId])
  const aoPedirApagar = useCallback((msg: MensagemInterna) => setParaApagar(msg), [])

  const confirmarApagar = async () => {
    if (!paraApagar) return
    setApagando(true)
    const r = await apagarMinhaMensagem(paraApagar)
    setApagando(false)
    setParaApagar(null)
    if (!r.ok && r.erro) toast({ title: r.erro.message, variant: 'destructive' })
  }

  const aoBaixar = useCallback(
    async (msg: MensagemInterna) => {
      if (!msg.anexo_path) return
      try {
        const url = await urlParaBaixar(msg.anexo_path, msg.anexo_nome ?? 'arquivo')
        await downloadFile(url, nomeParaDownload(msg.anexo_nome, msg.tipo === 'imagem' ? 'imagem' : msg.tipo === 'audio' ? 'audio' : 'documento'))
      } catch (e) {
        toast({ title: mensagemDoErro(e, 'Não foi possível baixar o arquivo'), variant: 'destructive' })
      }
    },
    [toast],
  )

  const irParaCitada = useCallback((id: string) => {
    const alvo = document.getElementById(`msg-${id}`)
    if (!alvo) return
    alvo.scrollIntoView({ block: 'center', behavior: 'smooth' })
    setDestacada(id)
    window.setTimeout(() => setDestacada((atual) => (atual === id ? null : atual)), 1600)
  }, [])

  const alternarSom = async () => {
    if (!conversa) return
    const silenciada = !conversa.silenciada
    definirSilenciadaLocal(conversa.id, silenciada)
    try {
      await silenciar(conversa.id, silenciada)
      toast({ title: silenciada ? 'Som desta conversa desligado' : 'Som desta conversa ligado' })
    } catch (e) {
      definirSilenciadaLocal(conversa.id, !silenciada)
      toast({ title: mensagemDoErro(e, 'Não foi possível mudar o som'), variant: 'destructive' })
    }
  }

  // Imagens da conversa, para navegar entre elas no visualizador.
  const imagensDoVisualizador = useMemo<ViewerMedia[]>(() => {
    const lista: ViewerMedia[] = []
    for (const m of mensagens) {
      if (m.tipo !== 'imagem' || m.apagada_em || !m.anexo_path) continue
      const url = urlDe(m.anexo_path)
      if (!url) continue
      lista.push({
        url,
        type: 'image',
        name: m.anexo_nome ?? 'imagem',
        autor: nomeDe(m.autor_id),
        enviadaEm: m.criado_em,
      })
    }
    return lista
    // `urlDe` lê um cache externo: o re-render do hook é o que renova esta lista.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mensagens, nomeDe, urlDe, caminhosDosAnexos])

  const aoAbrirImagem = useCallback((msg: MensagemInterna) => setVisualizadorId(msg.id), [])
  const indiceDoVisualizador = useMemo(() => {
    if (!visualizadorId) return -1
    const alvo = mensagens.find((m) => m.id === visualizadorId)
    if (!alvo?.anexo_path) return -1
    const url = urlDe(alvo.anexo_path)
    return imagensDoVisualizador.findIndex((m) => m.url === url)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visualizadorId, mensagens, imagensDoVisualizador])

  // ── Renderização ──────────────────────────────────────────────────────────
  if (!conversa) {
    const procurando = resumoEstado !== 'pronto' || !verificouLista
    return (
      <div className="relative flex h-full min-w-0 flex-1 flex-col bg-chat-conversation">
        <div className="flex h-[64px] flex-shrink-0 items-center gap-3 border-b border-chat-border bg-chat-header px-4 shadow-chat sm:px-5">
          <Button variant="ghost" size="icon" onClick={onFechar} title="Sair da conversa (Esc)" aria-label="Sair da conversa" className="-ml-2 text-chat-text/80 hover:text-chat-text">
            <ChevronLeft className="h-5 w-5" />
          </Button>
          {procurando && <div className="h-4 w-40 animate-pulse rounded bg-chat-muted/10" aria-label="Carregando conversa" />}
        </div>
        {!procurando && (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
            <Users className="h-10 w-10 text-chat-muted/30" />
            <p className="text-sm text-chat-muted">Esta conversa não está disponível para você.</p>
            <Button variant="outline" size="sm" onClick={onFechar}>
              Voltar
            </Button>
          </div>
        )}
      </div>
    )
  }

  const ehGrupo = conversa.tipo === 'grupo'
  const outro = !ehGrupo && conversa.outro_user_id ? pessoas[conversa.outro_user_id] : undefined
  const subtitulo = ehGrupo
    ? `${conversa.membros_count} participante${conversa.membros_count === 1 ? '' : 's'}`
    : conversa.outro_desativado
      ? 'Usuário desativado'
      : (outro?.setor ?? '')
  const bloqueio =
    !ehGrupo && conversa.outro_desativado ? 'Esta pessoa não está mais ativa; não é possível enviar mensagens.' : null
  const souAdmin = conversa.meu_papel === 'admin'

  return (
    <div className="relative flex h-full min-w-0 flex-1 flex-col bg-transparent">
      {/* Cabeçalho */}
      <div className="sticky top-0 z-10 flex h-[64px] flex-shrink-0 items-center justify-between border-b border-chat-border bg-chat-header px-4 shadow-chat sm:px-5">
        <div className="flex min-w-0 items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={(e) => {
              e.currentTarget.blur()
              onFechar()
            }}
            title="Sair da conversa (Esc)"
            aria-label="Sair da conversa"
            className="-ml-2 mr-1 flex-shrink-0 text-chat-text/80 hover:text-chat-text"
          >
            <ChevronLeft className="h-5 w-5" />
          </Button>
          <button
            type="button"
            disabled={!ehGrupo}
            onClick={() => setDialogo('participantes')}
            className={cn('flex min-w-0 items-center gap-3 text-left', ehGrupo ? 'cursor-pointer' : 'cursor-default')}
            title={ehGrupo ? 'Ver participantes' : undefined}
          >
            <AvatarInterno nome={conversa.nome} url={outro?.avatar_url} grupo={ehGrupo} className="h-10 w-10 flex-shrink-0 shadow-chat" />
            <span className="min-w-0">
              <span className="block truncate text-[16px] font-semibold tracking-tight text-chat-text">{conversa.nome}</span>
              {subtitulo && <span className="mt-0.5 block truncate text-xs text-chat-muted">{subtitulo}</span>}
            </span>
          </button>
          {conversa.silenciada && <BellOff className="h-4 w-4 flex-shrink-0 text-chat-muted" aria-label="Som desligado" />}
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Mais opções" className="flex-shrink-0 text-chat-text/80 hover:text-chat-text">
              <MoreVertical className="h-5 w-5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-[200px] border-chat-border bg-chat-panel text-chat-text">
            {ehGrupo && (
              <DropdownMenuItem className="cursor-pointer" onSelect={() => setDialogo('participantes')}>
                <Users className="mr-2 h-4 w-4" /> Ver participantes
              </DropdownMenuItem>
            )}
            {ehGrupo && souAdmin && (
              <DropdownMenuItem className="cursor-pointer" onSelect={() => setDialogo('renomear')}>
                <Pencil className="mr-2 h-4 w-4" /> Renomear grupo
              </DropdownMenuItem>
            )}
            <DropdownMenuItem className="cursor-pointer" onSelect={() => void alternarSom()}>
              {conversa.silenciada ? <Bell className="mr-2 h-4 w-4" /> : <BellOff className="mr-2 h-4 w-4" />}
              {conversa.silenciada ? 'Reativar som' : 'Silenciar'}
            </DropdownMenuItem>
            {ehGrupo && (
              <>
                <DropdownMenuSeparator className="bg-chat-border" />
                <DropdownMenuItem className="cursor-pointer text-red-500 focus:text-red-500" onSelect={() => setDialogo('sair')}>
                  <LogOut className="mr-2 h-4 w-4" /> Sair do grupo
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Mensagens */}
      <div className="relative flex-1 overflow-hidden bg-chat-conversation">
        <div className="chat-conversation-bg-layer pointer-events-none absolute inset-0 z-0" />
        <div ref={rolagemRef} onScroll={aoRolar} className="custom-scrollbar relative z-10 h-full overflow-y-auto px-3 sm:px-10 lg:px-12" role="log" aria-label="Mensagens da conversa">
          <div ref={conteudoRef} className="py-4">
            {linhas.length === 0 && !jaCarregou && dados?.estado !== 'erro' ? (
              <div className="flex flex-col gap-3 py-4" aria-busy="true" aria-label="Carregando mensagens">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className={cn('flex', i % 2 === 0 ? 'justify-start' : 'justify-end')}>
                    <div className="h-14 animate-pulse rounded-[7.5px] bg-chat-muted/10" style={{ width: `${38 + ((i * 13) % 34)}%` }} />
                  </div>
                ))}
              </div>
            ) : linhas.length === 0 && dados?.estado === 'erro' ? (
              <div className="flex flex-col items-center justify-center px-6 py-20 text-center">
                <p className="text-sm leading-relaxed text-chat-muted">Não foi possível carregar as mensagens.</p>
                <p className="mt-1 text-xs text-chat-muted/60">Verifique a conexão e tente novamente.</p>
                <Button variant="outline" size="sm" className="mt-4" onClick={() => void carregarUltimas(conversaId)}>
                  Tentar novamente
                </Button>
              </div>
            ) : linhas.length === 0 ? (
              <div className="flex flex-col items-center justify-center px-6 py-20 text-center">
                <p className="text-sm leading-relaxed text-chat-muted">Nenhuma mensagem ainda.</p>
                <p className="mt-1 text-xs text-chat-muted/60">Escreva a primeira abaixo.</p>
              </div>
            ) : (
              linhas.map(({ chave, msg, separador, inicio }) => (
                <div key={chave}>
                  {separador && <SeparadorDeData rotulo={separador} />}
                  <BalaoInterno
                    msg={msg}
                    minha={msg.autor_id === meuId}
                    inicioDeSequencia={inicio}
                    ehGrupo={ehGrupo}
                    nomeDoAutor={msg.autor_id ? nomeDe(msg.autor_id) : 'Usuário removido'}
                    avatarDoAutor={msg.autor_id ? pessoas[msg.autor_id]?.avatar_url : null}
                    citacao={citacaoDe(msg)}
                    urlDoAnexo={'previaLocal' in msg && msg.previaLocal ? msg.previaLocal : urlDe(msg.anexo_path)}
                    destacada={destacada === msg.id}
                    aoResponder={aoResponder}
                    aoApagar={aoPedirApagar}
                    aoReenviar={aoReenviar}
                    aoDescartar={aoDescartar}
                    aoAbrirImagem={aoAbrirImagem}
                    aoBaixar={aoBaixar}
                    aoIrParaCitada={irParaCitada}
                    aoFocarCampo={focarCampo}
                  />
                </div>
              ))
            )}
          </div>
        </div>

        {/* Fora do fluxo de rolagem de propósito: dentro dele a altura do indicador
            empurraria as mensagens e a posição ancorada daria um salto. */}
        {dados?.carregandoMais && (
          <div className="pointer-events-none absolute left-1/2 top-2 z-20 -translate-x-1/2 rounded-full border border-chat-border bg-chat-panel p-1.5 shadow-chat" aria-label="Carregando mensagens anteriores">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-chat-muted/30 border-t-chat-muted" />
          </div>
        )}

        {!noFim && (
          <button
            type="button"
            onClick={() => {
              rolarParaOFim(true)
              setNovasAbaixo(0)
            }}
            aria-label={novasAbaixo > 0 ? `Ir para o fim — ${novasAbaixo} ${novasAbaixo === 1 ? 'mensagem nova' : 'mensagens novas'}` : 'Ir para o fim'}
            className="absolute bottom-4 right-5 z-20 flex h-10 w-10 items-center justify-center rounded-full border border-chat-border bg-chat-panel text-chat-muted shadow-chat transition-colors hover:text-chat-text"
          >
            <ChevronDown className="h-5 w-5" />
            {novasAbaixo > 0 && (
              <span className="absolute -top-2 right-0 flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[10px] font-bold text-primary-foreground">
                {novasAbaixo > 99 ? '99+' : novasAbaixo}
              </span>
            )}
          </button>
        )}
      </div>

      <ComposerInterno
        conversaId={conversaId}
        bloqueioMotivo={bloqueio}
        respondendo={
          respondendoA
            ? { id: respondendoA.id, autor: nomeDe(respondendoA.autor_id), texto: previewDaMensagem(respondendoA) || 'Mensagem' }
            : null
        }
        aoCancelarResposta={() => setRespondendoA(null)}
        aoEnviar={aoEnviar}
        focoNaChave={`${conversaId}:${respondendoA?.id ?? ''}:${pedidoDeFoco}:${isMobile ? 'm' : 'd'}`}
        compacto={isMobile}
      />

      <MediaViewer
        media={indiceDoVisualizador >= 0 ? imagensDoVisualizador[indiceDoVisualizador] : null}
        lista={imagensDoVisualizador}
        indiceInicial={indiceDoVisualizador >= 0 ? indiceDoVisualizador : undefined}
        onClose={() => setVisualizadorId(null)}
      />

      {ehGrupo && meuId && (
        <>
          <DialogoParticipantes
            aberto={dialogo === 'participantes'}
            onFechar={() => setDialogo(null)}
            conversa={conversa}
            meuId={meuId}
            aoSair={aoSairDoGrupo}
          />
          <DialogoRenomearGrupo aberto={dialogo === 'renomear'} onFechar={() => setDialogo(null)} conversa={conversa} />
          <ConfirmarSaidaDoGrupo aberto={dialogo === 'sair'} onFechar={() => setDialogo(null)} conversa={conversa} meuId={meuId} aoSair={aoSairDoGrupo} />
        </>
      )}

      <AlertDialog open={!!paraApagar} onOpenChange={(v) => !v && !apagando && setParaApagar(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Apagar mensagem para todos?</AlertDialogTitle>
            <AlertDialogDescription>
              A mensagem some para todos os participantes e o anexo, se houver, é removido. Não dá para desfazer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={apagando}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={apagando}
              onClick={(e) => {
                e.preventDefault()
                void confirmarApagar()
              }}
              className="bg-red-600 text-white hover:bg-red-700"
            >
              {apagando ? 'Apagando...' : 'Apagar'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

export default ChatInternoWindow
