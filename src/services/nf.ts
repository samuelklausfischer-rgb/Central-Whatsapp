import { supabase } from '@/lib/supabase/client'
import { sendEmail, type AnexoParaEnviar } from '@/services/emails'

/**
 * Envio mensal de nota fiscal — Item 4 da fila de 25/09/2026.
 *
 * O PROBLEMA QUE ORIGINOU ISTO: "foi enviado a nota fiscal para email errado,
 * acabou sendo confundido o email". As tabelas (`nf_destinatarios`,
 * `nf_config`, `nf_lotes`, `nf_envios`) já existem em produção — ver
 * `supabase/migrations/20260925141833_nf_automacao.sql`. Este serviço só fala
 * com elas; nenhuma migration nova sai daqui.
 *
 * ⚠️ POR QUE O PAREAMENTO ARQUIVO↔DESTINATÁRIO NUNCA É AUTOMÁTICO: é
 * exatamente essa adivinhação (alguém assumindo que o arquivo X é da pessoa Y)
 * que causou o erro. `sugerirDestinatario` abaixo só aponta um candidato — a
 * tela nunca pré-seleciona a resposta no seletor sozinha; quem usa tem que
 * escolher ou clicar explicitamente em "usar esta sugestão". Sugestão errada
 * não aceita é inofensiva; pareamento automático errado é o defeito de novo.
 *
 * ⚠️ POR QUE `para_email`/`para_nome` SÃO CÓPIA, E NÃO SÓ LEITURA DO CADASTRO:
 * se o cadastro do cliente for corrigido em novembro, o registro de setembro
 * precisa continuar dizendo para ONDE A NOTA FOI DE VERDADE naquele dia — essa
 * era exatamente a pergunta que ninguém sabia responder quando o e-mail errado
 * aconteceu. Por isso `criarEnvios` sempre grava o e-mail/nome atuais do
 * destinatário no momento do disparo, e não uma referência que mudaria depois.
 */

export interface NfDestinatario {
  id: string
  account_id: string
  nome: string
  email: string
  documento: string | null
  observacao: string | null
  ativo: boolean
  criado_em: string
  criado_por: string | null
}

export interface NfConfig {
  account_id: string
  assunto: string
  corpo_html: string
  atualizado_em: string
  atualizado_por: string | null
}

/** Espelha o `default` da coluna no banco, para a tela ter o que mostrar antes do primeiro salvamento. */
export const CONFIG_PADRAO = {
  assunto: 'Nota fiscal',
  corpo_html: '<p>Olá, {{nome}}.</p><p>Segue em anexo a nota fiscal.</p>',
}

export type StatusDoLote = 'rascunho' | 'enviando' | 'enviado' | 'parcial' | 'cancelado'

export interface NfLote {
  id: string
  account_id: string
  referencia: string | null
  assunto: string
  corpo_html: string
  status: StatusDoLote
  criado_por: string | null
  criado_em: string
  enviado_em: string | null
}

export type StatusDoEnvio = 'pendente' | 'enviado' | 'falhou'

export interface NfEnvio {
  id: string
  lote_id: string
  account_id: string
  destinatario_id: string | null
  para_email: string
  para_nome: string | null
  arquivo_nome: string
  arquivo_tamanho: number | null
  arquivo_sha256: string | null
  status: StatusDoEnvio
  erro: string | null
  enviado_em: string | null
  criado_em: string
}

// ---------------------------------------------------------------------------
// Destinatários
// ---------------------------------------------------------------------------

/** Todos, ativos e inativos — a tela decide como mostrar cada um. */
export async function getDestinatarios(accountId: string): Promise<NfDestinatario[]> {
  const { data, error } = await supabase
    .from('nf_destinatarios')
    .select('*')
    .eq('account_id', accountId)
    .order('nome', { ascending: true })
  if (error) throw error
  return (data ?? []) as NfDestinatario[]
}

export async function criarDestinatario(input: {
  account_id: string
  nome: string
  email: string
  documento?: string | null
  observacao?: string | null
}): Promise<NfDestinatario> {
  const { data: { user } } = await supabase.auth.getUser()
  const { data, error } = await supabase
    .from('nf_destinatarios')
    .insert({ ...input, criado_por: user?.id })
    .select()
    .single()
  if (error) throw error
  return data as NfDestinatario
}

export async function atualizarDestinatario(
  id: string,
  patch: Partial<Pick<NfDestinatario, 'nome' | 'email' | 'documento' | 'observacao' | 'ativo'>>,
): Promise<NfDestinatario> {
  const { data, error } = await supabase
    .from('nf_destinatarios')
    .update(patch)
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data as NfDestinatario
}

// ---------------------------------------------------------------------------
// Mensagem padrão
// ---------------------------------------------------------------------------

export async function getConfig(accountId: string): Promise<NfConfig | null> {
  const { data, error } = await supabase
    .from('nf_config')
    .select('*')
    .eq('account_id', accountId)
    .maybeSingle()
  if (error) throw error
  return data as NfConfig | null
}

