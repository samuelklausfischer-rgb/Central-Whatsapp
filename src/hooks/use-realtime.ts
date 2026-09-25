import { useEffect, useRef } from 'react'
import type { RealtimePostgresChangesPayload } from '@supabase/supabase-js'
import supabase from '@/lib/supabase/client'

export interface RecordSubscription<T> {
  action: 'create' | 'update' | 'delete'
  record: T
}

/**
 * FASE 0 do conserto de 02/09 (canais Realtime duplicados sobrecarregando o
 * Postgres compartilhado). `TABELAS_COMPARTILHADAS` começa VAZIO — toda
 * chamada continua passando por `assinarSozinho`, cópia fiel do
 * comportamento de sempre (um canal Supabase próprio por chamada, nome com
 * sufixo aleatório). Isto isola "quebrou o refactor" de "quebrou o
 * compartilhamento": esta fase publica sozinha, sem nenhuma mudança
 * observável, e só depois de confirmada é que uma tabela entra no Set.
 *
 * Ligar uma tabela aqui NÃO muda a assinatura pública do hook nem exige
 * tocar em nenhum call site — o compartilhamento vive inteiramente dentro
 * deste arquivo.
 *
 *   Fase 1a: 'labels', 'contact_tags' — handlers idempotentes ("recarrega
 *     tudo"), nenhum usa onSubscribed/aoReconectar. O teste mais limpo do
 *     mecanismo.
 *   Fase 1b: + 'devices' — primeiro teste real de assinante persistente
 *     (Layout) convivendo com assinante de rota (ChatHub/Index).
 *   Fase 2:  + 'messages' — única tabela onde os assinantes usam
 *     onSubscribed/aoReconectar DIFERENTES entre si; tratar em deploy
 *     separado, com atenção redobrada (ver plano).
 */
// Fase 1a ativa (03/09): as duas tabelas mais seguras — os 4 handlers
// envolvidos (ChatList + ChatWindow) são "recarrega tudo" idempotentes e
// nenhum usa onSubscribed/aoReconectar. Rollback = tirar daqui e redeployar.
const TABELAS_COMPARTILHADAS = new Set<string>(['labels', 'contact_tags'])

type Despachante = (data: RecordSubscription<any>) => void
type RefDe<T> = { current: T }

interface Assinante {
  // Guardamos os REF OBJECTS, não as funções cruas. O hook já mantém
  // `.current` atualizado a cada render (useRealtime, mais abaixo), então o
  // registro sempre enxerga a closure mais nova sem precisar re-registrar
  // nada a cada render — e sem acumular closures antigas.
  callbackRef: RefDe<Despachante>
  onSubscribedRef: RefDe<(() => void) | undefined>
  aoReconectarRef: RefDe<(() => void) | undefined>
  // POR ASSINANTE, não por canal: quem se registra DEPOIS da queda não
  // viveu o buraco e não deve receber `aoReconectar`; um flag único no
  // canal seria "consumido" pelo primeiro do loop, deixando os outros sem
  // aviso.
  jaCaiu: boolean
}

interface Entrada {
  tabela: string
  filtro?: string
  canal: ReturnType<typeof supabase.channel> | null
  // Verdadeiro do início de abrirCanal() até `canal` ser atribuído (ou a
  // entrada morrer no meio do caminho). Existe só por causa do `await` do
  // setAuth() dentro de abrirCanal() — ver o comentário lá para o porquê.
  abrindoCanal: boolean
  assinantes: Map<number, Assinante>
  inscrito: boolean
  retry: number
  timerRetry: ReturnType<typeof setTimeout> | null
  // Carência antes do teardown real, quando o último assinante sai. Não é
  // sobre manter o socket vivo — é sobre TAXA de criação de assinatura, a
  // métrica que estourou no incidente de 02/09 (~5/s em repouso, pico de
  // 36/s). Navegar Painel↔Chat, ou abrir/fechar conversa no celular em
  // menos de 5s, reaproveita o canal em vez de fechar-e-reabrir.
  timerEncerramento: ReturnType<typeof setTimeout> | null
  descartada: boolean
  removerListeners: (() => void) | null
}

