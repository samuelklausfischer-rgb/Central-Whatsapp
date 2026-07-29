import supabase from '@/lib/supabase/client'

/**
 * Galeria da conversa: fotos, documentos e links trocados.
 *
 * POR QUE CONSULTA O BANCO E NÃO A MEMÓRIA
 * O chat mantém as últimas 500 mensagens da conversa em memória, e montar a
 * galeria a partir delas parece a solução óbvia e barata. Está errada e falha em
 * silêncio: medido em produção, **15,3% dos anexos (1.333) e 25% dos links (234)
 * estão fora das últimas 500**, afetando 28 e 21 conversas. A galeria ficaria
 * incompleta sem nenhum erro visível — exatamente a classe de defeito que já
 * custou 486 contatos invisíveis neste projeto.
 *
 * O custo de ir ao banco é baixo: o índice
 * `idx_messages_device_remote_sender_created` já cobre o filtro, e o EXPLAIN
 * ANALYZE na MAIOR conversa (4.658 mensagens, 270 anexos) deu 5,8 ms com zero
 * leitura de disco. Links, 8,5 ms no pior caso.
 */

/** Anexo com a mensagem de origem, para poder "ir para a mensagem". */
export interface ItemDeGaleria {
  messageId: string
  createdAt: string
  direction: string
  /** Legenda da mensagem, quando não for um marcador técnico. */
  legenda: string | null
  url: string
  nome: string
  tipo: string
  /** O arquivo ainda existe? Ver `anexoEstaVivo`. */
  disponivel: boolean
}

export interface LinkDeGaleria {
  messageId: string
  createdAt: string
  direction: string
  url: string
  /** Texto da mensagem em volta do link, para dar contexto. */
  trecho: string
}

/**
 * Host do Storage abandonado na migração de 16/07/2026. O domínio NÃO RESOLVE
 * mais (`nslookup` → Non-existent domain), então esses arquivos estão perdidos
 * em definitivo: 6.203 anexos de 29/05 a 15/07, contra 2.263 no servidor atual.
 *
 * A galeria é a primeira tela do app que mostra o histórico inteiro de uma vez —
 * ela não causou o problema, ela o revela. Sem esta checagem, a aba Fotos de uma
 * conversa antiga abre como um mural de miniaturas quebradas.
 */
const HOST_MORTO = 'cwpegwqopttjtdrqevlx.supabase.co'

export function anexoEstaVivo(url: string | null | undefined): boolean {
  if (!url) return false
  return !url.includes(HOST_MORTO)
}

// Teto explícito: o teto global do PostgREST já mudou uma vez (1000 → 10000) e
// trunca em silêncio. 2.000 dá ~7x de folga sobre o máximo real medido (270).
const TETO = 2000

const COLUNAS = 'id, created_at, direction, content, attachments'

/** Marcadores técnicos que o webhook grava quando não há texto real. */
const ehMarcadorTecnico = (texto: string | null | undefined): boolean => {
  if (!texto) return true
  const t = texto.trim()
  return t.startsWith('[') && t.endsWith(']')
}

function extrairItens(linhas: any[], tiposAceitos: string[]): ItemDeGaleria[] {
  const itens: ItemDeGaleria[] = []
  for (const linha of linhas) {
    const anexos = Array.isArray(linha.attachments) ? linha.attachments : []
    for (const anexo of anexos) {
      const tipo = String(anexo?.type ?? '')
      const url = String(anexo?.url ?? '')
      if (!url || !tiposAceitos.includes(tipo)) continue
      itens.push({
        messageId: linha.id,
        createdAt: linha.created_at,
        direction: linha.direction,
        legenda: ehMarcadorTecnico(linha.content) ? null : linha.content,
        url,
        nome: String(anexo?.name ?? 'arquivo'),
        tipo,
        disponivel: anexoEstaVivo(url),
      })
    }
  }
  return itens
}

async function buscarComAnexo(deviceId: string, remoteSender: string) {
  const { data, error } = await supabase
    .from('messages')
    .select(COLUNAS)
    .eq('device_id', deviceId)
    .eq('remote_sender', remoteSender)
    .is('deleted_at', null)
    .not('attachments', 'is', null)
    .order('created_at', { ascending: false })
    .limit(TETO)
  if (error) throw new Error(error.message)
  return data ?? []
}

/** Fotos e vídeos, do mais recente para o mais antigo. */
export async function getFotosDaConversa(deviceId: string, remoteSender: string): Promise<ItemDeGaleria[]> {
  return extrairItens(await buscarComAnexo(deviceId, remoteSender), ['image', 'video'])
}

/**
 * Documentos. Figurinha, áudio e contato ficam de fora — é o que o WhatsApp faz,
 * e os números apoiam: 438 figurinhas e 244 contatos não são o que alguém procura
 * ao abrir "Documentos".
 */
export async function getDocumentosDaConversa(deviceId: string, remoteSender: string): Promise<ItemDeGaleria[]> {
  return extrairItens(await buscarComAnexo(deviceId, remoteSender), ['document'])
}

const REGEX_URL = /(https?:\/\/[^\s]+|www\.[^\s]+)/gi

/**
 * Links. O filtro fino é no cliente de propósito: depender do operador regex do
 * PostgREST (`~*`) falharia só em runtime dependendo da versão/config do
 * self-hosted. O pré-filtro `ilike` foi validado como superconjunto seguro
 * (947 linhas contra 936 reais — 11 falsos positivos, ZERO falsos negativos).
 */
export async function getLinksDaConversa(deviceId: string, remoteSender: string): Promise<LinkDeGaleria[]> {
  const { data, error } = await supabase
    .from('messages')
    .select('id, created_at, direction, content')
    .eq('device_id', deviceId)
    .eq('remote_sender', remoteSender)
    .is('deleted_at', null)
    .or('content.ilike.%http%,content.ilike.%www.%')
    .order('created_at', { ascending: false })
    .limit(TETO)
  if (error) throw new Error(error.message)

  const links: LinkDeGaleria[] = []
  for (const linha of data ?? []) {
    const texto = String((linha as any).content ?? '')
    const achados = texto.match(REGEX_URL)
    if (!achados) continue
    for (const url of achados) {
      links.push({
        messageId: (linha as any).id,
        createdAt: (linha as any).created_at,
        direction: (linha as any).direction,
        url,
        trecho: texto.length > 160 ? texto.slice(0, 160) + '…' : texto,
      })
    }
  }
  return links
}
