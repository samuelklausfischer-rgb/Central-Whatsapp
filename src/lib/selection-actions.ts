import { format } from 'date-fns'
import { podeEncaminhar, ehMarcadorTecnico } from '@/lib/forward'
import { anexoEstaVivo } from '@/services/gallery'

/**
 * Regras das ações em lote do modo de seleção.
 *
 * POR QUE FORA DO ChatWindow
 * Cada ação da barra de seleção precisa responder duas perguntas antes de rodar:
 * "quais das marcadas servem para isto?" e "o que dizer sobre as que não
 * servem?". Escrever isso dentro do `ChatWindow` (que já passa de 3.800 linhas)
 * significaria quatro filtros embutidos no meio do JSX, impossíveis de conferir
 * sem abrir o app. Aqui são funções puras: entram mensagens, sai a resposta.
 *
 * NENHUMA delas reimplementa regra que já existe. `podeEncaminhar` (lib/forward)
 * e `anexoEstaVivo` (services/gallery) continuam sendo a fonte única — este
 * arquivo só as aplica item a item e conta o resultado.
 */

/** Teto de seleção, o mesmo do WhatsApp. Ver `use-message-selection`. */
export const MAX_SELECIONADAS = 30

export interface MensagemBloqueada {
  msg: any
  motivo: string
}

export interface SeparacaoEncaminhavel {
  /** Encaminháveis, com o anexo já resolvido por `podeEncaminhar`. */
  ok: { msg: any; anexo?: { url: string; type: string; name: string } }[]
  bloqueadas: MensagemBloqueada[]
}

/**
 * Divide a seleção entre o que a função de envio sabe repassar e o que não.
 *
 * Encaminhar em lote torna o bloqueio MAIS provável, não menos: numa seleção de
 * 15 mensagens quase sempre entra uma figurinha, um cartão de contato ou um
 * anexo do Storage abandonado em 16/07. Sem esta separação o laço tentaria
 * enviar todos e a paciente receberia áudio no lugar de figurinha, ou a palavra
 * "[Imagem]" — os dois casos já documentados em `lib/forward.ts`.
 */
export function separarEncaminhaveis(msgs: any[]): SeparacaoEncaminhavel {
  const ok: SeparacaoEncaminhavel['ok'] = []
  const bloqueadas: MensagemBloqueada[] = []

  for (const msg of msgs) {
    const veredito = podeEncaminhar(msg)
    if (veredito.pode) ok.push({ msg, anexo: veredito.anexo })
    else bloqueadas.push({ msg, motivo: veredito.motivo ?? 'Não pode ser encaminhada.' })
  }

  return { ok, bloqueadas }
}

/** Agrupa os motivos de bloqueio para caber numa linha de aviso. */
export function resumirMotivos(bloqueadas: MensagemBloqueada[]): string {
  const contagem = new Map<string, number>()
  for (const { motivo } of bloqueadas) contagem.set(motivo, (contagem.get(motivo) ?? 0) + 1)
  return [...contagem.entries()].map(([motivo, n]) => (n > 1 ? `${motivo} (${n})` : motivo)).join(' ')
}

/**
 * Monta o texto que vai para a área de transferência.
 *
 * FORMATO `[dd/MM HH:mm] Autor: texto`, e não só o texto solto. Copiar várias
 * mensagens de uma central de atendimento serve para colar num prontuário, num
 * e-mail ou num relatório — sem autor e hora o trecho perde justamente o que o
 * torna útil, e num grupo fica impossível saber quem disse o quê.
 *
 * `resolverAutor` vem de fora de propósito. A resolução de nome (própria /
 * participante de grupo / contato privado, com apelido e cache) já existe no
 * laço de renderização do `ChatWindow`; recriá-la aqui produziria uma segunda
 * verdade sobre o nome da mesma pessoa.
 *
 * Mídia sem legenda entra com o rótulo que já está em `content` (`[Imagem]`,
 * `[Áudio]`). É descrição honesta do que foi selecionado — melhor do que sumir
 * com a linha e o atendente achar que copiou tudo.
 */
export function montarTranscricao(msgs: any[], resolverAutor: (msg: any) => string): string {
  return msgs
    .map((msg) => {
      const quando = format(new Date(msg.created_at), 'dd/MM HH:mm')
      const autor = resolverAutor(msg)
      const texto = msg.deleted_at
        ? '[Mensagem apagada]'
        : String(msg.content ?? '').trim() || '[Sem conteúdo]'
      return `[${quando}] ${autor}: ${texto}`
    })
    .join('\n')
}

/** Há pelo menos uma mensagem com texto de verdade para copiar? */
export function temTextoParaCopiar(msgs: any[]): boolean {
  return msgs.some((msg) => !msg.deleted_at && !ehMarcadorTecnico(msg.content))
}

export interface MidiaBaixavel {
  url: string
  name: string
}

/**
 * Anexos que ainda existem no servidor.
 *
 * O filtro por `anexoEstaVivo` não é zelo: 73% dos anexos da base apontam para o
 * Storage abandonado, cujo domínio não resolve mais. Sem ele, "Baixar" numa
 * conversa antiga dispararia uma fila de downloads condenados, um por um, sem
 * nada acontecer na tela.
 */
export function midiasBaixaveis(msgs: any[]): MidiaBaixavel[] {
  const vistas = new Set<string>()
  const saida: MidiaBaixavel[] = []

  for (const msg of msgs) {
    const anexos = Array.isArray(msg.attachments) ? msg.attachments : []
    for (const anexo of anexos) {
      const url = String(anexo?.url ?? '')
      if (!url || !anexoEstaVivo(url)) continue
      // A mesma mídia pode aparecer em duas linhas (reenvio, eco do realtime):
      // baixar duas vezes só gera arquivo duplicado na pasta do atendente.
      if (vistas.has(url)) continue
      vistas.add(url)
      saida.push({ url, name: String(anexo?.name ?? 'arquivo') })
    }
  }

  return saida
}

/**
 * Mensagens que o atendente pode apagar: só as próprias e ainda não apagadas.
 *
 * Mesma condição que hoje libera o item "Apagar" no `MessageActionsMenu`
 * (`isMe && !msg.deleted_at`) — repetida aqui de propósito para que a barra de
 * seleção nunca ofereça em lote o que o menu individual recusa.
 */
export function apagaveis(msgs: any[], userId?: string): any[] {
  return msgs.filter(
    (msg) => !msg.deleted_at && (msg.direction === 'outbound' || (!!userId && msg.sender_id === userId)),
  )
}