// Escopo de MÓDULO — uma instância por aba do navegador, compartilhada entre
// todos os componentes montados naquela aba. A chave é tabela+filtro, nunca
// só tabela: nenhum dos call sites de hoje usa filtro (conferido), mas se
// algum dia alguém passar um, dois assinantes da mesma tabela com filtros
// DIFERENTES não podem compartilhar canal — juntar errado faria o filtro de
// quem montou primeiro valer pros dois, e o outro pararia de receber
// evento, em silêncio, sem erro nenhum.
const registro = new Map<string, Entrada>()
let proximoId = 1
const CARENCIA_MS = 5000

function chaveDe(tabela: string, filtro?: string): string {
  // JSON como chave, e não um separador: é inequívoco por construção (nenhuma
  // combinação de tabela+filtro produz a mesma string de outra) e é ASCII puro
  // no fonte. A primeira versão usava um NUL como separador e o caractere
  // acabou gravado CRU no arquivo — o git passou a tratar o .ts inteiro como
  // binário (sem diff, sem blame, sem merge). Não reintroduzir escapes aqui.
  return JSON.stringify([tabela, filtro ?? ''])
}

function eventoParaAcao(eventType: string): 'create' | 'update' | 'delete' {
  if (eventType === 'INSERT') return 'create'
  if (eventType === 'DELETE') return 'delete'
  return 'update'
}

function despacharParaTodos(entrada: Entrada, payload: RealtimePostgresChangesPayload<any>) {
  const acao = eventoParaAcao(payload.eventType)
  const record = payload.new || payload.old
  for (const assinante of entrada.assinantes.values()) {
    assinante.callbackRef.current({ action: acao, record })
  }
}

/**
 * Confirma que o `setAuth()` anterior REALMENTE aplicou o token no socket
 * do Realtime, e corrige UMA vez se não aplicou.
 *
 * Achado na revisão adversarial (o motivo de este código existir): por
 * baixo dos panos, `setAuth()` sem argumento chama o callback de
 * `accessToken` da supabase-js, que é `getSession()`. `getSession()`
 * adquire um lock via `navigator.locks` EXCLUSIVO por ORIGEM —
 * compartilhado entre TODAS as abas do mesmo domínio — com timeout de 5s
 * (auth-js `GoTrueClient.ts`, `_acquireLock`/`lockAcquireTimeout`). Se
 * outra aba estiver segurando esse lock por mais de 5s (a equipe usa
 * várias abas — ver nota no topo do arquivo sobre o incidente de 02/09 —
 * então isso VAI acontecer), o `getSession()` interno rejeita por
 * timeout. E `RealtimeClient._performAuth` ENGOLE essa rejeição num
 * try/catch e cai em `tokenToSend = this.accessTokenValue` (o valor
 * antigo, possivelmente `null`) — SEM relançar. Resultado: `setAuth()`
 * resolve com SUCESSO sem ter aplicado nada. O catch em volta do await
 * em `abrirCanal`/`subscribe` nunca dispara, e o canal nasceria anon de
 * novo, agora em silêncio total — o mesmo bug, invisível.
 *
 * Por isso comparamos aqui `accessTokenValue` (campo público e tipado em
 * `RealtimeClient`, ver `@supabase/realtime-js` `RealtimeClient.d.ts`:
 * `accessTokenValue: string | null`) com o token da sessão atual, e
 * tentamos `setAuth()` mais UMA vez se divergirem — sem laço. Se não
 * houver sessão nenhuma (usuário deslogado, tela de login), isso é o
 * ESPERADO — `accessTokenValue` null é correto ali — e não logamos nada,
 * para não gerar warning em toda renderização da tela de login.
 */
