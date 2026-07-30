import { FileX2 } from 'lucide-react'
import { getFileTypeMeta } from '@/lib/file-type'

/**
 * Anexo cujo arquivo não existe mais.
 *
 * A clínica migrou de Supabase Cloud para o self-hosted e os arquivos do
 * servidor antigo não vieram junto — o domínio nem resolve mais. Medido na
 * janela que o chat carrega: 2.427 mídias apontam para lá, contra 1.311 vivas.
 *
 * Antes, esses anexos eram renderizados como `<img>` normal. Duas consequências:
 * o app disparava milhares de requisições condenadas (cada uma gastando uma
 * falha de DNS), e o balão ia de 0px para a altura do ícone de imagem quebrada
 * DEPOIS que a conversa já tinha rolado para o fim — parte do motivo de a
 * conversa não abrir na última mensagem.
 *
 * Esta caixa tem altura fixa e não busca nada: é estável desde o primeiro paint.
 * Mostra o nome do arquivo de propósito — o atendente precisa saber O QUE se
 * perdeu para poder pedir de novo, e "arquivo indisponível" sem nome não ajuda.
 */
export function UnavailableAttachmentBubble({ name }: { name?: string | null }) {
  const nomeExibido = name?.trim() || 'Arquivo'
  const meta = getFileTypeMeta(nomeExibido)

  return (
    <div
      className="flex w-full max-w-[280px] items-center gap-2.5 rounded-xl border border-dashed border-chat-border bg-chat-hover/40 p-2.5"
      title="O arquivo não está mais disponível no servidor"
    >
      <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-chat-muted/10">
        <FileX2 className="h-5 w-5 text-chat-muted" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm text-chat-text/70" title={nomeExibido}>
          {nomeExibido}
        </span>
        <span className="block truncate text-xs text-chat-muted">
          {meta.label} · arquivo indisponível
        </span>
      </span>
    </div>
  )
}
