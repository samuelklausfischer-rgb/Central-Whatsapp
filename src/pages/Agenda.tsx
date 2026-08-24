import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  startOfDay,
  startOfMonth,
  startOfWeek,
  subMonths,
} from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { CalendarDays, ChevronLeft, ChevronRight, Link2, Mail, Plus, Trash2, Users } from 'lucide-react'
import { Dialog, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { GlassDialogContent } from '@/components/ui/glass-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useAuth } from '@/hooks/use-auth'
import { useToast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import {
  criarEvento,
  excluirEvento,
  getEventos,
  getGrupos,
  type EventoComPessoas,
  type ModoDaAgenda,
} from '@/services/agenda'
import type { AgendaEscopo, AgendaGroup, AgendaImportancia } from '@/lib/supabase/types'
import {
  conectar as conectarOutlook,
  desconectar as desconectarOutlook,
  getEventosDoOutlook,
  getStatus as getStatusDoOutlook,
  criarNoOutlook,
  type EventoDoOutlook,
  type StatusDaConexao,
} from '@/services/agenda_microsoft'

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

/**
 * Cor por importância. Fica aqui, e não no banco, porque é decisão de tela:
 * mudar a paleta não deveria pedir migration.
 */
const CORES_IMPORTANCIA: Record<AgendaImportancia, string> = {
  baixa: 'bg-slate-500/15 text-slate-300 border-slate-500/30',
  normal: 'bg-blue-500/15 text-blue-300 border-blue-500/30',
  alta: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  urgente: 'bg-red-500/15 text-red-300 border-red-500/30',
}

const DIAS_DA_SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']

/** `datetime-local` quer 'YYYY-MM-DDTHH:mm' no horário LOCAL, sem fuso. */
function paraCampoLocal(d: Date): string {
  return format(d, "yyyy-MM-dd'T'HH:mm")
}

/**
 * Um compromisso na tela pode vir de dois lugares: do nosso banco ou do Outlook
 * da pessoa. Esta é a forma comum, para a grade e a lista do dia não precisarem
 * saber a diferença — só o rótulo de origem muda.
 */
interface ItemDaAgenda {
  id: string
  titulo: string
  descricao: string | null
  starts_at: string
  ends_at: string
  dia_inteiro: boolean
  importancia: AgendaImportancia
  link: string | null
  email: string | null
  origem: 'interna' | 'outlook'
  escopo: AgendaEscopo | null
  setor: string | null
  /** Só compromisso NOSSO pode ser excluído daqui; o do Outlook é leitura. */
  podeExcluir: boolean
}

function daNossaAgenda(ev: EventoComPessoas, meuId: string | undefined): ItemDaAgenda {
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
    podeExcluir: ev.created_by === meuId,
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
    podeExcluir: false,
  }
}

interface Rascunho {
  titulo: string
  descricao: string
  inicio: string
  fim: string
  diaInteiro: boolean
  importancia: AgendaImportancia
  link: string
  email: string
  escopo: AgendaEscopo
  groupId: string
  /** Salvar no Outlook em vez de na nossa agenda. Só para escopo pessoal. */
  noOutlook: boolean
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

  // A grade cobre semanas inteiras, então vai um pouco além do mês nas duas
  // pontas — e a consulta precisa cobrir o MESMO intervalo, senão os dias que
  // sobram do mês vizinho aparecem sempre vazios.
  const gradeInicio = useMemo(() => startOfWeek(startOfMonth(mes), { locale: ptBR }), [mes])
  const gradeFim = useMemo(() => endOfWeek(endOfMonth(mes), { locale: ptBR }), [mes])
  const dias = useMemo(
    () => eachDayOfInterval({ start: gradeInicio, end: gradeFim }),
    [gradeInicio, gradeFim],
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
  useEffect(() => {
    if (!conexao.conectado || (modo !== 'meus' && modo !== 'tudo')) {
      setDoOutlookNoPeriodo([])
      setErroOutlook(null)
      return
    }
    let vivo = true
    getEventosDoOutlook(gradeInicio.toISOString(), gradeFim.toISOString())
      .then((lista) => {
        if (!vivo) return
        setDoOutlookNoPeriodo(lista)
        setErroOutlook(null)
      })
      .catch((e) => {
        if (!vivo) return
        setDoOutlookNoPeriodo([])
        setErroOutlook(e instanceof Error ? e.message : 'Não foi possível ler o Outlook')
        // Conexão revogada ou expirada: o servidor apaga a linha e responde 409,
        // então a tela volta a oferecer "Conectar" em vez de insistir no erro.
        if (e instanceof Error && /não conectado|expirou/i.test(e.message)) {
          setConexao((c) => ({ ...c, conectado: false }))
        }
      })
    return () => {
      vivo = false
    }
  }, [conexao.conectado, modo, gradeInicio, gradeFim, recarregaOutlook])

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
      ...eventos.map((ev) => daNossaAgenda(ev, user?.id)),
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
  }, [eventos, doOutlookNoPeriodo, user?.id])

  const doDiaSelecionado = porDia.get(format(diaSelecionado, 'yyyy-MM-dd')) || []

  const abrirNovo = () => {
    setRascunho(rascunhoVazio(diaSelecionado))
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
        Salvar no Outlook NÃO grava também no nosso banco. O compromisso volta
        pela consulta ao vivo — gravar dos dois lados criaria exatamente o
        compromisso duplicado que a consulta ao vivo existe para evitar.
      */
      if (rascunho.escopo === 'usuario' && rascunho.noOutlook) {
        await criarNoOutlook({
          titulo: rascunho.titulo.trim(),
          descricao: rascunho.descricao.trim() || null,
          inicio: rascunho.inicio,
          fim: rascunho.fim,
          dia_inteiro: rascunho.diaInteiro,
        })
        setDialogoAberto(false)
        toast({ title: 'Compromisso criado no Outlook' })
        setRecarregaOutlook((n) => n + 1)
        return
      }

      await criarEvento({
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
        created_by: user.id,
        assigned_to: null,
      })
      setDialogoAberto(false)
      toast({ title: 'Compromisso criado' })
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

  const remover = async (id: string) => {
    try {
      await excluirEvento(id)
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
        <Button onClick={abrirNovo} className="gap-1.5">
          <Plus className="h-4 w-4" />
          Novo compromisso
        </Button>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 px-6 pt-4">
        <Tabs value={modo} onValueChange={(v) => setModo(v as ModoDaAgenda)}>
          <TabsList>
            {MODOS.map((m) => (
              <TabsTrigger key={m.valor} value={m.valor}>
                {m.rotulo}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" onClick={() => setMes((m) => subMonths(m, 1))} aria-label="Mês anterior">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="min-w-[10rem] text-center text-sm font-medium capitalize">
            {format(mes, "MMMM 'de' yyyy", { locale: ptBR })}
          </span>
          <Button variant="ghost" size="icon" onClick={() => setMes((m) => addMonths(m, 1))} aria-label="Próximo mês">
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/*
        Só aparece quando o servidor já tem as chaves do aplicativo. Sem elas,
        oferecer "Conectar" seria prometer um botão que daria erro.
      */}
      {conexao.configurado && (
        <div className="mx-6 mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-border/60 bg-accent/30 px-4 py-2.5">
          <CalendarDays className="h-4 w-4 shrink-0 text-sky-400" aria-hidden="true" />
          {conexao.conectado ? (
            <>
              <span className="min-w-0 flex-1 break-words text-sm text-muted-foreground">
                Outlook conectado{conexao.conta_email ? ` como ${conexao.conta_email}` : ''}
              </span>
              <Button variant="ghost" size="sm" onClick={desligarOutlook}>
                Desconectar
              </Button>
            </>
          ) : (
            <>
              <span className="min-w-0 flex-1 break-words text-sm text-muted-foreground">
                Conecte seu Outlook para ver aqui os compromissos que já estão lá.
              </span>
              <Button size="sm" onClick={ligarOutlook}>
                Conectar Outlook
              </Button>
            </>
          )}
        </div>
      )}

      {erroOutlook && (
        <p className="mx-6 mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-300">
          {erroOutlook} — os compromissos criados aqui continuam aparecendo normalmente.
        </p>
      )}

      {erro && (
        <p className="mx-6 mt-4 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400">
          {erro}
        </p>
      )}

      <div className="grid flex-1 gap-6 overflow-auto p-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="superficie-vidro rounded-xl p-3">
          <div className="grid grid-cols-7 gap-1 pb-2 text-center text-[11px] font-medium uppercase text-muted-foreground">
            {DIAS_DA_SEMANA.map((d) => (
              <span key={d}>{d}</span>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {dias.map((dia) => {
              const doDia = porDia.get(format(dia, 'yyyy-MM-dd')) || []
              const noMes = isSameMonth(dia, mes)
              const selecionado = isSameDay(dia, diaSelecionado)
              const hoje = isSameDay(dia, new Date())
              return (
                <button
                  key={dia.toISOString()}
                  type="button"
                  onClick={() => setDiaSelecionado(startOfDay(dia))}
                  className={cn(
                    'flex min-h-[76px] flex-col items-start gap-1 rounded-lg border p-1.5 text-left transition-colors',
                    noMes ? 'border-border/50' : 'border-transparent opacity-40',
                    selecionado ? 'border-primary bg-primary/10' : 'hover:bg-accent/50',
                  )}
                >
                  <span
                    className={cn(
                      'text-xs tabular-nums',
                      hoje ? 'rounded-full bg-primary px-1.5 font-semibold text-primary-foreground' : '',
                    )}
                  >
                    {format(dia, 'd')}
                  </span>
                  {/* No máximo dois no quadradinho: com mais, a célula cresce e a
                      grade inteira desalinha. O resto vira "+N" e aparece na
                      lista ao lado. */}
                  {doDia.slice(0, 2).map((ev) => (
                    <span
                      key={ev.id}
                      className={cn(
                        'w-full truncate rounded border px-1 text-[10px] leading-4',
                        CORES_IMPORTANCIA[ev.importancia],
                      )}
                    >
                      {ev.titulo}
                    </span>
                  ))}
                  {doDia.length > 2 && (
                    <span className="text-[10px] text-muted-foreground">+{doDia.length - 2}</span>
                  )}
                </button>
              )
            })}
          </div>
        </div>

        <div className="superficie-vidro flex flex-col gap-3 rounded-xl p-4">
          <p className="text-sm font-medium capitalize">
            {format(diaSelecionado, "EEEE, d 'de' MMMM", { locale: ptBR })}
          </p>

          {carregando ? (
            <p className="text-sm text-muted-foreground">Carregando…</p>
          ) : doDiaSelecionado.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nada marcado para este dia.</p>
          ) : (
            doDiaSelecionado.map((ev) => (
              <div key={ev.id} className="rounded-lg border border-border/60 bg-accent/30 p-3">
                <div className="flex items-start justify-between gap-2">
                  <p className="min-w-0 flex-1 break-words text-sm font-medium">{ev.titulo}</p>
                  {/* Origem antes de importância: saber DE ONDE vem é o que
                      responde "por que isso está aqui se eu não marquei". */}
                  {ev.origem === 'outlook' ? (
                    <span className="shrink-0 rounded border border-sky-500/30 bg-sky-500/10 px-1.5 text-[10px] text-sky-300">
                      Outlook
                    </span>
                  ) : (
                    <span
                      className={cn('shrink-0 rounded border px-1.5 text-[10px]', CORES_IMPORTANCIA[ev.importancia])}
                    >
                      {ev.importancia}
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {ev.dia_inteiro
                    ? 'Dia inteiro'
                    : `${format(new Date(ev.starts_at), 'HH:mm')} – ${format(new Date(ev.ends_at), 'HH:mm')}`}
                  {ev.escopo === 'setor' && ` · setor ${ev.setor}`}
                  {ev.escopo === 'grupo' && ' · grupo'}
                </p>
                {ev.descricao && (
                  <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{ev.descricao}</p>
                )}
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  {ev.link && (
                    <a
                      href={ev.link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                    >
                      <Link2 className="h-3 w-3" />
                      {ev.origem === 'outlook' ? 'Abrir no Outlook' : 'Abrir link'}
                    </a>
                  )}
                  {ev.email && (
                    <a
                      href={`mailto:${ev.email}`}
                      className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                    >
                      <Mail className="h-3 w-3" /> {ev.email}
                    </a>
                  )}
                  {/* Compromisso do Outlook é somente leitura aqui: apagar e
                      editar continuam sendo lá, para não existirem dois donos
                      do mesmo item. */}
                  {ev.podeExcluir && (
                    <button
                      type="button"
                      onClick={() => remover(ev.id)}
                      className="ml-auto inline-flex items-center gap-1 text-xs text-red-400 hover:underline"
                    >
                      <Trash2 className="h-3 w-3" /> Excluir
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <Dialog open={dialogoAberto} onOpenChange={setDialogoAberto}>
        <GlassDialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Novo compromisso</DialogTitle>
          </DialogHeader>

          <div className="grid gap-3 py-2">
            <div className="grid gap-1.5">
              <Label htmlFor="ag-titulo">Título</Label>
              <Input
                id="ag-titulo"
                value={rascunho.titulo}
                onChange={(e) => setRascunho((r) => ({ ...r, titulo: e.target.value }))}
                placeholder="Reunião de fechamento"
              />
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="ag-desc">Descrição</Label>
              <Textarea
                id="ag-desc"
                value={rascunho.descricao}
                onChange={(e) => setRascunho((r) => ({ ...r, descricao: e.target.value }))}
                placeholder="Detalhes, pauta, o que levar…"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="ag-inicio">Início</Label>
                <Input
                  id="ag-inicio"
                  type="datetime-local"
                  value={rascunho.inicio}
                  onChange={(e) => setRascunho((r) => ({ ...r, inicio: e.target.value }))}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="ag-fim">Término</Label>
                <Input
                  id="ag-fim"
                  type="datetime-local"
                  value={rascunho.fim}
                  onChange={(e) => setRascunho((r) => ({ ...r, fim: e.target.value }))}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label>Importância</Label>
                <Select
                  value={rascunho.importancia}
                  onValueChange={(v) => setRascunho((r) => ({ ...r, importancia: v as AgendaImportancia }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="baixa">Baixa</SelectItem>
                    <SelectItem value="normal">Normal</SelectItem>
                    <SelectItem value="alta">Alta</SelectItem>
                    <SelectItem value="urgente">Urgente</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="grid gap-1.5">
                <Label>Agenda</Label>
                <Select
                  value={rascunho.escopo}
                  onValueChange={(v) => setRascunho((r) => ({ ...r, escopo: v as AgendaEscopo }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="usuario">Só minha</SelectItem>
                    <SelectItem value="setor">Do meu setor</SelectItem>
                    <SelectItem value="grupo">De um grupo</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/*
              Só na agenda pessoal: "setor" e "grupo" são conceitos nossos, que
              não existem no Outlook de ninguém.
            */}
            {rascunho.escopo === 'usuario' && conexao.conectado && (
              <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-border/60 bg-accent/30 p-3">
                <Checkbox
                  checked={rascunho.noOutlook}
                  onCheckedChange={(v) => setRascunho((r) => ({ ...r, noOutlook: v === true }))}
                  className="mt-0.5"
                />
                <span className="min-w-0 text-sm">
                  Salvar no Outlook
                  <span className="block text-xs text-muted-foreground">
                    Vai para a sua agenda da Microsoft e aparece também no celular. Depois, editar
                    e excluir se faz por lá.
                  </span>
                </span>
              </label>
            )}

            {rascunho.escopo === 'grupo' && (
              <div className="grid gap-1.5">
                <Label className="flex items-center gap-1.5">
                  <Users className="h-3.5 w-3.5" /> Grupo
                </Label>
                <Select
                  value={rascunho.groupId}
                  onValueChange={(v) => setRascunho((r) => ({ ...r, groupId: v }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={grupos.length ? 'Escolha o grupo' : 'Você ainda não tem grupos'} />
                  </SelectTrigger>
                  <SelectContent>
                    {grupos.map((g) => (
                      <SelectItem key={g.id} value={g.id}>
                        {g.nome}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="ag-link">Link</Label>
                <Input
                  id="ag-link"
                  value={rascunho.link}
                  onChange={(e) => setRascunho((r) => ({ ...r, link: e.target.value }))}
                  placeholder="https://…"
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="ag-email">E-mail</Label>
                <Input
                  id="ag-email"
                  type="email"
                  value={rascunho.email}
                  onChange={(e) => setRascunho((r) => ({ ...r, email: e.target.value }))}
                  placeholder="pessoa@prn.com"
                />
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setDialogoAberto(false)} disabled={salvando}>
              Cancelar
            </Button>
            <Button onClick={salvar} disabled={salvando}>
              {salvando ? 'Salvando…' : 'Criar'}
            </Button>
          </DialogFooter>
        </GlassDialogContent>
      </Dialog>
    </div>
  )
}
