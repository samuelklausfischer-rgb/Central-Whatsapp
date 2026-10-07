import { useSyncExternalStore } from 'react'
import { janelaEmPrimeiroPlano } from '@/lib/notificacao-do-sistema'
import {
  compararMensagens,
  microssDe,
  previewDaMensagem,
} from '@/lib/chat-interno'
import type {
  ColegaDoDiretorio,
  ConversaResumo,
  DadosDoEnvio,
  MembroDaConversa,
  MensagemInterna,
  MensagemPendente,
} from '@/lib/supabase/chat-interno-types'
import {
  ErroDoChatInterno,
  TAMANHO_DA_PAGINA,
  apagarMensagem,
  buscarMensagens,
  enviarComAnexo,
  enviarMensagem,
  esquecerUrlAssinada,
  getDiretorio,
  getMembros,
  getResumo,
  limparUrlsAssinadas,
  marcarLida,
  mensagemDoErro,
  removerArquivosDoChat,
} from '@/services/chat_interno'

/**
 * O Chat interno em memória.
 *
 * ── Por que uma store de módulo ──
 * Quem escuta o Realtime e toca o som mora no `Layout` (vive em toda tela), mas
 * quem DESENHA é o `ChatHub` — rota `lazy()` que desmonta ao navegar. O estado
 * precisa sobreviver a isso, e o selo de "não lidas" precisa existir mesmo com o
 * chat fechado. Mesmo padrão de `stores/notificacoes.ts` e `conversationDrafts.ts`:
 * módulo + `useSyncExternalStore`, sem dependência nova.
 *
 * ── O que NÃO fica aqui ──
 * Nada vai para disco (nome, texto e anexo são conteúdo privado). E tudo é
 * descartado ao trocar de usuário (`reiniciarStore`).
 */

export type EstadoDeCarga = 'inicial' | 'carregando' | 'pronto' | 'erro'

export interface ConversaCarregada {
  estado: 'carregando' | 'pronto' | 'erro'
  /** Linhas reais do banco, da mais antiga para a mais nova. */
  mensagens: MensagemInterna[]
  /** Envios ainda sem confirmação (ou que falharam). Sempre DEPOIS das reais. */
  pendentes: MensagemPendente[]
  temMais: boolean
  carregandoMais: boolean
  /** O canal caiu enquanto ela estava carregada: a próxima abertura relê o fim. */
  desatualizada: boolean
  /**
   * A primeira leitura do banco já deu certo? Enquanto não, o que existe em
   * `mensagens` veio só do Realtime — não é a conversa, e `temMais` não vale.
   */
  jaCarregou: boolean
}

export interface PessoaConhecida {
  nome: string
  avatar_url: string | null
  setor: string | null
  desativado: boolean
}

export interface MembrosEmCache {
  estado: 'carregando' | 'pronto' | 'erro'
  lista: MembroDaConversa[]
  /** Uma mensagem de sistema (entrou/saiu/promoveu) chegou depois da carga. */
  obsoleto: boolean
}

export interface EstadoDoChatInterno {
  usuarioId: string | null
  resumo: ConversaResumo[]
  resumoEstado: EstadoDeCarga
  resumoErro: string | null
  conversas: Record<string, ConversaCarregada>
  pessoas: Record<string, PessoaConhecida>
  diretorio: ColegaDoDiretorio[] | null
  diretorioEstado: EstadoDeCarga
  membros: Record<string, MembrosEmCache>
  /** A conversa que a janela está mostrando agora, e se a pessoa está lendo o fim dela. */
  emFoco: { id: string; noFim: boolean } | null
}

const ESTADO_VAZIO: EstadoDoChatInterno = {
  usuarioId: null,
  resumo: [],
  resumoEstado: 'inicial',
  resumoErro: null,
  conversas: {},
  pessoas: {},
  diretorio: null,
  diretorioEstado: 'inicial',
  membros: {},
  emFoco: null,
}

let estado: EstadoDoChatInterno = ESTADO_VAZIO
const ouvintes = new Set<() => void>()

function publicar(parcial: Partial<EstadoDoChatInterno>) {
  estado = { ...estado, ...parcial }
  ouvintes.forEach((o) => o())
}

function assinar(ouvinte: () => void) {
  ouvintes.add(ouvinte)
  return () => {
    ouvintes.delete(ouvinte)
  }
}

export function obterEstadoDoChatInterno(): Readonly<EstadoDoChatInterno> {
  return estado
}

