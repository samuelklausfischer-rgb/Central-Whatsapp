import supabase from '@/lib/supabase/client'

/**
 * Disparador em massa: listas de transmissão e campanhas.
 *
 * ── AS TABELAS SE CHAMAM `disparo_*`, NÃO `broadcast_*` ──────────────────────
 * `broadcast` já significa outra coisa neste banco: `app_broadcasts` e
 * `broadcast_reads` são os avisos internos que aparecem para a equipe ao abrir o
 * app (ver `services/broadcasts.ts`). Ter as duas coisas com o mesmo prefixo é
 * pedir para alguém ler a tabela errada num incidente.
 *
 * ── ONDE MORA CADA REGRA ─────────────────────────────────────────────────────
 * Escrita de lista é REST direto, porque é CRUD simples e a RLS já protege.
 * Criar disparo, consumir a fila e mudar status são RPC, porque envolvem mais de
 * uma tabela e precisam ser atômicos — campanha sem alvo ficaria "agendada" para
 * sempre.
 *
 * ── O QUE ESTE ARQUIVO NÃO FAZ ───────────────────────────────────────────────
 * Não envia nada. Quem envia é o worker (`worker/`), e ele envia pela
 * `send_whatsapp_message` — a mesma RPC do chat, que grava em `messages`. É isso
 * que faz a mensagem do disparo aparecer na conversa; um cliente Evolution
 * separado mandaria mensagem que o atendente não conseguiria ler.
 */

// ── Tipos ───────────────────────────────────────────────────────────────────

export interface ListaDeTransmissao {
  id: string
  nome: string
  descricao: string | null
  created_by: string | null
  created_at: string
  updated_at: string
  /** Preenchido por `listarListas`, não é coluna. */
  total_membros?: number
}

export type OrigemDoMembro = 'contato' | 'colado' | 'etiqueta'

export interface MembroDaLista {
  id: string
  list_id: string
  remote_sender: string
  nome_exibicao: string | null
  origem: OrigemDoMembro
  created_at: string
  /** `null` = nunca verificado. Nunca verificado ENTRA no disparo. */
  tem_whatsapp: boolean | null
  verificado_em: string | null
}

export type StatusDaCampanha =
  | 'rascunho' | 'agendado' | 'enviando' | 'pausado' | 'concluido' | 'cancelado'

/** O ritmo anti-ban. Padrões vindos do `prn-vigilante`, já validados em produção. */
export interface RitmoDoDisparo {
  delay_min_ms: number
  delay_max_ms: number
  jitter_pct: number
  pausa_a_cada: number
  pausa_longa_ms: number
  respeitar_horario: boolean
  hora_inicio: number
  hora_fim: number
}

export const RITMO_SEGURO: RitmoDoDisparo = {
  delay_min_ms: 180_000,
  delay_max_ms: 780_000,
  jitter_pct: 0.15,
  pausa_a_cada: 5,
  pausa_longa_ms: 60_000,
  respeitar_horario: false,
  hora_inicio: 8,
  hora_fim: 20,
}

/**
 * Perfis prontos, construídos EM CIMA do seguro.
 *
 * O seguro é o padrão e o ponto de partida; os outros só encurtam a janela de
 * espera. O banco ainda impõe um piso de 5 s (`disparo_campanhas_delay_coerente`
 * e o check de `delay_min_ms`), porque a tela não é o único caminho até a tabela.
 */
export const PERFIS_DE_RITMO = {
  seguro: { rotulo: 'Seguro', ...RITMO_SEGURO },
  moderado: { rotulo: 'Moderado', ...RITMO_SEGURO, delay_min_ms: 45_000, delay_max_ms: 120_000 },
  rapido: { rotulo: 'Rápido', ...RITMO_SEGURO, delay_min_ms: 15_000, delay_max_ms: 40_000, pausa_a_cada: 20 },
} as const

export type NomeDoPerfil = keyof typeof PERFIS_DE_RITMO

export interface Campanha extends RitmoDoDisparo {
  id: string
  nome: string
  /** Campanha de ensaio: percorre a fila sem chamar a Evolution. */
  ensaio: boolean
  /** De qual campanha esta foi duplicada, se foi. */
  origem_id: string | null
  device_id: string
  list_id: string | null
  mensagem: string
  anexos: unknown[] | null
  iniciar_em: string
  status: StatusDaCampanha
  created_by: string | null
  iniciado_em: string | null
  concluido_em: string | null
  created_at: string
  updated_at: string
}

