/**
 * Traz para o Central Whats os nomes REAIS da agenda dos celulares.
 *
 * POR QUE NÃO É IMPORTAÇÃO DE ARQUIVO
 * A ideia original era exportar um `.vcf` do celular. Medido em 07/08/2026: dos
 * 257 contatos de um export desses, ZERO existiam em `contacts` — nem casando
 * pelos últimos 8 dígitos, que é imune a 9º dígito e DDD. O motivo não é o
 * arquivo estar errado (100% dos seus contatos estão mesmo na agenda daquele
 * aparelho): é que `contacts` só ganha linha para quem TROCOU MENSAGEM pela
 * plataforma. A agenda tem gente que nunca conversou por aqui.
 *
 * A própria Evolution já guarda a agenda inteira de cada instância — 4.762
 * contatos com nome só na Adm, contra 257 do arquivo — indexada por JID e
 * cobrindo LID. Isso é o que decide: 676 dos 1.047 contatos sem nome no banco
 * são LID, e LID não tem telefone para casar com arquivo nenhum.
 *
 * A REGRA
 * Sobrescreve o nome de quem está na agenda (`isSaved`); quem não está fica
 * exatamente como está. `isSaved` é justamente "está na lista de contatos do
 * celular", em oposição a desconhecido que só mandou mensagem.
 *
 * POR QUE TRAVA O NOME (`name_locked = true`)
 * O webhook sobrescreve `name` a cada mensagem com o `pushName` que o CONTATO
 * transmite — que é o nome de perfil dele, não o que está salvo na agenda
 * (`evolution-webhook/index.ts:111`). Sem travar, o nome importado duraria até a
 * próxima mensagem daquela pessoa. Travar é o mesmo que o app já faz quando
 * alguém renomeia um contato pela interface (`src/services/contacts.ts:104`).
 * Efeito colateral aceito: esses contatos param de acompanhar mudanças de nome
 * de perfil — que é exatamente o que se está pedindo ao trazer o nome da agenda.
 *
 * USO
 *   node scripts/importar-contatos-celular/renomear-contatos.mjs            # ensaio
 *   node scripts/importar-contatos-celular/renomear-contatos.mjs --aplicar  # grava
 *
 * Exige no ambiente:
 *   SUPABASE_URL                (ex.: https://apps-supabase.srofjl.easypanel.host)
 *   SUPABASE_SERVICE_ROLE_KEY   (a chave de serviço — NÃO a anon)
 * As credenciais da Evolution são lidas da tabela `secrets`, o mesmo caminho que
 * as edge functions usam (`evolution-instances/index.ts:161`).
 */

const APLICAR = process.argv.includes('--aplicar')
const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/+$/, '')
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Faltam SUPABASE_URL e/ou SUPABASE_SERVICE_ROLE_KEY no ambiente.')
  process.exit(1)
}

const headers = {
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
  'Content-Type': 'application/json',
}

/** PostgREST corta em 1000 linhas por padrão e o corte é SILENCIOSO. */
const PAGINA = 1000