/**
 * Lê uma fatia. O seletor TEM de devolver a mesma referência enquanto a fatia
 * não mudou (todas as atualizações abaixo são imutáveis) — senão o
 * `useSyncExternalStore` entra em laço.
 */
export function useChatInternoStore<T>(seletor: (e: EstadoDoChatInterno) => T): T {
  return useSyncExternalStore(
    assinar,
    () => seletor(estado),
    () => seletor(ESTADO_VAZIO),
  )
}

// ─── Eventos de mensagem nova (som e notificação) ────────────────────────────

export interface EventoDeMensagemNova {
  mensagem: MensagemInterna
  /** A conversa já com o resumo atualizado; indefinida se nem o recarregamento a achou. */
  conversa: ConversaResumo | undefined
  /** A conversa não estava na lista: acabou de aparecer (convite para grupo, 1ª mensagem direta). */
  conversaNova: boolean
}

const ouvintesDeMensagem = new Set<(e: EventoDeMensagemNova) => void>()

export function aoChegarMensagemNova(ouvinte: (e: EventoDeMensagemNova) => void): () => void {
  ouvintesDeMensagem.add(ouvinte)
  return () => {
    ouvintesDeMensagem.delete(ouvinte)
  }
}

function emitirMensagemNova(evento: EventoDeMensagemNova) {
  ouvintesDeMensagem.forEach((o) => {
    try {
      o(evento)
    } catch (erro) {
      // Um ouvinte com defeito (notificação) não pode impedir os outros nem a tela.
      console.error('[chat-interno] ouvinte de mensagem falhou', erro)
    }
  })
}

// ─── Utilidades de estado ────────────────────────────────────────────────────

function conversaVazia(): ConversaCarregada {
  return { estado: 'carregando', mensagens: [], pendentes: [], temMais: false, carregandoMais: false, desatualizada: false, jaCarregou: false }
}

function atualizarConversa(id: string, fn: (c: ConversaCarregada) => ConversaCarregada) {
  const atual = estado.conversas[id] ?? conversaVazia()
  const novo = fn(atual)
  if (novo === atual && estado.conversas[id]) return
  publicar({ conversas: { ...estado.conversas, [id]: novo } })
}

function ordemDaLista(r: ConversaResumo): number {
  const t = microssDe(r.ultima_mensagem_em ?? r.criado_em)
  return Number.isNaN(t) ? 0 : t
}

function ordenarResumo(lista: ConversaResumo[]): ConversaResumo[] {
  return [...lista].sort((a, b) => ordemDaLista(b) - ordemDaLista(a) || (a.id < b.id ? -1 : 1))
}

function liberarPrevia(p: MensagemPendente) {
  if (p.previaLocal) URL.revokeObjectURL(p.previaLocal)
}

/**
 * Funde a versão nova numa mensagem que já temos.
 *
 * Por que NÃO é um `{...antiga, ...nova}`: o UPDATE do Realtime traz colunas
 * longas e inalteradas (TOAST) como `null`, e o spread apagaria o conteúdo da
 * tela. Só valores não nulos sobrescrevem. A exceção é o apagamento — esse sim
 * zera de propósito conteúdo e anexo.
 */
function fundirMensagem(antiga: MensagemInterna, nova: Partial<MensagemInterna>): MensagemInterna {
  const fundida: MensagemInterna = { ...antiga }
  for (const chave of Object.keys(nova) as (keyof MensagemInterna)[]) {
    const valor = nova[chave]
    if (valor !== null && valor !== undefined) (fundida as unknown as Record<string, unknown>)[chave] = valor
  }
  if (nova.apagada_em) {
    fundida.conteudo = null
    fundida.anexo_path = null
    fundida.anexo_nome = null
    fundida.anexo_mime = null
    fundida.anexo_tamanho = null
    fundida.anexo_duracao_seg = null
  }
  return fundida
}

function inserirOrdenado(lista: MensagemInterna[], msg: MensagemInterna): MensagemInterna[] {
  const i = lista.findIndex((m) => m.id === msg.id)
  if (i >= 0) {
    const copia = lista.slice()
    copia[i] = fundirMensagem(lista[i], msg)
    return copia
  }
  const ultima = lista[lista.length - 1]
  if (!ultima || compararMensagens(ultima, msg) < 0) return [...lista, msg]
  const copia = [...lista, msg]
  copia.sort(compararMensagens)
  return copia
}

