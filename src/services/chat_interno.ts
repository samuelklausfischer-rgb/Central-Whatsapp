import supabase from '@/lib/supabase/client'
import type {
  ColegaDoDiretorio,
  ConversaResumo,
  MembroDaConversa,
  MensagemInterna,
  PapelNoGrupo,
} from '@/lib/supabase/chat-interno-types'

/**
 * Acesso ao Chat interno: RPCs `chat_interno_*`, a leitura das mensagens e o
 * bucket PRIVADO `chat-interno`.
 *
 * Toda escrita passa por RPC (as tabelas só têm SELECT). O texto de
 * `error.message` das RPCs já é a frase em português para o usuário — é o
 * contrato com o banco —, então ele sobe até o toast sem tradução.
 */

export const BUCKET_DO_CHAT_INTERNO = 'chat-interno'
/** O limite do bucket (migration): 25 MB. Conferido aqui para recusar ANTES de subir. */
export const TAMANHO_MAXIMO_DO_ANEXO = 25 * 1024 * 1024
/** O banco recusa áudio menor que isto (cabeçalho WebM sem som, ~110 bytes). */
export const TAMANHO_MINIMO_DO_AUDIO = 1000
export const TAMANHO_DA_PAGINA = 50

/**
 * Erro com o texto pronto para o usuário e a pista de "o servidor recusou" ou
 * "não sei o que aconteceu".
 *
 * `definitivo`: veio um SQLSTATE do Postgres — a RPC rodou e RECUSOU, então nada
 * foi criado. Sem código (queda de rede, timeout do gateway) o resultado é
 * AMBÍGUO: a mensagem pode ter nascido e só a resposta se perdeu. Quem apaga
 * arquivo depois de um erro precisa dessa diferença — ver `enviarComAnexo`.
 */
export class ErroDoChatInterno extends Error {
  readonly codigo: string
  readonly definitivo: boolean
  /** Caminho que subiu para o Storage e foi mantido porque o resultado do envio é ambíguo. */
  caminhoJaEnviado?: string

  constructor(mensagem: string, codigo = '') {
    super(mensagem)
    this.name = 'ErroDoChatInterno'
    this.codigo = codigo
    this.definitivo = codigo !== ''
  }

  /** "Você não participa mais desta conversa" — hora de recarregar a lista e fechar. */
  get naoSouMembro() {
    return this.codigo === 'P0002'
  }
}

const SEM_CONEXAO = 'Sem conexão com o servidor. Verifique a internet e tente de novo.'

function pareceFalhaDeRede(mensagem: string) {
  return /failed to fetch|networkerror|network request failed|load failed|fetch failed/i.test(mensagem)
}

function paraErro(erro: { message?: string; code?: string } | null | undefined): ErroDoChatInterno {
  const mensagem = erro?.message ?? ''
  const codigo = erro?.code ?? ''
  if (!codigo && (!mensagem || pareceFalhaDeRede(mensagem))) return new ErroDoChatInterno(SEM_CONEXAO)
  // Códigos do PostgREST (PGRST...) trazem texto técnico em inglês: melhor o genérico.
  if (codigo.startsWith('PGRST')) {
    return new ErroDoChatInterno('Não foi possível concluir a operação agora. Tente de novo em instantes.', codigo)
  }
  return new ErroDoChatInterno(mensagem || 'Não foi possível concluir a operação.', codigo)
}

/** Texto para o toast, venha o erro de onde vier. */
export function mensagemDoErro(erro: unknown, padrao = 'Não foi possível concluir a operação.'): string {
  if (erro instanceof ErroDoChatInterno) return erro.message
  if (erro instanceof Error && erro.message) {
    return pareceFalhaDeRede(erro.message) ? SEM_CONEXAO : erro.message
  }
  return padrao
}

async function rpc<T>(nome: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(nome, args)
  if (error) throw paraErro(error)
  return data as T
}

/** RPC que devolve UMA linha composta: o PostgREST entrega objeto, mas aceitamos array por garantia. */
function umaLinha<T>(dado: unknown): T {
  return (Array.isArray(dado) ? dado[0] : dado) as T
}

// ─── Leitura ─────────────────────────────────────────────────────────────────

export async function getResumo(): Promise<ConversaResumo[]> {
  return (await rpc<ConversaResumo[] | null>('chat_interno_conversas_resumo')) ?? []
}

