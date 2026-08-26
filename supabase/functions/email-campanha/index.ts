import "jsr:@supabase/functions-js/edge-runtime.d.ts"

/**
 * Disparo de e-mail para listas — médicos e clínicas parceiras.
 *
 * Envia UMA mensagem por destinatário, com ritmo controlado, pela caixa da
 * própria empresa via Microsoft Graph. Irmã da `email-microsoft`, de onde vêm
 * as credenciais e a renovação de token.
 *
 * POR QUE ISTO É LEGÍTIMO E NÃO SPAM. A documentação da Microsoft diz que o
 * Exchange Online "não é adequado para cenários de envio em massa" e manda usar
 * provedor terceiro para e-mail comercial em massa. Comunicado B2B para ~200
 * parceiros com relação existente não é esse caso, e cabe com folga nos limites
 * (30 msg/min, 10.000 destinatários/dia). O campo `canal` da campanha existe
 * para o dia em que aparecer marketing de verdade: ele sai por provedor
 * dedicado, sem reescrever nada aqui.
 *
 * Rotas: `.../email-campanha/<rota>`
 *   preparar     — expande a lista em alvos, tirando quem está suprimido
 *   disparar     — o worker (chamado pelo pg_cron de minuto em minuto)
 *   teste        — manda só para quem está montando, antes de liberar
 *   status       — progresso da campanha
 *   cancelar     — para no meio sem perder o que já foi
 *   descadastrar — PÚBLICA, é o link do rodapé
 */

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || ''
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}

const serviceHeaders = {
  'Content-Type': 'application/json',
  Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
  apikey: SUPABASE_SERVICE_KEY,
}

const GRAPH = 'https://graph.microsoft.com/v1.0'

/**
 * Teto de tempo de uma rodada do worker.
 *
 * Edge function tem tempo limitado, e o cron acorda de minuto em minuto. Em vez
 * de tentar mandar a campanha inteira numa chamada, cada rodada envia o que
 * couber em ~100s e devolve o resto para a próxima. Campanha de 200 leva umas
 * 15 rodadas — e nenhuma delas corre risco de morrer no meio.
 */
const TETO_DA_RODADA_MS = 100_000

function json(data: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function esc(txt: string): string {
  return txt.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string))
}