async function rest(caminho) {
  const linhas = []
  for (let inicio = 0; ; inicio += PAGINA) {
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/${caminho}`, {
      headers: { ...headers, Range: `${inicio}-${inicio + PAGINA - 1}` },
    })
    if (!resp.ok) throw new Error(`GET ${caminho} → ${resp.status} ${await resp.text()}`)
    const lote = await resp.json()
    linhas.push(...lote)
    if (lote.length < PAGINA) return linhas
  }
}

async function configEvolution() {
  const linhas = await rest('secrets?select=key,value')
  const mapa = Object.fromEntries(linhas.map((l) => [l.key, l.value]))
  const url = (mapa.EVOLUTION_API_URL || '').replace(/\/+$/, '')
  const chave = mapa.EVOLUTION_API_KEY || ''
  if (!url || !chave) throw new Error('EVOLUTION_API_URL/KEY ausentes na tabela secrets')
  return { url, chave }
}

async function evolution({ url, chave }, metodo, caminho, corpo) {
  const resp = await fetch(`${url}${caminho}`, {
    method: metodo,
    headers: { apikey: chave, 'Content-Type': 'application/json' },
    body: corpo ? JSON.stringify(corpo) : undefined,
  })
  if (!resp.ok) throw new Error(`${metodo} ${caminho} → ${resp.status} ${await resp.text()}`)
  return resp.json()
}

/**
 * Um nome só vale se identificar uma PESSOA. Rejeita o que é o próprio número
 * disfarçado — inclusive o caso real encontrado na agenda: `51E+12 5`, telefone
 * que passou por Excel e voltou em notação científica. A checagem "só dígitos e
 * pontuação" não pegaria esse, porque tem a letra E.
 */
function nomeUtil(bruto, jid) {
  const nome = String(bruto ?? '').trim()
  if (nome.length < 2) return null
  if (/^[\d\s.,+()\-eE]+$/.test(nome)) return null
  const soDigitos = nome.replace(/\D/g, '')
  if (soDigitos.length >= 8 && jid.includes(soDigitos)) return null
  if (!/\p{L}{2}/u.test(nome)) return null
  return nome
}

const semSufixo = (jid) => String(jid ?? '').replace(/@.*$/, '')

async function main() {
  console.log(APLICAR ? '=== APLICANDO ===\n' : '=== ENSAIO (nada será gravado) ===\n')

  const cfg = await configEvolution()
  const instancias = await evolution(cfg, 'GET', '/instance/fetchInstances')
  console.log(`Instâncias na Evolution: ${instancias.length}`)

  /** jid → { nome, instancia, atualizadoEm }, guardando também os conflitos. */
  const agenda = new Map()
  const conflitos = []

  for (const inst of instancias) {
    const nomeInst = inst.name
    let contatos
    try {
      contatos = await evolution(cfg, 'POST', `/chat/findContacts/${encodeURIComponent(nomeInst)}`, {})
    } catch (err) {
      console.warn(`  ! ${nomeInst}: não deu para ler a agenda (${err.message.slice(0, 80)})`)
      continue
    }

    let aproveitados = 0
    for (const c of contatos) {
      // `isSaved` é a regra pedida: só entra quem está na lista de contatos.
      if (!c.isSaved) continue
      const jid = semSufixo(c.remoteJid)
      if (!jid || String(c.remoteJid).endsWith('@g.us')) continue
      const nome = nomeUtil(c.pushName, jid)
      if (!nome) continue

      aproveitados++
      const atual = agenda.get(jid)
      if (!atual) {
        agenda.set(jid, { nome, instancia: nomeInst, atualizadoEm: c.updatedAt || '' })
        continue
      }
      if (atual.nome === nome) continue

      // Mesma pessoa salva com nomes diferentes em aparelhos diferentes. Fica
      // com o registro mais recente da Evolution — e o conflito é RELATADO, não
      // resolvido em silêncio.
      conflitos.push({ jid, a: atual, b: { nome, instancia: nomeInst } })
      if ((c.updatedAt || '') > atual.atualizadoEm) {
        agenda.set(jid, { nome, instancia: nomeInst, atualizadoEm: c.updatedAt || '' })
      }
    }
    console.log(`  ${nomeInst}: ${contatos.length} na agenda, ${aproveitados} com nome utilizável`)
  }

  console.log(`\nNomes distintos reunidos: ${agenda.size}`)

  const contatos = await rest('contacts?select=id,remote_jid,name,name_locked')
  console.log(`Contatos no banco: ${contatos.length}\n`)

  const mudar = []
  let iguais = 0
  let travados = 0
  let foraDaAgenda = 0

  for (const c of contatos) {
    if (String(c.remote_jid).endsWith('@g.us')) continue
    const alvo = agenda.get(semSufixo(c.remote_jid))
    if (!alvo) {
      foraDaAgenda++
      continue
    }
    if (c.name_locked) {
      travados++
      continue
    }
    if ((c.name ?? '').trim() === alvo.nome) {
      iguais++
      continue
    }
    mudar.push({ id: c.id, jid: c.remote_jid, de: c.name, para: alvo.nome, instancia: alvo.instancia })
  }

  const semNomeAntes = contatos.filter(
    (c) => !String(c.remote_jid).endsWith('@g.us') &&
      (!c.name || !c.name.trim() || /^\d+$/.test(c.name)),
  ).length
  const ganhamNome = mudar.filter((m) => !m.de || !m.de.trim() || /^\d+$/.test(m.de)).length

  console.log('--- Resumo ---')
  console.log(`  a renomear .................. ${mudar.length}`)
  console.log(`    destes, hoje sem nome útil  ${ganhamNome}  (de ${semNomeAntes} sem nome no total)`)
  console.log(`  já iguais ................... ${iguais}`)
  console.log(`  travados (name_locked) ...... ${travados}`)
  console.log(`  fora da agenda (intocados) .. ${foraDaAgenda}`)
  if (conflitos.length) {
    console.log(`  conflitos entre aparelhos ... ${conflitos.length}`)
    for (const k of conflitos.slice(0, 10)) {
      console.log(`      ${k.jid}: "${k.a.nome}" (${k.a.instancia}) vs "${k.b.nome}" (${k.b.instancia})`)
    }
    if (conflitos.length > 10) console.log(`      ... e mais ${conflitos.length - 10}`)
  }

  console.log('\n--- Amostra do que muda (30 primeiros) ---')
  for (const m of mudar.slice(0, 30)) {
    console.log(`  ${m.jid}: ${JSON.stringify(m.de)} → ${JSON.stringify(m.para)}   [${m.instancia}]`)
  }

  if (!APLICAR) {
    console.log('\nEnsaio terminado. Nada foi gravado. Rode com --aplicar para gravar.')
    return
  }

  console.log(`\nGravando ${mudar.length} nomes...`)
  let ok = 0
  const falhas = []
  for (const m of mudar) {
    // `name_locked: true` junto — senão o webhook desfaz na próxima mensagem.
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/contacts?id=eq.${m.id}`, {
      method: 'PATCH',
      headers: { ...headers, Prefer: 'return=minimal' },
      body: JSON.stringify({ name: m.para, name_locked: true, updated_at: new Date().toISOString() }),
    })
    if (resp.ok) ok++
    else falhas.push(`${m.jid}: ${resp.status} ${await resp.text()}`)
  }

  console.log(`Gravados: ${ok}/${mudar.length}`)
  if (falhas.length) {
    console.log('Falhas:')
    falhas.slice(0, 20).forEach((f) => console.log(`  ${f}`))
  }
}

main().catch((err) => {
  console.error('\nERRO:', err.message)
  process.exit(1)
})