export interface ProgressoDaCampanha {
  total: number
  pendentes: number
  enviados: number
  falhas: number
  pulados: number
}

export interface AlvoDoDisparo {
  id: string
  campaign_id: string
  remote_sender: string
  nome_exibicao: string | null
  avulso: boolean
  status: 'pendente' | 'enviando' | 'enviado' | 'falhou' | 'pulado' | 'simulado'
  tentativas: number
  enviado_em: string | null
  erro: string | null
  /**
   * Quando o worker planeja enviar este alvo.
   *
   * Gravado por ELE, logo após travar o alvo e antes de dormir — é o mesmo número
   * que ele vai esperar. A tela conta regressivamente a partir daqui em vez de
   * estimar por conta própria, o que erraria a cada jitter.
   */
  previsto_para: string | null
}

export interface ModeloDeMensagem {
  id: string
  nome: string
  texto: string
  created_by: string | null
  created_at: string
}

/**
 * Acima disto o banco RECUSA a criação sem `confirmado`.
 *
 * A tela usa o mesmo número para saber quando mostrar o diálogo de confirmação. O
 * valor de verdade mora em `disparo_criar` — aqui é só o espelho, porque a tela
 * não é o único caminho até a tabela.
 */
export const TETO_CONFIRMACAO = 300

// ── Listas ──────────────────────────────────────────────────────────────────

export async function listarListas(): Promise<ListaDeTransmissao[]> {
  const { data, error } = await supabase
    .from('disparo_listas')
    .select('*, disparo_lista_membros(count)')
    .order('nome', { ascending: true })
  if (error) throw new Error(error.message)

  return ((data ?? []) as any[]).map((l) => ({
    ...l,
    // O embed de contagem do PostgREST chega como `[{ count: n }]`.
    total_membros: l.disparo_lista_membros?.[0]?.count ?? 0,
  })) as ListaDeTransmissao[]
}

export async function criarLista(nome: string, descricao?: string): Promise<ListaDeTransmissao> {
  const userId = (await supabase.auth.getSession()).data.session?.user?.id
  const { data, error } = await supabase
    .from('disparo_listas')
    .insert({ nome, descricao: descricao || null, created_by: userId } as any)
    .select()
    .single()
  if (error) throw new Error(error.message)
  return data as ListaDeTransmissao
}

export async function renomearLista(id: string, nome: string, descricao?: string): Promise<void> {
  const { error } = await supabase
    .from('disparo_listas')
    .update({ nome, descricao: descricao || null, updated_at: new Date().toISOString() } as any)
    .eq('id', id)
  if (error) throw new Error(error.message)
}

/**
 * Apagar não confere linhas afetadas de propósito? Confere, sim.
 *
 * A RLS deixa apagar só a própria lista (ou admin), e DELETE barrado por RLS
 * devolve SUCESSO com zero linhas no Postgres. Sem o `count`, apagar a lista de
 * outra pessoa diria "Lista removida" com a lista ainda lá — foi exatamente o
 * defeito corrigido em `labels.ts`.
 */
export async function apagarLista(id: string): Promise<void> {
  const { error, count } = await supabase
    .from('disparo_listas')
    .delete({ count: 'exact' })
    .eq('id', id)
  if (error) throw new Error(error.message)
  if (!count) throw new Error('Esta lista é de outra pessoa: só quem criou (ou um admin) pode apagar.')
}

export async function listarMembros(listId: string): Promise<MembroDaLista[]> {
  const { data, error } = await supabase
    .from('disparo_lista_membros')
    .select('*')
    .eq('list_id', listId)
    .order('nome_exibicao', { ascending: true })
  if (error) throw new Error(error.message)
  return (data ?? []) as MembroDaLista[]
}

/**
 * Acrescenta membros, ignorando quem já está.
 *
 * `upsert` com `ignoreDuplicates` em vez de conferir antes: acrescentar 300
 * contatos de uma etiqueta faria 300 consultas de checagem, e a corrida entre
 * duas pessoas editando a mesma lista continuaria existindo. A restrição
 * `unique (list_id, remote_sender)` é quem garante.
 */