function pagina(titulo: string, mensagem: string) {
  return new Response(
    `<!doctype html><html lang="pt-BR"><meta charset="utf-8">
     <meta name="viewport" content="width=device-width,initial-scale=1">
     <title>${esc(titulo)}</title>
     <body style="font-family:system-ui;display:grid;place-items:center;min-height:100vh;margin:0;background:#f5f5f2;color:#2c2c2a">
       <div style="max-width:28rem;text-align:center;padding:2rem">
         <h1 style="font-size:1.25rem;font-weight:600">${esc(titulo)}</h1>
         <p style="color:#5f5e5a;line-height:1.6">${esc(mensagem)}</p>
       </div>
     </body></html>`,
    { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
  )
}

async function rest(caminho: string, init?: RequestInit) {
  return await fetch(`${SUPABASE_URL}/rest/v1/${caminho}`, {
    ...init,
    headers: { ...serviceHeaders, ...(init?.headers ?? {}) },
  })
}

async function lerSegredos(): Promise<Record<string, string>> {
  const chaves = ['EMAIL_MS_CLIENT_ID', 'EMAIL_MS_TENANT_ID', 'EMAIL_MS_CLIENT_SECRET',
                  'EMAIL_DISPARO_SECRET', 'EMAIL_MS_CRON_SECRET']
  const lista = chaves.map((k) => `"${k}"`).join(',')
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/secrets?key=in.(${encodeURIComponent(lista)})&select=key,value`,
    { headers: serviceHeaders },
  )
  if (!r.ok) return {}
  const linhas = (await r.json()) as { key: string; value: string }[]
  return Object.fromEntries(linhas.map((l) => [l.key, l.value]))
}

async function usuarioDaRequisicao(authHeader: string): Promise<string | null> {
  if (!authHeader) return null
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { Authorization: authHeader, apikey: SUPABASE_SERVICE_KEY },
  })
  if (!r.ok) return null
  return (await r.json())?.id ?? null
}

/** Mesma checagem da policy `pode_disparar_email()`, aqui porque a função usa service_role. */
async function podeDisparar(userId: string): Promise<boolean> {
  const p = await rest(`profiles?id=eq.${encodeURIComponent(userId)}&select=is_admin`)
  if (p.ok && (await p.json())[0]?.is_admin === true) return true
  const t = await rest(
    `tool_access?user_id=eq.${encodeURIComponent(userId)}&tool=eq.disparador-email&select=id`,
  )
  return t.ok && (await t.json()).length > 0
}

// ——— Token do descadastro ———

async function assinar(valor: string, segredo: string): Promise<string> {
  const chave = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(segredo), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  )
  const a = await crypto.subtle.sign('HMAC', chave, new TextEncoder().encode(valor))
  return [...new Uint8Array(a)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * O link de descadastro é assinado.
 *
 * Sem assinatura, bastaria trocar o endereço na URL para descadastrar outra
 * pessoa — e ninguém descobriria, porque o efeito é justamente "parar de
 * receber". Mesma técnica do `state` do OAuth na `email-microsoft`.
 */
async function tokenDescadastro(campanha: string, email: string, segredo: string) {
  return await assinar(`${campanha}.${email.toLowerCase()}`, segredo)
}

// ——— Token do Microsoft Graph ———

async function tokenValido(accountId: string, s: Record<string, string>): Promise<string | null> {
  const r = await rest(`email_account_tokens?account_id=eq.${encodeURIComponent(accountId)}&select=*`)
  if (!r.ok) return null
  const t = (await r.json())[0]
  if (!t?.refresh_token) return null

  const venceEm = new Date(t.expires_at ?? 0).getTime()
  if (Number.isFinite(venceEm) && venceEm - Date.now() > 60_000) return t.access_token

  const resp = await fetch(
    `https://login.microsoftonline.com/${s.EMAIL_MS_TENANT_ID}/oauth2/v2.0/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: s.EMAIL_MS_CLIENT_ID,
        client_secret: s.EMAIL_MS_CLIENT_SECRET,
        refresh_token: t.refresh_token,
        grant_type: 'refresh_token',
      }),
    },
  )
  if (!resp.ok) return null
  const d = await resp.json()
  await rest('email_account_tokens?on_conflict=account_id', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify({
      account_id: accountId,
      access_token: d.access_token,
      refresh_token: d.refresh_token || t.refresh_token,
      expires_at: new Date(Date.now() + (d.expires_in ?? 3600) * 1000).toISOString(),
      scope: d.scope ?? t.scope,
      updated_at: new Date().toISOString(),
    }),
  })
  return d.access_token
}

// ——— Montagem da mensagem ———

interface Alvo {
  id: string
  email: string
  nome: string | null
  organizacao: string | null
}

/** Troca `{{nome}}`, `{{organizacao}}` e `{{email}}` pelos dados do destinatário. */
function personalizar(texto: string, alvo: Alvo): string {
  return texto
    .replace(/\{\{\s*nome\s*\}\}/gi, alvo.nome ?? '')
    .replace(/\{\{\s*organizacao\s*\}\}/gi, alvo.organizacao ?? '')
    .replace(/\{\{\s*email\s*\}\}/gi, alvo.email)
}

/**
 * Rodapé com o link de descadastro. É acrescentado SEMPRE, e não é opcional.
 *
 * O e-mail é enviado pelo Graph, e o Graph só aceita cabeçalho personalizado
 * começando com `x-` ("Add custom headers only when creating a message, and
 * name them starting with 'x-'"). Ou seja: NÃO dá para mandar o cabeçalho
 * `List-Unsubscribe`, que é o que faz o Gmail mostrar o botão de cancelar
 * inscrição ao lado do remetente.
 *
 * Então o link visível é a única saída de quem não quer mais receber. Se ele
 * não estiver lá, a pessoa marca como spam — e marcação de spam é o que destrói
 * a reputação do domínio, enquanto descadastro não custa nada.
 */
function rodape(urlDescadastro: string, remetente: string): string {
  return `
<div style="margin-top:32px;padding-top:16px;border-top:1px solid #e0e0e0;
            font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
            font-size:12px;color:#777;line-height:1.6">
  Você está recebendo esta mensagem porque faz parte da rede de parceiros da PRN Diagnósticos.<br>
  Se preferir não receber mais estes comunicados,
  <a href="${urlDescadastro}" style="color:#555;text-decoration:underline">clique aqui para descadastrar</a>.<br>
  Dúvidas? Basta responder este e-mail — ele chega em ${esc(remetente)}.
</div>`
}