function unirPaginas(a: MensagemInterna[], b: MensagemInterna[]): MensagemInterna[] {
  const porId = new Map<string, MensagemInterna>()
  for (const m of a) porId.set(m.id, m)
  for (const m of b) porId.set(m.id, porId.has(m.id) ? fundirMensagem(porId.get(m.id)!, m) : m)
  return [...porId.values()].sort(compararMensagens)
}

// ─── Pessoas ─────────────────────────────────────────────────────────────────

/** Só republica se algo mudou de fato: nomes chegam de várias fontes, a tela não pode piscar por isso. */
function registrarPessoas(novas: Record<string, PessoaConhecida>) {
  let mudou = false
  const proximo = { ...estado.pessoas }
  for (const [id, p] of Object.entries(novas)) {
    const a = proximo[id]
    if (!a || a.nome !== p.nome || a.avatar_url !== p.avatar_url || a.setor !== p.setor || a.desativado !== p.desativado) {
      proximo[id] = { ...a, ...p }
      mudou = true
    }
  }
  if (mudou) publicar({ pessoas: proximo })
}

export function nomeDaPessoa(id: string | null | undefined): string | undefined {
  return id ? estado.pessoas[id]?.nome : undefined
}

// ─── Sessão ──────────────────────────────────────────────────────────────────

/**
 * Rascunho por conversa (`conversaId` → texto): trocar de conversa e voltar não
 * apaga o que estava sendo digitado. Mora AQUI, e não no compositor, para o
 * `reiniciarStore` poder zerá-lo: era um `Map` de módulo do componente, que
 * sobrevivia ao logout, e a próxima pessoa a entrar naquela aba via o texto que a
 * anterior deixou pela metade (texto privado).
 */
export const rascunhosDoChatInterno = new Map<string, string>()

/**
 * Zera tudo para o usuário informado (ou para ninguém). Trocar de conta não pode
 * deixar a conversa da anterior na tela, e as URLs assinadas dela não valem mais.
 */
export function reiniciarStore(usuarioId: string | null) {
  if (estado.usuarioId === usuarioId) return
  Object.values(estado.conversas).forEach((c) => c.pendentes.forEach(liberarPrevia))
  limparUrlsAssinadas()
  rascunhosDoChatInterno.clear()
  resumoEmVoo = null
  resumoRepetir = false
  resumoUltimaCarga = 0
  if (agendamentoDoResumo) clearTimeout(agendamentoDoResumo)
  agendamentoDoResumo = null
  ultimasEmVoo.clear()
  membrosEmVoo.clear()
  filasDeEnvio.clear()
  estado = { ...ESTADO_VAZIO, usuarioId }
  ouvintes.forEach((o) => o())
}

// ─── Resumo (lista de conversas) ─────────────────────────────────────────────

let resumoEmVoo: Promise<void> | null = null
let resumoRepetir = false
let resumoUltimaCarga = 0
let agendamentoDoResumo: ReturnType<typeof setTimeout> | null = null

function pessoasDoResumo(lista: ConversaResumo[]): Record<string, PessoaConhecida> {
  const out: Record<string, PessoaConhecida> = {}
  for (const r of lista) {
    if (r.tipo === 'direta' && r.outro_user_id) {
      const a = estado.pessoas[r.outro_user_id]
      out[r.outro_user_id] = {
        nome: r.nome,
        avatar_url: a?.avatar_url ?? null,
        setor: a?.setor ?? null,
        desativado: !!r.outro_desativado,
      }
    }
    if (r.ultima_mensagem_autor_id && r.ultima_mensagem_autor_nome && !out[r.ultima_mensagem_autor_id]) {
      const a = estado.pessoas[r.ultima_mensagem_autor_id]
      out[r.ultima_mensagem_autor_id] = {
        nome: r.ultima_mensagem_autor_nome,
        avatar_url: a?.avatar_url ?? null,
        setor: a?.setor ?? null,
        desativado: a?.desativado ?? false,
      }
    }
  }
  return out
}

/**
 * Relê a lista. Chamadas simultâneas viram uma só; com `forcar` e uma carga já
 * em voo, uma segunda roda logo depois (a primeira pode ter lido o banco ANTES do
 * fato que motivou o pedido — ex.: ser adicionado a um grupo).
 */
