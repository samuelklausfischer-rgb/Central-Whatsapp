import supabase from '@/lib/supabase/client'
import { appEnv } from '@/lib/env'
import type { EmailAttachmentRow, ImagemCidDoServidor } from '@/lib/supabase/email-types'
import { normalizarCid } from '@/components/email/cid'

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

/* ——— Imagens embutidas (`cid:`) ——— */

/**
 * E-mails para os quais a rota `inline` já respondeu NESTA sessão.
 *
 * A rota vai ao Graph quando falta Content-ID, e há mensagens cujo corpo cita
 * `cid:` de um anexo que nunca existiu (imagem da cadeia de respostas antigas).
 * Sem esta memória, reabrir essa mensagem repetiria a ida à Microsoft toda vez
 * para voltar com o mesmo "não achei".
 */
const EMAILS_JA_CONSULTADOS = new Set<string>()

/**
 * A rota `inline` ainda não foi publicada? Enquanto a edge function nova não sobe,
 * cada e-mail aberto faria uma chamada fadada ao 404; lembrar disso evita o
 * barulho e mantém o leitor como era antes (imagem `cid:` sem resolver). Some ao
 * recarregar a página — e é assim que a primeira abertura depois do deploy já
 * enxerga a rota.
 *
 * Só vale a resposta do ROTEADOR para um caminho que ele não conhece
 * (`ROTA_DESCONHECIDA`). Um 404 qualquer não prova nada: a própria rota `inline`
 * já respondeu 404 para "e-mail não encontrado", e isso, tratado como "rota
 * ausente", desligaria a resolução de imagens da sessão inteira por causa de uma
 * única mensagem apagada. (Hoje o e-mail inexistente volta 410.)
 */
let rotaInlineIndisponivel = false
const ROTA_DESCONHECIDA = 'Rota desconhecida'

/** Binários já baixados, por id de anexo: reabrir um bloco não rebaixa a imagem. */
const BINARIOS_POR_ANEXO = new Map<string, Blob>()
const TETO_DE_BINARIOS_GUARDADOS = 40

/** Mais que isto num único e-mail é, na prática, propaganda — não vale baixar tudo. */
const TETO_DE_IMAGENS_POR_EMAIL = 30
const DOWNLOADS_SIMULTANEOS = 4

async function tokenDaSessao(): Promise<string> {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  if (!session?.access_token) throw new Error('Sessão não encontrada. Saia e entre novamente.')
  return session.access_token
}

/**
 * Pergunta à edge function quais anexos desta mensagem têm Content-ID, buscando
 * na Microsoft o que ainda não foi gravado (preenchimento sob demanda).
 *
 * Devolve `null` quando a rota não existe ainda — quem chama segue sem as imagens.
 * Qualquer outra falha (inclusive e-mail não encontrado) lança, e quem chama só
 * registra no console.
 */
async function consultarImagensEmbutidas(
  emailId: string,
  cids: string[],
  token: string,
): Promise<ImagemCidDoServidor[] | null> {
  if (rotaInlineIndisponivel) return null
  const resp = await fetch(
    `${appEnv.VITE_SUPABASE_URL}/functions/v1/email-microsoft/inline` +
      `?email_id=${encodeURIComponent(emailId)}&cids=${encodeURIComponent(cids.join(','))}`,
    { headers: { Authorization: `Bearer ${token}` } },
  )
  const corpo = await resp.json().catch(() => ({}))
  if (resp.status === 404 && corpo?.error === ROTA_DESCONHECIDA) {
    rotaInlineIndisponivel = true
    return null
  }
  if (!resp.ok) throw new Error(corpo?.error || `Imagens embutidas: HTTP ${resp.status}`)
  if (Array.isArray(corpo?.erros) && corpo.erros.length > 0) {
    // Não é falha para o usuário (a mensagem abre do mesmo jeito), mas é a pista
    // de por que uma imagem não apareceu — por isso vai ao console, não ao lixo.
    console.warn('imagens embutidas (servidor):', corpo.erros)
  }
  return (corpo?.anexos ?? []) as ImagemCidDoServidor[]
}

