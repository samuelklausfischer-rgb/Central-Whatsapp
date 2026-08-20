import "jsr:@supabase/functions-js/edge-runtime.d.ts"

// ITEM 12 (áudio recebido) e ITEM 11 (revisar antes de enviar): as DUAS
// funcionalidades passam pela MESMA transcrição — mesmo provedor (Groq, já
// usado em `ai-message-assist`), mesmo modelo, mesmo tratamento de erro. Uma
// função só, com dois formatos de entrada, evita duplicar essa lógica.
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || ''
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
const GROQ_KEY = Deno.env.get('GROQ_KEY') || ''

// `whisper-large-v3-turbo`: é o modelo de transcrição da Groq mais rápido com
// suporte multilíngue de verdade (o `distil-whisper-large-v3-en` é só
// inglês, não serve). A velocidade importa nos dois usos — item 12 não pode
// atrasar a ingestão, item 11 tem a pessoa esperando na tela para revisar o
// texto antes de enviar. `language: 'pt'` força português: sem isso a Groq
// tenta detectar o idioma sozinha, e áudio curto ou com ruído de fundo já
// saiu identificado como outro idioma em teste manual.
const GROQ_MODEL = 'whisper-large-v3-turbo'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function sbHeaders() {
  return {
    apikey: SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
    'Content-Type': 'application/json',
  }
}

/**
 * Chama a Groq (`/openai/v1/audio/transcriptions`, compatível com a API da
 * OpenAI/Whisper) com os bytes do áudio. Nunca lança: quem chama decide o
 * que fazer com `{ error }` — no caminho do webhook isso vira
 * `transcription_status = 'failed'`, nunca uma exceção que poderia derrubar
 * outra coisa.
 */