export function carregarResumo(opcoes: { forcar?: boolean; ignorarSeRecenteMs?: number } = {}): Promise<void> {
  const usuario = estado.usuarioId
  if (!usuario) return Promise.resolve()
  if (
    opcoes.ignorarSeRecenteMs &&
    estado.resumoEstado === 'pronto' &&
    Date.now() - resumoUltimaCarga < opcoes.ignorarSeRecenteMs
  ) {
    return Promise.resolve()
  }
  if (resumoEmVoo) {
    if (opcoes.forcar) resumoRepetir = true
    return resumoEmVoo
  }

  const carga = (async () => {
    if (estado.resumoEstado !== 'pronto') publicar({ resumoEstado: 'carregando', resumoErro: null })
    try {
      const lista = await getResumo()
      if (estado.usuarioId !== usuario) return
      resumoUltimaCarga = Date.now()
      registrarPessoas(pessoasDoResumo(lista))
      const foco = estado.emFoco
      // A conversa que estou lendo agora não tem não-lida: a marcação de leitura
      // pode ainda estar a caminho e o servidor devolver o número antigo.
      const ajustada = lista.map((r) => (foco && foco.id === r.id && foco.noFim && janelaEmPrimeiroPlano() ? { ...r, nao_lidas: 0 } : r))
      publicar({ resumo: ajustada, resumoEstado: 'pronto', resumoErro: null })
    } catch (erro) {
      if (estado.usuarioId !== usuario) return
      // Com lista já na tela, falhar uma releitura não derruba nada: segue o que há.
      publicar({
        resumoEstado: estado.resumoEstado === 'pronto' ? 'pronto' : 'erro',
        resumoErro: mensagemDoErro(erro, 'Não foi possível carregar as conversas.'),
      })
    } finally {
      resumoEmVoo = null
      if (resumoRepetir) {
        resumoRepetir = false
        void carregarResumo()
      }
    }
  })()
  resumoEmVoo = carga
  return carga
}

/** Várias mensagens de sistema seguidas pedem UMA releitura só. */
function agendarResumo(ms = 600) {
  if (agendamentoDoResumo) return
  agendamentoDoResumo = setTimeout(() => {
    agendamentoDoResumo = null
    void carregarResumo({ forcar: true })
  }, ms)
}

export function totalDeNaoLidas(e: Pick<EstadoDoChatInterno, 'resumo'>): number {
  let total = 0
  for (const r of e.resumo) if (!r.silenciada) total += r.nao_lidas
  return total
}

function alterarResumo(id: string, fn: (r: ConversaResumo) => ConversaResumo) {
  const i = estado.resumo.findIndex((r) => r.id === id)
  if (i < 0) return
  const antigo = estado.resumo[i]
  const novo = fn(antigo)
  if (novo === antigo) return
  const copia = estado.resumo.slice()
  copia[i] = novo
  publicar({ resumo: ordenarResumo(copia) })
}

export function removerConversaDaLista(id: string) {
  const conv = estado.conversas[id]
  conv?.pendentes.forEach(liberarPrevia)
  const { [id]: _a, ...resto } = estado.conversas
  const { [id]: _b, ...restoMembros } = estado.membros
  publicar({
    resumo: estado.resumo.filter((r) => r.id !== id),
    conversas: resto,
    membros: restoMembros,
    emFoco: estado.emFoco?.id === id ? null : estado.emFoco,
  })
}

export function definirSilenciadaLocal(id: string, silenciada: boolean) {
  alterarResumo(id, (r) => (r.silenciada === silenciada ? r : { ...r, silenciada }))
}

export function definirNomeLocal(id: string, nome: string) {
  alterarResumo(id, (r) => (r.nome === nome ? r : { ...r, nome }))
}

function zerarNaoLidasLocal(id: string) {
  alterarResumo(id, (r) => (r.nao_lidas === 0 ? r : { ...r, nao_lidas: 0 }))
}

/** Ids que já viraram "+1 não lida" — protege de um evento duplicado contar duas vezes. */
const jaContadas = new Set<string>()

function incorporarNoResumo(msg: MensagemInterna, lidaNaHora: boolean) {
  const meu = estado.usuarioId
  const ehMinha = msg.autor_id === meu
  const conta = !ehMinha && msg.tipo !== 'sistema' && !msg.apagada_em && !jaContadas.has(msg.id)
  if (conta) {
    jaContadas.add(msg.id)
    if (jaContadas.size > 500) jaContadas.delete(jaContadas.values().next().value as string)
  }
  alterarResumo(msg.conversa_id, (r) => {
    const maisNova = !r.ultima_mensagem_em || microssDe(msg.criado_em) >= microssDe(r.ultima_mensagem_em)
    return {
      ...r,
      ...(maisNova
        ? {
            ultima_mensagem_em: msg.criado_em,
            ultima_mensagem_preview: previewDaMensagem(msg),
            ultima_mensagem_tipo: msg.tipo,
            ultima_mensagem_autor_id: msg.autor_id,
            ultima_mensagem_autor_nome: msg.autor_id ? (estado.pessoas[msg.autor_id]?.nome ?? null) : null,
          }
        : {}),
      nao_lidas: conta && !lidaNaHora ? r.nao_lidas + 1 : r.nao_lidas,
    }
  })
}