export async function getDiretorio(): Promise<ColegaDoDiretorio[]> {
  return (await rpc<ColegaDoDiretorio[] | null>('chat_interno_diretorio')) ?? []
}

export async function getMembros(conversaId: string): Promise<MembroDaConversa[]> {
  return (await rpc<MembroDaConversa[] | null>('chat_interno_membros_da_conversa', { p_conversa: conversaId })) ?? []
}

/**
 * Uma página de mensagens, da MAIS NOVA para a mais antiga (quem chama inverte
 * para exibir). `antesDe` é o `criado_em` da mais antiga já carregada.
 *
 * Nunca embute `profiles` (`autor:profiles(...)`): quem não é admin não lê o
 * perfil dos colegas, e o embed derrubaria a consulta inteira. Os nomes vêm do
 * diretório e dos membros da conversa.
 */
export async function buscarMensagens(conversaId: string, antesDe?: string): Promise<MensagemInterna[]> {
  let consulta = supabase
    .from('chat_interno_mensagens')
    .select('*')
    .eq('conversa_id', conversaId)
    .order('criado_em', { ascending: false })
    .order('id', { ascending: false })
    .limit(TAMANHO_DA_PAGINA)
  if (antesDe) consulta = consulta.lt('criado_em', antesDe)
  const { data, error } = await consulta
  if (error) throw paraErro(error)
  return (data ?? []) as MensagemInterna[]
}

/** Mensagens citadas por resposta que estão fora da página carregada. */
export async function buscarMensagensPorId(ids: string[]): Promise<MensagemInterna[]> {
  if (ids.length === 0) return []
  const { data, error } = await supabase.from('chat_interno_mensagens').select('*').in('id', ids)
  if (error) throw paraErro(error)
  return (data ?? []) as MensagemInterna[]
}

// ─── Conversas e grupos ──────────────────────────────────────────────────────

export function abrirDireta(outro: string): Promise<string> {
  return rpc<string>('chat_interno_abrir_direta', { p_outro: outro })
}

export function criarGrupo(nome: string, membros: string[]): Promise<string> {
  return rpc<string>('chat_interno_criar_grupo', { p_nome: nome, p_membros: membros })
}

export function adicionarMembros(conversaId: string, membros: string[]): Promise<number> {
  return rpc<number>('chat_interno_adicionar_membros', { p_conversa: conversaId, p_membros: membros })
}

/** `userId` = eu → sair do grupo. */
export async function removerMembro(conversaId: string, userId: string): Promise<void> {
  await rpc<void>('chat_interno_remover_membro', { p_conversa: conversaId, p_user: userId })
}

export async function renomearGrupo(conversaId: string, nome: string): Promise<void> {
  await rpc<void>('chat_interno_renomear_grupo', { p_conversa: conversaId, p_nome: nome })
}

export async function definirPapel(conversaId: string, userId: string, papel: PapelNoGrupo): Promise<void> {
  await rpc<void>('chat_interno_definir_papel', { p_conversa: conversaId, p_user: userId, p_papel: papel })
}

export async function silenciar(conversaId: string, silenciada: boolean): Promise<void> {
  await rpc<void>('chat_interno_silenciar', { p_conversa: conversaId, p_silenciada: silenciada })
}

/** `ate`: o `criado_em` da última mensagem que a tela MOSTROU — nunca o relógio do cliente. */
export async function marcarLida(conversaId: string, ate: string): Promise<void> {
  await rpc<void>('chat_interno_marcar_lida', { p_conversa: conversaId, p_ate: ate })
}

// ─── Mensagens ───────────────────────────────────────────────────────────────

export interface ParametrosDeEnvio {
  conversaId: string
  tipo: 'texto' | 'imagem' | 'arquivo' | 'audio'
  conteudo?: string | null
  anexoPath?: string | null
  anexoNome?: string | null
  anexoMime?: string | null
  anexoTamanho?: number | null
  anexoDuracaoSeg?: number | null
  respondeA?: string | null
  clientId: string
}

