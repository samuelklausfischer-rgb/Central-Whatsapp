import { useState } from 'react'
import {
  Inbox, Send, FileEdit, Archive, ShieldX, Clock, Zap, UserCheck,
  CalendarClock, ChevronRight, ChevronDown, Folder, Trash2,
} from 'lucide-react'
// `Badge` saiu: a contagem de não lidas virou número solto em negrito, como no
// Outlook — pílula sobre pílula polui uma lista que se lê o dia inteiro.
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import type { EmailFolder } from '@/lib/supabase/email-types'
import type { Label } from '@/lib/supabase/types'

const SYSTEM_ICONS: Record<string, React.ElementType> = {
  Inbox, Send, FileEdit, Archive, ShieldX, Clock, Zap, UserCheck, CalendarClock, Folder,
}

/**
 * A ordem do Outlook, e não a alfabética.
 *
 * Quem usa o Outlook o dia inteiro procura a Caixa de Entrada no topo e o Lixo
 * Eletrônico lá embaixo. Ordenar por nome jogaria "Caixa de Saída" antes de
 * "Caixa de Entrada" e "Rascunhos" no fim — mesma informação, lugar errado.
 */
const ORDEM_DO_OUTLOOK = [
  'inbox',
  'drafts',
  'sentitems',
  'deleteditems',
  'junkemail',
  'archive',
  'outbox',
]

const ICONE_POR_PASTA: Record<string, React.ElementType> = {
  inbox: Inbox,
  drafts: FileEdit,
  sentitems: Send,
  deleteditems: Trash2,
  junkemail: ShieldX,
  archive: Archive,
  outbox: Send,
}

interface Props {
  folders: EmailFolder[]
  labels: Label[]
  selectedFolderId: string | null
  selectedLabelId: string | null
  unreadByFolder?: Record<string, number>
  onSelectFolder: (id: string | null) => void
  onSelectLabel: (id: string | null) => void
}

