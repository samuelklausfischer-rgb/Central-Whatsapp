import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { Mail, PenSquare, PanelLeftClose, PanelLeftOpen, Megaphone, Settings2 } from 'lucide-react'
import { Link, useSearchParams } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { AccountSwitcher } from '@/components/email/AccountSwitcher'
import { FolderTree } from '@/components/email/FolderTree'
import { EmailList } from '@/components/email/EmailList'
import { EmailBulkBar } from '@/components/email/EmailBulkBar'
import { EmailReader } from '@/components/email/EmailReader'
import { EmailComposer } from '@/components/email/EmailComposer'
import { MeusAjustesDialog } from '@/components/email/MeusAjustesDialog'
import { EmailPinDialog } from '@/components/email/EmailPinDialog'
import { EmailAtribuirDialog } from '@/components/email/EmailAtribuirDialog'
import { getEmailAccounts } from '@/services/email_accounts'
import { getFolders } from '@/services/email_folders'
import {
  getEmails, getEmail, searchEmails, markEmailRead, archiveEmail, markEmailStarred,
  marcarEmailsEmLote, arquivarEmailsEmLote, type ResultadoLote,
} from '@/services/emails'
import { getEmailState, setEmailStatus } from '@/services/email_states'
import { getFixados, type Fixado } from '@/services/email_fixados'
import {
  getAtribuicoes,
  listarColegas,
  type AtribuicaoDoEmail,
  type Colega,
} from '@/services/email_atribuicao'
import { getOrganizacaoEmLote, getClassificacoes } from '@/services/email_organizacao'
import { getLabels } from '@/services/labels'
import { getAiPrompts } from '@/services/ai_prompts'
import { supabase } from '@/lib/supabase/client'
import { useAuth } from '@/hooks/use-auth'
import { useToolAccess } from '@/hooks/use-tool-access'
import { useRealtime } from '@/hooks/use-realtime'
import { toast } from '@/hooks/use-toast'
import type { EmailAccount, EmailFolder, Email, EmailState, EmailFilters } from '@/lib/supabase/email-types'
import type { Label, Contact, AiPrompt } from '@/lib/supabase/types'

/**
 * Avisa o resultado de uma ação em massa sem mentir sobre falha parcial.
 *
 * Se ALGUM e-mail falhou, o título já diz "X de Y" (nunca só "pronto!") e a
 * descrição mostra o motivo do primeiro — o suficiente para a pessoa decidir
 * se tenta de novo, sem precisar abrir console nenhum.
 */
function avisarResultadoLote(resultado: ResultadoLote, rotulo: (n: number) => string) {
  const total = resultado.ok + resultado.falhas.length
  if (resultado.falhas.length === 0) {
    toast({ title: rotulo(resultado.ok) })
    return
  }
  toast({
    title: `${resultado.ok} de ${total}: ${rotulo(resultado.ok)}`,
    description: `${resultado.falhas.length} falharam. Motivo: ${resultado.falhas[0].motivo}`,
    variant: 'destructive',
  })
}

function debounce<A extends unknown[]>(fn: (...args: A) => void, ms: number): (...args: A) => void {
  let timer: ReturnType<typeof setTimeout>
  return (...args: A) => {
    clearTimeout(timer)
    timer = setTimeout(() => fn(...args), ms)
  }
}

/*
  Largura do painel de pastas.

  O padrão subiu de 220 para 260 (e o teto, de 320 para 380) em 26/08/2026: é a
  faixa que o Outlook usa, e é o que faz caber nome de subpasta sem cortar. Com
  220 e as linhas maiores, "Licitações não compatíveis" virava reticências no
  segundo nível da árvore.
*/
const SIDEBAR_MIN = 200
const SIDEBAR_MAX = 380
const SIDEBAR_DEFAULT = 260
const STORAGE_KEY_SIDEBAR = 'central-whats.emailSidebar.v1'
const STORAGE_KEY_PASTAS = 'central-whats.emailPastasRecolhidas.v1'

/**
 * Largura do painel de pastas quando recolhido.
 *
 * Não é zero de propósito: some o painel, mas ficam o botão de expandir e o
 * "Novo e-mail". Recolher para zero esconderia as duas ações mais usadas da
 * tela — o Outlook faz igual, vira uma faixa de ícones.
 */
const RAIL_W = 56

/**
 * Aplica um evento de Realtime sem deixar o corpo do e-mail ser apagado.
 *
 * O Postgres NÃO reenvia coluna grande que não mudou num UPDATE — corpo longo
 * mora no TOAST, e marcar como lido faz o evento chegar com `body_html: null`.
 * Trocar o objeto inteiro pelo do evento apagava o conteúdo da tela, que virava
 * "(sem conteúdo)" um instante depois de abrir.
 *
 * Preservar o corpo anterior não é remendo: **o corpo de um e-mail não muda
 * depois que ele chega**. O que o Graph atualiza é bandeira (lido, sinalizado)
 * e pasta. Se o evento trouxer corpo, ele vale; se vier vazio, vale o que já
 * temos.
 */
function mesclarSemPerderCorpo(anterior: Email, evento: Email): Email {
  return {
    ...anterior,
    ...evento,
    body_html: evento.body_html ?? anterior.body_html,
    body_text: evento.body_text ?? anterior.body_text,
    body_preview: evento.body_preview ?? anterior.body_preview,
  }
}