// ─── Mensagens ───────────────────────────────────────────────────────────────

/** Uma mensagem real chegou (Realtime ou retorno do próprio envio). Idempotente. */
export function incorporarMensagem(msg: MensagemInterna) {
  const id = msg.conversa_id
  const conhecida = estado.resumo.some((r) => r.id === id)
  const carregada = estado.conversas[id]

  if (carregada) {
    atualizarConversa(id, (c) => {
      let pendentes = c.pendentes
      if (msg.client_id && pendentes.some((p) => p.client_id === msg.client_id)) {
        pendentes.filter((p) => p.client_id === msg.client_id).forEach(liberarPrevia)
        pendentes = pendentes.filter((p) => p.client_id !== msg.client_id)
      }
      return { ...c, mensagens: inserirOrdenado(c.mensagens, msg), pendentes }
    })
  }

  if (msg.tipo === 'sistema') {
    invalidarMembros(id)
    if (conhecida) agendarResumo()
  }

  if (!conhecida) {
    // Conversa que não conhecemos: é assim que chega "fui adicionado a um grupo" e
    // "alguém abriu uma conversa comigo" — o canal só publica mensagens.
    // Se a lista ainda nem tinha carregado (mensagem que pegou a abertura do app),
    // "não conheço" não quer dizer "é nova": não vira convite.
    const listaJaEstavaPronta = estado.resumoEstado === 'pronto'
    void carregarResumo({ forcar: true }).then(() => {
      const conversa = estado.resumo.find((r) => r.id === id)
      if (conversa && msg.autor_id !== estado.usuarioId) {
        emitirMensagemNova({ mensagem: msg, conversa, conversaNova: listaJaEstavaPronta })
      }
    })
    return
  }

  const foco = estado.emFoco
  const lidaNaHora = !!foco && foco.id === id && foco.noFim && janelaEmPrimeiroPlano()
  incorporarNoResumo(msg, lidaNaHora)

  // Autor de grupo sem nome conhecido: busca os membros em segundo plano para o
  // balão e a lista deixarem de mostrar um espaço em branco.
  if (msg.autor_id && !estado.pessoas[msg.autor_id] && msg.autor_id !== estado.usuarioId) void carregarMembros(id)

  if (msg.autor_id !== estado.usuarioId) {
    emitirMensagemNova({
      mensagem: msg,
      conversa: estado.resumo.find((r) => r.id === id),
      conversaNova: false,
    })
  }
}

/** UPDATE do Realtime: hoje só o apagamento. */
export function aplicarAtualizacaoDeMensagem(parcial: Partial<MensagemInterna> & { id: string; conversa_id: string }) {
  const id = parcial.conversa_id
  const carregada = estado.conversas[id]
  const antiga = carregada?.mensagens.find((m) => m.id === parcial.id)

  if (antiga) {
    // O arquivo some do banco e do Storage: a URL assinada guardada não serve mais.
    if (parcial.apagada_em && antiga.anexo_path) esquecerUrlAssinada(antiga.anexo_path)
    atualizarConversa(id, (c) => ({
      ...c,
      mensagens: c.mensagens.map((m) => (m.id === parcial.id ? fundirMensagem(m, parcial) : m)),
    }))
  }

  if (parcial.apagada_em) {
    // O banco troca a prévia da conversa por "Mensagem apagada" quando era a última.
    const alvo = antiga?.criado_em ?? parcial.criado_em
    alterarResumo(id, (r) =>
      alvo && r.ultima_mensagem_em && microssDe(alvo) === microssDe(r.ultima_mensagem_em)
        ? { ...r, ultima_mensagem_preview: 'Mensagem apagada' }
        : r,
    )
  }
}

const ultimasEmVoo = new Map<string, Promise<void>>()

/**
 * Abre a conversa no store: lê o fim se ela nunca foi lida, deu erro ou ficou
 * para trás (canal caiu). Conversa já carregada e em dia não pede nada à rede —
 * voltar a ela é instantâneo.
 */
