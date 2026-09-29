/**
 * Onda de áudio (as barrinhas do player, como no WhatsApp).
 *
 * A onda REAL é calculada decodificando o arquivo no navegador. Isso é caro
 * (baixa o arquivo inteiro e vira PCM na memória), então tudo aqui existe para
 * gastar o mínimo: cache por URL, fila com no máximo 2 decodificações ao mesmo
 * tempo, teto de tamanho do arquivo e um único contexto de áudio compartilhado.
 *
 * Se algo falhar (CORS no Storage, formato que o navegador não decodifica,
 * arquivo grande demais), a Promise REJEITA e o componente mostra barras baixas
 * e uniformes. Nunca inventamos uma onda: onda falsa mente sobre o conteúdo.
 */

// Voz em opus pesa ~120 KB/min, então 1 MB cobre ~8 min. Acima disto o PCM
// decodificado ocuparia dezenas de MB só para desenhar 40 barrinhas — não
// compensa; cai no placeholder.
const TAMANHO_MAXIMO_BYTES = 1024 * 1024

// Para desenhar 40 barras não precisamos de qualidade de áudio: 16 kHz mono
// reduz a memória do PCM decodificado a ~1/3 de 44,1 kHz.
const TAXA_DE_AMOSTRAGEM = 16000

const MAX_DECODIFICACOES_SIMULTANEAS = 2
const MAX_ENTRADAS_NO_CACHE = 300

type ContextoOffline = OfflineAudioContext

export interface OndaDeAudio {
  /** Alturas normalizadas (0..1), uma por barra. */
  barras: number[]
  /**
   * Duração real do áudio decodificado, em segundos. Gravações WebM feitas no
   * navegador costumam vir sem duração no cabeçalho (`audio.duration` =
   * Infinity); o buffer decodificado sabe a duração verdadeira.
   */
  duracao: number
}

/**
 * `transitorio` separa o que vale tentar de novo (rede caiu, servidor 5xx) do
 * que é definitivo (formato não decodificável, 4xx, arquivo grande demais).
 * Só o definitivo pode ficar em cache: guardar uma falha passageira deixaria a
 * onda plana até recarregar a página.
 */
class ErroDeOnda extends Error {
  transitorio: boolean
  constructor(mensagem: string, transitorio: boolean) {
    super(mensagem)
    this.transitorio = transitorio
  }
}

// Um único contexto para a aba inteira. `decodeAudioData` funciona num
// OfflineAudioContext sem tocar nada e sem a política de autoplay; criar um por
// balão estouraria o limite de contextos do Chrome/Safari.
let contexto: ContextoOffline | null = null

function obterContexto(): ContextoOffline {
  if (contexto) return contexto
  // Safari antigo só expõe o construtor com prefixo.
  const Ctor: typeof OfflineAudioContext | undefined =
    window.OfflineAudioContext ??
    (window as unknown as { webkitOfflineAudioContext?: typeof OfflineAudioContext }).webkitOfflineAudioContext
  if (!Ctor) throw new Error('OfflineAudioContext indisponível')
  contexto = new Ctor(1, 1, TAXA_DE_AMOSTRAGEM)
  return contexto
}

// Safari antigo não devolve Promise em `decodeAudioData`; só aceita callbacks.
function decodificar(ctx: ContextoOffline, dados: ArrayBuffer): Promise<AudioBuffer> {
  return new Promise((resolve, reject) => {
    try {
      const retorno = ctx.decodeAudioData(dados, resolve, reject)
      if (retorno && typeof retorno.then === 'function') retorno.then(resolve, reject)
    } catch (erro) {
      reject(erro)
    }
  })
}

/** Reduz o PCM a `barras` valores em 0..1 (RMS por janela, normalizado pelo maior). */
function calcularBarras(buffer: AudioBuffer, barras: number): number[] {
  const amostras = buffer.getChannelData(0)
  const tamanhoJanela = Math.max(1, Math.floor(amostras.length / barras))
  const valores: number[] = []

  for (let i = 0; i < barras; i++) {
    const inicio = i * tamanhoJanela
    const fim = Math.min(amostras.length, inicio + tamanhoJanela)
    let soma = 0
    for (let j = inicio; j < fim; j++) soma += amostras[j] * amostras[j]
    // RMS (energia média) e não pico: um estalo isolado não deve virar barra alta.
    valores.push(fim > inicio ? Math.sqrt(soma / (fim - inicio)) : 0)
  }

  const maior = Math.max(...valores)
  if (!(maior > 0)) return valores.map(() => 0)
  // Normaliza pelo maior e suaviza com raiz: a voz falada tem muita variação de
  // volume e, linear, a maioria das barras ficaria quase invisível.
  return valores.map((v) => Math.pow(v / maior, 0.7))
}

/**
 * Lê o corpo respeitando o teto SEM baixar tudo antes de decidir: primeiro pelo
 * `content-length`; se o servidor não informar, lê em stream e aborta ao passar
 * do teto. `arrayBuffer()` puro baixaria um áudio de 50 MB inteiro só para
 * descartá-lo depois.
 */