async function garantirTokenRealtime(rotulo: string): Promise<void> {
  try {
    const { data } = await supabase.auth.getSession()
    const session = data.session
    if (!session) return // deslogado: accessTokenValue null é o certo, não é falha
    if (supabase.realtime.accessTokenValue === session.access_token) return // já está certo

    console.warn(
      `${rotulo} token não aplicado ao socket; canal pode nascer mudo — tentando setAuth() mais uma vez`,
    )
    try {
      await supabase.realtime.setAuth()
    } catch (erroRetry) {
      console.error(`${rotulo} segunda tentativa de setAuth também falhou; seguindo mesmo assim`, erroRetry)
    }
  } catch (erro) {
    // getSession() pode rejeitar pelo MESMO motivo descrito acima (lock de
    // origem ocupado por outra aba). Sem sessão pra comparar não há o que
    // confirmar — seguimos mesmo assim (degradado é melhor que travar a
    // assinatura por causa de uma checagem que também pode falhar).
    console.error(`${rotulo} não foi possível confirmar a sessão após setAuth; seguindo mesmo assim`, erro)
  }
}

async function abrirCanal(entrada: Entrada) {
  if (entrada.descartada) return
  // Guarda de "abertura em andamento". O `await` do setAuth() logo abaixo
  // abre uma janela em que `entrada.canal` continua `null`; sem esta
  // guarda, uma segunda chamada concorrente (registrar() vendo "sem
  // canal", agendarReinscricao() ou reconectarSeParado() via
  // 'online'/'focus'/'visibilitychange', todos definidos neste arquivo)
  // enxergaria a mesma entrada "sem canal" e tentaria abrir OUTRO — o
  // canal duplicado que o refactor de 02/09 (ver comentário no topo do
  // arquivo) existe para evitar. Marcada ANTES do primeiro await e só
  // liberada depois que `entrada.canal` já foi atribuído (ou a entrada
  // morreu no meio do caminho).
  if (entrada.abrindoCanal) return
  entrada.abrindoCanal = true

  // TUDO que segue vai num try/catch/finally: `.subscribe()` chama
  // `socket.connect()` por baixo, que pode lançar SÍNCRONO (ex.:
  // `VITE_SUPABASE_URL` malformado joga "WebSocket not available" — já
  // aconteceu neste projeto). Sem o `finally`, uma exceção aqui deixaria
  // `entrada.abrindoCanal` travado em `true` PARA SEMPRE, e os três
  // chamadores (registrar(), agendarReinscricao(), reconectarSeParado())
  // virariam no-op silencioso, sem nunca mais tentar abrir canal nenhum.
  // O `catch` evita, além disso, que a rejeição escape como unhandled
  // promise rejection (abrirCanal() é async e ninguém dá await/catch nas
  // chamadas). A atribuição de `entrada.canal` fica DENTRO do try, então o
  // `finally` só libera a guarda depois que o canal (se deu certo) já
  // está atribuído — nunca antes.
  try {
    // Por que este await existe — bug do canal preso em claims_role='anon':
    // `RealtimeChannel.subscribe()` lê `socket.accessTokenValue` de forma
    // SÍNCRONA ao montar o `phx_join` (realtime-js RealtimeChannel.js:130).
    // Em supabase-js, `_handleTokenChanged` só reage a TOKEN_REFRESHED e
    // SIGNED_IN — nunca a INITIAL_SESSION — e mesmo quando reage, dispara
    // `realtime.setAuth(token)` SEM esperar a conclusão. Se o `.subscribe()`
    // abaixo corresse antes da sessão do Supabase Auth resolver, o
    // `phx_join` sairia sem JWT, o servidor gravaria `claims_role='anon'` e
    // a RLS de `messages` (exige `auth.uid()`) passaria a devolver zero
    // linhas — o canal reporta SUBSCRIBED e nunca mais recebe evento, mesmo
    // depois do token chegar (o `setAuth` tardio da troca de token é
    // ignorado enquanto o canal está 'joining', e o que dispara ao fim do
    // join morre na guarda `accessTokenValue == tokenToSend` porque o valor
    // já tinha sido setado como anon). `setAuth()` chamado SEM argumento
    // reexecuta o callback interno da supabase-js que aguarda
    // `getSession()` — aguardá-lo aqui garante `accessTokenValue` correto
    // ANTES da leitura síncrona dentro de `.subscribe()`. Se a sessão já
    // estava certa, a guarda interna do socket torna isto um no-op barato.
    try {
      await supabase.realtime.setAuth()
    } catch (erro) {
      // setAuth() NÃO pode derrubar a assinatura — a própria supabase-js não
      // trata rejeição nesse caminho, e um canal degradado (talvez ainda
      // anon) é melhor que nenhum canal. Só registramos e seguimos.
      console.error('[use-realtime] setAuth falhou antes de abrir canal; seguindo mesmo assim', erro)
    }

    // setAuth() pode ter "resolvido com sucesso" sem aplicar nada (lock de
    // sessão ocupado por outra aba — ver comentário de garantirTokenRealtime).
    // Confirma e corrige antes de seguir.
    await garantirTokenRealtime('[use-realtime]')

    // Entre os awaits acima e aqui a entrada pode ter sido descartada
    // (último assinante saiu e a carência expirou, componente desmontou).
    // Sem este re-check criaríamos canal para uma entrada já morta.
    if (entrada.descartada) return

    const channelName = `${entrada.tabela}-changes-${Math.random().toString(36).slice(2)}`
    entrada.canal = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: entrada.tabela,
          ...(entrada.filtro ? { filter: entrada.filtro } : {}),
        },
        (payload) => despacharParaTodos(entrada, payload),
      )
      .subscribe((status) => {
        if (entrada.descartada) return
        if (status === 'SUBSCRIBED') {
          entrada.inscrito = true
          entrada.retry = 0
          // Fan-out para TODOS os registrados: se o canal caiu, o dado de
          // todo mundo pode estar desatualizado, não só o de quem estava
          // olhando quando caiu.
          for (const assinante of [...entrada.assinantes.values()]) {
            assinante.onSubscribedRef.current?.()
            if (assinante.jaCaiu) {
              assinante.jaCaiu = false
              assinante.aoReconectarRef.current?.()
            }
          }
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          entrada.inscrito = false
          for (const assinante of entrada.assinantes.values()) assinante.jaCaiu = true
          agendarReinscricao(entrada)
        }
      })

    // Os listeners de reconexão vivem por ENTRADA (uma vez, não um por
    // assinante) — anexados na primeira vez que o canal abre, removidos só
    // quando a entrada é descartada de vez.
    if (!entrada.removerListeners) {
      const reconectarSeParado = () => {
        if (entrada.descartada || entrada.inscrito) return
        if (entrada.timerRetry) {
          clearTimeout(entrada.timerRetry)
          entrada.timerRetry = null
        }
        entrada.retry = 0
        if (entrada.canal) {
          supabase.removeChannel(entrada.canal)
          entrada.canal = null
        }
        abrirCanal(entrada)
      }
      const aoFicarVisivel = () => {
        if (document.visibilityState === 'visible') reconectarSeParado()
      }
      window.addEventListener('online', reconectarSeParado)
      window.addEventListener('focus', reconectarSeParado)
      document.addEventListener('visibilitychange', aoFicarVisivel)
      entrada.removerListeners = () => {
        window.removeEventListener('online', reconectarSeParado)
        window.removeEventListener('focus', reconectarSeParado)
        document.removeEventListener('visibilitychange', aoFicarVisivel)
      }
    }
  } catch (erro) {
    // Cobre o throw SÍNCRONO de `.channel()...subscribe()` (ver comentário
    // grande acima). Todo chamador já zera `entrada.canal` antes de invocar
    // abrirCanal(), e a atribuição de `entrada.canal` nunca chega a rodar
    // quando o lado direito lança — mas fixamos `null` aqui explicitamente
    // por clareza, para não depender desse invariante externo.
    entrada.canal = null
    console.error(
      '[use-realtime] falha ao abrir canal; sem canal até a próxima tentativa (registrar/reconexão)',
      erro,
    )
  } finally {
    // Libera a guarda em QUALQUER saída (sucesso, `return` por descartada,
    // ou exceção) — é isso que impede o travamento permanente do defeito
    // 1. Como está em `finally` e a atribuição de `entrada.canal` está
    // DENTRO do try, nunca liberamos a guarda antes do canal existir.
    entrada.abrindoCanal = false
  }
}