export async function salvarConfig(
  accountId: string,
  valores: { assunto: string; corpo_html: string },
): Promise<NfConfig> {
  const { data: { user } } = await supabase.auth.getUser()
  const { data, error } = await supabase
    .from('nf_config')
    .upsert({
      account_id: accountId,
      ...valores,
      atualizado_por: user?.id,
      atualizado_em: new Date().toISOString(),
    })
    .select()
    .single()
  if (error) throw error
  return data as NfConfig
}

/** Troca `{{nome}}` e `{{documento}}` pelos dados reais. Documento vazio vira string vazia, não "undefined". */
export function substituirMarcadores(
  template: string,
  dados: { nome: string; documento?: string | null },
): string {
  return template
    .replace(/\{\{\s*nome\s*\}\}/gi, dados.nome)
    .replace(/\{\{\s*documento\s*\}\}/gi, dados.documento || '')
}

// ---------------------------------------------------------------------------
// Lotes (o disparo do mês) e envios (o registro do que saiu)
// ---------------------------------------------------------------------------

export async function criarLote(
  accountId: string,
  valores: { referencia: string | null; assunto: string; corpo_html: string },
): Promise<NfLote> {
  const { data: { user } } = await supabase.auth.getUser()
  const { data, error } = await supabase
    .from('nf_lotes')
    .insert({ account_id: accountId, ...valores, criado_por: user?.id })
    .select()
    .single()
  if (error) throw error
  return data as NfLote
}

export async function atualizarStatusLote(
  loteId: string,
  status: StatusDoLote,
  enviadoEm?: string | null,
): Promise<void> {
  const patch: Record<string, unknown> = { status }
  if (enviadoEm !== undefined) patch.enviado_em = enviadoEm
  const { error } = await supabase.from('nf_lotes').update(patch).eq('id', loteId)
  if (error) throw error
}

export async function getLotes(accountId: string): Promise<NfLote[]> {
  const { data, error } = await supabase
    .from('nf_lotes')
    .select('*')
    .eq('account_id', accountId)
    .order('criado_em', { ascending: false })
  if (error) throw error
  return (data ?? []) as NfLote[]
}

/** O que a tela sabe de cada arquivo antes de gravar a linha de envio. */
export interface NovoEnvio {
  destinatario_id: string | null
  para_email: string
  para_nome: string | null
  arquivo_nome: string
  arquivo_tamanho: number
  arquivo_sha256: string
}

/**
 * Grava uma linha `pendente` por arquivo, ANTES de disparar.
 *
 * Gravar antes (e não só no fim) é o que garante que um fechamento de aba no
 * meio do disparo deixe rastro — "pendente" já diz que aquele arquivo estava
 * na fila, mesmo que `dispararLote` nunca tenha chegado a processá-lo.
 */
export async function criarEnvios(
  loteId: string,
  accountId: string,
  itens: NovoEnvio[],
): Promise<NfEnvio[]> {
  if (itens.length === 0) return []
  const { data, error } = await supabase
    .from('nf_envios')
    .insert(itens.map((it) => ({ lote_id: loteId, account_id: accountId, ...it, status: 'pendente' })))
    .select()
  if (error) throw error
  return (data ?? []) as NfEnvio[]
}

async function marcarEnvio(
  id: string,
  resultado: { status: 'enviado' } | { status: 'falhou'; erro: string },
): Promise<void> {
  const patch: Record<string, unknown> = { status: resultado.status }
  if (resultado.status === 'enviado') patch.enviado_em = new Date().toISOString()
  else patch.erro = resultado.erro
  const { error } = await supabase.from('nf_envios').update(patch).eq('id', id)
  if (error) throw error
}

export async function getEnviosDoLote(loteId: string): Promise<NfEnvio[]> {
  const { data, error } = await supabase
    .from('nf_envios')
    .select('*')
    .eq('lote_id', loteId)
    .order('para_nome', { ascending: true })
  if (error) throw error
  return (data ?? []) as NfEnvio[]
}

/** Uma linha já pronta para sair: destinatário resolvido e anexo lido em base64. */
export interface ItemParaDisparar {
  envioId: string
  destinatario: { nome: string; email: string; documento: string | null }
  anexo: AnexoParaEnviar
}

export interface ResultadoDoDisparo {
  ok: number
  falhas: { envioId: string; motivo: string }[]
}

/** Nota fiscal para cliente: devagar e com registro vale mais que rápido. */
const CONCORRENCIA_MAXIMA_NF = 3

/**
 * Dispara o lote inteiro, um a um, com no máximo `CONCORRENCIA_MAXIMA_NF` em
 * voo ao mesmo tempo. Cada item vira a SUA PRÓPRIA chamada a `sendEmail` (a
 * mensagem e o assunto são a mesma base, mas com `{{nome}}`/`{{documento}}`
 * trocados pelo destinatário DAQUELE item) e o resultado — sucesso ou motivo
 * da falha — é gravado em `nf_envios` imediatamente, item a item.
 *
 * Nunca lança na primeira falha: se lançasse, uma nota que falhou no meio da
 * fila esconderia o resultado de todas as outras que já tinham saído. Quem
 * chama decide como avisar, inclusive avisar "18 de 23" — nunca "pronto"
 * quando sobrou gente de fora.
 */
