import supabase from '@/lib/supabase/client'

/**
 * A TENTATIVA DE ENVIO — para que a falha não suma.
 *
 * Hoje, quando um envio de WhatsApp falha, não sobra nada: a linha em
 * `messages` só nasce DEPOIS que a Evolution confirma (medido: 12.143 envios em
 * 30 dias, zero sem `external_id`). A falha vira um toast que some, e a pessoa
 * fica sem saber se a mensagem chegou na paciente.
 *
 * `public.tentativas_de_envio` é gravada ANTES da chamada e apagada quando o
 * envio confirma. Fica FORA de `messages` de propósito: os gatilhos de lá
 * fechariam a pendência em `conversation_pendencias`, e o Controle de Mensagens
 * passaria a registrar tempo de resposta de mensagem que nunca saiu. A história
 * completa está na migration `20260828130144_tentativas_de_envio.sql`.
 *
 * A linha é visível só para quem tentou (RLS por `sender_id`) — tentativa
 * falhada de uma pessoa não é mensagem da conversa.
 */

export interface TentativaDeEnvio {
  id: string
  device_id: string
  remote_sender: string
  sender_id: string
  conteudo: string
  anexos: { mediaUrl?: string; mediaType?: string; mediaName?: string } | null
  reply_to_id: string | null
  tipo: 'texto' | 'audio' | 'midia' | 'edicao' | 'encaminhada'
  status: 'pendente' | 'falhou' | 'enviada'
  erro: string | null
  tentativas: number
  created_at: string
}

/** O que `registrarTentativa` precisa saber. Espelha o payload de `sendMessage`. */
export interface DadosDaTentativa {
  device_id: string
  remote_sender: string
  sender_id: string
  conteudo: string
  anexos: TentativaDeEnvio['anexos']
  reply_to_id: string | null
  tipo: TentativaDeEnvio['tipo']
}

/**
 * Tentativas em aberto desta conversa, MAIS ANTIGAS PRIMEIRO — a interface as
 * desenha depois das mensagens reais, em ordem cronológica.
 *
 * Devolve `[]` em erro, nunca lança. É o mesmo motivo de `getLabels` em
 * `labels.ts`: quem chama usa isto ao abrir a conversa, junto de outras leituras,
 * e uma exceção aqui derrubaria a tela de conversa inteira — trocar um recurso
 * de confiabilidade por uma tela quebrada seria um péssimo negócio.
 */
export async function listarTentativasAbertas(
  deviceId: string,
  remoteSender: string,
): Promise<TentativaDeEnvio[]> {
  const { data, error } = await supabase
    .from('tentativas_de_envio')
    .select('*')
    .eq('device_id', deviceId)
    .eq('remote_sender', remoteSender)
    .in('status', ['pendente', 'falhou'])
    .order('created_at', { ascending: true })

  if (error) {
    console.warn('[tentativas] não consegui ler as tentativas em aberto:', error.message)
    return []
  }

  return (data as TentativaDeEnvio[]) || []
}

/**
 * Apaga a tentativa. Usado no sucesso do envio e no botão de descartar.
 *
 * Lança quando não apagou nada — mesmo cuidado de `deleteLabel` em `labels.ts`:
 * DELETE barrado pela RLS volta com SUCESSO e zero linhas, e engolir isso faria
 * o balão vermelho sumir da tela e voltar no próximo carregamento.
 */
export async function descartarTentativa(id: string): Promise<void> {
  const { data, error } = await supabase
    .from('tentativas_de_envio')
    .delete()
    .eq('id', id)
    .select('id')

  if (error) throw new Error(error.message)
  if (!data || data.length === 0) {
    throw new Error('Não foi possível descartar a tentativa.')
  }
}

/**
 * Volta a tentativa para `pendente` e soma 1 no contador, ANTES do reenvio.
 *
 * O contador não serve para reenviar sozinho — nada aqui reenvia sozinho, e é
 * decisão explícita: isto é mensagem para paciente, e o repo já registra
 * (`20260731150000_retry_dns_envio.sql`) que só falha de resolução DNS garante
 * que a requisição não saiu. Qualquer outro erro pode ter saído mesmo assim, e
 * reenviar cegamente mandaria a mensagem duas vezes. Serve para diagnóstico:
 * uma tentativa com 4 reenvios é sinal de problema, não de azar.
 */
export async function marcarReenvio(id: string): Promise<void> {
  const { data: atual, error: erroLeitura } = await supabase
    .from('tentativas_de_envio')
    .select('tentativas')
    .eq('id', id)
    .single()

  if (erroLeitura) throw new Error(erroLeitura.message)

  const { error } = await supabase
    .from('tentativas_de_envio')
    .update({ status: 'pendente', erro: null, tentativas: (atual?.tentativas ?? 1) + 1 })
    .eq('id', id)

  if (error) throw new Error(error.message)
}

/* -------------------------------------------------------------------------- */
/* Usadas por `sendMessage`. Ver a regra logo abaixo.                          */
/* -------------------------------------------------------------------------- */

/**
 * ⚠️ REGRA QUE VALE PARA AS DUAS FUNÇÕES ABAIXO: elas NUNCA podem impedir nem
 * atrasar um envio.
 *
 * Se o registro falhar (RLS, rede, banco fora), o envio segue normalmente e a
 * gente perde só o rastro daquela tentativa. Isto é um recurso de
 * confiabilidade; transformá-lo numa nova causa de falha de envio seria pior
 * que o problema que ele resolve. Por isso engolem o erro com `console.warn` em
 * vez de lançar — ao contrário das três exportadas acima, que são chamadas pela
 * interface e devem ser honestas sobre o que deu errado.
 */

/** Grava a tentativa antes da chamada. Devolve o `id`, ou `null` se não deu. */
export async function registrarTentativa(dados: DadosDaTentativa): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from('tentativas_de_envio')
      .insert({ ...dados, status: 'pendente' })
      .select('id')
      .single()

    if (error) {
      console.warn('[tentativas] não registrei a tentativa; o envio segue:', error.message)
      return null
    }
    return (data as { id: string }).id
  } catch (e) {
    console.warn('[tentativas] não registrei a tentativa; o envio segue:', e)
    return null
  }
}

/** Marca a tentativa como falhada, com o erro cru para diagnóstico. */
export async function marcarTentativaFalhou(id: string, erro: string): Promise<void> {
  try {
    const { error } = await supabase
      .from('tentativas_de_envio')
      // 500 caracteres porque a resposta crua da Evolution às vezes traz um
      // stack inteiro, e o que interessa está sempre no começo.
      .update({ status: 'falhou', erro: erro.slice(0, 500) })
      .eq('id', id)

    if (error) console.warn('[tentativas] não marquei a falha:', error.message)
  } catch (e) {
    console.warn('[tentativas] não marquei a falha:', e)
  }
}

/** Apaga a tentativa no sucesso. Silenciosa: a mensagem real já existe. */
export async function descartarTentativaSilenciosa(id: string): Promise<void> {
  try {
    const { error } = await supabase.from('tentativas_de_envio').delete().eq('id', id)
    if (error) console.warn('[tentativas] a mensagem saiu, mas a tentativa ficou:', error.message)
  } catch (e) {
    console.warn('[tentativas] a mensagem saiu, mas a tentativa ficou:', e)
  }
}