export function garantirConversaCarregada(id: string): Promise<void> {
  const c = estado.conversas[id]
  if (c && c.jaCarregou && !c.desatualizada && c.estado === 'pronto') return Promise.resolve()
  return carregarUltimas(id)
}

/** A primeira página — ou o fim, se a conversa já estava carregada e ficou para trás. */
export function carregarUltimas(id: string): Promise<void> {
  const voando = ultimasEmVoo.get(id)
  if (voando) return voando

  const antes = estado.conversas[id]
  if (!antes) atualizarConversa(id, () => conversaVazia())
  else if (antes.estado === 'erro') atualizarConversa(id, (c) => ({ ...c, estado: 'carregando' }))

  const usuario = estado.usuarioId
  const carga = (async () => {
    try {
      const desc = await buscarMensagens(id)
      if (estado.usuarioId !== usuario) return
      const pagina = [...desc].reverse()
      atualizarConversa(id, (c) => {
        const maisNovaQueTinhamos = c.mensagens[c.mensagens.length - 1]
        const maisAntigaDaPagina = pagina[0]
        // Sem sobreposição entre o que tínhamos e o que veio: há um buraco no
        // meio. Remendar deixaria uma lacuna invisível; recomeçar do fim é o certo.
        const haBuraco =
          c.jaCarregou &&
          !!maisNovaQueTinhamos &&
          !!maisAntigaDaPagina &&
          pagina.length >= TAMANHO_DA_PAGINA &&
          compararMensagens(maisNovaQueTinhamos, maisAntigaDaPagina) < 0
        const base = haBuraco ? [] : c.mensagens
        return {
          ...c,
          estado: 'pronto',
          mensagens: unirPaginas(base, pagina),
          temMais: !c.jaCarregou || haBuraco ? pagina.length >= TAMANHO_DA_PAGINA : c.temMais,
          desatualizada: false,
          carregandoMais: false,
          jaCarregou: true,
        }
      })
    } catch (erro) {
      if (estado.usuarioId !== usuario) return
      // Já tinha a conversa na tela: falhar a releitura do fim não a derruba.
      atualizarConversa(id, (c) => ({ ...c, estado: c.jaCarregou ? 'pronto' : 'erro' }))
      if (erro instanceof ErroDoChatInterno && erro.naoSouMembro) void carregarResumo({ forcar: true })
    } finally {
      ultimasEmVoo.delete(id)
    }
  })()
  ultimasEmVoo.set(id, carga)
  return carga
}

export async function carregarMaisAntigas(id: string): Promise<void> {
  const c = estado.conversas[id]
  if (!c || c.carregandoMais || !c.temMais || c.mensagens.length === 0) return
  atualizarConversa(id, (x) => ({ ...x, carregandoMais: true }))
  try {
    const desc = await buscarMensagens(id, c.mensagens[0].criado_em)
    atualizarConversa(id, (x) => ({
      ...x,
      mensagens: unirPaginas(x.mensagens, [...desc].reverse()),
      temMais: desc.length >= TAMANHO_DA_PAGINA,
      carregandoMais: false,
    }))
  } catch {
    atualizarConversa(id, (x) => ({ ...x, carregandoMais: false }))
  }
}

/** O canal caiu e voltou: o que aconteceu no intervalo não tem replay. */
export function marcarConversasDesatualizadas() {
  const ids = Object.keys(estado.conversas)
  if (ids.length === 0) return
  const conversas: Record<string, ConversaCarregada> = {}
  for (const id of ids) conversas[id] = { ...estado.conversas[id], desatualizada: true }
  publicar({ conversas })
  const foco = estado.emFoco
  if (foco) void carregarUltimas(foco.id)
}

export function definirEmFoco(foco: { id: string; noFim: boolean } | null) {
  const a = estado.emFoco
  if (a === foco) return
  if (a && foco && a.id === foco.id && a.noFim === foco.noFim) return
  if (!a && !foco) return
  publicar({ emFoco: foco })
}

// ─── Envio ───────────────────────────────────────────────────────────────────

/**
 * `ok: false` traz o `erro`. Não é uma união discriminada de propósito: o projeto
 * compila sem `strictNullChecks`, e sem ele o TypeScript não estreita `{ok:true}|{ok:false}`.
 */
export interface ResultadoDoEnvio {
  ok: boolean
  erro?: ErroDoChatInterno
}

function comoErro(e: unknown): ErroDoChatInterno {
  return e instanceof ErroDoChatInterno ? e : new ErroDoChatInterno(mensagemDoErro(e))
}