export function FolderTree({
  folders,
  labels,
  selectedFolderId,
  selectedLabelId,
  unreadByFolder = {},
  onSelectFolder,
  onSelectLabel,
}: Props) {
  const [labelsOpen, setLabelsOpen] = useState(true)
  const [customOpen, setCustomOpen] = useState(true)
  const [recolhidas, setRecolhidas] = useState<Set<string>>(new Set())

  const smartFolders = folders.filter((f) => f.is_smart)
  const reais = folders.filter((f) => !f.is_smart)

  // Filhas por pasta-mãe. Montar o índice uma vez evita varrer a lista inteira
  // a cada nível da recursão.
  const filhasDe = new Map<string, EmailFolder[]>()
  for (const f of reais) {
    if (!f.parent_id) continue
    filhasDe.set(f.parent_id, [...(filhasDe.get(f.parent_id) ?? []), f])
  }

  const raizes = reais.filter((f) => !f.parent_id)
  const sistema = raizes
    .filter((f) => f.well_known_name)
    .sort(
      (a, b) =>
        ORDEM_DO_OUTLOOK.indexOf(a.well_known_name!) - ORDEM_DO_OUTLOOK.indexOf(b.well_known_name!),
    )
  const personalizadas = raizes
    .filter((f) => !f.well_known_name)
    .sort((a, b) => a.display_name.localeCompare(b.display_name, 'pt-BR'))

  const alternar = (id: string) =>
    setRecolhidas((antes) => {
      const novo = new Set(antes)
      if (novo.has(id)) novo.delete(id)
      else novo.add(id)
      return novo
    })

  function FolderItem({ folder, nivel = 0 }: { folder: EmailFolder; nivel?: number }) {
    const filhas = (filhasDe.get(folder.id) ?? []).sort((a, b) =>
      a.display_name.localeCompare(b.display_name, 'pt-BR'),
    )
    const Icon =
      ICONE_POR_PASTA[folder.well_known_name ?? ''] ??
      SYSTEM_ICONS[folder.icon ?? 'Folder'] ??
      Folder
    const isSelected = selectedFolderId === folder.id
    const aberta = !recolhidas.has(folder.id)

    /*
      A contagem vem do Outlook (`unread_count`, gravado na sincronização de
      pastas), não das linhas que importamos. Como só trazemos 90 dias, contar
      o que está no banco daria um número menor que o do Outlook e pareceria
      defeito. `unreadByFolder` fica como reserva para pasta inteligente, que
      não existe lá.
    */
    const unread = folder.unread_count || unreadByFolder[folder.id] || 0

    return (
      <>
        {/*
          Linha no padrão Outlook: mais alta, com barra de destaque à esquerda
          quando selecionada. A barra existe porque só o fundo se perde numa
          árvore com muitas pastas — e esta caixa tem 26, com 11 subpastas.
        */}
        <div className="relative flex items-center" style={{ paddingLeft: 4 + nivel * 14 }}>
          {isSelected && (
            <span className="absolute left-0 top-1 bottom-1 w-[3px] rounded-r bg-primary" />
          )}
          {filhas.length > 0 ? (
            <button
              onClick={() => alternar(folder.id)}
              className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
              aria-label={aberta ? 'Recolher' : 'Expandir'}
            >
              {aberta ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            </button>
          ) : (
            <span className="w-[26px] shrink-0" />
          )}
          <button
            onClick={() => {
              onSelectFolder(folder.id)
              onSelectLabel(null)
            }}
            className={`flex min-w-0 flex-1 items-center gap-2.5 rounded-md px-2 py-2 text-[13.5px] transition-colors ${
              isSelected
                ? 'bg-accent font-semibold text-accent-foreground'
                : 'text-foreground/75 hover:bg-accent/50 hover:text-foreground'
            }`}
          >
            <Icon
              className="h-[18px] w-[18px] flex-shrink-0"
              style={folder.color ? { color: folder.color } : {}}
            />
            <span className="flex-1 truncate text-left">{folder.display_name}</span>
            {/* Sem "pílula": o Outlook mostra o número solto, em negrito. Badge
                sobre badge polui uma lista que se lê o dia inteiro. */}
            {unread > 0 && (
              <span className={`shrink-0 text-xs tabular-nums ${
                isSelected ? 'text-accent-foreground' : 'font-semibold text-primary'
              }`}>
                {unread > 999 ? '999+' : unread}
              </span>
            )}
          </button>
        </div>
        {aberta && filhas.map((f) => <FolderItem key={f.id} folder={f} nivel={nivel + 1} />)}
      </>
    )
  }

  return (
    <div className="flex flex-col gap-0.5 overflow-y-auto px-2 py-2">
      {/* Pastas do sistema, na ordem do Outlook */}
      <div className="mb-1">
        {sistema.map((f) => (
          <FolderItem key={f.id} folder={f} />
        ))}
      </div>

      {/* Pastas inteligentes */}
      {smartFolders.length > 0 && (
        <div className="mb-1">
          <p className="px-3 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/80">
            Inteligentes
          </p>
          {smartFolders.map((f) => (
            <FolderItem key={f.id} folder={f} />
          ))}
        </div>
      )}

      {/* Pastas criadas pela pessoa, com as subpastas dentro */}
      {personalizadas.length > 0 && (
        <Collapsible open={customOpen} onOpenChange={setCustomOpen}>
          <CollapsibleTrigger asChild>
            <button className="flex w-full items-center gap-1.5 px-3 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/80 transition-colors hover:text-foreground">
              {customOpen ? (
                <ChevronDown className="h-3 w-3" />
              ) : (
                <ChevronRight className="h-3 w-3" />
              )}
              Pastas
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            {personalizadas.map((f) => (
              <FolderItem key={f.id} folder={f} />
            ))}
          </CollapsibleContent>
        </Collapsible>
      )}

      {/* Etiquetas */}
      {labels.length > 0 && (
        <Collapsible open={labelsOpen} onOpenChange={setLabelsOpen}>
          <CollapsibleTrigger asChild>
            <button className="flex w-full items-center gap-1.5 px-3 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/80 transition-colors hover:text-foreground">
              {labelsOpen ? (
                <ChevronDown className="h-3 w-3" />
              ) : (
                <ChevronRight className="h-3 w-3" />
              )}
              Etiquetas
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            {labels.map((label) => {
              const isSelected = selectedLabelId === label.id
              return (
                <button
                  key={label.id}
                  onClick={() => {
                    onSelectLabel(label.id)
                    onSelectFolder(null)
                  }}
                  className={`w-full flex items-center gap-2.5 px-3 py-1.5 rounded-md text-sm transition-colors ${
                    isSelected
                      ? 'bg-accent text-accent-foreground font-medium'
                      : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
                  }`}
                >
                  <span
                    className="h-2.5 w-2.5 rounded-full flex-shrink-0"
                    style={{ backgroundColor: label.color }}
                  />
                  <span className="flex-1 text-left truncate">{label.name}</span>
                </button>
              )
            })}
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  )
}
