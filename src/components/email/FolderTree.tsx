import { useState } from 'react'
import {
  Inbox, Send, FileEdit, Archive, ShieldX, Clock, Zap, UserCheck,
  CalendarClock, Tag, ChevronRight, ChevronDown, Plus, Folder,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import type { EmailFolder } from '@/lib/supabase/email-types'
import type { Label } from '@/lib/supabase/types'

const SYSTEM_ICONS: Record<string, React.ElementType> = {
  Inbox, Send, FileEdit, Archive, ShieldX, Clock, Zap, UserCheck, CalendarClock, Folder,
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

  const systemFolders = folders.filter((f) => f.is_system && !f.is_smart)
  const smartFolders = folders.filter((f) => f.is_smart)
  const customFolders = folders.filter((f) => !f.is_system && !f.is_smart)

  function FolderItem({ folder }: { folder: EmailFolder }) {
    const Icon = SYSTEM_ICONS[folder.icon ?? 'Folder'] ?? Folder
    const isSelected = selectedFolderId === folder.id
    const unread = unreadByFolder[folder.id] ?? 0

    return (
      <button
        onClick={() => {
          onSelectFolder(folder.id)
          onSelectLabel(null)
        }}
        className={`w-full flex items-center gap-2.5 px-3 py-1.5 rounded-md text-sm transition-colors ${
          isSelected
            ? 'bg-accent text-accent-foreground font-medium'
            : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
        }`}
      >
        <Icon className="h-4 w-4 flex-shrink-0" style={folder.color ? { color: folder.color } : {}} />
        <span className="flex-1 text-left truncate">{folder.display_name}</span>
        {unread > 0 && (
          <Badge variant="secondary" className="text-xs px-1.5 py-0 h-4 min-w-[1rem]">
            {unread}
          </Badge>
        )}
      </button>
    )
  }

  return (
    <div className="flex flex-col gap-1 px-2 py-2 overflow-y-auto">
      {/* Pastas do sistema */}
      <div className="mb-1">
        {systemFolders.map((f) => (
          <FolderItem key={f.id} folder={f} />
        ))}
      </div>

      {/* Pastas inteligentes */}
      {smartFolders.length > 0 && (
        <div className="mb-1">
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-3 py-1">
            Inteligentes
          </p>
          {smartFolders.map((f) => (
            <FolderItem key={f.id} folder={f} />
          ))}
        </div>
      )}

      {/* Pastas customizadas */}
      {customFolders.length > 0 && (
        <Collapsible open={customOpen} onOpenChange={setCustomOpen}>
          <CollapsibleTrigger asChild>
            <button className="w-full flex items-center gap-1 px-3 py-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider hover:text-foreground">
              {customOpen ? (
                <ChevronDown className="h-3 w-3" />
              ) : (
                <ChevronRight className="h-3 w-3" />
              )}
              Pastas
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            {customFolders.map((f) => (
              <FolderItem key={f.id} folder={f} />
            ))}
          </CollapsibleContent>
        </Collapsible>
      )}

      {/* Etiquetas */}
      {labels.length > 0 && (
        <Collapsible open={labelsOpen} onOpenChange={setLabelsOpen}>
          <CollapsibleTrigger asChild>
            <button className="w-full flex items-center gap-1 px-3 py-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider hover:text-foreground">
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
