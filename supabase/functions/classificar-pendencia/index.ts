import "jsr:@supabase/functions-js/edge-runtime.d.ts"

/**
 * ETAPA 3 — a Groq decide o que realmente pede resposta.
 *
 * Nem toda mensagem recebida é uma cobrança em cima do time. "Obrigada!", "ok",
 * "perfeito, era isso" encerram o assunto — se contarem, o time é cobrado por
 * atraso que não existe e a média de tempo de resposta fica pior do que a
 * realidade. Esta função lê a mensagem e devolve uma de três etiquetas.
 *
 * QUANDO É CHAMADA: no marco dos 2 MINUTOS, pelo cron da Etapa 4 — não a cada
 * mensagem que chega. Mensagem respondida antes disso não precisa de julgamento
 * (já foi atendida rápido), e classificar tudo seria uma chamada de IA por
 * mensagem recebida. No volume atual isso corta a grande maioria das chamadas.
 *
 * FALHA NÃO BLOQUEIA: se a Groq cair, `requires_reply` fica `null`, e quem lê
 * trata `null` como "pede resposta". Cobrar à toa é menos grave do que deixar um
 * cliente esperando porque a IA estava fora do ar.
 *
 * Mesma `GROQ_KEY` e mesmo `GROQ_MODEL` de `ai-message-assist`.
 */

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || ''
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
const GROQ_KEY = Deno.env.get('GROQ_KEY') || ''
const GROQ_MODEL = Deno.env.get('GROQ_MODEL') || 'openai/gpt-oss-120b'

/**
 * Sonda de deploy. As edge functions do self-hosted são servidas por VOLUME:
 * conferir o arquivo dentro do container mostra o que está em disco, não o que o
 * isolate do Deno está executando. Este marcador volta no corpo da resposta e é a
 * única checagem que prova qual código está rodando. TROCAR A CADA DEPLOY.
 */
const BUILD_MARKER = 'classificar-pendencia-2026-08-25'

/** Quantas pendências por rodada. Segura o custo se algo represar a fila. */
const LOTE_MAXIMO = 20

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify({ ...body, build: BUILD_MARKER }), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

const PROMPT = `Você classifica mensagens recebidas por uma clínica de diagnóstico por imagem no WhatsApp.

Responda APENAS com uma destas três palavras, em minúsculas, sem pontuação e sem explicar:

pergunta - a mensagem espera alguma coisa do atendimento: dúvida, pedido, reclamação, envio de documento, confirmação de horário, ou qualquer assunto em aberto.
agradecimento - a mensagem é só cortesia: "obrigada", "ok", "perfeito", "valeu", emoji de positivo. Nada em aberto.
encerramento - a mensagem fecha o assunto: "era só isso", "pode encerrar", "resolvido", "até mais". Nada em aberto.

Na dúvida, responda pergunta: deixar um cliente esperando é pior do que cobrar o time à toa.`

/** Só 'agradecimento' e 'encerramento' dispensam resposta. */
function precisaResposta(etiqueta: string): boolean {
  return etiqueta !== 'agradecimento' && etiqueta !== 'encerramento'
}

/**
 * Provedores compatíveis com a API da OpenAI já mudaram o contrato de raciocínio
 * antes — a limpeza de `<think>` é rede de segurança, não zelo.
 */
function limpar(bruto: string): string {
  return bruto
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .trim()
    .toLowerCase()
}

async function classificar(texto: string): Promise<string | null> {
  const resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${GROQ_KEY}`,
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      // Baixa de propósito: classificar em três caixas não é tarefa criativa, e
      // variação aqui só produziria etiqueta instável para a mesma frase.
      temperature: 0,
      max_tokens: 10,
      messages: [
        { role: 'system', content: PROMPT },
        { role: 'user', content: texto.slice(0, 1500) },
      ],
      // Ver o comentário em `ai-message-assist`: `gpt-oss-120b` é modelo de
      // raciocínio e sem estes dois campos devolve o pensamento junto.
      reasoning_effort: 'low',
      include_reasoning: false,
    }),
  })

  if (!resp.ok) return null

  const json = await resp.json()
  const etiqueta = limpar(json?.choices?.[0]?.message?.content ?? '')
  if (etiqueta === 'pergunta' || etiqueta === 'agradecimento' || etiqueta === 'encerramento') {
    return etiqueta
  }
  // Etiqueta fora do combinado é o mesmo que não ter resposta: devolve null e a
  // pendência segue como "pede resposta".
  return null
}

async function rest(caminho: string, init: RequestInit = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${caminho}`, {
    ...init,
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  })
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders })
  if (req.method !== 'POST') return jsonResponse({ error: 'method not allowed' }, 405)
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return jsonResponse({ error: 'Supabase credentials not configured' }, 500)
  }
  if (!GROQ_KEY) return jsonResponse({ error: 'GROQ_KEY not configured' }, 500)

  // Pendências abertas, ainda sem etiqueta, esperando há mais de 2 minutos.
  // O join traz o texto da mensagem — em áudio, a transcrição serve igual.
  const busca = await rest(
    'conversation_pendencias?select=id,inbound_message_id,messages!inbound_message_id(content,transcription)' +
      '&responded_at=is.null&requires_reply=is.null' +
      `&inbound_at=lt.${new Date(Date.now() - 120_000).toISOString()}` +
      `&order=inbound_at.asc&limit=${LOTE_MAXIMO}`,
  )

  if (!busca.ok) {
    return jsonResponse({ error: 'Falha ao ler pendências: ' + (await busca.text()) }, 502)
  }

  const pendencias = await busca.json()
  if (!Array.isArray(pendencias) || pendencias.length === 0) {
    return jsonResponse({ classificadas: 0, motivo: 'nada na fila' })
  }

  let classificadas = 0
  let semTexto = 0
  let falhas = 0

  for (const p of pendencias) {
    const msg = p.messages ?? {}
    const texto: string = (msg.content || msg.transcription || '').trim()

    // Mídia sem legenda e sem transcrição: não há o que julgar. Marca como
    // "pede resposta" — foto de exame ou documento é justamente o caso em que o
    // cliente mais espera retorno.
    if (!texto) {
      await rest(`conversation_pendencias?id=eq.${p.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          requires_reply: true,
          classification: 'pergunta',
          classified_at: new Date().toISOString(),
        }),
      })
      semTexto++
      continue
    }

    const etiqueta = await classificar(texto)
    if (!etiqueta) {
      falhas++
      continue // fica `null`: quem lê trata como "pede resposta"
    }

    await rest(`conversation_pendencias?id=eq.${p.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        requires_reply: precisaResposta(etiqueta),
        classification: etiqueta,
        classified_at: new Date().toISOString(),
      }),
    })
    classificadas++
  }

  return jsonResponse({ classificadas, semTexto, falhas, lote: pendencias.length })
})
