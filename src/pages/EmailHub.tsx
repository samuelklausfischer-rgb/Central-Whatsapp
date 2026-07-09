import { useState, useEffect, useRef, useCallback } from 'react'
import { Mail, PenSquare } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { AccountSwitcher } from '@/components/email/AccountSwitcher'
import { FolderTree } from '@/components/email/FolderTree'
import { EmailList } from '@/components/email/EmailList'
import { EmailReader } from '@/components/email/EmailReader'
import { EmailComposer } from '@/components/email/EmailComposer'
import { getEmailAccounts } from '@/services/email_accounts'
import { getFolders } from '@/services/email_folders'
import { getEmails, searchEmails, markEmailRead, archiveEmail, markEmailStarred } from '@/services/emails'
import { getEmailState, setEmailStatus } from '@/services/email_states'
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

const SIDEBAR_MIN = 200
const SIDEBAR_MAX = 320
const SIDEBAR_DEFAULT = 220
const LIST_MIN = 260
const LIST_MAX = 420
const LIST_DEFAULT = 300
const STORAGE_KEY_SIDEBAR = 'central-whats.emailSidebar.v1'
const STORAGE_KEY_LIST = 'central-whats.emailList.v1'

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
  const [listW, setListW] = useState(() =>
    parseInt(sessionStorage.getItem(STORAGE_KEY_LIST) ?? String(LIST_DEFAULT), 10)
  )
  const sidebarResizing = useRef(false)
  const listResizing = useRef(false)

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

  // Carregar email selecionado + estado + contato
  useEffect(() => {
    if (!selectedEmailId) {
      setSelectedEmail(null)
      setSelectedEmailState(null)
      setSelectedContact(null)
      return
    }

    const email = emails.find((e) => e.id === selectedEmailId)
    if (!email) return

    setSelectedEmail(email)

    // Marcar como lido
    if (!email.is_read) {
      markEmailRead(email.id, true)
      setEmails((prev) => prev.map((e) => e.id === email.id ? { ...e, is_read: true } : e))
    }

    // Carregar estado
    getEmailState(email.id).then(setSelectedEmailState)

    // Carregar contato (se linkado)
    if (email.contact_id) {
      supabase
        .from('contacts')
        .select('*')
        .eq('id', email.contact_id)
        .maybeSingle()
        .then(({ data }) => setSelectedContact(data))
    } else {
      setSelectedContact(null)
    }
  }, [selectedEmailId, emails])

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
      setEmails((prev) => prev.map((e) => e.id === record.id ? record : e))
      if (record.id === selectedEmailId) setSelectedEmail(record)
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
      if (listResizing.current) {
        const newW = Math.min(LIST_MAX, Math.max(LIST_MIN, e.clientX - sidebarW))
        setListW(newW)
        sessionStorage.setItem(STORAGE_KEY_LIST, String(newW))
      }
    }
    function onMouseUp() {
      sidebarResizing.current = false
      listResizing.current = false
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
    <div className="flex h-[calc(100vh-4rem)] overflow-hidden bg-background">
      {/* Painel 1 — Sidebar */}
      <div
        className="flex flex-col border-r border-border bg-background flex-shrink-0 overflow-hidden"
        style={{ width: sidebarW }}
      >
        {/* Topo: conta + botão novo */}
        <div className="p-3 border-b border-border">
          <AccountSwitcher
            accounts={accounts}
            selectedAccountId={selectedAccountId}
            onSelect={setSelectedAccountId}
          />
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
      </div>

      {/* Handle resize sidebar */}
      <div
        className="w-1 hover:w-1.5 bg-border hover:bg-primary/30 cursor-col-resize flex-shrink-0 transition-all"
        onMouseDown={() => {
          sidebarResizing.current = true
          document.body.style.userSelect = 'none'
          document.body.style.cursor = 'col-resize'
        }}
      />

      {/* Painel 2 — Lista de emails */}
      <div
        className="flex flex-col border-r border-border bg-background flex-shrink-0 overflow-hidden"
        style={{ width: listW }}
      >
        <EmailList
          emails={emails}
          selectedEmailId={selectedEmailId}
          onSelect={handleSelectEmail}
          onSearch={handleSearch}
          isLoading={isLoadingEmails}
        />
      </div>

      {/* Handle resize lista */}
      <div
        className="w-1 hover:w-1.5 bg-border hover:bg-primary/30 cursor-col-resize flex-shrink-0 transition-all"
        onMouseDown={() => {
          listResizing.current = true
          document.body.style.userSelect = 'none'
          document.body.style.cursor = 'col-resize'
        }}
      />

      {/* Painel 3 — Leitura */}
      <div className="flex-1 flex flex-col overflow-hidden bg-background">
        {selectedEmail ? (
          <EmailReader
            email={selectedEmail}
            state={selectedEmailState}
            contact={selectedContact}
            aiPrompts={aiPrompts}
            onReply={handleReply}
            onForward={handleForward}
            onClose={handleClose}
            onArchive={handleArchive}
            onToggleStar={handleToggleStar}
            onSetWaiting={handleSetWaiting}
            onUseSuggestion={handleUseSuggestion}
          />
        ) : (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground">
            <Mail className="h-14 w-14 opacity-20" />
            <p className="text-sm">Selecione um email para ler</p>
          </div>
        )}
      </div>

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