async function lerCorpoLimitado(resposta: Response): Promise<ArrayBuffer> {
  const declarado = Number(resposta.headers.get('content-length'))
  if (Number.isFinite(declarado) && declarado > TAMANHO_MAXIMO_BYTES) {
    void resposta.body?.cancel()
    throw new ErroDeOnda('Áudio grande demais para a onda', false)
  }

  if (!resposta.body) {
    const dados = await resposta.arrayBuffer()
    if (dados.byteLength > TAMANHO_MAXIMO_BYTES) throw new ErroDeOnda('Áudio grande demais para a onda', false)
    return dados
  }

  const leitor = resposta.body.getReader()
  const pedacos: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await leitor.read()
    if (done) break
    total += value.byteLength
    if (total > TAMANHO_MAXIMO_BYTES) {
      void leitor.cancel()
      throw new ErroDeOnda('Áudio grande demais para a onda', false)
    }
    pedacos.push(value)
  }
  const junto = new Uint8Array(total)
  let posicao = 0
  for (const pedaco of pedacos) {
    junto.set(pedaco, posicao)
    posicao += pedaco.byteLength
  }
  return junto.buffer
}

async function calcularOnda(url: string, barras: number): Promise<OndaDeAudio> {
  const resposta = await fetch(url)
  if (!resposta.ok) throw new ErroDeOnda(`Áudio indisponível (${resposta.status})`, resposta.status >= 500)
  const dados = await lerCorpoLimitado(resposta)
  const buffer = await decodificar(obterContexto(), dados)
  return { barras: calcularBarras(buffer, barras), duracao: buffer.duration }
}

// --- Fila: no máximo 2 decodificações ao mesmo tempo -------------------------
// Uma conversa com 30 áudios visíveis ao rolar não pode baixar e decodificar
// tudo de uma vez e travar a aba.
let emAndamento = 0
const fila: Array<() => void> = []

function proximaDaFila() {
  while (emAndamento < MAX_DECODIFICACOES_SIMULTANEAS && fila.length > 0) {
    const iniciar = fila.shift()
    iniciar?.()
  }
}

function enfileirar<T>(tarefa: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    fila.push(() => {
      emAndamento++
      tarefa()
        .then(resolve, reject)
        .finally(() => {
          emAndamento--
          proximaDaFila()
        })
    })
    proximaDaFila()
  })
}

// --- Cache em memória: URL -> Promise ----------------------------------------
// Guarda a Promise (não o resultado) para que dois balões com a mesma URL
// dividam a mesma decodificação. Falhas DEFINITIVAS também ficam guardadas: sem
// isso, um CORS bloqueado seria refeito a cada montagem do balão. Falhas de
// rede/5xx saem do cache para a próxima tentativa poder dar certo.
const cache = new Map<string, Promise<OndaDeAudio>>()

// Espelho SÍNCRONO só das ondas prontas. O componente lê daqui no estado
// inicial: ao remontar (rolagem, troca de conversa) o balão já nasce com a onda
// e não pisca plano por um frame esperando a Promise resolver.
const prontas = new Map<string, OndaDeAudio>()

function chaveDe(url: string, barras: number): string {
  return `${barras}|${url}`
}

// Cada entrada é minúscula (40 números), mas as listas não podem crescer sem
// fim numa sessão longa: descarta a mais antiga (Map guarda ordem de inserção).
function limitar<V>(mapa: Map<string, V>) {
  if (mapa.size > MAX_ENTRADAS_NO_CACHE) {
    const maisAntiga = mapa.keys().next().value
    if (maisAntiga !== undefined) mapa.delete(maisAntiga)
  }
}

/** Onda já calculada, ou `null`. Leitura síncrona, sem disparar nada. */
export function ondaEmCache(url: string, barras = 40): OndaDeAudio | null {
  return prontas.get(chaveDe(url, barras)) ?? null
}

/**
 * Devolve a onda do áudio (`barras` valores entre 0 e 1) e a duração real.
 * Rejeita se não for possível calcular — quem chama mostra o placeholder.
 */
export function obterOnda(url: string, barras = 40): Promise<OndaDeAudio> {
  const chave = chaveDe(url, barras)
  const existente = cache.get(chave)
  if (existente) return existente

  const promessa = enfileirar(() => calcularOnda(url, barras))
  cache.set(chave, promessa)
  limitar(cache)

  promessa.then(
    (onda) => {
      prontas.set(chave, onda)
      limitar(prontas)
    },
    (erro: unknown) => {
      // `fetch` falha com TypeError quando a rede cai; 5xx vem como transitório.
      const transitorio = erro instanceof TypeError || (erro instanceof ErroDeOnda && erro.transitorio)
      if (transitorio && cache.get(chave) === promessa) cache.delete(chave)
    },
  )
  return promessa
}