async function transcreverBytes(
  bytes: Uint8Array,
  filename: string,
  mime: string,
): Promise<{ text: string } | { error: string }> {
  try {
    const form = new FormData()
    form.append('file', new Blob([bytes], { type: mime || 'application/octet-stream' }), filename)
    form.append('model', GROQ_MODEL)
    form.append('language', 'pt')
    form.append('response_format', 'json')

    const resp = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${GROQ_KEY}` },
      body: form,
    })

    if (!resp.ok) {
      const errText = await resp.text().catch(() => '')
      return { error: `Groq HTTP ${resp.status}: ${errText.slice(0, 500)}` }
    }

    const data = await resp.json().catch(() => null)
    const text = typeof data?.text === 'string' ? data.text.trim() : ''
    return { text }
  } catch (err) {
    return { error: String(err) }
  }
}

/**
 * ITEM 12: áudio já salvo (mensagem recebida) — chamada pelo
 * `evolution-webhook`, de forma assíncrona (ver `dispararTranscricao` lá).
 * Body: `{ message_id, audio_url }`. Baixa o áudio do Storage, transcreve, e
 * grava o resultado direto na linha da mensagem via service role.
 *
 * SEMPRE devolve 200: quem chama não trata o corpo da resposta (é
 * fire-and-forget), então um status de erro aqui não muda nada — só o log
 * desta função importa para diagnosticar.
 */
async function transcreverMensagemSalva(messageId: string, audioUrl: string): Promise<Response> {
  const marcarStatus = async (status: 'ready' | 'failed', transcription?: string) => {
    await fetch(`${SUPABASE_URL}/rest/v1/messages?id=eq.${messageId}`, {
      method: 'PATCH',
      headers: sbHeaders(),
      body: JSON.stringify(
        status === 'ready' ? { transcription, transcription_status: 'ready' } : { transcription_status: 'failed' },
      ),
    }).catch((err) => {
      console.warn(JSON.stringify({ scope: 'audio_transcribe', stage: 'patch_falhou', messageId, error: String(err) }))
    })
  }

  try {
    const mediaResp = await fetch(audioUrl)
    if (!mediaResp.ok) {
      console.warn(JSON.stringify({ scope: 'audio_transcribe', stage: 'download_falhou', messageId, status: mediaResp.status }))
      await marcarStatus('failed')
      return jsonResponse({ status: 'error', reason: 'download_failed' })
    }

    const mime = mediaResp.headers.get('content-type') || 'audio/ogg'
    const bytes = new Uint8Array(await mediaResp.arrayBuffer())
    const resultado = await transcreverBytes(bytes, 'audio.ogg', mime)

    if ('error' in resultado) {
      console.warn(JSON.stringify({ scope: 'audio_transcribe', stage: 'groq_falhou', messageId, error: resultado.error }))
      await marcarStatus('failed')
      return jsonResponse({ status: 'error', reason: resultado.error })
    }

    if (!resultado.text) {
      // Groq respondeu OK mas sem texto (áudio silencioso, música sem fala).
      // Não é bem uma FALHA, mas também não há nada para mostrar — mesmo
      // tratamento de 'failed' do lado da UI (nunca mostra caixa vazia).
      await marcarStatus('failed')
      return jsonResponse({ status: 'ignored', reason: 'empty_transcription' })
    }

    await marcarStatus('ready', resultado.text)
    console.log(JSON.stringify({ scope: 'audio_transcribe', stage: 'concluido', messageId, chars: resultado.text.length }))
    return jsonResponse({ status: 'success' })
  } catch (err) {
    console.warn(JSON.stringify({ scope: 'audio_transcribe', stage: 'excecao', messageId, error: String(err) }))
    await marcarStatus('failed')
    return jsonResponse({ status: 'error', reason: 'unhandled' })
  }
}

/**
 * ITEM 11: transcreve um áudio ainda NÃO enviado — a pessoa acabou de gravar
 * e quer revisar o texto antes de mandar. Body: multipart/form-data com o
 * blob gravado no campo `file`. Não grava nada no banco (a mensagem nem
 * existe ainda): só devolve `{ text }` para o compositor colocar no campo de
 * mensagem, editável.
 */
async function transcreverUpload(req: Request): Promise<Response> {
  const form = await req.formData().catch(() => null)
  const file = form?.get('file')
  if (!(file instanceof File) && !(file instanceof Blob)) {
    return jsonResponse({ error: 'arquivo de áudio ausente' }, 400)
  }

  const bytes = new Uint8Array(await file.arrayBuffer())
  const mime = (file as File).type || 'audio/webm'
  const resultado = await transcreverBytes(bytes, 'audio.webm', mime)

  if ('error' in resultado) {
    return jsonResponse({ error: resultado.error }, 502)
  }
  if (!resultado.text) {
    return jsonResponse({ error: 'A transcrição voltou vazia' }, 422)
  }
  return jsonResponse({ text: resultado.text })
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders })
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'method not allowed' }, 405)
  }
  if (!GROQ_KEY) {
    return jsonResponse({ error: 'GROQ_KEY not configured' }, 500)
  }

  const contentType = req.headers.get('content-type') || ''

  try {
    if (contentType.includes('multipart/form-data')) {
      return await transcreverUpload(req)
    }

    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
      return jsonResponse({ error: 'Supabase credentials not configured' }, 500)
    }

    const body = await req.json().catch(() => null)
    const messageId = body?.message_id
    const audioUrl = body?.audio_url
    if (!messageId || !audioUrl) {
      return jsonResponse({ error: 'message_id e audio_url são obrigatórios' }, 400)
    }

    return await transcreverMensagemSalva(String(messageId), String(audioUrl))
  } catch (err) {
    // Mesma rede de segurança do webhook principal: uma exceção aqui não
    // pode virar 500 destrambelhado no log de quem chama.
    console.error(JSON.stringify({ scope: 'audio_transcribe', stage: 'falha_nao_tratada', error: String(err) }))
    return jsonResponse({ status: 'error', reason: 'unhandled' }, 200)
  }
})
