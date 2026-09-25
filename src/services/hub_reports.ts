// Envio de "Reportar problema / Sugerir ideia" para a fila do PRN Hub.
//
// Não usa o client de `@/lib/supabase/client` de propósito, por dois motivos:
//
// 1. RLS — a policy `hub_reports_insert_anon` e o grant de EXECUTE da RPC
//    `hub_projeto_id_by_slug` valem só para o role `anon`. O client do app
//    manda o JWT do usuário logado (role `authenticated`), e o insert seria
//    rejeitado. Aqui usamos fetch cru só com a anon key, sem sessão — mesmo
//    caminho do widget oficial (`PRN-hub/src/embed/report-widget.ts`).
//
// 2. Destino — o alvo é o Hub, não o "Supabase do app". Hoje é o mesmo
//    projeto self-hosted, mas se o Central Whats um dia apontar para outro,
//    os reports devem continuar chegando no Hub. Por isso URL e chave ficam
//    fixas aqui (ambas já são públicas no repo do PRN-hub).

const HUB_SUPABASE_URL = 'https://apps-supabase.srofjl.easypanel.host'
const HUB_SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJvbGUiOiJhbm9uIiwiaWF0IjoxNzUyNzAwMDAwLCJleHAiOjIzODQ1MDAwMDB9.Gseqw0-_o6Nmwmz3mCWvgxjjCfJB1LhVgTV83uJe-F4'

/**
 * Projeto padrão quando ninguém disser de onde veio.
 *
 * Deixou de ser o ÚNICO destino em 08/09/2026: até então todo relato caía aqui,
 * inclusive os escritos de dentro do PRN Hub Dev ou da Proposta Comercial, que
 * têm fila própria — 26 relatos medidos no banco, todos para `central-whats`.
 * Quem decide o destino agora é `lib/hub/onde-estou.ts`.
 */
const PROJETO_PADRAO = 'central-whats'

const hubHeaders = {
  'Content-Type': 'application/json',
  apikey: HUB_SUPABASE_ANON_KEY,
  Authorization: `Bearer ${HUB_SUPABASE_ANON_KEY}`,
}

export type HubReportTipo = 'problema' | 'ideia'

export interface EnviarHubReportInput {
  tipo: HubReportTipo
  titulo: string
  descricao: string
  reportadoPor: string
  /** Slug do projeto no Hub. Omitido = Central Whats. */
  projetoSlug?: string
  metadata?: Record<string, unknown>
}

/** Só o que quem chama precisa: o id, para anexar prints logo em seguida. */
export interface EnviarHubReportResultado {
  id: string
}

export const enviarHubReport = async ({
  tipo,
  titulo,
  descricao,
  reportadoPor,
  projetoSlug,
  metadata,
}: EnviarHubReportInput): Promise<EnviarHubReportResultado> => {
  const slug = projetoSlug || PROJETO_PADRAO
  // `hub_projetos` é fechada para `anon`; a RPC (SECURITY DEFINER) devolve
  // só o id daquele slug, sem expor mais nada do projeto.
  const rpcRes = await fetch(`${HUB_SUPABASE_URL}/rest/v1/rpc/hub_projeto_id_by_slug`, {
    method: 'POST',
    headers: hubHeaders,
    body: JSON.stringify({ slug_input: slug }),
  })
  if (!rpcRes.ok) {
    throw new Error(`Não foi possível conectar ao PRN Hub agora (erro ${rpcRes.status}). Tente de novo em instantes.`)
  }

  const projetoId = await rpcRes.json()
  if (!projetoId) throw new Error(`Projeto "${slug}" não está cadastrado no PRN Hub.`)

  // `status` e `prioridade` são omitidos de propósito: os defaults da tabela
  // ('novo' / 'media') são exatamente o que a policy de insert exige.
  //
  // `id` GERADO NO CLIENTE — não dá para usar `Prefer: return=representation`
  // para recuperar o id de volta: o grant do `anon` nesta tabela é por
  // COLUNA e não inclui SELECT, e `return=representation` faz um RETURNING
  // por baixo, que a Prod já provou responder 401 "permission denied for
  // table hub_reports". `return=minimal` continua sendo o único caminho que
  // funciona — por isso o id precisa nascer aqui, e `id` está na lista de
  // colunas que o `anon` PODE inserir.
  const id = crypto.randomUUID()
  const res = await fetch(`${HUB_SUPABASE_URL}/rest/v1/hub_reports`, {
    method: 'POST',
    headers: { ...hubHeaders, Prefer: 'return=minimal' },
    body: JSON.stringify({
      id,
      projeto_id: projetoId,
      tipo,
      titulo,
      descricao,
      reportado_por: reportadoPor,
      origem: 'widget',
      pagina_url: window.location.href,
      metadata: { projeto_slug: slug, ...metadata },
    }),
  })

  // `return=minimal` devolve corpo vazio — não dá para chamar `.json()` aqui.
  if (!res.ok) throw new Error(`Falha ao enviar o report (erro ${res.status}).`)
  return { id }
}

/** Bucket de Storage onde os prints do widget ficam — policy anon de INSERT já existe lá. */
const HUB_REPORT_PRINTS_BUCKET = 'hub-report-prints'

/** Mesmo teto que a policy de INSERT em `hub_report_anexos` impõe. */
const HUB_REPORT_ANEXO_MAX_BYTES = 5 * 1024 * 1024