/** Idempotente no `client_id`: reenviar com o MESMO id devolve a linha que já existe. */
export async function enviarMensagem(p: ParametrosDeEnvio): Promise<MensagemInterna> {
  const dado = await rpc<unknown>('chat_interno_enviar', {
    p_conversa: p.conversaId,
    p_tipo: p.tipo,
    p_conteudo: p.conteudo ?? null,
    p_anexo_path: p.anexoPath ?? null,
    p_anexo_nome: p.anexoNome ?? null,
    p_anexo_mime: p.anexoMime ?? null,
    p_anexo_tamanho: p.anexoTamanho ?? null,
    p_anexo_duracao_seg: p.anexoDuracaoSeg ?? null,
    p_responde_a: p.respondeA ?? null,
    p_client_id: p.clientId,
  })
  return umaLinha<MensagemInterna>(dado)
}

export async function apagarMensagem(mensagemId: string): Promise<MensagemInterna> {
  const dado = await rpc<unknown>('chat_interno_apagar_mensagem', { p_mensagem: mensagemId })
  return umaLinha<MensagemInterna>(dado)
}

// ─── Storage ─────────────────────────────────────────────────────────────────

/** Nome seguro para chave de objeto: sem acento, sem barra, sem caractere que o Storage rejeita. */
export function nomeSeguro(nome: string): string {
  const limpo = nome
    .normalize('NFD')
    // Diacríticos soltos que o NFD separa das letras (U+0300 a U+036F).
    .replace(new RegExp('[\\u0300-\\u036f]', 'g'), '')
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '')
  if (!limpo) return 'arquivo'
  if (limpo.length <= 100) return limpo
  const ponto = limpo.lastIndexOf('.')
  const extensao = ponto > 0 && limpo.length - ponto <= 10 ? limpo.slice(ponto) : ''
  return limpo.slice(0, 100 - extensao.length) + extensao
}

/** `<conversa_id>/<uuid>-<nome>` — a primeira pasta é o que a policy do bucket confere. */
export function montarCaminhoDoAnexo(conversaId: string, nome: string): string {
  return `${conversaId.toLowerCase()}/${crypto.randomUUID()}-${nomeSeguro(nome)}`
}

async function removerArquivos(caminhos: string[]): Promise<void> {
  if (caminhos.length === 0) return
  try {
    await supabase.storage.from(BUCKET_DO_CHAT_INTERNO).remove(caminhos)
  } catch {
    /* Limpeza é no melhor esforço: um arquivo órfão não pode virar erro para quem enviou. */
  }
}

export const removerArquivosDoChat = removerArquivos

export interface DadosDoAnexo {
  arquivo: File | Blob
  nome: string
  mime: string
  tamanho: number
  duracaoSeg?: number | null
}

/**
 * Sobe o arquivo e depois chama `enviar`.
 *
 * Se o `enviar` falhar:
 *  - recusa DEFINITIVA do servidor → o arquivo vai embora (nada o referencia);
 *  - falha AMBÍGUA (rede) → o arquivo FICA. A mensagem pode ter sido criada e só
 *    a resposta se perdeu; apagar agora deixaria um balão apontando para um
 *    arquivo inexistente. O caminho volta no erro (`caminhoJaEnviado`) para o
 *    reenvio reaproveitá-lo em vez de subir de novo.
 */
export async function enviarComAnexo(
  base: Omit<ParametrosDeEnvio, 'anexoPath' | 'anexoNome' | 'anexoMime' | 'anexoTamanho' | 'anexoDuracaoSeg'>,
  anexo: DadosDoAnexo,
  caminhoJaEnviado?: string,
): Promise<MensagemInterna> {
  let caminho = caminhoJaEnviado

  if (!caminho) {
    caminho = montarCaminhoDoAnexo(base.conversaId, anexo.nome)
    const { error } = await supabase.storage
      .from(BUCKET_DO_CHAT_INTERNO)
      .upload(caminho, anexo.arquivo, { contentType: anexo.mime, upsert: false })
    if (error) {
      const msg = (error as { message?: string }).message ?? ''
      throw new ErroDoChatInterno(
        pareceFalhaDeRede(msg) || !msg ? SEM_CONEXAO : 'Não foi possível enviar o arquivo. Tente de novo.',
      )
    }
  }

  let linha: MensagemInterna
  try {
    linha = await enviarMensagem({
      ...base,
      anexoPath: caminho,
      anexoNome: anexo.nome,
      anexoMime: anexo.mime,
      anexoTamanho: anexo.tamanho,
      anexoDuracaoSeg: anexo.duracaoSeg ?? null,
    })
  } catch (erro) {
    const e = erro instanceof ErroDoChatInterno ? erro : paraErro(erro as { message?: string })
    if (e.definitivo) {
      void removerArquivos([caminho])
    } else {
      e.caminhoJaEnviado = caminho
    }
    throw e
  }

  // Reenvio idempotente: o banco devolveu a linha de uma tentativa anterior, que
  // aponta para OUTRO arquivo. O que acabamos de subir ficou sem dono.
  if (linha.anexo_path !== caminho) void removerArquivos([caminho])
  return linha
}