function alterarPendente(conversaId: string, clientId: string, fn: (p: MensagemPendente) => MensagemPendente) {
  atualizarConversa(conversaId, (c) => ({
    ...c,
    pendentes: c.pendentes.map((p) => (p.client_id === clientId ? fn(p) : p)),
  }))
}

async function executarEnvio(conversaId: string, clientId: string): Promise<ResultadoDoEnvio> {
  const pendente = estado.conversas[conversaId]?.pendentes.find((p) => p.client_id === clientId)
  if (!pendente) return { ok: true }
  const d = pendente.dados
  try {
    const linha = d.arquivo
      ? await enviarComAnexo(
          { conversaId, tipo: d.tipo, conteudo: d.conteudo, respondeA: d.respondeA, clientId },
          {
            arquivo: d.arquivo,
            nome: d.nomeDoArquivo ?? 'arquivo',
            mime: d.mime ?? 'application/octet-stream',
            tamanho: d.tamanho ?? d.arquivo.size,
            duracaoSeg: d.duracaoSeg ?? null,
          },
          d.caminhoJaEnviado,
        )
      : await enviarMensagem({ conversaId, tipo: 'texto', conteudo: d.conteudo, respondeA: d.respondeA, clientId })
    incorporarMensagem(linha)
    return { ok: true }
  } catch (e) {
    const erro = comoErro(e)
    alterarPendente(conversaId, clientId, (p) => ({
      ...p,
      situacao: 'falhou',
      erro: erro.message,
      // Falha ambígua: o arquivo ficou no Storage e o reenvio reaproveita.
      dados: { ...p.dados, caminhoJaEnviado: erro.caminhoJaEnviado ?? (erro.definitivo ? undefined : p.dados.caminhoJaEnviado) },
    }))
    if (erro.naoSouMembro) void carregarResumo({ forcar: true })
    return { ok: false, erro }
  }
}

/**
 * Fila de envio POR CONVERSA. Os balões aparecem na hora, mas o que vai para o
 * banco sai um de cada vez, na ordem em que a pessoa mandou — três fotos enviadas
 * juntas chegam na ordem, e o "ok" digitado depois delas não passa na frente
 * (o `criado_em` do banco é a ordem final na tela; sem fila, o balão da foto
 * lenta daria um pulo para baixo quando enfim fosse confirmada).
 * `executarEnvio` nunca rejeita, então um envio que falha não trava os seguintes.
 */
const filasDeEnvio = new Map<string, Promise<unknown>>()

function naFila<T>(conversaId: string, tarefa: () => Promise<T>): Promise<T> {
  const anterior = filasDeEnvio.get(conversaId) ?? Promise.resolve()
  const proxima = anterior.then(tarefa, tarefa)
  filasDeEnvio.set(
    conversaId,
    proxima.then(
      () => undefined,
      () => undefined,
    ),
  )
  return proxima
}

/** Mostra o balão na hora e envia. `clientId` é a chave de idempotência do reenvio. */
export function enviarNaConversa(conversaId: string, dados: DadosDoEnvio): Promise<ResultadoDoEnvio> {
  const clientId = crypto.randomUUID()
  const gerarPrevia = dados.arquivo && (dados.tipo === 'imagem' || dados.tipo === 'audio')
  const pendente: MensagemPendente = {
    id: `local-${clientId}`,
    conversa_id: conversaId,
    autor_id: estado.usuarioId,
    tipo: dados.tipo,
    conteudo: dados.conteudo,
    anexo_path: null,
    anexo_nome: dados.nomeDoArquivo ?? null,
    anexo_mime: dados.mime ?? null,
    anexo_tamanho: dados.tamanho ?? null,
    anexo_duracao_seg: dados.duracaoSeg ?? null,
    responde_a: dados.respondeA,
    client_id: clientId,
    criado_em: new Date().toISOString(),
    editada_em: null,
    apagada_em: null,
    situacao: 'enviando',
    dados,
    previaLocal: gerarPrevia ? URL.createObjectURL(dados.arquivo!) : undefined,
  }
  atualizarConversa(conversaId, (c) => ({ ...c, pendentes: [...c.pendentes, pendente] }))
  return naFila(conversaId, () => executarEnvio(conversaId, clientId))
}

/** "Tentar de novo": o MESMO `client_id`, então se a primeira tentativa chegou ao banco não duplica. */
export function reenviarPendente(conversaId: string, clientId: string): Promise<ResultadoDoEnvio> {
  alterarPendente(conversaId, clientId, (p) => ({ ...p, situacao: 'enviando', erro: undefined }))
  return naFila(conversaId, () => executarEnvio(conversaId, clientId))
}

