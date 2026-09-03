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
import { ChevronLeft, ChevronRight, CalendarDays, Plus, RefreshCw, Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
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
import {
  atualizarEvento,
  criarEvento,
  excluirEvento,
  getEventos,
  getGrupos,
  type EventoComPessoas,
  type ModoDaAgenda,
  type NovoEvento,
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
    seRepete: false,
    groupId: ev.group_id,
    cor: ev.cor,
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
    seRepete: seRepeteNoOutlook(ev),
    groupId: null,
    // Cor é campo só nosso: o Microsoft Graph tem categorias de cor próprias,
    // e este recurso não tenta traduzir uma coisa na outra.
    cor: null,
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
    cor: null,
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
  const [ultimaSync, setUltimaSync] = useState<Date | null>(null)
  /** Reconta sozinho para o "há X min" andar sem depender de outra mudança. */
  const [, setTiquetaque] = useState(0)

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
      cor: ev.cor,
    })
    setDialogoAberto(true)
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

      const campos: Record<string, unknown> = {
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

      /**
       * `cor` só entra no payload quando há algo definitivo a dizer sobre
       * ela — mesmo motivo do `p_sem_assinatura` em `services/messages.ts`
       * (~181-194 lá): a migration que cria a coluna pode ainda não ter sido
       * aplicada no banco quando este código subir, e `insert`/`update` com
       * uma chave que a tabela não tem falha o SALVAMENTO INTEIRO (o erro
       * vira "column \"cor\" does not exist"). Aqui isso não seria "a cor não
       * pegou" — seria "não deu para criar/editar o compromisso nenhum".
       *
       * Omitida por padrão, as duas pontas ficam independentes: criar/editar
       * compromisso continua funcionando IGUAL A HOJE mesmo sem a migration,
       * e o seletor de cor passa a ter efeito assim que ela for aplicada, sem
       * ordem obrigatória de deploy.
       *
       * `editando?.cor` truthy é a prova de que a coluna JÁ EXISTE neste
       * banco — um evento só chega com `cor` preenchida se o `select('*')` a
       * trouxe — e é o que permite mandar `cor: null` com segurança quando a
       * pessoa desmarca a cor de um compromisso que já tinha uma.
       */
      if (rascunho.cor) {
        campos.cor = rascunho.cor
      } else if (editando?.cor) {
        campos.cor = null
      }

      if (editando) {
        // `created_by` e `assigned_to` ficam DE FORA: quem editou não vira dono,
        // e a designação tem gatilho próprio no banco (`agenda_events_designacao`).
        await atualizarEvento(editando.id, campos as Partial<NovoEvento>)
        toast({ title: 'Compromisso atualizado' })
      } else {
        await criarEvento({ ...campos, created_by: user.id, assigned_to: null } as NovoEvento)
        toast({ title: 'Compromisso criado' })
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
      await excluirEvento(ev.id)
      toast({ title: 'Compromisso excluído' })
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
            ) : (
              doDiaSelecionado.map((ev) => (
                <CartaoDoCompromisso
                  key={ev.id}
                  ev={ev}
                  aoEditar={abrirEdicao}
                  aoExcluir={remover}
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
        conexaoConectada={conexao.conectado}
        salvando={salvando}
        aoSalvar={salvar}
      />
    </div>
  )
}