// ─── URLs assinadas ──────────────────────────────────────────────────────────

const VALIDADE_DA_URL_S = 4 * 60 * 60
/** Renova quando faltar menos que isto — antes de a imagem quebrar na tela de quem está lendo. */
export const MARGEM_DE_RENOVACAO_MS = 20 * 60 * 1000

const urlsAssinadas = new Map<string, { url: string; expiraEm: number }>()
const emAssinatura = new Set<string>()

/**
 * Quem quer saber quando o cache de URLs ganhou valor novo. Existe porque o
 * aviso NÃO pode ficar com quem pediu a assinatura: quando a lista de anexos
 * visíveis muda no meio de um pedido, o pedido novo pula o que já está em voo e
 * o antigo foi "aposentado" pelo seu efeito — então ninguém redesenhava e a
 * imagem ficava em branco. Com o aviso por módulo, toda assinatura concluída
 * acorda quem está montado, seja qual for o pedido que a trouxe.
 */
const ouvintesDeUrls = new Set<() => void>()

/** Inscreve `aoMudar`; devolve a função que cancela. */
export function aoMudarUrlsAssinadas(aoMudar: () => void): () => void {
  ouvintesDeUrls.add(aoMudar)
  return () => {
    ouvintesDeUrls.delete(aoMudar)
  }
}

/** Leitura síncrona do cache — pode devolver URL perto de vencer; quem renova é `garantirUrlsAssinadas`. */
export function urlAssinadaEmCache(caminho: string | null | undefined): string | undefined {
  return caminho ? urlsAssinadas.get(caminho)?.url : undefined
}

/**
 * Assina em LOTE o que falta (ou está perto de vencer). Devolve `true` se algum
 * valor do cache mudou; e, nesse caso, avisa os inscritos em
 * `aoMudarUrlsAssinadas` (é por ali que a tela redesenha).
 *
 * Por que cache e lote: URL curta e regerada a cada render já causou tempestade
 * de re-render de avatar neste app. Aqui cada caminho é assinado UMA vez por
 * ~3h40 e o `<img src>` não muda no meio da leitura.
 */
export async function garantirUrlsAssinadas(caminhos: string[], renovar = false): Promise<boolean> {
  const agora = Date.now()
  const faltam = [...new Set(caminhos)].filter((c) => {
    if (!c || emAssinatura.has(c)) return false
    const atual = urlsAssinadas.get(c)
    if (!atual) return true
    return renovar && atual.expiraEm - agora < MARGEM_DE_RENOVACAO_MS
  })
  if (faltam.length === 0) return false

  faltam.forEach((c) => emAssinatura.add(c))
  try {
    const { data, error } = await supabase.storage
      .from(BUCKET_DO_CHAT_INTERNO)
      .createSignedUrls(faltam, VALIDADE_DA_URL_S)
    if (error || !data) return false
    let mudou = false
    const expiraEm = Date.now() + VALIDADE_DA_URL_S * 1000
    for (const item of data) {
      if (item.signedUrl && item.path) {
        urlsAssinadas.set(item.path, { url: item.signedUrl, expiraEm })
        mudou = true
      }
    }
    if (mudou) ouvintesDeUrls.forEach((aoMudar) => aoMudar())
    return mudou
  } catch {
    return false
  } finally {
    faltam.forEach((c) => emAssinatura.delete(c))
  }
}

export function esquecerUrlAssinada(caminho: string | null | undefined) {
  if (caminho) urlsAssinadas.delete(caminho)
}

export function limparUrlsAssinadas() {
  urlsAssinadas.clear()
}

/** Link de uso imediato (60 s) que força o download com o nome original. */
export async function urlParaBaixar(caminho: string, nome: string): Promise<string> {
  const { data, error } = await supabase.storage
    .from(BUCKET_DO_CHAT_INTERNO)
    .createSignedUrl(caminho, 60, { download: nome })
  if (error || !data?.signedUrl) throw new ErroDoChatInterno('Não foi possível baixar o arquivo agora.')
  return data.signedUrl
}