/** MIME aceitos pela policy de INSERT em `hub_report_anexos`. */
const HUB_REPORT_ANEXO_MIME_ACEITOS = ['image/webp', 'image/png', 'image/jpeg'] as const

export interface EnviarHubReportAnexoInput {
  reportId: string
  /** Começa em 1 — é o que compõe o caminho no Storage. */
  ordem: number
  arquivo: Blob
  mime: string
  nomeArquivo: string
  largura: number
  altura: number
}

/**
 * Sobe um print para o Storage e registra o anexo em `hub_report_anexos`.
 *
 * Duas chamadas, não uma RPC: o bucket e a tabela têm policies de INSERT
 * `anon` separadas, e é assim que o widget oficial do Hub já faz. Se o
 * upload subir mas o insert da linha falhar (ou vice-versa), quem chamou
 * decide o que fazer — este helper só propaga o erro, nunca esconde.
 */
export const enviarHubReportAnexo = async ({
  reportId,
  ordem,
  arquivo,
  mime,
  nomeArquivo,
  largura,
  altura,
}: EnviarHubReportAnexoInput): Promise<void> => {
  if (arquivo.size <= 0 || arquivo.size > HUB_REPORT_ANEXO_MAX_BYTES) {
    throw new Error('O print excede o limite de 5 MB.')
  }
  if (!HUB_REPORT_ANEXO_MIME_ACEITOS.includes(mime as (typeof HUB_REPORT_ANEXO_MIME_ACEITOS)[number])) {
    throw new Error(`Formato de imagem não aceito (${mime}).`)
  }

  // Padrão que o Hub já usa: `<report_id>/<ordem>-image.webp`, começando em 1.
  // A policy de INSERT em `hub_report_anexos` exige que `caminho` comece com
  // o id do report — por isso ele vem primeiro, não depois.
  const caminho = `${reportId}/${ordem}-image.webp`

  const upRes = await fetch(`${HUB_SUPABASE_URL}/storage/v1/object/${HUB_REPORT_PRINTS_BUCKET}/${caminho}`, {
    method: 'POST',
    headers: {
      apikey: HUB_SUPABASE_ANON_KEY,
      Authorization: `Bearer ${HUB_SUPABASE_ANON_KEY}`,
      'Content-Type': mime,
    },
    body: arquivo,
  })
  if (!upRes.ok) {
    throw new Error(`Falha ao subir o print (erro ${upRes.status}).`)
  }

  const anexoRes = await fetch(`${HUB_SUPABASE_URL}/rest/v1/hub_report_anexos`, {
    method: 'POST',
    headers: { ...hubHeaders, Prefer: 'return=minimal' },
    body: JSON.stringify({
      report_id: reportId,
      caminho,
      nome_arquivo: nomeArquivo,
      mime,
      tamanho_bytes: arquivo.size,
      largura,
      altura,
      ordem,
    }),
  })
  if (!anexoRes.ok) {
    throw new Error(`Falha ao registrar o print (erro ${anexoRes.status}).`)
  }
}

export type HubReportStatus =
  | 'novo'
  | 'em_analise'
  | 'em_andamento'
  | 'resolvido'
  | 'melhoramento'
  | 'nao_aplicado'
  | 'arquivado'

export interface HubReportChecklistItem {
  id: string
  texto: string
  status: 'pendente' | 'fazendo' | 'feito'
  prazo: string | null
}

export interface HubMeuReport {
  id: string
  tipo: HubReportTipo
  titulo: string
  descricao: string
  status: HubReportStatus
  criado_em: string
  prazo: string | null
  checklist: HubReportChecklistItem[]
}

export interface ListarMeusHubReportsInput {
  userId?: string | null
  userEmail?: string | null
}

/**
 * "Meus reportes" — lê pela RPC `hub_meus_reports` (SECURITY DEFINER), a
 * única porta de leitura que existe pra `anon` em `hub_reports`. Não há
 * policy de SELECT nessa tabela de propósito (exporia reports de todo mundo);
 * a função filtra por autor por dentro, usando os mesmos `user_id`/`user_email`
 * que `ReportarProblemaDialog.tsx` já grava em `metadata` no envio. Mesmo
 * fetch cru + anon key do restante deste arquivo — ver comentário no topo.
 *
 * Enquanto a migration `20260820130000_hub_meus_reports.sql` não for aplicada
 * em produção, a RPC não existe e este fetch volta 404 — tratado como erro
 * normal pela tela (ver ReportarProblemaDialog), não como bug.
 */
export const listarMeusHubReports = async ({
  userId,
  userEmail,
}: ListarMeusHubReportsInput): Promise<HubMeuReport[]> => {
  if (!userId && !userEmail) return []

  const res = await fetch(`${HUB_SUPABASE_URL}/rest/v1/rpc/hub_meus_reports`, {
    method: 'POST',
    headers: hubHeaders,
    body: JSON.stringify({ p_user_id: userId ?? null, p_user_email: userEmail ?? null }),
  })

  if (!res.ok) {
    throw new Error(`Não foi possível carregar seus reportes agora (erro ${res.status}). Tente de novo em instantes.`)
  }

  const data = await res.json()
  return Array.isArray(data) ? (data as HubMeuReport[]) : []
}
