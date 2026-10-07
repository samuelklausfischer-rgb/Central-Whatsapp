/**
 * Tipos do Chat interno (migration 20261007140000_chat_interno.sql).
 *
 * Escritos à mão, como os demais deste diretório: o cliente do Supabase não
 * recebe o `Database` genérico, então `.rpc()` e `.from()` devolvem `any` e quem
 * dá forma ao dado é o serviço (`services/chat_interno.ts`) — nunca o componente.
 */

export type TipoDeConversaInterna = 'direta' | 'grupo'
export type TipoDeMensagemInterna = 'texto' | 'imagem' | 'arquivo' | 'audio' | 'sistema'
export type PapelNoGrupo = 'admin' | 'membro'

/** Uma linha de `chat_interno_conversas_resumo()` — a lista de conversas inteira numa chamada. */
export interface ConversaResumo {
  id: string
  tipo: TipoDeConversaInterna
  /** Grupo: o nome do grupo. Direta: o nome da OUTRA pessoa (calculado no banco). */
  nome: string
  outro_user_id: string | null
  outro_desativado: boolean | null
  membros_count: number
  meu_papel: PapelNoGrupo
  silenciada: boolean
  criado_em: string
  ultima_mensagem_em: string | null
  ultima_mensagem_preview: string | null
  ultima_mensagem_tipo: TipoDeMensagemInterna | null
  ultima_mensagem_autor_id: string | null
  ultima_mensagem_autor_nome: string | null
  nao_lidas: number
}

/** Uma linha de `chat_interno_mensagens`. */
export interface MensagemInterna {
  id: string
  conversa_id: string
  /** Nulo quando o perfil do autor foi apagado (FK `ON DELETE SET NULL`). */
  autor_id: string | null
  tipo: TipoDeMensagemInterna
  conteudo: string | null
  anexo_path: string | null
  anexo_nome: string | null
  anexo_mime: string | null
  anexo_tamanho: number | null
  anexo_duracao_seg: number | null
  responde_a: string | null
  client_id: string | null
  criado_em: string
  editada_em: string | null
  apagada_em: string | null
}

/** Estado de envio de uma mensagem que ainda não é uma linha do banco. */
export type SituacaoDoEnvio = 'enviando' | 'falhou'

/**
 * Tudo que é preciso para REENVIAR uma mensagem que falhou com o MESMO
 * `client_id`. O arquivo fica na memória (File) até a confirmação.
 */
export interface DadosDoEnvio {
  tipo: Exclude<TipoDeMensagemInterna, 'sistema'>
  conteudo: string | null
  respondeA: string | null
  arquivo?: File | Blob
  nomeDoArquivo?: string
  mime?: string
  tamanho?: number
  duracaoSeg?: number | null
  /**
   * Caminho que já subiu para o Storage. Preenchido quando o upload deu certo e
   * o `enviar` falhou de um jeito AMBÍGUO (rede): a mensagem pode ter nascido no
   * banco, então o arquivo NÃO é apagado e o reenvio o reaproveita.
   */
  caminhoJaEnviado?: string
}

/** Mensagem otimista, ainda sem confirmação do banco. Vive só na memória. */
export interface MensagemPendente extends MensagemInterna {
  situacao: SituacaoDoEnvio
  dados: DadosDoEnvio
  /** URL `blob:` para mostrar a foto/áudio na hora, antes de existir no Storage. */
  previaLocal?: string
  erro?: string
}

export interface ColegaDoDiretorio {
  id: string
  nome: string
  setor: string | null
  avatar_url: string | null
}

export interface MembroDaConversa {
  user_id: string
  nome: string
  setor: string | null
  avatar_url: string | null
  papel: PapelNoGrupo
  entrou_em: string
  ultima_leitura_em: string
  desativado: boolean
}