export async function dispararLote(
  accountId: string,
  mensagem: { assunto: string; corpo_html: string },
  itens: ItemParaDisparar[],
  aoProgredir?: (feitos: number, total: number) => void,
): Promise<ResultadoDoDisparo> {
  const falhas: ResultadoDoDisparo['falhas'] = []
  let ok = 0
  let feitos = 0
  let proximoIndice = 0

  async function processarFila(): Promise<void> {
    while (proximoIndice < itens.length) {
      const item = itens[proximoIndice++]
      try {
        await sendEmail({
          account_id: accountId,
          to: [item.destinatario.email],
          subject: substituirMarcadores(mensagem.assunto, item.destinatario),
          body_html: substituirMarcadores(mensagem.corpo_html, item.destinatario),
          anexos: [item.anexo],
        })
        await marcarEnvio(item.envioId, { status: 'enviado' })
        ok++
      } catch (err) {
        const motivo = err instanceof Error ? err.message : 'Falha desconhecida'
        await marcarEnvio(item.envioId, { status: 'falhou', erro: motivo })
        falhas.push({ envioId: item.envioId, motivo })
      } finally {
        feitos++
        aoProgredir?.(feitos, itens.length)
      }
    }
  }

  const trabalhadores = Array.from(
    { length: Math.min(CONCORRENCIA_MAXIMA_NF, itens.length) },
    () => processarFila(),
  )
  await Promise.all(trabalhadores)

  return { ok, falhas }
}

// ---------------------------------------------------------------------------
// Arquivo: hash e limite
// ---------------------------------------------------------------------------

/** A edge function de envio recusa anexo acima disto — avisar antes é melhor que descobrir no meio do disparo. */
export const LIMITE_ANEXO_BYTES = 3.5 * 1024 * 1024

export function formatarBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** SHA-256 pela própria API do navegador — sem biblioteca nova no projeto. */
export async function calcularSha256(arquivo: File): Promise<string> {
  const buffer = await arquivo.arrayBuffer()
  const hash = await crypto.subtle.digest('SHA-256', buffer)
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/** Lê o arquivo e devolve só o base64, sem o prefixo `data:...;base64,` — mesma técnica do `EmailComposer`. */
export function lerComoBase64(arquivo: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const leitor = new FileReader()
    leitor.onerror = () => reject(new Error(`Não consegui ler ${arquivo.name}.`))
    leitor.onload = () => {
      const r = String(leitor.result ?? '')
      const virgula = r.indexOf(',')
      resolve(virgula >= 0 ? r.slice(virgula + 1) : r)
    }
    leitor.readAsDataURL(arquivo)
  })
}

// ---------------------------------------------------------------------------
// Sugestão de pareamento — NUNCA decide sozinha, só aponta um candidato
// ---------------------------------------------------------------------------

function normalizarTexto(s: string): string {
  return s
    .normalize('NFD')
    // Faixa unicode dos acentos combinantes (pós-NFD): tira o acento de "José" para bater com "jose".
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function apenasDigitos(s: string): string {
  return s.replace(/\D+/g, '')
}

/**
 * Aponta um destinatário provável a partir do NOME DO ARQUIVO — nunca do
 * conteúdo do PDF, que o sistema não lê. É só uma dica visual na tela: quem
 * usa ainda precisa clicar para aceitar. Ver o comentário no topo do arquivo
 * sobre por que o pareamento automático é exatamente o que não pode acontecer.
 *
 * Ordem de prioridade:
 *  1. Documento (CNPJ/CPF): números longos batendo por coincidência são
 *     raríssimos, então é o sinal mais forte quando presente.
 *  2. Uma palavra de 4+ letras do nome cadastrado aparecendo no nome do
 *     arquivo — mais fraco, por isso só quando não há documento cadastrado
 *     ou ele não bateu.
 */
export function sugerirDestinatario(
  nomeArquivo: string,
  destinatarios: NfDestinatario[],
): NfDestinatario | null {
  const digitosArquivo = apenasDigitos(nomeArquivo)
  if (digitosArquivo.length >= 8) {
    const porDocumento = destinatarios.find((d) => {
      const doc = apenasDigitos(d.documento ?? '')
      return doc.length >= 8 && digitosArquivo.includes(doc)
    })
    if (porDocumento) return porDocumento
  }

  const arquivoNorm = normalizarTexto(nomeArquivo)
  return (
    destinatarios.find((d) => {
      const palavras = normalizarTexto(d.nome)
        .split(' ')
        .filter((p) => p.length >= 4)
      return palavras.some((p) => arquivoNorm.includes(p))
    }) ?? null
  )
}