function agendarReinscricao(entrada: Entrada) {
  if (entrada.descartada || entrada.timerRetry) return
  const delay = Math.min(1000 * 2 ** entrada.retry, 15000)
  entrada.retry++
  entrada.timerRetry = setTimeout(() => {
    entrada.timerRetry = null
    if (entrada.descartada) return
    if (entrada.canal) {
      supabase.removeChannel(entrada.canal)
      entrada.canal = null
    }
    abrirCanal(entrada)
  }, delay)
}

function descartarEntrada(entrada: Entrada) {
  entrada.descartada = true
  if (entrada.timerRetry) clearTimeout(entrada.timerRetry)
  entrada.removerListeners?.()
  if (entrada.canal) supabase.removeChannel(entrada.canal)
}

function registrar(tabela: string, filtro: string | undefined, assinante: Assinante): () => void {
  const chave = chaveDe(tabela, filtro)
  let entrada = registro.get(chave)

  if (!entrada) {
    entrada = {
      tabela,
      filtro,
      canal: null,
      abrindoCanal: false,
      assinantes: new Map(),
      inscrito: false,
      retry: 0,
      timerRetry: null,
      timerEncerramento: null,
      descartada: false,
      removerListeners: null,
    }
    registro.set(chave, entrada)
  }

  // Alguém voltou dentro da carência: cancela o encerramento adiado e reusa
  // o canal em vez de recriar.
  if (entrada.timerEncerramento) {
    clearTimeout(entrada.timerEncerramento)
    entrada.timerEncerramento = null
  }

  const id = proximoId++
  entrada.assinantes.set(id, assinante)

  if (!entrada.canal) {
    abrirCanal(entrada)
  } else if (entrada.inscrito) {
    // Entrou num canal JÁ inscrito ("late joiner"). Hoje todo mount ganha
    // canal novo e por isso SEMPRE recebe `onSubscribed` — sem este replay,
    // dois call sites reais quebrariam em silêncio: ChatHub.tsx (contacts)
    // refaz o fetch inicial no onSubscribed pra fechar a janela do
    // handshake, e use-notificacoes-de-mensagem.ts recupera mensagem
    // perdida na reconexão. queueMicrotask + guarda de "ainda registrado"
    // evita chamar depois de um desregistro no mesmo instante.
    const entradaAtual = entrada
    queueMicrotask(() => {
      if (entradaAtual.assinantes.get(id) === assinante) {
        assinante.onSubscribedRef.current?.()
      }
    })
  }

  return () => desregistrar(chave, id)
}

