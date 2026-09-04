/**
 * Mensagens por conversa, com estado de carga.
 *
 * PROBLEMA QUE ISTO RESOLVE
 * A conversa exibida era montada a partir de três pedaços de estado mutável
 * independentes — `conversationMessages` (estado React), um cache LRU em `useRef`
 * e o handler de Realtime — atualizados por efeitos separados, sem dono único e
 * **sem nada amarrando o dado à identidade da conversa**. Daí saíam três defeitos
 * que pareciam distintos e eram o mesmo:
 *
 * 1. CONVERSA DE OUTRA PESSOA SOB O NOME ERRADO. O efeito que mantinha o cache em
 *    dia rodava com o contato NOVO e o estado ainda com as mensagens ANTIGAS, e
 *    gravava as mensagens de uma pessoa na chave da outra — a cada troca, não em
 *    corrida rara. Depois esse cache envenenado era pintado com toda a confiança.
 *    Medido no vídeo de 29/07: 7 segundos com a conversa da Raphaela sob o nome do
 *    Lucas Rocha.
 * 2. MENSAGEM NOVA NÃO APARECIA ao reabrir uma conversa que estava fechada quando
 *    ela chegou: o handler de Realtime só aplicava a mensagem se a conversa
 *    estivesse aberta, embora já usasse o mesmo registro para tocar o som e
 *    atualizar a lista lateral.
 * 3. CONVERSA ABRINDO VAZIA, porque não havia como distinguir "ainda carregando"
 *    de "não tem mensagem".
 *
 * COMO ESTE STORE RESOLVE
 * A tela passa a ser função de `obterConversa(chave)`. Exibir mensagem de outra
 * conversa deixa de ser algo que uma guarda evita e passa a ser **impossível por
 * construção**: o que se lê é indexado pela mesma chave que identifica a conversa.
 * O Realtime escreve na entrada DA MENSAGEM, aberta ou não. E `estado` é a flag de
 * carregamento que faltava.
 *
 * `ultimaMensagemId` existe para detectar cache velho ANTES de pintar: as summaries
 * já trazem `last_message_id` por conversa, então dá para mostrar o snapshot na
 * hora e ainda saber que ele está desatualizado — é o que separa "rápido" de
 * "rápido e certo".
 *
 * ESCOPO: memória, só durante a sessão. Nada vai para disco — o conteúdo é de
 * paciente/cliente, mesma classe dos rascunhos (ver conversationDrafts.ts).
 * Escopo de MÓDULO, não `useRef`: `ChatHub` é lazy e desmonta ao navegar para
 * Dashboard/Email, o que zeraria qualquer ref.
 */

export type EstadoDaConversa = 'ausente' | 'carregando' | 'pronto' | 'erro'

export interface EntradaDeConversa {
  mensagens: any[]
  estado: EstadoDaConversa
  /** Id da última mensagem conhecida — comparado com `last_message_id` das summaries. */
  ultimaMensagemId: string | null
}

/** Teto de conversas guardadas. Map preserva ordem de inserção: a primeira chave é a mais antiga. */
const MAX_CONVERSAS = 50

const porConversa = new Map<string, EntradaDeConversa>()

export const chaveDaConversa = (deviceId: string, remoteSender: string) =>
  `${deviceId}|${remoteSender}`

const ENTRADA_AUSENTE: EntradaDeConversa = {
  mensagens: [],
  estado: 'ausente',
  ultimaMensagemId: null,
}

/**
 * Devolve sempre uma entrada válida. `estado: 'ausente'` significa "nunca
 * carregada nesta sessão" — que é o que acende o skeleton. Não confundir com
 * `estado: 'pronto'` e `mensagens: []`, que significa "carregou e está vazia
 * mesmo".
 */
export function obterConversa(chave: string | null): EntradaDeConversa {
  if (!chave) return ENTRADA_AUSENTE
  return porConversa.get(chave) ?? ENTRADA_AUSENTE
}

function podar(): void {
  while (porConversa.size > MAX_CONVERSAS) {
    const maisAntiga = porConversa.keys().next().value
    if (maisAntiga === undefined) break
    porConversa.delete(maisAntiga)
  }
}

function gravar(chave: string, entrada: EntradaDeConversa): void {
  // Reinserir move a chave para o fim da ordem — mantém o LRU honesto.
  porConversa.delete(chave)
  porConversa.set(chave, entrada)
  podar()
}

const ultimoIdDe = (mensagens: any[]): string | null =>
  mensagens.length > 0 ? (mensagens[mensagens.length - 1]?.id ?? null) : null

export function marcarCarregando(chave: string): void {
  const atual = porConversa.get(chave)
  // Preserva o que já havia: durante a revalidação a tela continua mostrando o
  // conteúdo anterior DESTA conversa, em vez de piscar em branco.
  gravar(chave, {
    mensagens: atual?.mensagens ?? [],
    estado: 'carregando',
    ultimaMensagemId: atual?.ultimaMensagemId ?? null,
  })
}

export function definirMensagens(chave: string, mensagens: any[]): void {
  gravar(chave, { mensagens, estado: 'pronto', ultimaMensagemId: ultimoIdDe(mensagens) })
}

