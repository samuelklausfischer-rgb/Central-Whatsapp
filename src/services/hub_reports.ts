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

// Slug do projeto "Central Whats" cadastrado em `hub_projetos`.
const PROJETO_SLUG = 'central-whats'

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
  metadata?: Record<string, unknown>
}

export const enviarHubReport = async ({
  tipo,
  titulo,
  descricao,
  reportadoPor,
  metadata,
}: EnviarHubReportInput) => {
  // `hub_projetos` é fechada para `anon`; a RPC (SECURITY DEFINER) devolve
  // só o id daquele slug, sem expor mais nada do projeto.
  const rpcRes = await fetch(`${HUB_SUPABASE_URL}/rest/v1/rpc/hub_projeto_id_by_slug`, {
    method: 'POST',
    headers: hubHeaders,
    body: JSON.stringify({ slug_input: PROJETO_SLUG }),
  })
  if (!rpcRes.ok) {
    throw new Error(`Não foi possível conectar ao PRN Hub agora (erro ${rpcRes.status}). Tente de novo em instantes.`)
  }

  const projetoId = await rpcRes.json()
  if (!projetoId) throw new Error(`Projeto "${PROJETO_SLUG}" não está cadastrado no PRN Hub.`)

  // `status` e `prioridade` são omitidos de propósito: os defaults da tabela
  // ('novo' / 'media') são exatamente o que a policy de insert exige.
  const res = await fetch(`${HUB_SUPABASE_URL}/rest/v1/hub_reports`, {
    method: 'POST',
    headers: { ...hubHeaders, Prefer: 'return=minimal' },
    body: JSON.stringify({
      projeto_id: projetoId,
      tipo,
      titulo,
      descricao,
      reportado_por: reportadoPor,
      origem: 'widget',
      pagina_url: window.location.href,
      metadata: { projeto_slug: PROJETO_SLUG, ...metadata },
    }),
  })

  if (!res.ok) throw new Error(`Falha ao enviar o report (erro ${res.status}).`)
}