function desregistrar(chave: string, id: number) {
  const entrada = registro.get(chave)
  if (!entrada) return
  entrada.assinantes.delete(id)
  if (entrada.assinantes.size > 0) return

  entrada.timerEncerramento = setTimeout(() => {
    if (entrada.assinantes.size > 0) return // alguém se registrou de novo dentro da carência
    registro.delete(chave)
    descartarEntrada(entrada)
  }, CARENCIA_MS)
}

/**
 * Caminho legado: cópia fiel e isolada do comportamento anterior ao
 * conserto de 02/09 — um canal Supabase próprio por chamada, com seus
 * próprios listeners e seu próprio backoff. Usado por toda tabela que
 * ainda não está em `TABELAS_COMPARTILHADAS`.
 */
function assinarSozinho<T extends Record<string, unknown>>(
  tableName: string,
  callbackRef: RefDe<(data: RecordSubscription<T>) => void>,
  filter: string | undefined,
  onSubscribedRef: RefDe<(() => void) | undefined>,
  aoReconectarRef: RefDe<(() => void) | undefined>,
): () => void {
  let channel: ReturnType<typeof supabase.channel> | null = null
  let retry = 0
  let retryTimer: ReturnType<typeof setTimeout> | null = null
  let disposed = false
  let joined = false
  // Mesmo papel de `entrada.abrindoCanal` em abrirCanal() (ver o
  // comentário grande lá para o mecanismo completo): impede que
  // scheduleResubscribe()/reconnectIfStale() reabram um segundo canal
  // enquanto este `subscribe()` ainda está esperando o `setAuth()` e
  // `channel` continua `null`.
  let abrindoCanal = false
  // Local ao ciclo de vida desta chamada (mount → unmount): marca se o
  // canal já passou por CHANNEL_ERROR/TIMED_OUT/CLOSED desde a última vez
  // que ficou SUBSCRIBED, para `aoReconectar` distinguir "primeira
  // inscrição" de "voltou depois de cair".
  let jaCaiu = false

  const handlePayload = (payload: RealtimePostgresChangesPayload<T>) => {
    callbackRef.current({
      action: eventoParaAcao(payload.eventType),
      record: (payload.new || payload.old) as T,
    })
  }

  const subscribe = async () => {
    if (disposed || abrindoCanal) return
    abrindoCanal = true

    // try/catch/finally pelo mesmo motivo de abrirCanal() (defeito 1 da
    // revisão adversarial): `.subscribe()` pode lançar SÍNCRONO
    // (`socket.connect()` joga se `VITE_SUPABASE_URL` estiver malformado).
    // Sem `finally`, `abrindoCanal` travaria em `true` para sempre e
    // `scheduleResubscribe()`/`reconnectIfStale()` virariam no-op mudo. A
    // atribuição de `channel` fica DENTRO do try, então o `finally` só
    // libera a guarda depois que `channel` já existe (ou a chamada foi
    // encerrada) — nunca antes.
    try {
      // Mesmo mecanismo e mesmo motivo do await em abrirCanal() (topo deste
      // arquivo): `messages` — a própria tabela que este caminho legado
      // atende — é a que mais sofre com claims_role='anon', porque sua RLS
      // de SELECT/UPDATE exige `auth.uid()`. Sem aguardar aqui, o join
      // síncrono do realtime-js pode sair antes da sessão resolver e o canal
      // fica mudo para sempre, reportando SUBSCRIBED.
      try {
        await supabase.realtime.setAuth()
      } catch (erro) {
        // Nunca derruba a assinatura: degradado (possivelmente anon) é
        // melhor que nenhuma assinatura.
        console.error(
          '[use-realtime] setAuth falhou antes de assinar (legado); seguindo mesmo assim',
          erro,
        )
      }

      // setAuth() pode ter "resolvido com sucesso" sem aplicar nada (lock de
      // sessão ocupado por outra aba) — ver comentário de garantirTokenRealtime.
      await garantirTokenRealtime('[use-realtime]')

      // Pode ter desmontado (cleanup chamado) enquanto esperávamos a sessão
      // resolver — sem este re-check criaríamos canal para uma chamada já
      // encerrada.
      if (disposed) return

      const channelName = `${tableName}-changes-${Math.random().toString(36).slice(2)}`
      channel = supabase
        .channel(channelName)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: tableName,
            ...(filter ? { filter } : {}),
          },
          handlePayload,
        )
        .subscribe((status) => {
          if (status === 'SUBSCRIBED') {
            joined = true
            retry = 0
            onSubscribedRef.current?.()
            // Só conta como reconexão se já tinha caído antes — o mount
            // inicial nunca dispara `aoReconectar`.
            if (jaCaiu) {
              jaCaiu = false
              aoReconectarRef.current?.()
            }
          } else if (
            status === 'CHANNEL_ERROR' ||
            status === 'TIMED_OUT' ||
            status === 'CLOSED'
          ) {
            joined = false
            jaCaiu = true
            scheduleResubscribe()
          }
        })
    } catch (erro) {
      // Cobre o throw síncrono de `.channel()...subscribe()`.
      channel = null
      console.error(
        '[use-realtime] falha ao assinar (legado); sem canal até a próxima tentativa',
        erro,
      )
    } finally {
      // Libera a guarda em QUALQUER saída — é isso que impede o travamento
      // permanente do defeito 1.
      abrindoCanal = false
    }
  }

  const scheduleResubscribe = () => {
    if (disposed || retryTimer) return
    const delay = Math.min(1000 * 2 ** retry, 15000)
    retry++
    retryTimer = setTimeout(() => {
      retryTimer = null
      if (disposed) return
      if (channel) {
        supabase.removeChannel(channel)
        channel = null
      }
      subscribe()
    }, delay)
  }

  // Quando a janela volta ao foco / a rede reconecta, só re-inscreve se o
  // canal não estiver saudável — evita churn de canais a cada foco.
  const reconnectIfStale = () => {
    if (disposed || joined) return
    if (retryTimer) {
      clearTimeout(retryTimer)
      retryTimer = null
    }
    retry = 0
    if (channel) {
      supabase.removeChannel(channel)
      channel = null
    }
    subscribe()
  }

  const onVisibility = () => {
    if (document.visibilityState === 'visible') reconnectIfStale()
  }

  subscribe()
  window.addEventListener('online', reconnectIfStale)
  window.addEventListener('focus', reconnectIfStale)
  document.addEventListener('visibilitychange', onVisibility)

  return () => {
    disposed = true
    if (retryTimer) clearTimeout(retryTimer)
    window.removeEventListener('online', reconnectIfStale)
    window.removeEventListener('focus', reconnectIfStale)
    document.removeEventListener('visibilitychange', onVisibility)
    if (channel) supabase.removeChannel(channel)
  }
}