export async function acrescentarMembros(
  listId: string,
  membros: { remote_sender: string; nome_exibicao?: string | null }[],
  origem: OrigemDoMembro,
): Promise<number> {
  if (membros.length === 0) return 0
  const linhas = membros.map((m) => ({
    list_id: listId,
    remote_sender: m.remote_sender,
    nome_exibicao: m.nome_exibicao ?? null,
    origem,
  }))
  const { error, count } = await supabase
    .from('disparo_lista_membros')
    .upsert(linhas as any, { onConflict: 'list_id,remote_sender', ignoreDuplicates: true, count: 'exact' })
  if (error) throw new Error(error.message)
  return count ?? 0
}

export async function removerMembro(id: string): Promise<void> {
  const { error } = await supabase.from('disparo_lista_membros').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

// ── Origens de contato ──────────────────────────────────────────────────────

/**
 * Normaliza uma cola de números pela MESMA função que o banco usa
 * (`disparo_normalizar_numero`), em vez de reimplementar a regra no cliente.
 *
 * Duas cópias da regra é como um número entra na lista pela tela e é recusado no
 * disparo — e ninguém entende por quê. Devolve o que entrou e o que foi recusado,
 * para a tela poder mostrar as linhas ruins em vez de engolir em silêncio.
 */
export async function normalizarColagem(
  texto: string,
): Promise<{ validos: string[]; invalidos: string[] }> {
  const brutos = texto
    .split(/[\n,;]+/)
    .map((s) => s.trim())
    .filter(Boolean)
  if (brutos.length === 0) return { validos: [], invalidos: [] }

  const { data, error } = await supabase.rpc('disparo_normalizar_lote', { p_brutos: brutos })
  if (error) throw new Error(error.message)

  const validos: string[] = []
  const invalidos: string[] = []
  for (const linha of (data ?? []) as { bruto: string; numero: string | null }[]) {
    if (linha.numero) validos.push(linha.numero)
    else invalidos.push(linha.bruto)
  }
  return { validos: [...new Set(validos)], invalidos }
}

/**
 * As etiquetas disponíveis, para o seletor.
 *
 * Consulta direta em vez de importar `services/labels.ts`: aquele arquivo é da
 * área de Etiquetas e a única coisa que preciso daqui é `id` e `nome`. Puxar o
 * serviço inteiro traria as quatro funções de escrita junto, sem necessidade.
 */
export async function listarEtiquetas(): Promise<{ id: string; name: string }[]> {
  const { data, error } = await supabase
    .from('labels')
    .select('id, name')
    .order('name', { ascending: true })
  if (error) throw new Error(error.message)
  return (data ?? []) as { id: string; name: string }[]
}

/** Contatos de uma etiqueta, para montar lista a partir do que já é usado no chat. */
export async function contatosDaEtiqueta(
  labelId: string,
): Promise<{ remote_sender: string; nome_exibicao: string | null }[]> {
  const { data, error } = await supabase
    .from('contact_tags')
    .select('remote_sender')
    .eq('label_id', labelId)
  if (error) throw new Error(error.message)

  const numeros = [...new Set(((data ?? []) as { remote_sender: string }[]).map((l) => l.remote_sender))]
    // Grupo não recebe disparo: a mensagem cairia para todo mundo de uma vez, o
    // oposto de um envio individualizado.
    .filter((n) => !n.endsWith('@g.us'))
  if (numeros.length === 0) return []

  const { data: contatos } = await supabase
    .from('contacts')
    .select('remote_jid, name, nickname')
    .in('remote_jid', numeros)

  const nomePor = new Map(
    ((contatos ?? []) as any[]).map((c) => [c.remote_jid as string, (c.nickname || c.name) as string | null]),
  )
  return numeros.map((n) => ({ remote_sender: n, nome_exibicao: nomePor.get(n) ?? null }))
}

/**
 * Verifica em lote se os números da lista existem no WhatsApp.
 *
 * Chama a RPC em laço porque ela processa um lote pequeno por vez — o
 * `statement_timeout` deste banco é de 8 s, e uma lista de 500 números numa
 * chamada HTTP só estouraria. Ver o comentário de `disparo_verificar_whatsapp`.
 *
 * `onProgresso` existe para a tela não ficar muda durante uma lista grande.
 */
export async function verificarWhatsApp(
  listId: string,
  deviceId: string,
  onProgresso?: (verificados: number, restantes: number) => void,
): Promise<{ verificados: number; comWhatsApp: number }> {
  let verificados = 0
  let comWhatsApp = 0

  // Teto de segurança: 200 rodadas de 50 cobrem 10.000 contatos. Sem ele, uma RPC
  // que devolvesse `restantes` sem nunca zerar viraria laço infinito no navegador.
  for (let rodada = 0; rodada < 200; rodada++) {
    const { data, error } = await supabase.rpc('disparo_verificar_whatsapp', {
      p_device_id: deviceId,
      p_list_id: listId,
      p_limite: 50,
    })
    if (error) throw new Error(error.message)

    const linha = ((data as { verificados: number; com_whatsapp: number; restantes: number }[]) ?? [])[0]
    if (!linha || linha.verificados === 0) break

    verificados += linha.verificados
    comWhatsApp += linha.com_whatsapp
    onProgresso?.(verificados, linha.restantes)
    if (linha.restantes === 0) break
  }

  return { verificados, comWhatsApp }
}

// ── Campanhas ───────────────────────────────────────────────────────────────

export async function criarDisparo(entrada: {
  nome: string
  deviceId: string
  mensagem: string
  iniciarEm: string
  listId?: string | null
  avulsos?: string[]
  anexos?: unknown[] | null
  ritmo?: RitmoDoDisparo
  /** Nasce como rascunho: salvo, mas o worker não pega. */
  rascunho?: boolean
  /** Ensaio: percorre a fila sem enviar, e dá para converter em real depois. */
  ensaio?: boolean
  /** Obrigatório acima de `TETO_CONFIRMACAO`; sem ele o banco recusa. */
  confirmado?: boolean
}): Promise<string> {
  const { data, error } = await supabase.rpc('disparo_criar', {
    p_nome: entrada.nome,
    p_device_id: entrada.deviceId,
    p_mensagem: entrada.mensagem,
    p_iniciar_em: entrada.iniciarEm,
    p_list_id: entrada.listId ?? null,
    p_avulsos: entrada.avulsos ?? null,
    p_anexos: entrada.anexos ?? null,
    p_ritmo: entrada.ritmo ?? null,
    p_rascunho: entrada.rascunho ?? false,
    p_ensaio: entrada.ensaio ?? false,
    p_confirmado: entrada.confirmado ?? false,
  })
  if (error) throw new Error(error.message)
  return data as string
}

/** Copia um disparo. `apenasFalhas` faz o reenvio de quem não recebeu. */
export async function duplicarDisparo(
  campaignId: string,
  apenasFalhas = false,
  nome?: string,
): Promise<string> {
  const { data, error } = await supabase.rpc('disparo_duplicar', {
    p_campaign_id: campaignId,
    p_apenas_falhas: apenasFalhas,
    p_nome: nome ?? null,
  })
  if (error) throw new Error(error.message)
  return data as string
}

/** Só aceita `rascunho` e `agendado` — depois do primeiro envio o banco recusa. */
export async function editarDisparo(entrada: {
  id: string
  nome: string
  mensagem: string
  iniciarEm: string
  listId?: string | null
  ritmo?: RitmoDoDisparo
  trocarLista?: boolean
}): Promise<void> {
  const { error } = await supabase.rpc('disparo_editar', {
    p_campaign_id: entrada.id,
    p_nome: entrada.nome,
    p_mensagem: entrada.mensagem,
    p_iniciar_em: entrada.iniciarEm,
    p_list_id: entrada.listId ?? null,
    p_ritmo: entrada.ritmo ?? null,
    p_trocar_lista: entrada.trocarLista ?? false,
  })
  if (error) throw new Error(error.message)
}

/** Devolve os `simulado` para a fila e tira o ensaio: a MESMA campanha vai valer. */
export async function prepararParaReal(campaignId: string): Promise<number> {
  const { data, error } = await supabase.rpc('disparo_preparar_para_real', {
    p_campaign_id: campaignId,
  })
  if (error) throw new Error(error.message)
  return (data as number) ?? 0
}

// ── Modelos de mensagem ─────────────────────────────────────────────────────

export async function listarModelos(): Promise<ModeloDeMensagem[]> {
  const { data, error } = await supabase
    .from('disparo_modelos')
    .select('*')
    .order('nome', { ascending: true })
  if (error) throw new Error(error.message)
  return (data ?? []) as ModeloDeMensagem[]
}

export async function salvarModelo(nome: string, texto: string): Promise<void> {
  const userId = (await supabase.auth.getSession()).data.session?.user?.id
  const { error } = await supabase
    .from('disparo_modelos')
    .insert({ nome, texto, created_by: userId } as any)
  if (error) throw new Error(error.message)
}

/** Mesma checagem de linhas afetadas de `apagarLista` — DELETE barrado por RLS
 *  devolve sucesso com zero linhas, e diria "removido" com o modelo ainda lá. */
export async function apagarModelo(id: string): Promise<void> {
  const { error, count } = await supabase
    .from('disparo_modelos')
    .delete({ count: 'exact' })
    .eq('id', id)
  if (error) throw new Error(error.message)
  if (!count) throw new Error('Este modelo é de outra pessoa: só quem criou (ou um admin) pode apagar.')
}

export async function listarDisparos(): Promise<(Campanha & { progresso: ProgressoDaCampanha })[]> {
  const { data, error } = await supabase
    .from('disparo_campanhas')
    .select('*, disparo_alvos(status)')
    .order('created_at', { ascending: false })
    .limit(100)
  if (error) throw new Error(error.message)

  return ((data ?? []) as any[]).map((c) => {
    const alvos = (c.disparo_alvos ?? []) as { status: string }[]
    const conta = (s: string) => alvos.filter((a) => a.status === s).length
    return {
      ...c,
      progresso: {
        total: alvos.length,
        pendentes: conta('pendente') + conta('enviando'),
        enviados: conta('enviado'),
        falhas: conta('falhou'),
        pulados: conta('pulado'),
      },
    }
  })
}

export async function listarAlvos(campaignId: string): Promise<AlvoDoDisparo[]> {
  const { data, error } = await supabase
    .from('disparo_alvos')
    .select('*')
    .eq('campaign_id', campaignId)
    .order('created_at', { ascending: true })
    .limit(1000)
  if (error) throw new Error(error.message)
  return (data ?? []) as AlvoDoDisparo[]
}

export async function mudarStatusDoDisparo(
  campaignId: string,
  acao: 'pausar' | 'retomar' | 'cancelar',
): Promise<void> {
  const { error } = await supabase.rpc('disparo_mudar_status', {
    p_campaign_id: campaignId,
    p_acao: acao,
  })
  if (error) throw new Error(error.message)
}

/**
 * O worker está vivo?
 *
 * Sem isto, worker caído = campanha agendada que simplesmente não sai, e ninguém
 * descobre até alguém perguntar por que o cliente não recebeu. A tela mostra o
 * aviso; 3 minutos sem sinal já é anormal para um heartbeat de 30 s.
 */
export async function workerEstaVivo(): Promise<{ vivo: boolean; visto_em: string | null }> {
  const { data, error } = await supabase
    .from('disparo_worker_heartbeat')
    .select('visto_em')
    .order('visto_em', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(error.message)

  const visto = (data as { visto_em: string } | null)?.visto_em ?? null
  const vivo = visto != null && Date.now() - new Date(visto).getTime() < 3 * 60_000
  return { vivo, visto_em: visto }
}

// ── Previsão ────────────────────────────────────────────────────────────────

/**
 * Quanto tempo o disparo vai levar, em segundos.
 *
 * Existe porque no ritmo seguro 100 contatos levam ~13 h e 500 levam ~67 h —
 * quase três dias. Ninguém deve descobrir isso DEPOIS de apertar o botão, então a
 * tela mostra a previsão de término antes de confirmar.
 *
 * Espelha o `humanizer.ts` do worker: média do intervalo, mais a pausa longa a
 * cada N. O jitter é simétrico e não desloca a média, por isso não entra na conta.
 */
export function preverDuracaoSegundos(quantidade: number, ritmo: RitmoDoDisparo): number {
  if (quantidade <= 0) return 0
  const mediaMs = (ritmo.delay_min_ms + ritmo.delay_max_ms) / 2
  const pausas = ritmo.pausa_a_cada > 0 ? Math.floor(quantidade / ritmo.pausa_a_cada) : 0
  // `quantidade - 1`: não há espera antes da primeira mensagem.
  return Math.round(((quantidade - 1) * mediaMs + pausas * ritmo.pausa_longa_ms) / 1000)
}
