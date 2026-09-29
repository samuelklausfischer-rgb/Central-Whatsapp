import { format, differenceInCalendarDays } from 'date-fns'
import { ptBR } from 'date-fns/locale'

/**
 * Regras de aparência da conversa que imitam o WhatsApp. Puras de propósito:
 * a lista de balões é memorizada e não pode depender de estado para decidir
 * forma — só da mensagem e da vizinha anterior.
 */

type MensagemMinima = {
  direction?: string | null
  sender_id?: string | null
  remote_sender?: string | null
  group_participant?: string | null
  sender_name?: string | null
  created_at: string
}

function ehMinha(msg: MensagemMinima, userId: string | undefined) {
  return msg.direction === 'outbound' || (!!userId && msg.sender_id === userId)
}

function autor(msg: MensagemMinima, userId: string | undefined) {
  if (ehMinha(msg, userId)) return 'eu'
  // `sender_name` (pushName) fica por último: em conversa 1:1 ele varia de uma
  // mensagem para outra e abriria sequência falsa. Mesma ordem do avatar e do
  // rótulo de grupo no ChatWindow.
  return msg.group_participant || msg.remote_sender || msg.sender_name || '?'
}

/**
 * Começa uma sequência nova quando não há anterior, quando algo quebra o bloco
 * à força (mudou o dia e o separador de data aparece; ou a anterior é uma linha
 * de sistema, como "[Mensagem fixada]") ou quando muda quem falou.
 * É o que decide o espaço maior acima e o rabinho.
 */
export function ehInicioDeSequencia(
  msg: MensagemMinima,
  anterior: MensagemMinima | undefined,
  quebraForcada: boolean,
  userId: string | undefined,
) {
  if (!anterior || quebraForcada) return true
  return autor(msg, userId) !== autor(anterior, userId)
}

/**
 * Hoje · Ontem · nome do dia (até 6 dias atrás) · dd/MM/yyyy.
 * `agora` é parâmetro para a regra ser pura (e conferível no console).
 */
export function rotuloDaData(valor: string, agora: Date = new Date()) {
  if (!valor) return ''
  const data = new Date(valor)
  if (Number.isNaN(data.getTime())) return ''
  const dias = differenceInCalendarDays(agora, data)
  if (dias === 0) return 'Hoje'
  if (dias === 1) return 'Ontem'
  if (dias > 1 && dias < 7) return format(data, 'EEEE', { locale: ptBR })
  return format(data, 'dd/MM/yyyy')
}

/**
 * Tipo de um anexo, seja o objeto novo (`{ type, url }`) ou o nome de arquivo
 * antigo (string). A ordem das checagens de arquivo imita o desenho do balão:
 * áudio antes de vídeo (`.webm` cai nos dois) e imagem antes de figurinha
 * (`.webp` também).
 */
export function tipoDoAnexo(att: unknown): 'image' | 'video' | 'audio' | 'sticker' | 'document' | 'other' {
  if (att && typeof att === 'object') {
    const tipo = (att as { type?: string }).type
    if (tipo === 'image' || tipo === 'video' || tipo === 'audio' || tipo === 'sticker') return tipo
    if (tipo === 'contact' || tipo === 'buttons' || tipo === 'list') return 'other'
    return 'document'
  }
  if (typeof att !== 'string') return 'other'
  if (/\.(mp3|ogg|oga|m4a|aac|wav|webm)$/i.test(att)) return 'audio'
  if (/\.(mp4|webm|mov|m4v|3gp)$/i.test(att)) return 'video'
  if (/\.(jpeg|jpg|gif|png|webp)$/i.test(att)) return 'image'
  return 'document'
}

/**
 * Álbum: ≥ 4 mensagens SEGUIDAS de foto/vídeo do mesmo autor, no mesmo dia, cada
 * uma até 60 s depois da anterior. Só entram mensagens "puras": um anexo vivo,
 * sem legenda (conteúdo vazio ou rótulo técnico), sem citação, sem
 * "Encaminhada", não apagadas. Qualquer mensagem no meio que não cumpra isso
 * quebra a sequência.
 *
 * É regra do CLIENTE: o banco guarda cada foto como uma mensagem e não sabe o
 * que é álbum. Por ser derivada da lista, foto que chega pelo Realtime entra no
 * álbum sozinha.
 */
export const MINIMO_DE_FOTOS_NO_ALBUM = 4
const JANELA_DO_ALBUM_MS = 60_000

export type Albuns = {
  /** id da 1ª mensagem do álbum → ids de todas, em ordem (inclui a 1ª). */
  porPrimeira: Map<string, string[]>
  /** ids das mensagens que NÃO são a primeira de um álbum (não têm balão próprio). */
  membros: Set<string>
}

type MensagemDeAlbum = MensagemMinima & {
  id: string
  content?: string | null
  attachments?: unknown
  deleted_at?: string | null
  revoked_at?: string | null
  status?: string | null
  reply_to_snapshot?: unknown
  is_forwarded?: boolean | null
}

export function agruparAlbuns(
  mensagens: MensagemDeAlbum[],
  opcoes: {
    userId: string | undefined
    /** O anexo ainda existe? (o ChatWindow considera a prévia local do envio). */
    anexoVivo: (msg: MensagemDeAlbum, anexo: unknown) => boolean
    /** Conteúdo vazio ou rótulo técnico tipo "[Imagem]". */
    semLegenda: (content: string | null | undefined) => boolean
  },
): Albuns {
  const porPrimeira = new Map<string, string[]>()
  const membros = new Set<string>()
  let atual: MensagemDeAlbum[] = []

  const candidata = (msg: MensagemDeAlbum) => {
    if (msg.deleted_at || msg.reply_to_snapshot || msg.is_forwarded) return false
    // Apagada pelo contato: volta a ter balão próprio, com o selo "apagada".
    if (msg.revoked_at) return false
    // Falhou: precisa do botão "tentar novamente" do rodapé, que o quadro do
    // álbum não tem. Já `sending` FICA no álbum de propósito — o quadro mostra o
    // progresso, e tirar a foto do grupo agora para juntá-la quando subir
    // causaria salto de layout.
    if (msg.status === 'failed') return false
    if (!Array.isArray(msg.attachments) || msg.attachments.length !== 1) return false
    const anexo = msg.attachments[0]
    const tipo = tipoDoAnexo(anexo)
    if (tipo !== 'image' && tipo !== 'video') return false
    if (!opcoes.anexoVivo(msg, anexo)) return false
    return !msg.content?.trim() || opcoes.semLegenda(msg.content)
  }

  const continua = (anterior: MensagemDeAlbum, msg: MensagemDeAlbum) => {
    if (autor(msg, opcoes.userId) !== autor(anterior, opcoes.userId)) return false
    const a = new Date(anterior.created_at)
    const b = new Date(msg.created_at)
    if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return false
    if (a.toDateString() !== b.toDateString()) return false
    const dif = b.getTime() - a.getTime()
    return dif >= 0 && dif <= JANELA_DO_ALBUM_MS
  }

  const fechar = () => {
    if (atual.length >= MINIMO_DE_FOTOS_NO_ALBUM) {
      porPrimeira.set(atual[0].id, atual.map((m) => m.id))
      for (const m of atual.slice(1)) membros.add(m.id)
    }
    atual = []
  }

  for (const msg of mensagens) {
    if (!candidata(msg)) {
      fechar()
      continue
    }
    const anterior = atual[atual.length - 1]
    if (anterior && !continua(anterior, msg)) fechar()
    atual.push(msg)
  }
  fechar()
  return { porPrimeira, membros }
}