export default function EmailHub() {
  const { user } = useAuth()
  const { podeUsar } = useToolAccess()
  const [searchParams, setSearchParams] = useSearchParams()

  // Contas e pastas
  const [accounts, setAccounts] = useState<EmailAccount[]>([])
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null)
  const [folders, setFolders] = useState<EmailFolder[]>([])
  const [labels, setLabels] = useState<Label[]>([])
  const [aiPrompts, setAiPrompts] = useState<AiPrompt[]>([])

  // Filtros e seleção
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null)
  const [selectedLabelId, setSelectedLabelId] = useState<string | null>(null)
  const [selectedEmailId, setSelectedEmailId] = useState<string | null>(null)

  /*
    Seleção MÚLTIPLA (para ações em massa) — não confundir com `selectedEmailId`
    acima, que é o e-mail ABERTO na leitura. As duas convivem: nada aqui impede
    marcar caixas e depois abrir uma mensagem.
  */
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  // Âncora do Shift+clique: guarda o ÚLTIMO id clicado (com ou sem Shift) para
  // o próximo clique com Shift saber até onde estender o intervalo.
  const lastToggledIdRef = useRef<string | null>(null)
  const [bulkOperando, setBulkOperando] = useState(false)
  const [bulkProgresso, setBulkProgresso] = useState<{ feitos: number; total: number } | null>(null)

  /*
    Fixados (fila 25/09/2026, item 2) — pin pessoal com etiqueta de urgência
    e lembrete opcional. `pins` é o mapa `email_id -> Fixado` (o meu, ou o de
    um colega que compartilhou — ver `services/email_fixados.ts`) para os
    e-mails que estão na tela agora.
  */
  const [pins, setPins] = useState<Record<string, Fixado>>({})
  const [pinDialogAberto, setPinDialogAberto] = useState(false)

  /*
    Atribuição e remetente grudado (fila 25/09/2026, item 3) — "quem é o dono
    deste e-mail" (`email_states.assigned_to`), num mapa `email_id -> {
    assigned_to, status }` no mesmo molde de `pins`/`marcadores` abaixo: uma
    ida ao banco por PASTA (`getAtribuicoes`, em lote), nunca um `select` por
    e-mail. `pessoasEquipe` é a lista para escolher em quem atribuir e para
    resolver nome/iniciais na lista — carregada uma vez só (ver a carga
    inicial, abaixo), igual ao `GerenciadorDeSetores` e ao `PainelDeOrganizacao`.
  */
  const [atribuicoes, setAtribuicoes] = useState<Record<string, AtribuicaoDoEmail>>({})
  const [pessoasEquipe, setPessoasEquipe] = useState<Colega[]>([])
  const [atribuirDialogAberto, setAtribuirDialogAberto] = useState(false)

  /*
    Abas Geral / Minhas — mesmo vocabulário do Whats do PRN Hub (ver
    `ChatList.tsx`, a faixa de duas abas acima da busca). "Minhas" é
    `assigned_to === meu id`; o filtro entra dentro de `emailsOrdenados`
    (abaixo) — NUNCA num useMemo à parte — pelo motivo já registrado no
    comentário daquele bloco.
  */
  const [abaEmail, setAbaEmail] = useState<'geral' | 'minhas'>('geral')

  /*
    Carimbo de tempo para a piscada da lista (`EmailList.calcularNivelPiscar`),
    atualizado a cada ~30s por UM ÚNICO temporizador aqui — não a cada
    segundo, e não recalculado a cada render. "Está na hora de ler?" não
    precisa de precisão de segundo, e um timer de 1s (ou o cálculo dentro do
    render) faria a lista inteira re-renderizar sem parar.
  */
  const [agora, setAgora] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setAgora(Date.now()), 30_000)
    return () => clearInterval(id)
  }, [])

  // Dados
  const [emails, setEmails] = useState<Email[]>([])
  const [selectedEmail, setSelectedEmail] = useState<Email | null>(null)
  /** O corpo ainda está vindo? Enquanto sim, o leitor mostra esqueleto — e não "(sem conteúdo)". */
  const [carregandoCorpo, setCarregandoCorpo] = useState(false)
  const [selectedEmailState, setSelectedEmailState] = useState<EmailState | null>(null)
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null)
  const [isLoadingEmails, setIsLoadingEmails] = useState(false)

  // Composer
  const [composerOpen, setComposerOpen] = useState(false)
  const [replyToEmail, setReplyToEmail] = useState<Email | null>(null)
  const [forwardFromEmail, setForwardFromEmail] = useState<Email | null>(null)
  const [composerInitialBody, setComposerInitialBody] = useState('')
  const [ajustesAbertos, setAjustesAbertos] = useState(false)

  // Resize panels
  const [sidebarW, setSidebarW] = useState(() =>
    parseInt(sessionStorage.getItem(STORAGE_KEY_SIDEBAR) ?? String(SIDEBAR_DEFAULT), 10)
  )
  /*
    A lista não tem mais largura própria nem alça de redimensionamento: desde
    que ela SAI ao abrir o e-mail, é ela ou o leitor ocupando o espaço que sobra
    das pastas. Redimensionar um painel que é sempre o único da área não fazia
    sentido — e a alça só atrapalhava.
  */
  const sidebarResizing = useRef(false)

  const [pastasRecolhidas, setPastasRecolhidas] = useState(
    () => sessionStorage.getItem(STORAGE_KEY_PASTAS) === '1',
  )
  const alternarPastas = useCallback(() => {
    setPastasRecolhidas((antes) => {
      sessionStorage.setItem(STORAGE_KEY_PASTAS, antes ? '0' : '1')
      return !antes
    })
  }, [])

  /** Fecha a mensagem e traz a lista de volta. */
  const voltarParaLista = useCallback(() => setSelectedEmailId(null), [])

  /*
    `Esc` volta para a lista. Como a lista SOME ao abrir o e-mail, sair da
    mensagem passou a ser uma ação frequente — e quem lê e-mail o dia inteiro
    faz isso pelo teclado. O compositor tem precedência: com ele aberto, `Esc`
    é dele.
  */
  useEffect(() => {
    if (!selectedEmailId || composerOpen) return
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === 'Escape') voltarParaLista()
    }
    window.addEventListener('keydown', aoTeclar)
    return () => window.removeEventListener('keydown', aoTeclar)
  }, [selectedEmailId, composerOpen, voltarParaLista])

  /*
    `Esc` também limpa a seleção múltipla — só quando a LISTA está na tela
    (sem e-mail aberto, sem compositor por cima). Registrado só nesta janela
    para não competir com o `Esc` acima, que fecha o leitor: os dois nunca
    ficam ativos ao mesmo tempo, porque lista e leitor são mutuamente
    exclusivos.
  */
  const selectedIdsRef = useRef(selectedIds)
  useEffect(() => {
    selectedIdsRef.current = selectedIds
  }, [selectedIds])

  useEffect(() => {
    if (selectedEmailId || composerOpen) return
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && selectedIdsRef.current.size > 0) {
        setSelectedIds(new Set())
      }
    }
    window.addEventListener('keydown', aoTeclar)
    return () => window.removeEventListener('keydown', aoTeclar)
  }, [selectedEmailId, composerOpen])

  // Carga inicial
  useEffect(() => {
    Promise.all([
      getEmailAccounts(),
      getLabels(),
      getAiPrompts(),
      // Falha aqui não pode travar a caixa inteira: sem a lista de pessoas o
      // diálogo de atribuir só fica sem opções (ver `EmailAtribuirDialog`).
      //
      // ⚠️ `listarColegas()` (RPC `colegas()`), e NÃO `listarPessoas()`: a
      // segunda faz `select` direto em `profiles`, cuja policy é
      // `(id = auth.uid()) OR _is_admin()`. Quem não é admin receberia só a si
      // mesmo — e o nome do dono ao lado de cada e-mail apareceria em branco
      // para 13 das 19 pessoas. A RPC é `SECURITY DEFINER` e resolve isso.
      listarColegas().catch((e) => {
        console.error('pessoas da equipe:', e)
        return [] as Colega[]
      }),
    ]).then(([accs, lbls, prompts, pessoas]) => {
      setAccounts(accs)
      setLabels(lbls)
      // Prompts de email: is_global ou channel='email'
      setAiPrompts(prompts.filter((p) => p.is_global || (p as any).channel === 'email'))
      setPessoasEquipe(pessoas)
      if (accs.length > 0) {
        const saved = sessionStorage.getItem('emailSelectedAccountId')
        const first = saved && accs.find((a) => a.id === saved) ? saved : accs[0].id
        setSelectedAccountId(first)
      }
    })
  }, [])

  // Carregar pastas ao trocar de conta
  useEffect(() => {
    if (!selectedAccountId) return
    sessionStorage.setItem('emailSelectedAccountId', selectedAccountId)
    // Limpa AGORA e escolhe a pasta quando a lista chegar: sem o zerar imediato,
    // a pasta da conta anterior continuaria selecionada durante a busca e a lista
    // apareceria filtrada por uma pasta que não é desta caixa.
    setSelectedFolderId(null)
    setSelectedEmailId(null)
    setSelectedEmail(null)
    getFolders(selectedAccountId).then((lista) => {
      setFolders(lista)
      // Abrir na CAIXA DE ENTRADA, não em "nada selecionado".
      //
      // Sem isto o hub abria com `folder_id = null`, que o serviço traduz para
      // `.is('folder_id', null)` — ou seja, a lista de e-mails SEM PASTA. Hoje
      // são 804 dos 1.455 no banco, uma mistura sem sentido nenhum para quem
      // abre a tela, e nada parecido com uma caixa de entrada.
      const entrada = lista.find((f) => f.well_known_name === 'inbox')
      setSelectedFolderId(entrada?.id ?? null)
    })
  }, [selectedAccountId])

  // Carregar emails ao mudar filtros
  const loadEmails = useCallback(async () => {
    if (!selectedAccountId) return
    setIsLoadingEmails(true)
    try {
      const filters: EmailFilters = {
        // `undefined` e `null` querem dizer coisas DIFERENTES no serviço:
        // `undefined` não filtra por pasta, `null` pede as que não têm pasta.
        // Aqui "nenhuma pasta escolhida" precisa ser o primeiro caso — inclusive
        // porque 3 das 5 contas ativas ainda não têm pasta nenhuma espelhada, e
        // filtrar por pasta nelas devolveria uma tela vazia.
        folder_id: selectedFolderId ?? undefined,
      }
      const data = await getEmails(selectedAccountId, filters)
      setEmails(data)
    } finally {
      setIsLoadingEmails(false)
    }
  }, [selectedAccountId, selectedFolderId])

  useEffect(() => {
    loadEmails()
  }, [loadEmails])

  /*
    Higiene da seleção múltipla, por RECONCILIAÇÃO — não por confiança.

    Em vez de lembrar de limpar `selectedIds` em cada lugar que troca `emails`
    (carga inicial, busca, Realtime, arquivar em massa...), este efeito roda
    toda vez que `emails` muda e descarta da seleção qualquer id que não esteja
    mais na lista. Agir sobre um e-mail que a pessoa não está mais vendo — por
    exemplo depois de trocar de pasta e a seleção antiga "vazar" para a pasta
    nova — é o defeito que isto existe para evitar.
  */
  useEffect(() => {
    const idsValidos = new Set(emails.map((e) => e.id))
    setSelectedIds((antes) => {
      let mudou = false
      const depois = new Set<string>()
      antes.forEach((id) => {
        if (idsValidos.has(id)) depois.add(id)
        else mudou = true
      })
      // Sem retornar a MESMA referência quando nada mudou, este efeito
      // reagiria ao próprio `setState` (novo Set a cada render) e entraria
      // em loop.
      return mudou ? depois : antes
    })
  }, [emails])

  /*
    Trocar de conta, pasta, etiqueta OU ABA é trocar de caixa — a seleção da
    caixa anterior não faz sentido na nova, mesmo que por coincidência algum id
    aparecesse nas duas (a reconciliação acima cuidaria disso de qualquer
    forma, mas aqui a intenção é explícita: seleção não atravessa filtro).

    `abaEmail` entra aqui pelo MESMO motivo: a reconciliação de cima só reage
    a mudança em `emails` (a lista CRUA), e trocar de aba não muda `emails` —
    muda só o que `emailsOrdenados` deixa passar. Sem isto, marcar e-mails em
    "Geral" e trocar para "Minhas" deixaria ids invisíveis (de fora da aba
    atual) marcados por baixo do capô, e uma ação em massa acertaria e-mail
    que a pessoa nem está vendo na tela.
  */
  useEffect(() => {
    setSelectedIds(new Set())
  }, [selectedAccountId, selectedFolderId, selectedLabelId, abaEmail])

  /*
    O que a equipe registrou sobre os e-mails da lista — classificação e quantas
    pessoas estão cuidando.

    Busca em LOTE: perguntar um a um seriam 100 idas ao banco ao abrir uma
    pasta. Aqui são duas consultas para a página inteira.
  */
  const [marcadores, setMarcadores] = useState<Record<string, { cor: string | null; pessoas: number }>>({})
  const chavesDaLista = emails.map((e) => e.id).join(',')

  useEffect(() => {
    const ids = chavesDaLista ? chavesDaLista.split(',') : []
    if (ids.length === 0) {
      setMarcadores({})
      return
    }
    let valido = true
    Promise.all([getOrganizacaoEmLote(ids), getClassificacoes()])
      .then(([org, classes]) => {
        if (!valido) return
        const cor = new Map(classes.map((c) => [c.chave, c.cor]))
        setMarcadores(
          Object.fromEntries(
            Object.entries(org).map(([id, o]) => [
              id,
              { cor: o.classificacao ? cor.get(o.classificacao) ?? null : null, pessoas: o.responsaveis.length },
            ]),
          ),
        )
      })
      .catch((e) => console.error('marcadores:', e))
    return () => {
      valido = false
    }
  }, [chavesDaLista])

  /*
    Pins dos e-mails da lista, em LOTE (mesmo molde do efeito acima): uma ida
    ao banco para a pasta inteira, nunca um `select` por e-mail — ver
    `getFixados`.
  */
  useEffect(() => {
    const ids = chavesDaLista ? chavesDaLista.split(',') : []
    if (ids.length === 0) {
      setPins({})
      return
    }
    let valido = true
    getFixados(ids)
      .then((mapa) => valido && setPins(mapa))
      .catch((e) => console.error('fixados:', e))
    return () => {
      valido = false
    }
  }, [chavesDaLista])

  /*
    Atribuições dos e-mails da lista, em LOTE — mesmo molde do efeito acima.
    Substitui o mapa inteiro (não faz merge): e-mail que saiu da pasta (trocou
    de conta/pasta/etiqueta) precisa sair também daqui, senão "Minhas" contaria
    dono de e-mail que não está mais na tela.
  */
  useEffect(() => {
    const ids = chavesDaLista ? chavesDaLista.split(',') : []
    if (ids.length === 0) {
      setAtribuicoes({})
      return
    }
    let valido = true
    getAtribuicoes(ids)
      .then((mapa) => valido && setAtribuicoes(mapa))
      .catch((e) => console.error('atribuições:', e))
    return () => {
      valido = false
    }
  }, [chavesDaLista])

  /*
    A lista mais recente, para o efeito abaixo poder consultá-la SEM depender
    dela. Com `emails` nas dependências, marcar como lido mudava a lista, o
    efeito rodava de novo e buscava a mensagem outra vez — a cada evento de
    Realtime, indefinidamente.
  */
  const emailsRef = useRef(emails)
  useEffect(() => {
    emailsRef.current = emails
  }, [emails])

  // Carregar email selecionado + estado + contato
  useEffect(() => {
    if (!selectedEmailId) {
      setSelectedEmail(null)
      setSelectedEmailState(null)
      setSelectedContact(null)
      setCarregandoCorpo(false)
      return
    }

    /*
      Duas etapas de propósito.

      A linha da LISTA vem sem corpo (ver `COLUNAS_DA_LISTA` em `services/emails`)
      e serve para a tela abrir na hora, com assunto, remetente e data. O corpo
      chega logo atrás, por `getEmail`, que é a única porta por onde ele entra.
    */
    const daLista = emailsRef.current.find((e) => e.id === selectedEmailId) ?? null
    setSelectedEmail(daLista)
    setCarregandoCorpo(true)

    let valido = true

    getEmail(selectedEmailId)
      .then((completo) => {
        if (valido && completo) setSelectedEmail(completo)
      })
      .catch((err) => console.error('corpo do email:', err))
      .finally(() => {
        if (valido) setCarregandoCorpo(false)
      })

    // Marcar como lido
    if (daLista && !daLista.is_read) {
      markEmailRead(selectedEmailId, true)
      setEmails((prev) => prev.map((e) => (e.id === selectedEmailId ? { ...e, is_read: true } : e)))
    }

    // Carregar estado
    getEmailState(selectedEmailId).then((s) => {
      if (valido) setSelectedEmailState(s)
    })

    /*
      Atribuição do e-mail aberto — buscada AQUI TAMBÉM, não só no lote da
      pasta: o deep link do sino (`?abrir=`, mais abaixo) pode abrir um e-mail
      que não está na pasta selecionada agora, e portanto ficou de fora do
      lote de `getAtribuicoes` do efeito de `chavesDaLista`. É um merge (não
      substitui o mapa inteiro) — sempre a MESMA fonte de verdade que a lista
      usa, nunca um estado paralelo só para o leitor.
    */
    getAtribuicoes([selectedEmailId])
      .then((mapa) => {
        if (valido && mapa[selectedEmailId]) {
          setAtribuicoes((antes) => ({ ...antes, [selectedEmailId]: mapa[selectedEmailId] }))
        }
      })
      .catch((e) => console.error('atribuição do email aberto:', e))

    // Carregar contato (se linkado)
    if (daLista?.contact_id) {
      supabase
        .from('contacts')
        .select('*')
        .eq('id', daLista.contact_id)
        .maybeSingle()
        .then(({ data }) => {
          if (valido) setSelectedContact(data)
        })
    } else {
      setSelectedContact(null)
    }

    return () => {
      valido = false
    }
  }, [selectedEmailId])

  // Busca
  const handleSearch = useCallback(
    debounce(async (query: string) => {
      if (!selectedAccountId) return
      if (!query.trim()) {
        loadEmails()
        return
      }
      setIsLoadingEmails(true)
      try {
        const results = await searchEmails(selectedAccountId, query)
        setEmails(results)
      } finally {
        setIsLoadingEmails(false)
      }
    }, 400),
    [selectedAccountId, loadEmails]
  )

  // Realtime: atualiza lista quando chegar email novo
  useRealtime<Email>('emails', ({ action, record }) => {
    if (!selectedAccountId) return
    if (action === 'create' && record.account_id === selectedAccountId) {
      setEmails((prev) => [record, ...prev])
    }
    if (action === 'update') {
      setEmails((prev) => prev.map((e) => (e.id === record.id ? mesclarSemPerderCorpo(e, record) : e)))
      if (record.id === selectedEmailId) {
        setSelectedEmail((antes) => (antes ? mesclarSemPerderCorpo(antes, record) : record))
      }
    }
  })

  useRealtime<EmailState>('email_states', ({ action, record }) => {
    if (action === 'update' && record.email_id === selectedEmailId) {
      setSelectedEmailState(record)
    }
  })

  // Resize sidebar
  useEffect(() => {
    function onMouseMove(e: MouseEvent) {
      if (sidebarResizing.current) {
        const newW = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, e.clientX - 0))
        setSidebarW(newW)
        sessionStorage.setItem(STORAGE_KEY_SIDEBAR, String(newW))
      }
    }
    function onMouseUp() {
      sidebarResizing.current = false
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
    }
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
  }, [sidebarW])

  // Ações sobre emails
  const handleSelectEmail = useCallback((id: string) => setSelectedEmailId(id), [])

  const handleReply = useCallback((email: Email) => {
    setReplyToEmail(email)
    setForwardFromEmail(null)
    setComposerInitialBody('')
    setComposerOpen(true)
  }, [])

  const handleForward = useCallback((email: Email) => {
    setForwardFromEmail(email)
    setReplyToEmail(null)
    setComposerInitialBody('')
    setComposerOpen(true)
  }, [])

  const handleClose = useCallback(async (emailId: string) => {
    await setEmailStatus(emailId, 'closed')
    setSelectedEmailState((prev) => prev ? { ...prev, status: 'closed' } : prev)
  }, [])

  const handleArchive = useCallback(async (emailId: string) => {
    await archiveEmail(emailId)
    setEmails((prev) => prev.filter((e) => e.id !== emailId))
    setSelectedEmailId(null)
  }, [])

  const handleToggleStar = useCallback(async (emailId: string) => {
    const email = emails.find((e) => e.id === emailId)
    if (!email) return
    await markEmailStarred(emailId, !email.is_starred)
    setEmails((prev) => prev.map((e) => e.id === emailId ? { ...e, is_starred: !e.is_starred } : e))
  }, [emails])

  const handleSetWaiting = useCallback(async (emailId: string) => {
    await setEmailStatus(emailId, 'waiting')
    setSelectedEmailState((prev) => prev ? { ...prev, status: 'waiting' } : prev)
  }, [])

  const handleUseSuggestion = useCallback((text: string) => {
    if (selectedEmail) handleReply(selectedEmail)
    setComposerInitialBody(text)
  }, [selectedEmail, handleReply])

  /*
    Lista ÚNICA, filtrada pela aba e ordenada — fixados primeiro, depois o
    resto na ordem que já vinha (`received_at desc`, da consulta). É a MESMA
    lista usada para RENDERIZAR (`EmailList`) e para calcular o intervalo do
    Shift+clique (`handleToggleSelect`, logo abaixo).

    ⚠️ Isso não é capricho: o Item 1 (seleção em massa) calcula o intervalo do
    Shift pela POSIÇÃO no array. Se a tela mostrasse os fixados no topo mas o
    Shift continuasse contando pela ordem crua de `emails` (sem os fixados
    realocados), a pessoa veria um intervalo na tela — digamos, da linha 2 à
    linha 5 — e o app selecionaria outro, porque a linha 2 da TELA não seria
    mais o segundo elemento do ARRAY. Um único `useMemo`, consumido nos dois
    lugares, é o que impede as duas ordens de divergirem.

    O filtro da aba (item 3, 25/09/2026) entra AQUI DENTRO pelo MESMO motivo,
    não num `useMemo` separado consumido só pela `EmailList`: se "Minhas"
    filtrasse num lugar e o Shift/"selecionar todos" contassem posição na
    lista CRUA (`emails`, sem filtrar) em outro, o Shift estenderia a seleção
    por cima de e-mail que a aba escondeu — fora da tela, mas dentro do
    intervalo — e "selecionar todos" marcaria e-mail da aba Geral enquanto a
    pessoa olha para "Minhas". Filtrar e ordenar num só lugar, e usar esse
    resultado em todo canto (`handleToggleSelect`, `handleSelecionarTodos`,
    `totalNaLista`, `<EmailList emails={...}>`), é o que torna esse desvio
    impossível por construção, não só evitado por atenção.
  */
  const emailsOrdenados = useMemo(() => {
    const base =
      abaEmail === 'minhas'
        ? user
          ? emails.filter((e) => atribuicoes[e.id]?.assigned_to === user.id)
          : []
        : emails

    if (Object.keys(pins).length === 0) return base
    const fixados: Email[] = []
    const resto: Email[] = []
    for (const e of base) {
      if (pins[e.id]) fixados.push(e)
      else resto.push(e)
    }
    return fixados.length > 0 ? [...fixados, ...resto] : base
  }, [emails, pins, abaEmail, atribuicoes, user])

  /** Quantos e-mails da pasta atual são meus — só para o número na aba "Minhas". */
  const totalMinhas = useMemo(() => {
    if (!user) return 0
    return emails.filter((e) => atribuicoes[e.id]?.assigned_to === user.id).length
  }, [emails, atribuicoes, user])

  // ── Ações em massa (barra de seleção múltipla) ──

  /**
   * Alterna a seleção de um e-mail; com `shiftKey`, estende do último
   * clicado (`lastToggledIdRef`) até este — sempre SELECIONANDO o intervalo
   * inteiro, nunca alternando cada um (é assim que Gmail e exploradores de
   * arquivo se comportam, e é o que a pessoa espera de um Shift+clique).
   *
   * Usa `emailsOrdenados`, NUNCA `emails` cru — ver o comentário acima.
   */
  const handleToggleSelect = useCallback((id: string, shiftKey: boolean) => {
    setSelectedIds((antes) => {
      const depois = new Set(antes)
      if (shiftKey && lastToggledIdRef.current) {
        const ids = emailsOrdenados.map((e) => e.id)
        const de = ids.indexOf(lastToggledIdRef.current)
        const ate = ids.indexOf(id)
        if (de !== -1 && ate !== -1) {
          const [inicio, fim] = de < ate ? [de, ate] : [ate, de]
          for (let i = inicio; i <= fim; i++) depois.add(ids[i])
          lastToggledIdRef.current = id
          return depois
        }
      }
      if (depois.has(id)) depois.delete(id)
      else depois.add(id)
      lastToggledIdRef.current = id
      return depois
    })
  }, [emailsOrdenados])

  // "Selecionar todos" não depende de ordem (é um Set), mas usa
  // `emailsOrdenados` por consistência com o resto desta seção — a mesma
  // lista em todo lugar, um hábito que evita a divergência do comentário
  // acima se algo aqui crescer para depender de posição no futuro.
  const handleSelecionarTodos = useCallback((marcar: boolean) => {
    setSelectedIds(marcar ? new Set(emailsOrdenados.map((e) => e.id)) : new Set())
  }, [emailsOrdenados])

  const handleLimparSelecao = useCallback(() => setSelectedIds(new Set()), [])

  /**
   * Marcar lido/não lido e estrela/sem estrela em massa — as quatro ações
   * seguem o mesmo caminho porque as quatro são, por baixo, a mesma chamada
   * (`marcarEmailsEmLote`) com um campo diferente em `mudanca`.
   *
   * Otimismo NA HORA (a tela muda antes da resposta) e recarga do servidor
   * AO FIM: quem manda de verdade em lido/estrela é o Outlook (ver o
   * comentário de `markEmailRead` em `services/emails`), então o estado local
   * é só uma prévia — o `loadEmails()` final é o que fica valendo.
   */
  const handleBulkMark = useCallback(async (
    mudanca: { is_read?: boolean; is_starred?: boolean },
    rotulo: (n: number) => string,
  ) => {
    const ids = Array.from(selectedIds)
    if (ids.length === 0 || bulkOperando) return
    setBulkOperando(true)
    setBulkProgresso({ feitos: 0, total: ids.length })
    setEmails((prev) => prev.map((e) => (selectedIds.has(e.id) ? { ...e, ...mudanca } : e)))
    try {
      const resultado = await marcarEmailsEmLote(
        ids,
        mudanca,
        (feitos, total) => setBulkProgresso({ feitos, total }),
      )
      avisarResultadoLote(resultado, rotulo)
    } finally {
      await loadEmails()
      setBulkProgresso(null)
      setBulkOperando(false)
    }
  }, [selectedIds, bulkOperando, loadEmails])

  const handleBulkMarcarLido = useCallback(
    () => handleBulkMark({ is_read: true }, (n) => `${n} email${n === 1 ? '' : 's'} marcado${n === 1 ? '' : 's'} como lido${n === 1 ? '' : 's'}`),
    [handleBulkMark],
  )
  const handleBulkMarcarNaoLido = useCallback(
    () => handleBulkMark({ is_read: false }, (n) => `${n} email${n === 1 ? '' : 's'} marcado${n === 1 ? '' : 's'} como não lido${n === 1 ? '' : 's'}`),
    [handleBulkMark],
  )
  const handleBulkAdicionarEstrela = useCallback(
    () => handleBulkMark({ is_starred: true }, (n) => `Estrela adicionada em ${n} email${n === 1 ? '' : 's'}`),
    [handleBulkMark],
  )
  const handleBulkRemoverEstrela = useCallback(
    () => handleBulkMark({ is_starred: false }, (n) => `Estrela removida de ${n} email${n === 1 ? '' : 's'}`),
    [handleBulkMark],
  )

  /**
   * Arquivar em massa é UMA chamada (`arquivarEmailsEmLote`, `.in('id', ids)`),
   * não fan-out — por isso o try/catch simples, sem `ok`/`falhas`: ou a
   * atualização inteira dá certo, ou nenhuma linha muda.
   */
  const handleBulkArchive = useCallback(async () => {
    const ids = Array.from(selectedIds)
    if (ids.length === 0 || bulkOperando) return
    setBulkOperando(true)
    setEmails((prev) => prev.filter((e) => !selectedIds.has(e.id)))
    if (selectedEmailId && selectedIds.has(selectedEmailId)) setSelectedEmailId(null)
    try {
      await arquivarEmailsEmLote(ids)
      setSelectedIds(new Set())
      toast({ title: `${ids.length} email${ids.length === 1 ? '' : 's'} arquivado${ids.length === 1 ? '' : 's'}` })
    } catch (err) {
      toast({
        title: 'Não consegui arquivar',
        description: err instanceof Error ? err.message : 'Tente novamente',
        variant: 'destructive',
      })
    } finally {
      await loadEmails()
      setBulkOperando(false)
    }
  }, [selectedIds, bulkOperando, selectedEmailId, loadEmails])

  // ── Fixados (Item 2) ──

  /** Abre o diálogo de fixar/editar — só existe botão para isto no leitor (`EmailActionsBar`). */
  const handleAbrirFixar = useCallback(() => setPinDialogAberto(true), [])

  /** Atualiza o mapa local sem recarregar a pasta inteira — mesmo otimismo das outras ações. */
  const handlePinSalvo = useCallback((fixado: Fixado) => {
    setPins((antes) => ({ ...antes, [fixado.email_id]: fixado }))
  }, [])

  /*
    Não basta apagar a chave do mapa local: se um COLEGA também tiver
    fixado e compartilhado o mesmo e-mail, removê-lo do mapa esconderia o
    pin dele até a próxima troca de pasta. Uma nova ida ao banco (só para
    ESTE e-mail, depois de uma escrita — não é a varredura de 1 em 1 que o
    comentário de `getFixados` proíbe) resolve certo: some se ninguém mais
    tem pin ali, ou reaparece o do colega se ele existir.
  */
  const handlePinRemovido = useCallback(async () => {
    if (!selectedEmailId) return
    const emailId = selectedEmailId
    try {
      const mapa = await getFixados([emailId])
      setPins((antes) => {
        const depois = { ...antes }
        if (mapa[emailId]) depois[emailId] = mapa[emailId]
        else delete depois[emailId]
        return depois
      })
    } catch (e) {
      console.error('recarregar fixado após remover:', e)
    }
  }, [selectedEmailId])

  // ── Atribuição e remetente grudado (Item 3) ──

  /** Abre o diálogo de atribuir/grudar — só existe botão para isto no leitor (`EmailActionsBar`). */
  const handleAbrirAtribuir = useCallback(() => setAtribuirDialogAberto(true), [])

  /**
   * Atualiza o mapa local sem recarregar a pasta inteira — mesmo otimismo das
   * outras ações (fixar, marcar lido). `status` é preservado do que já
   * estava no mapa (ou 'open' se este e-mail ainda não tinha linha), pelo
   * mesmo motivo do `atribuirEmail` em `services/email_atribuicao`: trocar o
   * dono não pode reabrir sozinho um e-mail fechado.
   */
  const handleAtribuido = useCallback((emailId: string, novoDono: string | null) => {
    setAtribuicoes((antes) => ({
      ...antes,
      [emailId]: { assigned_to: novoDono, status: antes[emailId]?.status ?? 'open' },
    }))
  }, [])

  /*
    Deep link do sino: `?abrir=<email_id>` é o `link` que
    `private.processar_lembretes_de_email` grava na notificação. Abrir aqui
    não depende de pasta nem de conta selecionada — `getEmail(id)` (no efeito
    "Carregar email selecionado", acima) busca pelo id direto na tabela.

    Limpa o parâmetro logo em seguida: sem isso, um F5 (ou voltar para a aba)
    reabriria o MESMO e-mail para sempre, porque a URL continuaria carregando
    `?abrir=...` a cada montagem da página.
  */
  useEffect(() => {
    const abrirId = searchParams.get('abrir')
    if (!abrirId) return
    setSelectedEmailId(abrirId)
    setSearchParams(
      (prev) => {
        const novo = new URLSearchParams(prev)
        novo.delete('abrir')
        return novo
      },
      { replace: true },
    )
  }, [searchParams, setSearchParams])

  const selectedAccount = accounts.find((a) => a.id === selectedAccountId) ?? null
  // O pin do e-mail aberto agora — meu, ou de um colega que compartilhou (ver `getFixados`).
  const fixadoDoSelecionado = selectedEmail ? pins[selectedEmail.id] ?? null : null
  const souMeuPinDoSelecionado = fixadoDoSelecionado?.user_id === user?.id

  /** Nome curto para exibir — cai para o e-mail, e por fim para um rótulo genérico. */
  const nomeDaPessoaPorId = useCallback(
    (id: string | null): string | null => {
      if (!id) return null
      const pessoa = pessoasEquipe.find((p) => p.id === id)
      return pessoa?.nome || 'alguém'
    },
    [pessoasEquipe],
  )

  const donoDoSelecionado = selectedEmail ? atribuicoes[selectedEmail.id]?.assigned_to ?? null : null
  const donoNomeDoSelecionado = nomeDaPessoaPorId(donoDoSelecionado)

  /*
    Rótulo do dono para cada linha da LISTA (item 5) — iniciais discretas no
    rodapé, junto dos outros ícones. Resolvido aqui (não dentro da
    `EmailList`) porque só o `EmailHub` conhece `pessoasEquipe`; a lista só
    recebe o nome já pronto para mostrar.
  */
  const donosNaLista = useMemo(() => {
    const mapa: Record<string, string> = {}
    for (const e of emailsOrdenados) {
      const id = atribuicoes[e.id]?.assigned_to
      if (!id) continue
      const nome = nomeDaPessoaPorId(id)
      if (nome) mapa[e.id] = nome
    }
    return mapa
  }, [emailsOrdenados, atribuicoes, nomeDaPessoaPorId])

  return (
    // ── UM painel de vidro só, não três ──
    // Os 3 painéis (sidebar/lista/leitura) eram `bg-background` sólido e juntos
    // cobriam 100% da largura — mesmo tirando o `bg-background` da raiz antiga,
    // o fundo do PRN nunca aparecia porque os FILHOS é que tapavam tudo. A
    // correção é aplicar `.superficie-vidro` UMA vez no contêiner que envolve
    // os três, e não em cada um: um único `backdrop-blur` para a tela inteira
    // em vez de três empilhados lado a lado (blur é caro, e blur repetido não
    // soma nitidez nenhuma — só custo). As divisões viram borda sutil
    // (`border-border/60`) entre as colunas, não bloco opaco.
    // `h-full min-h-0` e não `calc(100vh-4rem)`: desde 26/08/2026 a rota `/email`
    // é "tela cheia" no Layout, então a altura já vem certa do `<main>`. O 4rem
    // chutado errava sempre que o cabeçalho mudava de tamanho — e era o que
    // deixava o fundo do PRN aparecendo em volta do painel.
    <div className="flex h-full min-h-0 overflow-hidden superficie-vidro rounded-2xl">
      {/* Painel 1 — Pastas. Recolhido, vira faixa de ícones. */}
      <div
        className="flex flex-col border-r border-border/60 flex-shrink-0 overflow-hidden transition-[width] duration-200"
        style={{ width: pastasRecolhidas ? RAIL_W : sidebarW }}
      >
        {pastasRecolhidas ? (
          <div className="flex flex-col items-center gap-2 p-2">
            <Button
              variant="ghost"
              size="icon"
              onClick={alternarPastas}
              title="Mostrar pastas"
              aria-label="Mostrar pastas"
            >
              <PanelLeftOpen className="h-4 w-4" />
            </Button>
            <Button
              size="icon"
              onClick={() => {
                setReplyToEmail(null)
                setForwardFromEmail(null)
                setComposerInitialBody('')
                setComposerOpen(true)
              }}
              disabled={!selectedAccountId}
              title="Novo email"
              aria-label="Novo email"
            >
              <PenSquare className="h-4 w-4" />
            </Button>
            {/* Gêmeo do "Meus ajustes" do rodapé: sem ele, recolher as pastas
                faria a assinatura sumir do alcance. */}
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setAjustesAbertos(true)}
              title="Meus ajustes"
              aria-label="Meus ajustes"
              className="text-muted-foreground"
            >
              <Settings2 className="h-4 w-4" />
            </Button>
          </div>
        ) : (
          <>
            {/* Topo: conta + botão novo */}
            <div className="p-3 border-b border-border/60">
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <AccountSwitcher
                    accounts={accounts}
                    selectedAccountId={selectedAccountId}
                    onSelect={setSelectedAccountId}
                  />
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="shrink-0"
                  onClick={alternarPastas}
                  title="Esconder pastas"
                  aria-label="Esconder pastas"
                >
                  <PanelLeftClose className="h-4 w-4" />
                </Button>
              </div>
              <Button
                className="w-full mt-2 gap-2"
                size="sm"
                onClick={() => {
                  setReplyToEmail(null)
                  setForwardFromEmail(null)
                  setComposerInitialBody('')
                  setComposerOpen(true)
                }}
                disabled={!selectedAccountId}
              >
                <PenSquare className="h-4 w-4" />
                Novo email
              </Button>
              {/* Campanhas tem bloqueio próprio: sem o `if`, sobraria um botão
                  que devolve a pessoa para o Painel. */}
              {podeUsar['tela-email-campanhas'] && (
                <Button className="mt-2 w-full gap-2" size="sm" variant="outline" asChild>
                  <Link to="/email/campanhas">
                    <Megaphone className="h-4 w-4" />
                    Disparo em massa
                  </Link>
                </Button>
              )}
            </div>

            {/* Pastas e etiquetas */}
            <div className="flex-1 overflow-y-auto">
              {selectedAccountId ? (
                <FolderTree
                  folders={folders}
                  labels={labels}
                  selectedFolderId={selectedFolderId}
                  selectedLabelId={selectedLabelId}
                  onSelectFolder={setSelectedFolderId}
                  onSelectLabel={setSelectedLabelId}
                />
              ) : (
                <div className="flex flex-col items-center justify-center h-32 gap-2 text-sm text-muted-foreground px-4 text-center">
                  <Mail className="h-8 w-8 opacity-30" />
                  <p>Nenhuma conta configurada</p>
                </div>
              )}
            </div>

            {/*
              Rodapé da barra de pastas, FORA da rolagem.

              É onde o Outlook e o Gmail põem a engrenagem, e aqui era espaço
              virgem: a árvore ia até o fim do painel e não havia nada abaixo.
              Ficar fora do `overflow-y-auto` importa — numa caixa com trinta
              pastas, um botão dentro da rolagem só aparece depois de rolar tudo.
            */}
            <div className="border-t border-border/60 p-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setAjustesAbertos(true)}
                className="w-full justify-start gap-2 text-muted-foreground hover:text-foreground"
              >
                <Settings2 className="h-4 w-4" />
                Meus ajustes
              </Button>
            </div>
          </>
        )}
      </div>

      {/* Handle resize sidebar — mais largo e mais visível no hover que a borda
          ao lado dele, para o usuário achar a área de arrasto mesmo sem o
          bloco opaco de antes marcando o limite do painel.
          Some quando as pastas estão recolhidas: não há o que redimensionar. */}
      {!pastasRecolhidas && (
        <div
          className="w-1 hover:w-1.5 bg-border/80 hover:bg-primary/40 cursor-col-resize flex-shrink-0 transition-all"
          onMouseDown={() => {
            sidebarResizing.current = true
            document.body.style.userSelect = 'none'
            document.body.style.cursor = 'col-resize'
          }}
        />
      )}

      {/* Painel 2 — Lista. SAI quando um e-mail está aberto (decisão de
          26/08/2026): o leitor fica com a tela toda e volta pelo botão ou
          pelo Esc. */}
      {!selectedEmail && (
        <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
          {/*
            Abas Geral / Minhas (item 3, 25/09/2026) — ACIMA da busca, mesmo
            lugar do Whats (`ChatList.tsx`): troca o CONJUNTO sobre o qual a
            busca e a seleção em massa trabalham, então o inverso confundiria
            quem busca e não acha porque estava na aba errada.
          */}
          <div className="flex items-center gap-1 border-b border-border/60 p-2">
            {(
              [
                { id: 'geral' as const, rotulo: 'Geral' },
                { id: 'minhas' as const, rotulo: 'Minhas' },
              ]
            ).map((aba) => (
              <button
                key={aba.id}
                onClick={() => setAbaEmail(aba.id)}
                aria-pressed={abaEmail === aba.id}
                className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                  abaEmail === aba.id
                    ? 'bg-accent text-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {aba.rotulo}
                {aba.id === 'minhas' && totalMinhas > 0 && (
                  <span className="rounded-full bg-blue-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-blue-600 dark:text-blue-400">
                    {totalMinhas}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/*
            Faixa ADICIONAL, não substituição: a barra de busca é da própria
            `EmailList` e continua no lugar de sempre. Esta entra só quando há
            seleção (o componente devolve `null` com `selecionados === 0`) e
            some sozinha ao limpar a seleção.
          */}
          <EmailBulkBar
            selecionados={selectedIds.size}
            totalNaLista={emailsOrdenados.length}
            onSelecionarTodos={handleSelecionarTodos}
            onLimparSelecao={handleLimparSelecao}
            onMarcarLido={handleBulkMarcarLido}
            onMarcarNaoLido={handleBulkMarcarNaoLido}
            onAdicionarEstrela={handleBulkAdicionarEstrela}
            onRemoverEstrela={handleBulkRemoverEstrela}
            onArquivar={handleBulkArchive}
            operando={bulkOperando}
            progresso={bulkProgresso}
          />
          <EmailList
            emails={emailsOrdenados}
            selectedEmailId={selectedEmailId}
            onSelect={handleSelectEmail}
            onSearch={handleSearch}
            isLoading={isLoadingEmails}
            marcadores={marcadores}
            selectedIds={selectedIds}
            onToggleSelect={handleToggleSelect}
            pins={pins}
            agora={agora}
            donos={donosNaLista}
            mensagemVazia={
              abaEmail === 'minhas'
                ? 'Nada aqui ainda. Um e-mail cai em "Minhas" quando alguém atribui a você, ou quando o remetente está grudado no seu nome.'
                : undefined
            }
          />
        </div>
      )}

      {/* Painel 3 — Leitura. Fica MAIS opaco que os outros dois de propósito:
          e-mail é texto denso (corpo inteiro, às vezes HTML de remetente
          externo) e translucidez sobre esse volume de texto atrapalha a
          leitura. `bg-background/90` é só opacidade — não é um novo
          `backdrop-blur` (a regra dura do vidro aninhado continua valendo: o
          único blur da tela é o do contêiner pai). */}
      {selectedEmail && (
        <div className="flex-1 min-w-0 flex flex-col overflow-hidden bg-background/90">
          <EmailReader
            email={selectedEmail}
            state={selectedEmailState}
            contact={selectedContact}
            aiPrompts={aiPrompts}
            carregandoCorpo={carregandoCorpo}
            setorDaCaixa={selectedAccount?.department ?? null}
            fixado={fixadoDoSelecionado}
            souMeuPin={souMeuPinDoSelecionado}
            donoNome={donoNomeDoSelecionado}
            onVoltar={voltarParaLista}
            onReply={handleReply}
            onForward={handleForward}
            onClose={handleClose}
            onArchive={handleArchive}
            onToggleStar={handleToggleStar}
            onSetWaiting={handleSetWaiting}
            onUseSuggestion={handleUseSuggestion}
            onFixar={handleAbrirFixar}
            onAtribuir={handleAbrirAtribuir}
          />
          <EmailPinDialog
            open={pinDialogAberto}
            onOpenChange={setPinDialogAberto}
            email={selectedEmail}
            meuFixado={souMeuPinDoSelecionado ? fixadoDoSelecionado : null}
            onSalvo={handlePinSalvo}
            onRemovido={handlePinRemovido}
          />
          <EmailAtribuirDialog
            open={atribuirDialogAberto}
            onOpenChange={setAtribuirDialogAberto}
            email={selectedEmail}
            donoAtual={donoDoSelecionado}
            meuId={user?.id ?? null}
            onAtribuido={handleAtribuido}
          />
        </div>
      )}

      {/* Composer */}
      <EmailComposer
        open={composerOpen}
        onClose={() => {
          setComposerOpen(false)
          setReplyToEmail(null)
          setForwardFromEmail(null)
          setComposerInitialBody('')
        }}
        account={selectedAccount}
        replyTo={replyToEmail}
        forwardFrom={forwardFromEmail}
        initialBody={composerInitialBody}
        /*
          Nada de inserir o enviado na lista à mão.

          O Graph responde 202 sem corpo, então não temos o `graph_id` da
          mensagem no momento do envio — e é ele que casa o upsert. A cópia entra
          em Itens Enviados e chega aqui pelo aviso em tempo real, com o id certo.
          Inserir aqui produziria a mesma mensagem duas vezes, e ainda no topo da
          pasta errada (a que estivesse aberta).
        */
        onSent={() => {}}
      />

      <MeusAjustesDialog aberto={ajustesAbertos} onOpenChange={setAjustesAbertos} />
    </div>
  )
}