export function descartarPendente(conversaId: string, clientId: string) {
  atualizarConversa(conversaId, (c) => {
    const alvo = c.pendentes.filter((p) => p.client_id === clientId)
    if (alvo.length === 0) return c
    alvo.forEach(liberarPrevia)
    return { ...c, pendentes: c.pendentes.filter((p) => p.client_id !== clientId) }
  })
}

export async function apagarMinhaMensagem(msg: MensagemInterna): Promise<ResultadoDoEnvio> {
  const caminho = msg.anexo_path
  try {
    const linha = await apagarMensagem(msg.id)
    aplicarAtualizacaoDeMensagem({ ...linha, apagada_em: linha.apagada_em ?? new Date().toISOString() })
    if (caminho) {
      esquecerUrlAssinada(caminho)
      void removerArquivosDoChat([caminho])
    }
    return { ok: true }
  } catch (e) {
    return { ok: false, erro: comoErro(e) }
  }
}

// ─── Leitura ─────────────────────────────────────────────────────────────────

export async function marcarComoLida(conversaId: string, ate: string): Promise<void> {
  zerarNaoLidasLocal(conversaId)
  try {
    await marcarLida(conversaId, ate)
  } catch {
    // Não marcou: relê a lista para o selo voltar a dizer a verdade (e para
    // descobrir, se for o caso, que não sou mais membro).
    void carregarResumo({ forcar: true })
  }
}

// ─── Membros e diretório ─────────────────────────────────────────────────────

export function invalidarMembros(conversaId: string) {
  const atual = estado.membros[conversaId]
  if (!atual || atual.obsoleto) return
  publicar({ membros: { ...estado.membros, [conversaId]: { ...atual, obsoleto: true } } })
}

const membrosEmVoo = new Map<string, Promise<MembroDaConversa[]>>()

export function carregarMembros(conversaId: string): Promise<MembroDaConversa[]> {
  const jaTem = estado.membros[conversaId]
  if (jaTem && jaTem.estado === 'pronto' && !jaTem.obsoleto) return Promise.resolve(jaTem.lista)
  const voando = membrosEmVoo.get(conversaId)
  if (voando) return voando

  publicar({
    membros: {
      ...estado.membros,
      [conversaId]: { estado: jaTem?.lista.length ? 'pronto' : 'carregando', lista: jaTem?.lista ?? [], obsoleto: false },
    },
  })
  const p = getMembros(conversaId)
    .then((lista) => {
      const pessoas: Record<string, PessoaConhecida> = {}
      for (const m of lista) {
        pessoas[m.user_id] = { nome: m.nome, avatar_url: m.avatar_url, setor: m.setor, desativado: m.desativado }
      }
      registrarPessoas(pessoas)
      publicar({ membros: { ...estado.membros, [conversaId]: { estado: 'pronto', lista, obsoleto: false } } })
      return lista
    })
    .catch((erro) => {
      publicar({
        membros: {
          ...estado.membros,
          [conversaId]: { estado: 'erro', lista: estado.membros[conversaId]?.lista ?? [], obsoleto: false },
        },
      })
      if (erro instanceof ErroDoChatInterno && erro.naoSouMembro) void carregarResumo({ forcar: true })
      throw erro
    })
    .finally(() => {
      membrosEmVoo.delete(conversaId)
    })
  membrosEmVoo.set(conversaId, p)
  // Quem não espera o retorno não pode gerar "unhandled rejection".
  p.catch(() => {})
  return p
}

export async function carregarDiretorio(forcar = false): Promise<void> {
  if (!estado.usuarioId) return
  if (!forcar && estado.diretorioEstado === 'pronto') return
  if (estado.diretorioEstado !== 'pronto') publicar({ diretorioEstado: 'carregando' })
  const usuario = estado.usuarioId
  try {
    const lista = await getDiretorio()
    if (estado.usuarioId !== usuario) return
    const pessoas: Record<string, PessoaConhecida> = {}
    for (const c of lista) {
      pessoas[c.id] = { nome: c.nome || 'Usuário', avatar_url: c.avatar_url, setor: c.setor, desativado: false }
    }
    registrarPessoas(pessoas)
    publicar({ diretorio: lista, diretorioEstado: 'pronto' })
  } catch {
    if (estado.usuarioId !== usuario) return
    publicar({ diretorioEstado: estado.diretorio ? 'pronto' : 'erro' })
  }
}