export function useRealtime<T extends Record<string, unknown>>(
  tableName: string,
  callback: (data: RecordSubscription<T>) => void,
  enabled: boolean = true,
  filter?: string,
  // Opcional e por isso retrocompatível com todo call site existente que só
  // passa (tableName, callback[, enabled[, filter]]). Disparado toda vez que
  // o canal fica SUBSCRIBED (mount inicial e reconexões) — serve pra quem
  // precisa reconciliar um fetch inicial com o handshake assíncrono do
  // websocket, fechando a janela em que uma mudança chegaria entre os dois e
  // seria perdida em silêncio.
  onSubscribed?: () => void,
  // Também opcional e retrocompatível pelo mesmo motivo. Diferente de
  // `onSubscribed` (que dispara em toda inscrição, inclusive o mount),
  // `aoReconectar` SÓ dispara quando o canal volta a SUBSCRIBED depois de
  // ter caído (CHANNEL_ERROR, TIMED_OUT ou CLOSED) — nunca na primeira
  // inscrição. Motivo: `postgres_changes` não tem replay. Tudo que mudou no
  // banco enquanto o WebSocket estava fora do ar (o backoff chega a 15s)
  // nunca vira evento — some sem erro nenhum. Quem passa `aoReconectar`
  // normalmente usa o gancho para refazer a leitura por REST e fechar essa
  // janela.
  aoReconectar?: () => void,
) {
  const callbackRef = useRef(callback)
  callbackRef.current = callback
  const onSubscribedRef = useRef(onSubscribed)
  onSubscribedRef.current = onSubscribed
  const aoReconectarRef = useRef(aoReconectar)
  aoReconectarRef.current = aoReconectar

  useEffect(() => {
    if (!enabled) return

    if (TABELAS_COMPARTILHADAS.has(tableName)) {
      return registrar(tableName, filter, {
        callbackRef: callbackRef as unknown as RefDe<Despachante>,
        onSubscribedRef,
        aoReconectarRef,
        jaCaiu: false,
      })
    }

    return assinarSozinho<T>(tableName, callbackRef, filter, onSubscribedRef, aoReconectarRef)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tableName, enabled, filter])
}

export default useRealtime