export function marcarErro(chave: string): void {
  const atual = porConversa.get(chave)
  // Só vira 'erro' se não havia nada para mostrar. Falhar a revalidação de uma
  // conversa já carregada não deve apagar o que o atendente está lendo.
  if (atual && atual.mensagens.length > 0) {
    gravar(chave, { ...atual, estado: 'pronto' })
    return
  }
  gravar(chave, { mensagens: [], estado: 'erro', ultimaMensagemId: null })
}

/**
 * Identidade ESTÁVEL de renderização, preservada quando um registro do servidor
 * substitui um objeto que já estava na lista.
 *
 * A lista de mensagens é renderizada com `key={msg.chaveRender ?? msg.id}`. Uma
 * mensagem enviada por aqui nasce como balão otimista com `id: temp-...` e, um
 * segundo depois, é substituída pela linha real, que tem UUID do banco. Se a
 * `key` mudasse nessa troca, o React desmontaria o balão e montaria outro no
 * lugar — e a animação de entrada (`animate-in fade-in slide-in-from-bottom-2`,
 * no ChatWindow) rodaria de novo. Era exatamente o "flick" relatado em 03/09.
 *
 * Por isso a linha real herda o `tempId` em `chaveRender`. E por isso este
 * helper existe: todo evento POSTERIOR (uma reação, uma edição, o eco do
 * Realtime da própria mensagem) traz um registro fresco do servidor, que não
 * conhece `chaveRender`. Sem preservar aqui, a chave voltaria ao UUID na
 * primeira reação e o flick reapareceria — mais tarde e mais difícil de achar.
 *
 * Mensagem que nunca foi otimista não tem `chaveRender` e cai em `msg.id`,
 * exatamente como antes.
 */
function herdarChaveRender(novo: any, anterior: any): any {
  return anterior?.chaveRender ? { ...novo, chaveRender: anterior.chaveRender } : novo
}

/**
 * Aplica um evento de Realtime na conversa DA MENSAGEM — aberta ou não. É o que
 * faz reabrir uma conversa já mostrar o que chegou enquanto ela estava fechada.
 *
 * Não cria entrada para conversa desconhecida: sem o fetch inicial, guardar uma
 * mensagem solta produziria uma conversa de UMA mensagem só, pior que o skeleton.
 * Devolve `true` quando alterou algo.
 */
export function aplicarEventoDeMensagem(
  chave: string,
  acao: 'create' | 'update' | 'delete',
  registro: any,
  /** Id de uma mensagem otimista a substituir, quando o eco é do próprio envio. */
  tempIdParaSubstituir?: string | null,
): boolean {
  const atual = porConversa.get(chave)
  // `erro` é parada dura junto com `ausente`: sem isto, uma única mensagem
  // chegando por Realtime apagaria o painel de erro (com o botão "tentar
  // novamente") e o app passaria a AFIRMAR um histórico de uma mensagem só.
  if (!atual || atual.estado === 'ausente' || atual.estado === 'erro') return false

  let proximas: any[]
  if (acao === 'create') {
    if (atual.mensagens.some((m) => m.id === registro.id)) {
      proximas = atual.mensagens.map((m) => (m.id === registro.id ? herdarChaveRender(registro, m) : m))
    } else if (tempIdParaSubstituir && atual.mensagens.some((m) => m.id === tempIdParaSubstituir)) {
      // A linha real HERDA a identidade de renderização do balão otimista —
      // ver `herdarChaveRender`. Sem isto a `key` do React mudaria de
      // `temp-...` para o UUID, o balão seria desmontado e remontado, e a
      // animação de entrada rodaria de novo: é o "flick" ~1s após enviar.
      proximas = atual.mensagens.map((m) =>
        m.id === tempIdParaSubstituir ? { ...registro, chaveRender: tempIdParaSubstituir } : m,
      )
    } else {
      // Inclui o caso "temp já saiu do array": sem este fallback o `map` seria
      // no-op e a mensagem real seria DESCARTADA em silêncio.
      proximas = [...atual.mensagens, registro]
    }
  } else if (acao === 'update') {
    if (!atual.mensagens.some((m) => m.id === registro.id)) return false
    proximas = atual.mensagens.map((m) => (m.id === registro.id ? herdarChaveRender(registro, m) : m))
  } else {
    if (!atual.mensagens.some((m) => m.id === registro.id)) return false
    proximas = atual.mensagens.filter((m) => m.id !== registro.id)
  }

  gravar(chave, { mensagens: proximas, estado: atual.estado, ultimaMensagemId: ultimoIdDe(proximas) })
  return true
}

/** Usado pelo envio otimista, que precisa pintar antes de existir no banco. */
export function definirMensagensSePresente(chave: string, mensagens: any[]): void {
  const atual = porConversa.get(chave)
  if (!atual || atual.estado === 'ausente' || atual.estado === 'erro') return
  gravar(chave, { mensagens, estado: atual.estado, ultimaMensagemId: ultimoIdDe(mensagens) })
}

/**
 * O snapshot está desatualizado em relação à lista lateral? As summaries já
 * carregam `last_message_id`, então dá para saber sem ir à rede.
 */
export function estaDesatualizada(chave: string, ultimaMensagemIdConhecida: string | null): boolean {
  const atual = porConversa.get(chave)
  if (!atual || atual.estado === 'ausente') return true
  if (!ultimaMensagemIdConhecida) return false
  return atual.ultimaMensagemId !== ultimaMensagemIdConhecida
}

/** Chamado na troca de usuário — o conteúdo é por sessão, não por conta. */
export function limparConversas(): void {
  porConversa.clear()
}
