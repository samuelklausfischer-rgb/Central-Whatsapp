import { useState, useEffect, useRef, useCallback } from 'react'
import { Mail, PenSquare, PanelLeftClose, PanelLeftOpen, Megaphone } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { AccountSwitcher } from '@/components/email/AccountSwitcher'
import { FolderTree } from '@/components/email/FolderTree'
import { EmailList } from '@/components/email/EmailList'
import { EmailReader } from '@/components/email/EmailReader'
import { EmailComposer } from '@/components/email/EmailComposer'
import { getEmailAccounts } from '@/services/email_accounts'
import { getFolders } from '@/services/email_folders'
import { getEmails, getEmail, searchEmails, markEmailRead, archiveEmail, markEmailStarred } from '@/services/emails'
import { getEmailState, setEmailStatus } from '@/services/email_states'
import { getOrganizacaoEmLote, getClassificacoes } from '@/services/email_organizacao'
import { getLabels } from '@/services/labels'
import { getAiPrompts } from '@/services/ai_prompts'
import { supabase } from '@/lib/supabase/client'
import { useAuth } from '@/hooks/use-auth'
import { useRealtime } from '@/hooks/use-realtime'
import type { EmailAccount, EmailFolder, Email, EmailState, EmailFilters } from '@/lib/supabase/email-types'
import type { Label, Contact, AiPrompt } from '@/lib/supabase/types'

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

  // Carga inicial
  useEffect(() => {
    Promise.all([
      getEmailAccounts(),
      getLabels(),
      getAiPrompts(),
    ]).then(([accs, lbls, prompts]) => {
      setAccounts(accs)
      setLabels(lbls)
      // Prompts de email: is_global ou channel='email'
      setAiPrompts(prompts.filter((p) => p.is_global || (p as any).channel === 'email'))
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
    getFolders(selectedAccountId).then(setFolders)
    setSelectedFolderId(null)
    setSelectedEmailId(null)
    setSelectedEmail(null)
  }, [selectedAccountId])

  // Carregar emails ao mudar filtros
  const loadEmails = useCallback(async () => {
    if (!selectedAccountId) return
    setIsLoadingEmails(true)
    try {
      const filters: EmailFilters = {
        folder_id: selectedFolderId,
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

  const selectedAccount = accounts.find((a) => a.id === selectedAccountId) ?? null

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
              <Button className="mt-2 w-full gap-2" size="sm" variant="outline" asChild>
                <Link to="/email/campanhas">
                  <Megaphone className="h-4 w-4" />
                  Disparo em massa
                </Link>
              </Button>
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
          <EmailList
            emails={emails}
            selectedEmailId={selectedEmailId}
            onSelect={handleSelectEmail}
            onSearch={handleSearch}
            isLoading={isLoadingEmails}
            marcadores={marcadores}
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
            onVoltar={voltarParaLista}
            onReply={handleReply}
            onForward={handleForward}
            onClose={handleClose}
            onArchive={handleArchive}
            onToggleStar={handleToggleStar}
            onSetWaiting={handleSetWaiting}
            onUseSuggestion={handleUseSuggestion}
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
        onSent={(email) => {
          setEmails((prev) => [email, ...prev])
        }}
      />
    </div>
  )
}