function rodapeTexto(urlDescadastro: string, remetente: string): string {
  return `\n\n-----\nVocê está recebendo esta mensagem porque faz parte da rede de parceiros da PRN Diagnósticos.\nPara não receber mais: ${urlDescadastro}\nDúvidas? Responda este e-mail — ele chega em ${remetente}.`
}

/** Remove tags para gerar a versão em texto quando a campanha não trouxer uma. */
function htmlParaTexto(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

async function enviarUm(
  token: string,
  campanha: Record<string, any>,
  alvo: Alvo,
  urlDescadastro: string,
  remetente: string,
): Promise<{ ok: boolean; erro?: string }> {
  const html = personalizar(campanha.corpo_html, alvo) + rodape(urlDescadastro, remetente)
  const textoBase = campanha.corpo_texto
    ? personalizar(campanha.corpo_texto, alvo)
    : htmlParaTexto(personalizar(campanha.corpo_html, alvo))

  const resp = await fetch(`${GRAPH}/me/sendMail`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: {
        subject: personalizar(campanha.assunto, alvo),
        body: { contentType: 'HTML', content: html },
        // UM destinatário. Nunca uma lista em cópia oculta: além de ser o padrão
        // que todo filtro reconhece, ninguém confia num e-mail que não foi
        // endereçado a ele.
        toRecipients: [{ emailAddress: { address: alvo.email, name: alvo.nome ?? undefined } }],
        ...(campanha.responder_para
          ? { replyTo: [{ emailAddress: { address: campanha.responder_para } }] }
          : {}),
        // Só cabeçalho `x-` é aceito pelo Graph. Servem para rastrear a origem
        // de uma reclamação sem depender do assunto, que muda a cada campanha.
        internetMessageHeaders: [
          { name: 'x-prn-campanha', value: String(campanha.id) },
          { name: 'x-prn-alvo', value: String(alvo.id) },
        ],
      },
      // Guardar em Itens Enviados: se um parceiro cobrar "não recebi", a prova
      // está na caixa, do jeito que ele receberia.
      saveToSentItems: true,
    }),
  })

  if (resp.ok) return { ok: true }
  const erro = await resp.text().catch(() => '')
  // O texto vai para a coluna `erro` do alvo; cortar evita encher o banco com
  // stack trace da Microsoft.
  return { ok: false, erro: `Graph ${resp.status}: ${erro.slice(0, 300)}` }
}

// ——— Ritmo ———

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Intervalo variável entre envios. Intervalo exato e constante é assinatura de robô. */
function intervalo(c: Record<string, any>): number {
  const min = Number(c.delay_min_ms ?? 2500)
  const max = Number(c.delay_max_ms ?? 6000)
  return min + Math.random() * Math.max(0, max - min)
}

/**
 * Está dentro da janela de envio?
 *
 * Fuso de São Paulo, e não UTC: uma campanha configurada para 8h–18h precisa
 * sair no horário comercial de quem recebe. Ninguém manda 200 e-mails às 3h da
 * manhã — o horário entra na avaliação de quem julga o remetente, e um parceiro
 * que recebe de madrugada percebe que é robô.
 */
