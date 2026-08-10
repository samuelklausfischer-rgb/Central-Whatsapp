import "jsr:@supabase/functions-js/edge-runtime.d.ts"

// Endpoint de update OTA do app Android (@capgo/capacitor-updater, self-hospedado).
//
// SEM AUTENTICAÇÃO DE USUÁRIO DE PROPÓSITO: o plugin chama isso antes de o app
// necessariamente ter uma sessão logada (é a primeira coisa que roda ao
// abrir). Por isso esta função precisa estar configurada com `verify_jwt =
// false` no deploy (via `supabase functions deploy mobile-update
// --no-verify-jwt`, ou a entrada equivalente em `supabase/config.toml` —
// nenhuma das duas foi feita aqui, é passo de deploy). A superfície exposta é
// mínima por desenho: só a linha mais recente de `app_mobile_bundles`
// (versão/url/checksum), lida com a service role — nunca dado de usuário.

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || ''
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const serviceHeaders = {
  'Content-Type': 'application/json',
  Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
  apikey: SUPABASE_SERVICE_KEY,
}

type JsonRecord = Record<string, unknown>

function json(data: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

/**
 * Compara duas versões semver como NÚMEROS, componente a componente.
 *
 * Comparação de string erra: "0.0.10" < "0.0.9" lexicograficamente, porque
 * '1' < '9' no segundo caractere — mas 10 é maior que 9. Por isso cada
 * segmento entre pontos é convertido para inteiro antes de comparar.
 * Segmento ausente (versões com número de partes diferente) vira 0; segmento
 * não numérico (build metadata tipo "1.2.3-beta") também vira 0 em vez de
 * quebrar a função — degrada, não derruba o endpoint.
 *
 * Retorna >0 se `a` > `b`, <0 se `a` < `b`, 0 se iguais.
 */
function compareVersions(a: string, b: string): number {
  const parse = (v: string) => String(v || '').split('.').map((part) => {
    const n = parseInt(part, 10)
    return Number.isFinite(n) ? n : 0
  })

  const pa = parse(a)
  const pb = parse(b)
  const len = Math.max(pa.length, pb.length)

  for (let i = 0; i < len; i++) {
    const na = pa[i] ?? 0
    const nb = pb[i] ?? 0
    if (na !== nb) return na - nb
  }
  return 0
}

async function buscarBundleMaisRecente(): Promise<{ version: string; url: string; checksum: string } | null> {
  const resp = await fetch(
    `${SUPABASE_URL}/rest/v1/app_mobile_bundles?select=version,url,checksum,released_at&order=released_at.desc&limit=1`,
    { headers: serviceHeaders },
  )
  if (!resp.ok) throw new Error(`Falha ao consultar app_mobile_bundles (status ${resp.status})`)

  const rows = await resp.json().catch(() => [])
  if (!Array.isArray(rows) || rows.length === 0) return null

  const row = rows[0] as JsonRecord
  return {
    version: String(row.version || ''),
    url: String(row.url || ''),
    checksum: String(row.checksum || ''),
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return json({ error: 'method not allowed' }, 405)
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return json({ error: 'Supabase environment not configured' }, 500)
  }

  try {
    // O plugin Capgo manda version_name, version_build, version_os,
    // device_id, platform, app_id, plugin_version, custom_id, is_prod,
    // is_emulator — mas o conjunto de campos varia entre versões do plugin.
    // `.json().catch()` cobre corpo ausente/inválido (body vazio, não-JSON);
    // cada campo é lido isolado, então faltar qualquer um não derruba o resto.
    const body = await req.json().catch(() => ({})) as JsonRecord

    const versionName = String(body.version_name ?? '').trim()

    const bundle = await buscarBundleMaisRecente()

    // Tabela vazia (nenhum bundle publicado ainda): não é erro, é "nada para
    // oferecer". Responde no formato de "sem atualização" do contrato Capgo.
    if (!bundle || !bundle.version) {
      return json({ message: 'No update available', version: versionName || '0.0.0' })
    }

    // Sem version_name no corpo, não há base de comparação segura — trata
    // como "sempre atualiza" (compareVersions com '' vira 0.0.0, então
    // qualquer bundle publicado é "maior"), já que o pior caso é o app
    // aplicar um update que já tinha.
    const temAtualizacao = compareVersions(bundle.version, versionName) > 0

    if (!temAtualizacao) {
      return json({ message: 'No update available', version: versionName || bundle.version })
    }

    if (!bundle.url || !bundle.checksum) {
      // Linha mais recente sem url/checksum preenchidos é dado inconsistente
      // na tabela (não deveria acontecer, `url`/`checksum` são NOT NULL) —
      // mas se acontecer, não devolve update quebrado: cai em "sem
      // atualização" em vez de mandar o app baixar algo inválido.
      return json({ message: 'No update available', version: versionName || bundle.version })
    }

    return json({
      version: bundle.version,
      url: bundle.url,
      checksum: bundle.checksum,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected error'
    return json({ error: message }, 500)
  }
})
