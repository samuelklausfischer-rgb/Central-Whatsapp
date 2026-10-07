import { useEffect, useState } from 'react'
import { Download, FileText, FileSpreadsheet, FileImage, File as FileIcon } from 'lucide-react'
import { useToast } from '@/hooks/use-toast'
import {
  getAttachments, baixarAnexo, tipoDoAnexo, tamanhoLegivel,
} from '@/services/email_attachments'
import type { EmailAttachmentRow } from '@/lib/supabase/email-types'

/** Ícone por tipo de arquivo, no espírito do Outlook. */
const ICONE_DO_ANEXO: Record<string, React.ElementType> = {
  pdf: FileText,
  imagem: FileImage,
  planilha: FileSpreadsheet,
  documento: FileText,
  arquivo: FileIcon,
}

interface Props {
  emailId: string
  /** O Graph disse que há anexo? Sem isso nem consulta o banco — a maioria não tem. */
  temAnexos: boolean
}

/**
 * Anexos de UMA mensagem, vindos de `email_attachments`.
 *
 * Antes esta seção lia `email.attachments` (jsonb), que deixou de ser preenchido
 * na migration 20260826140000 — e-mail com anexo não mostrava anexo nenhum, sem
 * erro. O conteúdo continua na Microsoft: o botão busca na hora.
 *
 * Mora aqui, e não no leitor, porque agora cada BLOCO da conversa tem os seus.
 */
export function AnexosDoEmail({ emailId, temAnexos }: Props) {
  const { toast } = useToast()
  const [anexos, setAnexos] = useState<EmailAttachmentRow[]>([])
  const [baixandoId, setBaixandoId] = useState<string | null>(null)

  useEffect(() => {
    setAnexos([])
    // Só consulta quando o Graph disse que há anexo — evita uma ida ao banco
    // por mensagem aberta, e a maioria não tem nenhum.
    if (!temAnexos) return
    let valido = true
    getAttachments(emailId)
      .then((lista) => valido && setAnexos(lista))
      .catch((e) => console.error('anexos:', e))
    return () => {
      valido = false
    }
  }, [emailId, temAnexos])

  const baixar = async (att: EmailAttachmentRow) => {
    setBaixandoId(att.id)
    try {
      await baixarAnexo(att)
    } catch (e) {
      toast({
        title: 'Não deu para baixar o anexo',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      })
    } finally {
      setBaixandoId(null)
    }
  }

  if (anexos.length === 0) return null

  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {anexos.length === 1 ? '1 anexo' : `${anexos.length} anexos`}
      </p>
      <div className="flex flex-wrap gap-2">
        {anexos.map((att) => {
          const Icone = ICONE_DO_ANEXO[tipoDoAnexo(att.mime_type, att.name)]
          const baixando = baixandoId === att.id
          return (
            <button
              key={att.id}
              onClick={() => baixar(att)}
              disabled={baixando}
              className="group flex items-center gap-3 rounded-lg border border-border bg-muted/30 px-3 py-2 text-left text-sm transition-colors hover:bg-muted/60 disabled:opacity-60"
              title={`Baixar ${att.name}`}
            >
              <Icone className="h-5 w-5 flex-shrink-0 text-muted-foreground" />
              <span className="min-w-0">
                <span className="block max-w-[220px] truncate">{att.name}</span>
                {att.size ? (
                  <span className="block text-xs text-muted-foreground">
                    {tamanhoLegivel(att.size)}
                  </span>
                ) : null}
              </span>
              <Download
                className={`h-4 w-4 flex-shrink-0 text-muted-foreground ${baixando ? 'animate-pulse' : ''}`}
              />
            </button>
          )
        })}
      </div>
    </div>
  )
}
