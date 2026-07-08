import { useState } from 'react'
import { List } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'

interface ListRow {
  rowId: string
  title: string
  description?: string
}

interface ListSection {
  title?: string
  rows: ListRow[]
}

/**
 * Balão de lista interativa do WhatsApp (listMessage) no chat: título/descrição
 * + botão que abre as opções. A Evolution API não expõe um jeito de responder
 * nativamente selecionando uma opção (listResponseMessage é montado pelo próprio
 * celular) — ao clicar numa opção, envia o título dela como mensagem de texto normal,
 * citando esta mensagem.
 */
export function ListMessageBubble({
  title,
  description,
  buttonText,
  sections,
  onSelectOption,
}: {
  title: string
  description: string
  buttonText: string
  sections: ListSection[]
  onSelectOption: (optionTitle: string) => void
}) {
  const [isOpen, setIsOpen] = useState(false)

  const handleSelect = (rowTitle: string) => {
    onSelectOption(rowTitle)
    setIsOpen(false)
  }

  return (
    <>
      <div className="w-full max-w-[280px] overflow-hidden rounded-xl border border-chat-border bg-chat-panel/60">
        <div className="p-3">
          {title && (
            <p className="text-sm font-medium text-chat-text" title={title}>
              {title}
            </p>
          )}
          {description && (
            <p className="mt-1 text-xs text-chat-muted whitespace-pre-wrap">{description}</p>
          )}
        </div>
        <button
          type="button"
          onClick={() => setIsOpen(true)}
          className="flex w-full items-center justify-center gap-1.5 border-t border-chat-border py-2 text-sm font-medium text-blue-400 hover:bg-chat-hover transition-colors"
        >
          <List className="h-4 w-4" /> {buttonText}
        </button>
      </div>

      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="sm:max-w-[420px] max-h-[80vh] overflow-y-auto bg-chat-panel border-chat-border">
          <DialogHeader>
            <DialogTitle>{title || 'Opções'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {sections.map((section, sIdx) => (
              <div key={sIdx}>
                {section.title && (
                  <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-chat-muted">
                    {section.title}
                  </p>
                )}
                <div className="space-y-1">
                  {section.rows.map((row, rIdx) => (
                    <button
                      key={rIdx}
                      type="button"
                      onClick={() => handleSelect(row.title)}
                      className="w-full rounded-lg border border-chat-border px-3 py-2 text-left hover:bg-chat-hover transition-colors"
                    >
                      <p className="text-sm font-medium text-chat-text">{row.title}</p>
                      {row.description && (
                        <p className="mt-0.5 text-xs text-chat-muted">{row.description}</p>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
