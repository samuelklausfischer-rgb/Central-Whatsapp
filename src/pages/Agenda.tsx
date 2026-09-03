import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  addDays,
  addMonths,
  addWeeks,
  eachDayOfInterval,
  endOfDay,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  startOfDay,
  startOfMonth,
  startOfWeek,
  subDays,
  subMonths,
  subWeeks,
} from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { ChevronLeft, ChevronRight, CalendarDays, Plus, RefreshCw, Search, Users, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useAuth } from '@/hooks/use-auth'
import { useToast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import { GradeDoMes } from '@/components/agenda/GradeDoMes'
import { GradeDeHoras } from '@/components/agenda/GradeDeHoras'
import { CartaoDoCompromisso } from '@/components/agenda/CartaoDoCompromisso'
import { DialogoDeGrupos } from '@/components/agenda/DialogoDeGrupos'
import { BarraDoOutlook } from '@/components/agenda/BarraDoOutlook'
import { DialogoDoCompromisso } from '@/components/agenda/DialogoDoCompromisso'
import {
  HORA_FINAL,
  HORA_INICIAL,
  paraCampoLocal,
  type ItemDaAgenda,
  type Rascunho,
  type Visao,
} from '@/components/agenda/tipos'
import { porImportanciaDepoisHorario } from '@/components/agenda/ordem'
import {
  atualizarEvento,
  criarEvento,
  excluirEvento,
  getEventos,
  getGrupos,
  type EventoComPessoas,
  type ModoDaAgenda,
} from '@/services/agenda'
import type { AgendaGroup } from '@/lib/supabase/types'
import {
  conectar as conectarOutlook,
  desconectar as desconectarOutlook,
  getEventosDoOutlook,
  getStatus as getStatusDoOutlook,
  criarNoOutlook,
  atualizarNoOutlook,
  excluirDoOutlook,
  seRepete as seRepeteNoOutlook,
  type EventoDoOutlook,
  type RascunhoDoOutlook,
  type StatusDaConexao,
} from '@/services/agenda_microsoft'
import { useRealtime } from '@/hooks/use-realtime'

/**
 * ITEM 1: a Agenda.
 *
 * Grade de mês montada à mão com `date-fns`, que o projeto já usa, em vez de
 * trazer uma biblioteca de calendário: as prontas chegam com folha de estilo
 * própria e brigam com o visual do app — o custo de encaixá-las é maior que o
 * de desenhar uma grade de 42 células.
 *
 * Os QUATRO MODOS pedidos são filtro sobre a mesma consulta, e não quatro telas.
 * Quem decide o que existe para cada pessoa é a RLS; o modo só escolhe o recorte
 * dentro do que já veio.
 */

const MODOS: { valor: ModoDaAgenda; rotulo: string }[] = [
  { valor: 'meus', rotulo: 'Só meus' },
  { valor: 'setor', rotulo: 'Setor' },
  { valor: 'grupos', rotulo: 'Grupos' },
  { valor: 'tudo', rotulo: 'Tudo junto' },
]

const VISOES: { valor: Visao; rotulo: string }[] = [
  { valor: 'mes', rotulo: 'Mês' },
  { valor: 'semana', rotulo: 'Semana' },
  { valor: 'dia', rotulo: 'Dia' },
]

/**
 * De quanto em quanto tempo reler o Outlook com a tela aberta.
 *
 * Dois minutos: cada ciclo é uma chamada ao Microsoft Graph por pessoa com a
 * Agenda aberta. Mais curto que isso gasta cota para ganhar segundos que
 * ninguém percebe; mais longo faz a pessoa desconfiar do que está vendo.
 */
const INTERVALO_SYNC_MS = 2 * 60 * 1000

/** "agora", "há 3 min", "há 2 h" — sem trazer biblioteca só para isto. */
function haQuantoTempo(quando: Date | null): string {
  if (!quando) return ''
  const min = Math.floor((Date.now() - quando.getTime()) / 60000)
  if (min < 1) return 'agora'
  if (min < 60) return `há ${min} min`
  return `há ${Math.floor(min / 60)} h`
}

function daNossaAgenda(
  ev: EventoComPessoas,
  meuId: string | undefined,
  souAdmin: boolean,
): ItemDaAgenda {
  const meu = ev.created_by === meuId
  return {
    id: ev.id,
    titulo: ev.titulo,
    descricao: ev.descricao,
    starts_at: ev.starts_at,
    ends_at: ev.ends_at,
    dia_inteiro: ev.dia_inteiro,
    importancia: ev.importancia,
    link: ev.link,
    email: ev.email,
    origem: 'interna',
    escopo: ev.escopo,
    setor: ev.setor,
    podeEditar: meu || ev.assigned_to === meuId || souAdmin,
    podeExcluir: meu || souAdmin,
    souOCriador: meu,
    seRepete: false,
    groupId: ev.group_id,
    // `?? null` porque as três são opcionais no tipo (ver `AgendaEvent`): uma
    // linha gravada antes da migration 20260903143607 nem traz a chave.
    outlook_event_id: ev.outlook_event_id ?? null,
    outlook_ical_uid: ev.outlook_ical_uid ?? null,
    outlook_sync_erro: ev.outlook_sync_erro ?? null,
  }
}

function doOutlook(ev: EventoDoOutlook): ItemDaAgenda {
  return {
    id: `outlook:${ev.id}`,
    titulo: ev.titulo,
    descricao: ev.descricao,
    starts_at: ev.starts_at,
    ends_at: ev.ends_at,
    dia_inteiro: ev.dia_inteiro,
    // O Outlook não tem "importância" no mesmo sentido; entra como normal para
    // não inventar urgência que a pessoa não marcou.
    importancia: 'normal',
    link: ev.link,
    email: null,
    origem: 'outlook',
    escopo: null,
    setor: null,
    // É a agenda da própria pessoa — quem consegue ler, consegue mexer.
    podeEditar: true,
    podeExcluir: true,
    souOCriador: true,
    seRepete: seRepeteNoOutlook(ev),
    groupId: null,
    // Um item lido DO Outlook não tem vínculo a registrar: ele já é o evento.
    // O `outlook_event_id` existe para amarrar uma linha NOSSA a um evento de
    // lá — aqui não há linha nossa nenhuma.
    outlook_event_id: null,
    outlook_ical_uid: null,
    outlook_sync_erro: null,
  }
}

/** Desmonta o `outlook:<id>` que a tela usa para não colidir com o id interno. */
function idNoOutlook(idDaTela: string): string {
  return idDaTela.startsWith('outlook:') ? idDaTela.slice('outlook:'.length) : idDaTela
}

function rascunhoVazio(dia: Date): Rascunho {
  const base = startOfDay(dia)
  const inicio = new Date(base)
  inicio.setHours(9, 0, 0, 0)
  const fim = new Date(base)
  fim.setHours(10, 0, 0, 0)
  return {
    titulo: '',
    descricao: '',
    inicio: paraCampoLocal(inicio),
    fim: paraCampoLocal(fim),
    diaInteiro: false,
    importancia: 'normal',
    link: '',
    email: '',
    escopo: 'usuario',
    groupId: '',
    noOutlook: false,
    // Desmarcado por padrão: convidar dispara e-mail para o grupo inteiro, e
    // isso tem de ser um ato deliberado. Um compromisso de grupo continua
    // visível para todo mundo no Central Whats sem convite nenhum.
    convidarOutlook: false,
  }
}

export default function Agenda() {
  const { user } = useAuth()
  const { toast } = useToast()

  const [mes, setMes] = useState(() => startOfMonth(new Date()))
  const [diaSelecionado, setDiaSelecionado] = useState(() => startOfDay(new Date()))
  const [modo, setModo] = useState<ModoDaAgenda>('tudo')
  const [eventos, setEventos] = useState<EventoComPessoas[]>([])
  const [doOutlookNoPeriodo, setDoOutlookNoPeriodo] = useState<EventoDoOutlook[]>([])
  const [conexao, setConexao] = useState<StatusDaConexao>({ configurado: false, conectado: false })
  const [grupos, setGrupos] = useState<AgendaGroup[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  /** Falha do Outlook é avisada à parte: a agenda daqui continua servindo. */
  const [erroOutlook, setErroOutlook] = useState<string | null>(null)
  /** Sobe depois de criar no Outlook, para a consulta ao vivo refazer. */
  const [recarregaOutlook, setRecarregaOutlook] = useState(0)

  const [dialogoAberto, setDialogoAberto] = useState(false)
  const [rascunho, setRascunho] = useState<Rascunho>(() => rascunhoVazio(new Date()))
  const [salvando, setSalvando] = useState(false)
  /** null = criando. Preenchido = editando aquele compromisso. */
  const [editando, setEditando] = useState<ItemDaAgenda | null>(null)
  /** Visão do calendário. Filtro de desenho, não de dado. */
  const [visao, setVisao] = useState<Visao>('mes')
  const [atualizandoOutlook, setAtualizandoOutlook] = useState(false)
  const [gruposAberto, setGruposAberto] = useState(false)
  /** Id do compromisso cujo convite está sendo reenviado agora, ou null. */
  const [reenviandoConvite, setReenviandoConvite] = useState<string | null>(null)
  const [ultimaSync, setUltimaSync] = useState<Date | null>(null)
  /** Reconta sozinho para o "há X min" andar sem depender de outra mudança. */
  const [, setTiquetaque] = useState(0)
  /**
   * Busca da lista lateral. Filtro de DESENHO, não de dado: peneira o que já
   * está carregado, sem ir ao banco. O volume de um dia é pequeno, então não
   * precisa do `useDeferredValue` que a lista de conversas usa.
   */
  const [busca, setBusca] = useState('')

  const souAdmin = Boolean(user?.is_admin)

  /**
   * O período consultado muda com a VISÃO — e a consulta tem de cobrir
   * exatamente o que a tela desenha.
   *
   * No mês a grade cobre semanas inteiras, então passa das bordas do mês nas
   * duas pontas: sem isso os dias que sobram do mês vizinho apareceriam sempre
   * vazios. Na semana e no dia o intervalo é o próprio período — pedir o mês
   * inteiro ali seria trazer dezenas de compromissos para desenhar um.
   */
  const [gradeInicio, gradeFim] = useMemo<[Date, Date]>(() => {
    if (visao === 'semana') {
      return [
        startOfWeek(diaSelecionado, { locale: ptBR }),
        endOfWeek(diaSelecionado, { locale: ptBR }),
      ]
    }
    if (visao === 'dia') return [startOfDay(diaSelecionado), endOfDay(diaSelecionado)]
    return [startOfWeek(startOfMonth(mes), { locale: ptBR }), endOfWeek(endOfMonth(mes), { locale: ptBR })]
  }, [visao, mes, diaSelecionado])

  const dias = useMemo(
    () => eachDayOfInterval({ start: gradeInicio, end: gradeFim }),
    [gradeInicio, gradeFim],
  )

  const horas = useMemo(
    () => Array.from({ length: HORA_FINAL - HORA_INICIAL + 1 }, (_, i) => HORA_INICIAL + i),
    [],
  )

  const carregar = useCallback(async () => {
    if (!user?.id) return
    setCarregando(true)
    setErro(null)
    try {
      const lista = await getEventos(gradeInicio.toISOString(), gradeFim.toISOString(), modo, user.id)
      setEventos(lista)
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível carregar a agenda')
    } finally {
      setCarregando(false)
    }
  }, [user?.id, gradeInicio, gradeFim, modo])

  useEffect(() => {
    void carregar()
  }, [carregar])

  useEffect(() => {
    getGrupos()
      .then(setGrupos)
      .catch(() => setGrupos([]))
  }, [])

  useEffect(() => {
    getStatusDoOutlook().then(setConexao)
  }, [])

  /**
   * Compromissos do Outlook do período visível.
   *
   * Consulta AO VIVO, sem copiar para o nosso banco — é o que evita compromisso
   * duplicado e compromisso fantasma, e é o que faz repetição funcionar sem
   * implementarmos recorrência (a Microsoft já devolve as ocorrências
   * expandidas).
   *
   * Só nos modos que incluem a agenda pessoal: em "Setor" e "Grupos" o Outlook
   * de alguém não tem o que fazer ali.
   */
  const outlookNoModo = conexao.conectado && (modo === 'meus' || modo === 'tudo')

  const recarregarOutlook = useCallback(
    async (comIndicador = false) => {
      if (!outlookNoModo) {
        setDoOutlookNoPeriodo([])
        setErroOutlook(null)
        return
      }
      if (comIndicador) setAtualizandoOutlook(true)
      try {
        const lista = await getEventosDoOutlook(gradeInicio.toISOString(), gradeFim.toISOString())
        setDoOutlookNoPeriodo(lista)
        setErroOutlook(null)
        setUltimaSync(new Date())
      } catch (e) {
        setDoOutlookNoPeriodo([])
        setErroOutlook(e instanceof Error ? e.message : 'Não foi possível ler o Outlook')
        // Conexão revogada ou expirada: o servidor apaga a linha e responde 409,
        // então a tela volta a oferecer "Conectar" em vez de insistir no erro.
        if (e instanceof Error && /não conectado|expirou/i.test(e.message)) {
          setConexao((c) => ({ ...c, conectado: false }))
        }
      } finally {
        if (comIndicador) setAtualizandoOutlook(false)
      }
    },
    [outlookNoModo, gradeInicio, gradeFim],
  )

  useEffect(() => {
    void recarregarOutlook()
  }, [recarregarOutlook, recarregaOutlook])

  /**
   * Atualização automática — SÓ COM A ABA VISÍVEL.
   *
   * O `visibilitychange` é o que reagenda: com a aba escondida o intervalo é
   * desmontado inteiro, e volta ao reaparecer (já disparando uma vez, para quem
   * volta depois de horas não olhar dado velho).
   *
   * Este cuidado não é teórico. O `setInterval(refetchOpen, 25000)` do ChatHub
   * seguia disparando com o app minimizado — cada ciclo aqui é uma ida ao
   * Microsoft Graph, e a janela minimizada a noite inteira somaria centenas de
   * chamadas para uma tela que ninguém está olhando.
   */
  useEffect(() => {
    if (!outlookNoModo) return
    let timer: ReturnType<typeof setInterval> | null = null

    const parar = () => {
      if (timer) clearInterval(timer)
      timer = null
    }
    const comecar = () => {
      parar()
      timer = setInterval(() => void recarregarOutlook(), INTERVALO_SYNC_MS)
    }
    const aoMudarVisibilidade = () => {
      if (document.visibilityState === 'visible') {
        void recarregarOutlook()
        comecar()
      } else {
        parar()
      }
    }

    if (document.visibilityState === 'visible') comecar()
    document.addEventListener('visibilitychange', aoMudarVisibilidade)
    window.addEventListener('focus', aoMudarVisibilidade)
    return () => {
      parar()
      document.removeEventListener('visibilitychange', aoMudarVisibilidade)
      window.removeEventListener('focus', aoMudarVisibilidade)
    }
  }, [outlookNoModo, recarregarOutlook])

  /** Só para o rótulo "atualizado há X" não congelar na tela. */
  useEffect(() => {
    const t = setInterval(() => setTiquetaque((n) => n + 1), 30_000)
    return () => clearInterval(t)
  }, [])

  /**
   * Agenda interna ao vivo: compromisso de setor ou de grupo criado por outra
   * pessoa aparece sem ninguém recarregar nada.
   *
   * `onSubscribed` refaz a consulta quando o canal (re)conecta — é a janela
   * entre o primeiro fetch e o handshake do websocket, em que uma mudança
   * chegaria e se perderia em silêncio.
   */
  useRealtime<Record<string, unknown>>(
    'agenda_events',
    // O payload é ignorado de propósito: `carregar()` refaz a consulta com o
    // filtro de período e de modo já aplicados, e o `DELETE` do realtime traz
    // só a chave primária — não daria para decidir se a linha apagada sequer
    // estava na tela. Uma consulta a mais custa menos que um estado errado.
    () => void carregar(),
    Boolean(user?.id),
    undefined,
    () => void carregar(),
  )

  /**
   * Tudo o que aparece na tela, das duas origens, na forma comum — e por dia,
   * para a grade não varrer a lista inteira 42 vezes.
   *
   * Ordenado por horário DENTRO do dia: sem isso os compromissos do Outlook
   * cairiam todos depois dos nossos, e a lista do dia deixaria de ser uma linha
   * do tempo.
   */
  const porDia = useMemo(() => {
    const todos: ItemDaAgenda[] = [
      ...eventos.map((ev) => daNossaAgenda(ev, user?.id, souAdmin)),
      ...doOutlookNoPeriodo.map(doOutlook),
    ]
    const mapa = new Map<string, ItemDaAgenda[]>()
    for (const ev of todos) {
      const quando = new Date(ev.starts_at)
      if (Number.isNaN(quando.getTime())) continue
      const chave = format(quando, 'yyyy-MM-dd')
      const atual = mapa.get(chave) || []
      atual.push(ev)
      mapa.set(chave, atual)
    }
    for (const lista of mapa.values()) {
      lista.sort((a, b) => a.starts_at.localeCompare(b.starts_at))
    }
    return mapa
  }, [eventos, doOutlookNoPeriodo, user?.id, souAdmin])

  const doDiaSelecionado = porDia.get(format(diaSelecionado, 'yyyy-MM-dd')) || []

  /**
   * A lista lateral, na ordem em que ela é lida: importante em cima.
   *
   * Derivado, não no lugar — `porDia` continua cronológico porque as grades
   * dependem disso (ver o comentário em `ordem.ts`). A cópia com spread existe
   * porque `sort` muda o array no lugar, e o original é o mesmo objeto guardado
   * no `Map` do `porDia`: ordenar direto ali bagunçaria as grades.
   */
  const doDiaOrdenado = useMemo(
    () => [...doDiaSelecionado].sort(porImportanciaDepoisHorario),
    [doDiaSelecionado],
  )

  /** O que a busca deixa passar. Sem termo digitado, passa tudo. */
  const doDiaVisivel = useMemo(() => {
    const termo = busca.trim().toLowerCase()
    if (!termo) return doDiaOrdenado
    return doDiaOrdenado.filter((ev) =>
      `${ev.titulo} ${ev.descricao ?? ''}`.toLowerCase().includes(termo),
    )
  }, [doDiaOrdenado, busca])

  /**
   * Trocar de dia zera a busca.
   *
   * Sem isto, um termo digitado num dia continuaria filtrando o dia seguinte —
   * e como a lista lateral é a única coisa que a busca afeta, a pessoa veria
   * "nada encontrado" num dia cheio e não teria pista do porquê. É efeito e não
   * um `selecionarDia()` porque o dia muda por cinco caminhos diferentes
   * (setas, "hoje", clique no mês, clique na semana, atalho) — um só lugar
   * cobre todos, inclusive os que vierem depois.
   */
  useEffect(() => {
    setBusca('')
  }, [diaSelecionado])

  /**
   * Navegar significa coisa diferente em cada visão — mês a mês, semana a
   * semana, dia a dia. No mês o `diaSelecionado` acompanha, senão a lista
   * lateral continuaria mostrando um dia que não está mais na grade.
   */
  const navegar = (passo: number) => {
    if (visao === 'mes') {
      const novo = passo > 0 ? addMonths(mes, 1) : subMonths(mes, 1)
      setMes(novo)
      setDiaSelecionado(startOfDay(startOfMonth(novo)))
      return
    }
    const salto = visao === 'semana'
      ? (passo > 0 ? addWeeks(diaSelecionado, 1) : subWeeks(diaSelecionado, 1))
      : (passo > 0 ? addDays(diaSelecionado, 1) : subDays(diaSelecionado, 1))
    setDiaSelecionado(startOfDay(salto))
    setMes(startOfMonth(salto))
  }

  const irParaHoje = () => {
    const hoje = new Date()
    setDiaSelecionado(startOfDay(hoje))
    setMes(startOfMonth(hoje))
  }

  const rotuloDoPeriodo = useMemo(() => {
    if (visao === 'dia') return format(diaSelecionado, "d 'de' MMMM 'de' yyyy", { locale: ptBR })
    if (visao === 'semana') {
      const de = startOfWeek(diaSelecionado, { locale: ptBR })
      const ate = endOfWeek(diaSelecionado, { locale: ptBR })
      // Semana que atravessa o mês precisa dizer os dois, senão "1 – 7 de set"
      // esconderia que começou em agosto.
      return isSameMonth(de, ate)
        ? `${format(de, 'd')} – ${format(ate, "d 'de' MMMM", { locale: ptBR })}`
        : `${format(de, "d 'de' MMM", { locale: ptBR })} – ${format(ate, "d 'de' MMM", { locale: ptBR })}`
    }
    return format(mes, "MMMM 'de' yyyy", { locale: ptBR })
  }, [visao, mes, diaSelecionado])

  const abrirNovo = (dia?: Date) => {
    setEditando(null)
    setRascunho(rascunhoVazio(dia ?? diaSelecionado))
    setDialogoAberto(true)
  }

  /**
   * Abre o diálogo já preenchido. `datetime-local` exige horário LOCAL sem
   * fuso, e o que temos é ISO — daí o `paraCampoLocal(new Date(...))`, que
   * converte para o fuso do navegador em vez de cortar a string.
   */
  const abrirEdicao = (ev: ItemDaAgenda) => {
    setEditando(ev)
    setRascunho({
      titulo: ev.titulo,
      descricao: ev.descricao ?? '',
      inicio: paraCampoLocal(new Date(ev.starts_at)),
      fim: paraCampoLocal(new Date(ev.ends_at)),
      diaInteiro: ev.dia_inteiro,
      importancia: ev.importancia,
      link: ev.link ?? '',
      email: ev.email ?? '',
      escopo: ev.escopo ?? 'usuario',
      groupId: ev.groupId ?? '',
      noOutlook: ev.origem === 'outlook',
      // Já convidado continua marcado — o diálogo tranca a caixa nesse caso
      // (ver `DialogoDoCompromisso`), então isto é o que a pessoa vê como
      // estado atual, não uma escolha nova.
      convidarOutlook: Boolean(ev.outlook_event_id),
    })
    setDialogoAberto(true)
  }

  /**
   * Manda (ou refaz) o convite do grupo no Outlook e GRAVA o desfecho na linha
   * do compromisso.
   *
   * O DESFECHO É SEMPRE GRAVADO — deu certo ou não. Sem isso a falha viraria um
   * toast que some em cinco segundos: quem marcou acharia que convidou o grupo
   * e só descobriria que ninguém foi convidado quando a sala ficasse vazia. Com
   * a mensagem na linha, o cartão do dia mostra o aviso e oferece tentar de
   * novo, quantas vezes forem precisas.
   *
   * Esta função NUNCA lança. Ela é chamada depois de o compromisso já estar
   * salvo, e o convite é um extra: uma exceção aqui subindo para o `catch` do
   * `salvar()` faria a tela dizer "não foi possível criar o compromisso" sobre
   * um compromisso que foi criado.
   *
   * Com `outlookEventId` preenchido é PATCH (o mesmo evento, lista de
   * convidados recalculada do grupo de agora); sem ele é POST, criando o evento
   * na caixa de quem está chamando. Repare que essa distinção é o que permite
   * ligar o convite depois, num compromisso de grupo que nasceu sem ele.
   */
  const sincronizarConviteDoGrupo = useCallback(
    async (params: {
      eventoId: string
      groupId: string
      outlookEventId: string | null
      corpo: RascunhoDoOutlook
    }): Promise<{ ok: boolean; titulo: string; detalhe?: string }> => {
      try {
        const corpo = { ...params.corpo, group_id: params.groupId }
        const resposta = params.outlookEventId
          ? await atualizarNoOutlook(params.outlookEventId, corpo)
          : await criarNoOutlook(corpo)

        await atualizarEvento(params.eventoId, {
          outlook_event_id: resposta.id,
          outlook_ical_uid: resposta.ical_uid,
          outlook_sync_erro: null,
        })

        const quantos = resposta.convidados ?? 0
        return {
          ok: true,
          titulo: 'Compromisso salvo e grupo convidado',
          // Zero convidados não é erro: pode ser um grupo em que só o criador
          // conectou o Outlook. Dizer isso evita a pessoa ficar esperando uma
          // confirmação que nunca vai chegar de ninguém.
          detalhe:
            quantos === 0
              ? 'Ninguém mais do grupo tem o Outlook conectado — o convite ficou só na sua agenda.'
              : quantos === 1
                ? '1 pessoa do grupo recebeu o convite no Outlook.'
                : `${quantos} pessoas do grupo receberam o convite no Outlook.`,
        }
      } catch (e) {
        const mensagem = e instanceof Error ? e.message : 'Não foi possível convidar o grupo no Outlook'
        // O `.catch` vazio é intencional: se até a gravação do erro falhar (o
        // banco caiu junto), não há mais nada a fazer aqui, e deixar essa
        // segunda falha estourar apagaria a primeira, que é a informativa.
        await atualizarEvento(params.eventoId, { outlook_sync_erro: mensagem }).catch(() => {})
        return {
          ok: false,
          titulo: 'Compromisso salvo, mas o convite no Outlook falhou',
          detalhe: mensagem,
        }
      }
    },
    [],
  )

  /** O botão "tentar de novo" do cartão, para um convite que falhou antes. */
  const reenviarConvite = async (ev: ItemDaAgenda) => {
    if (!ev.groupId || reenviandoConvite) return
    setReenviandoConvite(ev.id)
    try {
      const desfecho = await sincronizarConviteDoGrupo({
        eventoId: ev.id,
        groupId: ev.groupId,
        outlookEventId: ev.outlook_event_id,
        // O Graph quer horário LOCAL sem fuso (a função declara
        // America/Sao_Paulo por nós) e o que temos guardado é ISO em UTC —
        // recortar a string traria o compromisso três horas fora do lugar.
        corpo: {
          titulo: ev.titulo,
          descricao: ev.descricao,
          inicio: paraCampoLocal(new Date(ev.starts_at)),
          fim: paraCampoLocal(new Date(ev.ends_at)),
          dia_inteiro: ev.dia_inteiro,
        },
      })
      toast({
        title: desfecho.ok ? 'Grupo convidado no Outlook' : desfecho.titulo,
        description: desfecho.detalhe,
        variant: desfecho.ok ? undefined : 'destructive',
      })
      await carregar()
    } finally {
      setReenviandoConvite(null)
    }
  }

  const salvar = async () => {
    if (!user?.id) return
    if (!rascunho.titulo.trim()) {
      toast({ title: 'Dê um título ao compromisso', variant: 'destructive' })
      return
    }
    if (rascunho.escopo === 'grupo' && !rascunho.groupId) {
      toast({ title: 'Escolha o grupo', variant: 'destructive' })
      return
    }
    if (rascunho.escopo === 'setor' && !user.department) {
      toast({
        title: 'Seu usuário não tem setor definido',
        description: 'Peça a um administrador para preencher o setor no seu cadastro.',
        variant: 'destructive',
      })
      return
    }

    const inicio = new Date(rascunho.inicio)
    const fim = new Date(rascunho.fim)
    if (Number.isNaN(inicio.getTime()) || Number.isNaN(fim.getTime())) {
      toast({ title: 'Data inválida', variant: 'destructive' })
      return
    }
    if (fim < inicio) {
      toast({ title: 'O fim não pode ser antes do início', variant: 'destructive' })
      return
    }

    setSalvando(true)
    try {
      /*
        Compromisso do Outlook mora SÓ no Outlook. Ele volta para a tela pela
        consulta ao vivo — gravar também no nosso banco criaria exatamente a
        duplicata que a consulta ao vivo existe para evitar.
      */
      const noOutlook = rascunho.escopo === 'usuario' && rascunho.noOutlook
      const doOutlookEditando = editando?.origem === 'outlook'

      if (noOutlook || doOutlookEditando) {
        const corpo = {
          titulo: rascunho.titulo.trim(),
          descricao: rascunho.descricao.trim() || null,
          inicio: rascunho.inicio,
          fim: rascunho.fim,
          dia_inteiro: rascunho.diaInteiro,
        }
        if (doOutlookEditando) {
          await atualizarNoOutlook(idNoOutlook(editando.id), corpo)
          toast({
            title: 'Compromisso atualizado no Outlook',
            description: editando.seRepete ? 'A mudança vale só para este dia.' : undefined,
          })
        } else {
          await criarNoOutlook(corpo)
          toast({ title: 'Compromisso criado no Outlook' })
        }
        setDialogoAberto(false)
        setRecarregaOutlook((n) => n + 1)
        return
      }

      const campos = {
        titulo: rascunho.titulo.trim(),
        descricao: rascunho.descricao.trim() || null,
        starts_at: inicio.toISOString(),
        ends_at: fim.toISOString(),
        dia_inteiro: rascunho.diaInteiro,
        importancia: rascunho.importancia,
        link: rascunho.link.trim() || null,
        email: rascunho.email.trim() || null,
        escopo: rascunho.escopo,
        setor: rascunho.escopo === 'setor' ? user.department : null,
        group_id: rascunho.escopo === 'grupo' ? rascunho.groupId : null,
      }

      let salvo
      if (editando) {
        // `created_by` e `assigned_to` ficam DE FORA: quem editou não vira dono,
        // e a designação tem gatilho próprio no banco (`agenda_events_designacao`).
        salvo = await atualizarEvento(editando.id, campos)
      } else {
        salvo = await criarEvento({ ...campos, created_by: user.id, assigned_to: null })
      }

      /*
        O CONVITE VEM DEPOIS, E NÃO PODE DESFAZER O QUE JÁ FOI SALVO.

        Nesta altura o compromisso já existe no banco. Se o Graph recusar, a
        pessoa perde o convite, não a reunião — e é por isso que a chamada está
        aqui embaixo e não antes, e por isso `sincronizarConviteDoGrupo` engole
        a exceção em vez de deixá-la cair no `catch` lá de baixo (que diria
        "não foi possível criar o compromisso" sobre um compromisso criado).

        `souOCriador` na condição de edição não é zelo: o evento no Outlook mora
        na caixa de quem criou, e o `outlook_event_id` só vale com o token dele.
        Um admin editando o compromisso de outra pessoa criaria um evento novo
        na PRÓPRIA caixa, sobrescreveria o id na linha, e o original ficaria
        órfão no Outlook do criador — vivo e sem ninguém capaz de cancelá-lo.
      */
      const convidar =
        rascunho.escopo === 'grupo' &&
        rascunho.convidarOutlook &&
        conexao.conectado &&
        Boolean(salvo.group_id) &&
        (!editando || editando.souOCriador)

      if (convidar) {
        const desfecho = await sincronizarConviteDoGrupo({
          eventoId: salvo.id,
          groupId: String(salvo.group_id),
          // Ao editar, reaproveita o evento que já existe lá; ao criar, é nulo
          // e a função faz o POST.
          outlookEventId: editando?.outlook_event_id ?? null,
          corpo: {
            titulo: campos.titulo,
            descricao: campos.descricao,
            inicio: rascunho.inicio,
            fim: rascunho.fim,
            dia_inteiro: rascunho.diaInteiro,
          },
        })
        toast({
          title: desfecho.titulo,
          description: desfecho.detalhe,
          variant: desfecho.ok ? undefined : 'destructive',
        })
      } else {
        toast({ title: editando ? 'Compromisso atualizado' : 'Compromisso criado' })
      }

      setDialogoAberto(false)
      await carregar()
    } catch (e) {
      toast({
        title: e instanceof Error ? e.message : 'Não foi possível criar o compromisso',
        variant: 'destructive',
      })
    } finally {
      setSalvando(false)
    }
  }

  /**
   * Excluir, pedindo confirmação — e avisando o caso que engana.
   *
   * Uma OCORRÊNCIA de compromisso que se repete tem id próprio: apagá-la apaga
   * aquele dia e a repetição continua. Sem dizer isso, alguém apaga "a reunião
   * de segunda" achando que cancelou a série inteira e só descobre na semana
   * seguinte.
   */
  const remover = async (ev: ItemDaAgenda) => {
    const aviso = ev.seRepete
      ? `"${ev.titulo}" se repete.\n\nIsto apaga SÓ este dia. A repetição continua nas outras datas.`
      : `Excluir "${ev.titulo}"?`
    if (!window.confirm(aviso)) return

    try {
      if (ev.origem === 'outlook') {
        await excluirDoOutlook(idNoOutlook(ev.id))
        toast({ title: ev.seRepete ? 'Este dia foi excluído' : 'Compromisso excluído do Outlook' })
        setRecarregaOutlook((n) => n + 1)
        return
      }
      /*
        Compromisso de grupo com convite: cancela no Outlook ANTES de apagar
        daqui.

        A ordem importa. Apagar a linha primeiro perderia o `outlook_event_id`,
        e o evento continuaria vivo na agenda de todo mundo que foi convidado,
        sem nenhum caminho no app para cancelá-lo. Cancelar na caixa do
        organizador é o que faz o Exchange retirar a cópia de cada convidado.

        A falha do Graph NÃO impede a exclusão local — senão um Outlook fora do
        ar transformaria o compromisso numa linha impossível de apagar. O 404 já
        volta como sucesso da própria função (é o caso de quem apagou pelo
        celular antes), então o que sobra aqui é falha de verdade, e ela vira
        aviso no lugar da confirmação.

        `souOCriador` porque o id só existe na caixa dele: um admin apagando o
        compromisso de outra pessoa chamaria o Graph com o token errado. Nesse
        caso o evento fica mesmo órfão no Outlook do criador — a alternativa
        seria esta função escrever na caixa de quem não pediu nada, o que é
        justamente o poder que o modelo organizador+attendees existe para não
        precisar ter.
      */
      let avisoDoOutlook: string | null = null
      if (ev.outlook_event_id && ev.souOCriador) {
        try {
          await excluirDoOutlook(ev.outlook_event_id)
        } catch (e) {
          avisoDoOutlook = e instanceof Error ? e.message : 'O Outlook não respondeu.'
        }
      }

      await excluirEvento(ev.id)
      toast(
        avisoDoOutlook
          ? {
              title: 'Compromisso excluído aqui, mas o convite pode ter ficado no Outlook',
              description: `${avisoDoOutlook} Confira na sua agenda da Microsoft.`,
              variant: 'destructive',
            }
          : { title: 'Compromisso excluído' },
      )
      await carregar()
    } catch (e) {
      toast({
        title: e instanceof Error ? e.message : 'Não foi possível excluir',
        variant: 'destructive',
      })
    }
  }

  const ligarOutlook = async () => {
    try {
      await conectarOutlook()
      toast({
        title: 'Abrimos a autorização da Microsoft',
        description: 'Ao terminar, volte para esta aba e a conexão já estará feita.',
      })
    } catch (e) {
      toast({
        title: e instanceof Error ? e.message : 'Não foi possível iniciar a conexão',
        variant: 'destructive',
      })
    }
  }

  const desligarOutlook = async () => {
    try {
      await desconectarOutlook()
      setConexao((c) => ({ ...c, conectado: false, conta_email: null }))
      setDoOutlookNoPeriodo([])
      toast({ title: 'Outlook desconectado' })
    } catch (e) {
      toast({
        title: e instanceof Error ? e.message : 'Não foi possível desconectar',
        variant: 'destructive',
      })
    }
  }

  /**
   * A conexão termina numa ABA à parte (o retorno cai na função do servidor,
   * não no app). Ao voltar o foco para cá, reconsultamos — assim a tela se
   * atualiza sozinha, sem a pessoa precisar recarregar nada.
   */
  useEffect(() => {
    const aoVoltar = () => {
      if (document.visibilityState === 'visible') getStatusDoOutlook().then(setConexao)
    }
    window.addEventListener('focus', aoVoltar)
    document.addEventListener('visibilitychange', aoVoltar)
    return () => {
      window.removeEventListener('focus', aoVoltar)
      document.removeEventListener('visibilitychange', aoVoltar)
    }
  }, [])

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center justify-between gap-3 px-6 pt-6">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <CalendarDays className="h-6 w-6 text-primary" />
            Agenda
          </h1>
          <p className="text-sm text-muted-foreground">
            Compromissos seus, do seu setor e dos seus grupos.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {outlookNoModo && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => void recarregarOutlook(true)}
              disabled={atualizandoOutlook}
              className="gap-1.5"
            >
              <RefreshCw className={cn('h-3.5 w-3.5', atualizandoOutlook && 'animate-spin')} />
              {atualizandoOutlook ? 'Atualizando…' : 'Atualizar'}
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => setGruposAberto(true)} className="gap-1.5">
            <Users className="h-3.5 w-3.5" />
            Grupos
          </Button>
          <Button onClick={() => abrirNovo()} className="gap-1.5">
            <Plus className="h-4 w-4" />
            Novo compromisso
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 px-6 pt-4">
        <div className="flex flex-wrap items-center gap-2">
          <Tabs value={modo} onValueChange={(v) => setModo(v as ModoDaAgenda)}>
            <TabsList>
              {MODOS.map((m) => (
                <TabsTrigger key={m.valor} value={m.valor}>
                  {m.rotulo}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>

          <Tabs value={visao} onValueChange={(v) => setVisao(v as Visao)}>
            <TabsList>
              {VISOES.map((v) => (
                <TabsTrigger key={v.valor} value={v.valor}>
                  {v.rotulo}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>

        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={irParaHoje}>
            Hoje
          </Button>
          <Button variant="ghost" size="icon" onClick={() => navegar(-1)} aria-label="Período anterior">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="min-w-[12rem] text-center text-sm font-medium capitalize">
            {rotuloDoPeriodo}
          </span>
          <Button variant="ghost" size="icon" onClick={() => navegar(1)} aria-label="Próximo período">
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <BarraDoOutlook
        conexao={conexao}
        erroOutlook={erroOutlook}
        erro={erro}
        aoConectar={ligarOutlook}
        aoDesconectar={desligarOutlook}
      />

      <div
        className={cn(
          'grid flex-1 gap-6 overflow-auto p-6',
          visao === 'mes' && 'lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]',
          visao === 'dia' && 'lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]',
        )}
      >
        {visao === 'mes' && (
          <GradeDoMes
            dias={dias}
            mes={mes}
            diaSelecionado={diaSelecionado}
            porDia={porDia}
            aoSelecionarDia={setDiaSelecionado}
            aoMarcarNoDia={abrirNovo}
          />
        )}

        {(visao === 'semana' || visao === 'dia') && (
          <GradeDeHoras
            dias={dias}
            horas={horas}
            porDia={porDia}
            aoSelecionarDia={setDiaSelecionado}
            aoMarcarNoDia={abrirNovo}
            aoAbrirCompromisso={abrirEdicao}
          />
        )}

        {/* A lista lateral não aparece na semana: ali as sete colunas já são a
            lista, e uma coluna a mais só espremeria a grade. */}
        {visao !== 'semana' && (
          <div className="superficie-vidro flex flex-col gap-3 rounded-xl p-4">
            <div className="flex items-baseline justify-between gap-2">
              <p className="text-sm font-medium capitalize">
                {format(diaSelecionado, "EEEE, d 'de' MMMM", { locale: ptBR })}
              </p>
              {ultimaSync && outlookNoModo && (
                <span className="shrink-0 text-[11px] text-muted-foreground">
                  Outlook {haQuantoTempo(ultimaSync)}
                </span>
              )}
            </div>

            {/* A busca só aparece quando há o que buscar: num dia vazio ela
                seria um campo que não filtra nada. */}
            {doDiaSelecionado.length > 0 && (
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                  placeholder="Buscar por nome"
                  className="h-9 pl-8 pr-8"
                />
                {busca && (
                  <button
                    type="button"
                    onClick={() => setBusca('')}
                    aria-label="Limpar busca"
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            )}

            {carregando ? (
              <p className="text-sm text-muted-foreground">Carregando…</p>
            ) : doDiaSelecionado.length === 0 ? (
              <div className="text-sm text-muted-foreground">
                <p>Nada marcado para este dia.</p>
                <button
                  type="button"
                  onClick={() => abrirNovo(diaSelecionado)}
                  className="mt-2 inline-flex items-center gap-1 text-xs text-primary hover:underline"
                >
                  <Plus className="h-3 w-3" /> Marcar algo neste dia
                </button>
              </div>
            ) : doDiaVisivel.length === 0 ? (
              /* Dia TEM compromisso, a busca é que não achou — dizer "nada
                 marcado" aqui seria mentira e faria a pessoa duvidar do que
                 ela mesma agendou. */
              <p className="text-sm text-muted-foreground">
                Nada encontrado para «{busca.trim()}» neste dia.
              </p>
            ) : (
              doDiaVisivel.map((ev) => (
                <CartaoDoCompromisso
                  key={ev.id}
                  ev={ev}
                  aoEditar={abrirEdicao}
                  aoExcluir={remover}
                  aoReenviarConvite={reenviarConvite}
                  reenviandoConvite={reenviandoConvite === ev.id}
                />
              ))
            )}
          </div>
        )}
      </div>

      <DialogoDeGrupos
        aberto={gruposAberto}
        aoFechar={() => setGruposAberto(false)}
        meuId={user?.id ?? ''}
        souAdmin={souAdmin}
        // Recarrega o seletor de escopo do diálogo de compromisso: sem isto, um
        // grupo recém-criado não apareceria na lista até recarregar a página.
        aoMudarGrupos={() => {
          getGrupos().then(setGrupos).catch(() => setGrupos([]))
          void carregar()
        }}
      />

      <DialogoDoCompromisso
        aberto={dialogoAberto}
        aoAbrirMudar={(v) => {
          setDialogoAberto(v)
          if (!v) setEditando(null)
        }}
        editando={editando}
        rascunho={rascunho}
        setRascunho={setRascunho}
        grupos={grupos}
        conexao={conexao}
        salvando={salvando}
        aoSalvar={salvar}
      />
    </div>
  )
}