function dentroDoHorario(c: Record<string, any>): boolean {
  if (!c.respeitar_horario) return true
  const agora = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }))
  const h = agora.getHours()
  return h >= Number(c.hora_inicio ?? 8) && h < Number(c.hora_fim ?? 18)
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const url = new URL(req.url)
  const rota = url.pathname.split('/').filter(Boolean).pop() || ''
  const host = req.headers.get('x-forwarded-host') || url.host
  const local = host.startsWith('localhost') || host.startsWith('127.0.0.1')
  const origemPublica = `${local ? 'http' : 'https'}://${host}`
  const s = await lerSegredos()

  /*
    Descadastro. PÚBLICA por natureza: quem clica não tem login no nosso app, e
    exigir qualquer coisa aqui empurraria a pessoa para o botão de spam.
  */
  if (rota === 'descadastrar') {
    const campanha = url.searchParams.get('c') || ''
    const email = (url.searchParams.get('e') || '').toLowerCase()
    const token = url.searchParams.get('t') || ''

    if (!campanha || !email || !token) {
      return pagina('Link inválido', 'Não deu para identificar o cadastro. Responda o e-mail que a gente remove na mão.')
    }
    const esperado = await tokenDescadastro(campanha, email, s.EMAIL_DISPARO_SECRET || '')
    if (token !== esperado) {
      return pagina('Link inválido', 'Este link não confere. Responda o e-mail que a gente remove na mão.')
    }

    await rest('email_supressao?on_conflict=email', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify({
        email, motivo: 'descadastro', campaign_id: campanha,
        detalhe: 'clicou no link do rodapé',
      }),
    })
    // Marca também os alvos pendentes desta e de outras campanhas, para não
    // sair nada no intervalo entre o clique e a próxima rodada do worker.
    await rest(`email_campanha_alvos?email=eq.${encodeURIComponent(email)}&status=eq.pendente`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'suprimido', erro: 'descadastrou' }),
    })

    return pagina(
      'Pronto, você saiu da lista',
      'Não vamos mais mandar comunicados para este endereço. Se foi engano, é só responder um e-mail nosso que a gente cadastra de volta.',
    )
  }

  // ——— Daqui para baixo exige identificação ———
  const segredoCron = s.EMAIL_MS_CRON_SECRET || ''
  const ehServico = segredoCron.length > 0 && req.headers.get('x-cron-secret') === segredoCron
  const userId = ehServico ? null : await usuarioDaRequisicao(req.headers.get('Authorization') || '')

  if (!ehServico) {
    if (!userId) return json({ error: 'Sessão não encontrada' }, 401)
    if (!(await podeDisparar(userId))) {
      return json({ error: 'Você não tem permissão para disparar e-mail.' }, 403)
    }
  } else if (rota !== 'disparar') {
    return json({ error: 'O agendador só pode disparar.' }, 403)
  }

  const corpoJson = async () => (await req.json().catch(() => ({}))) as Record<string, any>

  /*
    Expande a lista em alvos, tirando quem está suprimido.

    A conferência de supressão acontece AQUI e de novo na hora do envio. Parece
    redundante e não é: entre preparar e enviar pode passar meia hora, e alguém
    pode ter descadastrado nesse meio-tempo pelo link de outra campanha.
  */
  if (rota === 'preparar') {
    const c = await corpoJson()
    const campaignId = String(c.campaign_id ?? '')
    if (!campaignId) return json({ error: 'Falta a campanha.' }, 400)

    const rc = await rest(`email_campanhas?id=eq.${encodeURIComponent(campaignId)}&select=*`)
    const campanha = rc.ok ? (await rc.json())[0] : null
    if (!campanha) return json({ error: 'Campanha não encontrada.' }, 404)
    if (campanha.status !== 'rascunho' && campanha.status !== 'preparada') {
      return json({ error: `Campanha já está em "${campanha.status}".` }, 409)
    }

    const rm = await rest(
      `email_lista_membros?list_id=eq.${encodeURIComponent(campanha.list_id)}&select=email,nome,organizacao`,
    )
    if (!rm.ok) return json({ error: 'Não deu para ler a lista.' }, 500)
    const membros = await rm.json()

    const rs = await rest('email_supressao?select=email')
    const suprimidos = new Set(
      rs.ok ? (await rs.json()).map((x: any) => String(x.email).toLowerCase()) : [],
    )

    const valido = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
    let ignorados = 0
    const alvos: Record<string, unknown>[] = []
    const jaVistos = new Set<string>()

    for (const m of membros) {
      const email = String(m.email ?? '').trim().toLowerCase()
      if (!valido.test(email) || suprimidos.has(email) || jaVistos.has(email)) {
        ignorados++
        continue
      }
      jaVistos.add(email)
      alvos.push({
        campaign_id: campaignId, email,
        nome: m.nome ?? null, organizacao: m.organizacao ?? null,
      })
    }

    if (alvos.length === 0) return json({ error: 'Nenhum destinatário válido.', ignorados }, 400)

    await rest('email_campanha_alvos?on_conflict=campaign_id,email', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify(alvos),
    })
    await rest(`email_campanhas?id=eq.${encodeURIComponent(campaignId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'preparada', updated_at: new Date().toISOString() }),
    })

    return json({ preparados: alvos.length, ignorados })
  }

  /** Manda a campanha só para quem está montando — obrigatório antes de liberar. */
  if (rota === 'teste') {
    const c = await corpoJson()
    const campaignId = String(c.campaign_id ?? '')
    const para = String(c.para ?? '').trim().toLowerCase()
    if (!campaignId || !para) return json({ error: 'Falta a campanha ou o destinatário.' }, 400)

    const rc = await rest(`email_campanhas?id=eq.${encodeURIComponent(campaignId)}&select=*`)
    const campanha = rc.ok ? (await rc.json())[0] : null
    if (!campanha) return json({ error: 'Campanha não encontrada.' }, 404)

    const token = await tokenValido(campanha.account_id, s)
    if (!token) return json({ error: 'A conexão com a Microsoft expirou. Reconecte a caixa.' }, 401)

    const ra = await rest(`email_accounts?id=eq.${encodeURIComponent(campanha.account_id)}&select=email`)
    const remetente = ra.ok ? (await ra.json())[0]?.email ?? '' : ''

    const alvo: Alvo = { id: 'teste', email: para, nome: 'Teste', organizacao: 'Teste' }
    const t = await tokenDescadastro(campaignId, para, s.EMAIL_DISPARO_SECRET || '')
    const link = `${origemPublica}/functions/v1/email-campanha/descadastrar` +
      `?c=${encodeURIComponent(campaignId)}&e=${encodeURIComponent(para)}&t=${t}`

    const r = await enviarUm(token, campanha, alvo, link, remetente)
    return r.ok ? json({ ok: true }) : json({ error: r.erro }, 502)
  }

  if (rota === 'status') {
    const c = await corpoJson()
    const campaignId = String(c.campaign_id ?? '')
    if (!campaignId) return json({ error: 'Falta a campanha.' }, 400)
    const r = await rest(
      `email_campanha_alvos?campaign_id=eq.${encodeURIComponent(campaignId)}&select=status`,
    )
    const linhas = r.ok ? await r.json() : []
    const conta: Record<string, number> = {}
    for (const l of linhas) conta[l.status] = (conta[l.status] ?? 0) + 1
    return json({ total: linhas.length, por_status: conta })
  }

  if (rota === 'cancelar') {
    const c = await corpoJson()
    const campaignId = String(c.campaign_id ?? '')
    if (!campaignId) return json({ error: 'Falta a campanha.' }, 400)
    await rest(`email_campanha_alvos?campaign_id=eq.${encodeURIComponent(campaignId)}&status=eq.pendente`, {
      method: 'PATCH', body: JSON.stringify({ status: 'cancelado' }),
    })
    await rest(`email_campanhas?id=eq.${encodeURIComponent(campaignId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'cancelada', concluido_em: new Date().toISOString() }),
    })
    return json({ ok: true })
  }

  /*
    O worker. Chamado pelo pg_cron de minuto em minuto.

    Manda uma campanha por rodada, e só o que couber no teto de tempo. O ritmo
    (intervalo variável, pausa a cada bloco, janela de horário) é o que separa
    "comunicado" de "disparo suspeito" aos olhos de quem recebe.
  */
  if (rota === 'disparar') {
    const c = await corpoJson()
    const pedida = c.campaign_id ? String(c.campaign_id) : null

    const filtro = pedida
      ? `id=eq.${encodeURIComponent(pedida)}`
      : `status=in.(preparada,enviando)&or=(agendado_para.is.null,agendado_para.lte.${new Date().toISOString()})`
    const rc = await rest(`email_campanhas?${filtro}&select=*&order=created_at.asc&limit=1`)
    const campanha = rc.ok ? (await rc.json())[0] : null
    if (!campanha) return json({ nada: true })

    if (campanha.status !== 'preparada' && campanha.status !== 'enviando') {
      return json({ nada: true, motivo: `campanha em "${campanha.status}"` })
    }
    if (!dentroDoHorario(campanha)) {
      return json({ nada: true, motivo: 'fora da janela de horário' })
    }

    const token = await tokenValido(campanha.account_id, s)
    if (!token) return json({ error: 'Conexão com a Microsoft expirada.' }, 401)

    const ra = await rest(`email_accounts?id=eq.${encodeURIComponent(campanha.account_id)}&select=email`)
    const remetente = ra.ok ? (await ra.json())[0]?.email ?? '' : ''

    if (campanha.status === 'preparada') {
      await rest(`email_campanhas?id=eq.${encodeURIComponent(campanha.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'enviando', iniciado_em: new Date().toISOString() }),
      })
    }

    // Trava órfã: worker que morreu no meio deixa o alvo preso. Depois de 5 min
    // ele volta para a fila — senão a campanha trava para sempre num registro.
    const limiteTrava = new Date(Date.now() - 5 * 60_000).toISOString()
    await rest(
      `email_campanha_alvos?campaign_id=eq.${encodeURIComponent(campanha.id)}&status=eq.pendente&locked_at=lt.${limiteTrava}`,
      { method: 'PATCH', body: JSON.stringify({ locked_by: null, locked_at: null }) },
    )

    const inicio = Date.now()
    const workerId = crypto.randomUUID()
    let enviados = 0
    let falhas = 0

    while (Date.now() - inicio < TETO_DA_RODADA_MS) {
      const rp = await rest(
        `email_campanha_alvos?campaign_id=eq.${encodeURIComponent(campanha.id)}` +
        `&status=eq.pendente&locked_at=is.null&select=id,email,nome,organizacao&limit=1`,
      )
      const alvo: Alvo | undefined = rp.ok ? (await rp.json())[0] : undefined
      if (!alvo) break

      // Trava antes de mandar. Dois workers acordando juntos não podem mandar o
      // mesmo e-mail duas vezes para a mesma pessoa.
      const trava = await rest(
        `email_campanha_alvos?id=eq.${encodeURIComponent(alvo.id)}&locked_at=is.null`,
        {
          method: 'PATCH',
          headers: { Prefer: 'return=representation' },
          body: JSON.stringify({ locked_by: workerId, locked_at: new Date().toISOString() }),
        },
      )
      if (!trava.ok || (await trava.json()).length === 0) continue

      // Segunda conferência de supressão: entre preparar e enviar, a pessoa pode
      // ter descadastrado pelo link de outra campanha.
      const rsup = await rest(
        `email_supressao?email=eq.${encodeURIComponent(alvo.email)}&select=email`,
      )
      if (rsup.ok && (await rsup.json()).length > 0) {
        await rest(`email_campanha_alvos?id=eq.${encodeURIComponent(alvo.id)}`, {
          method: 'PATCH',
          body: JSON.stringify({ status: 'suprimido', erro: 'na lista de supressão', locked_at: null, locked_by: null }),
        })
        continue
      }

      const t = await tokenDescadastro(campanha.id, alvo.email, s.EMAIL_DISPARO_SECRET || '')
      const link = `${origemPublica}/functions/v1/email-campanha/descadastrar` +
        `?c=${encodeURIComponent(campanha.id)}&e=${encodeURIComponent(alvo.email)}&t=${t}`

      const r = await enviarUm(token, campanha, alvo, link, remetente)

      await rest(`email_campanha_alvos?id=eq.${encodeURIComponent(alvo.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({
          status: r.ok ? 'enviado' : 'falhou',
          enviado_em: r.ok ? new Date().toISOString() : null,
          erro: r.erro ?? null,
          tentativas: 1,
          locked_by: null,
          locked_at: null,
        }),
      })

      if (r.ok) enviados++
      else falhas++

      // Pausa longa a cada bloco: uma sequência de 200 envios sem respiro é
      // padrão de máquina, mesmo com intervalo variável entre eles.
      if (enviados > 0 && enviados % Number(campanha.pausa_a_cada ?? 25) === 0) {
        await dormir(Number(campanha.pausa_longa_ms ?? 60_000))
      } else {
        await dormir(intervalo(campanha))
      }
    }

    // Acabou a fila?
    const rrest = await rest(
      `email_campanha_alvos?campaign_id=eq.${encodeURIComponent(campanha.id)}&status=eq.pendente&select=id&limit=1`,
    )
    const aindaTem = rrest.ok && (await rrest.json()).length > 0
    if (!aindaTem) {
      await rest(`email_campanhas?id=eq.${encodeURIComponent(campanha.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'concluida', concluido_em: new Date().toISOString() }),
      })
    }

    return json({ campanha: campanha.id, enviados, falhas, concluida: !aindaTem })
  }

  return json({ error: 'Rota desconhecida' }, 404)
})