async function baixarBinario(anexoId: string, token: string): Promise<Blob | null> {
  const guardado = BINARIOS_POR_ANEXO.get(anexoId)
  if (guardado) return guardado
  const resp = await fetch(
    `${appEnv.VITE_SUPABASE_URL}/functions/v1/email-microsoft/anexo?id=${encodeURIComponent(anexoId)}`,
    { headers: { Authorization: `Bearer ${token}` } },
  )
  if (!resp.ok) return null
  const blob = await resp.blob()
  if (BINARIOS_POR_ANEXO.size >= TETO_DE_BINARIOS_GUARDADOS) {
    // Descarta o mais antigo (o Map guarda a ordem de inserção).
    const maisAntigo = BINARIOS_POR_ANEXO.keys().next().value
    if (maisAntigo) BINARIOS_POR_ANEXO.delete(maisAntigo)
  }
  BINARIOS_POR_ANEXO.set(anexoId, blob)
  return blob
}

export interface ImagensCidResolvidas {
  /** `cid` normalizado → endereço `blob:` que o iframe consegue abrir. */
  enderecos: Map<string, string>
  /** Libera os `blob:` criados. Sem isto eles ficam na memória até a aba fechar. */
  liberar: () => void
}

/**
 * Resolve as imagens `cid:` de uma mensagem em endereços `blob:`.
 *
 * Caminho: (1) o que já está em `email_attachments` com `content_id`; (2) para o
 * que falta, a rota `inline` da edge function, que busca o Content-ID na
 * Microsoft e grava; (3) cada imagem é baixada pela rota `anexo` e vira `blob:`.
 *
 * Nunca lança por causa de imagem: leitor sem imagem é leitor funcionando. Qualquer
 * falha devolve o que deu para resolver (às vezes nada).
 */
export async function resolverImagensCid(
  emailId: string,
  cids: string[],
  aindaValido: () => boolean = () => true,
): Promise<ImagensCidResolvidas> {
  const enderecos = new Map<string, string>()
  const liberar = () => {
    for (const url of enderecos.values()) URL.revokeObjectURL(url)
    enderecos.clear()
  }
  if (cids.length === 0) return { enderecos, liberar }

  try {
    const token = await tokenDaSessao()

    // 1) O que o banco já sabe.
    const porCid = new Map<string, { id: string }>()
    const { data: linhas } = await supabase
      .from('email_attachments')
      .select('id, content_id')
      .eq('email_id', emailId)
      .not('content_id', 'is', null)
    for (const linha of (linhas ?? []) as { id: string; content_id: string }[]) {
      porCid.set(normalizarCid(linha.content_id), { id: linha.id })
    }

    // 2) O que falta, a edge function busca na Microsoft.
    const faltam = cids.filter((cid) => !porCid.has(cid))
    if (faltam.length > 0 && !EMAILS_JA_CONSULTADOS.has(emailId)) {
      const doServidor = await consultarImagensEmbutidas(emailId, faltam, token).catch((e) => {
        console.warn('imagens embutidas:', e)
        return null
      })
      // Só marca como consultado quando a rota respondeu: uma queda de rede ou
      // um 401 não pode impedir a próxima abertura de tentar de novo.
      if (doServidor) EMAILS_JA_CONSULTADOS.add(emailId)
      for (const item of doServidor ?? []) {
        porCid.set(normalizarCid(item.content_id), { id: item.attachment_id })
      }
    }

    // 3) Baixa as que existem, poucas por vez.
    const alvos = cids.filter((cid) => porCid.has(cid)).slice(0, TETO_DE_IMAGENS_POR_EMAIL)
    let proximo = 0
    const trabalhar = async () => {
      while (proximo < alvos.length && aindaValido()) {
        const cid = alvos[proximo++]
        const blob = await baixarBinario(porCid.get(cid)!.id, token).catch(() => null)
        // Se a tela já mudou de mensagem, não cria `blob:` que ninguém vai revogar.
        if (blob && aindaValido()) enderecos.set(cid, URL.createObjectURL(blob))
      }
    }
    await Promise.all(Array.from({ length: Math.min(DOWNLOADS_SIMULTANEOS, alvos.length) }, trabalhar))
  } catch (e) {
    console.warn('imagens embutidas:', e)
  }

  if (!aindaValido()) liberar()
  return { enderecos, liberar }
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
