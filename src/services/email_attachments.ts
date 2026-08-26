import supabase from '@/lib/supabase/client'
import { appEnv } from '@/lib/env'
import type { EmailAttachmentRow } from '@/lib/supabase/email-types'

/**
 * Anexos de um e-mail.
 *
 * A ficha (nome, tipo, tamanho) mora em `email_attachments`; o CONTEÚDO continua
 * na Microsoft e só é buscado quando alguém clica em baixar — decisão de
 * 26/08/2026, que evita encher o disco com anexo que ninguém abre.
 *
 * Substitui a leitura do campo `emails.attachments` (jsonb), que a tela usava e
 * que parou de ser preenchido na migration `20260826140000`. O sintoma era
 * silencioso: e-mail com anexo não mostrava anexo nenhum.
 */

export async function getAttachments(emailId: string): Promise<EmailAttachmentRow[]> {
  const { data, error } = await supabase
    .from('email_attachments')
    .select('*')
    .eq('email_id', emailId)
    // Anexo embutido é a imagem que já aparece dentro do corpo (assinatura,
    // logo). Listar junto encheria a barra de anexos de coisa que o usuário
    // não reconhece como arquivo.
    .eq('is_inline', false)
    .order('name', { ascending: true })
  if (error) throw error
  return (data ?? []) as EmailAttachmentRow[]
}

/**
 * Baixa o anexo.
 *
 * NÃO dá para usar um `<a href>` simples: a rota exige o cabeçalho de
 * autorização da sessão, e link comum não o envia — o arquivo voltaria 401.
 * Por isso busca com `fetch` autenticado, vira blob e o download é disparado
 * por um link temporário.
 */
export async function baixarAnexo(anexo: EmailAttachmentRow): Promise<void> {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  if (!session?.access_token) throw new Error('Sessão não encontrada. Saia e entre novamente.')

  const resp = await fetch(
    `${appEnv.VITE_SUPABASE_URL}/functions/v1/email-microsoft/anexo?id=${encodeURIComponent(anexo.id)}`,
    { headers: { Authorization: `Bearer ${session.access_token}` } },
  )
  if (!resp.ok) {
    const erro = await resp.json().catch(() => ({}))
    throw new Error(erro?.error || `Não deu para baixar o anexo (${resp.status})`)
  }

  const blob = await resp.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = anexo.name
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Sem o revoke o blob fica na memória da aba até recarregar — anexo de 20 MB
  // aberto algumas vezes vira memória presa à toa.
  URL.revokeObjectURL(url)
}

/** Ícone por tipo, no espírito do Outlook: PDF, planilha, imagem, documento. */
export function tipoDoAnexo(mime: string | null, nome: string): 'pdf' | 'imagem' | 'planilha' | 'documento' | 'arquivo' {
  const m = (mime ?? '').toLowerCase()
  const ext = nome.toLowerCase().split('.').pop() ?? ''
  if (m.includes('pdf') || ext === 'pdf') return 'pdf'
  if (m.startsWith('image/') || ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'].includes(ext)) return 'imagem'
  if (m.includes('sheet') || m.includes('excel') || ['xlsx', 'xls', 'csv'].includes(ext)) return 'planilha'
  if (m.includes('word') || m.includes('document') || ['docx', 'doc', 'odt'].includes(ext)) return 'documento'
  return 'arquivo'
}

export function tamanhoLegivel(bytes: number | null): string {
  if (!bytes || bytes <= 0) return ''
  const unidades = ['B', 'KB', 'MB', 'GB']
  let valor = bytes
  let i = 0
  while (valor >= 1024 && i < unidades.length - 1) {
    valor /= 1024
    i++
  }
  return `${valor < 10 && i > 0 ? valor.toFixed(1) : Math.round(valor)} ${unidades[i]}`
}
