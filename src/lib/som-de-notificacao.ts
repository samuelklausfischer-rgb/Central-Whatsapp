/**
 * Som de aviso de mensagem nova, sintetizado na hora (sem arquivo de áudio).
 *
 * Vivia dentro de `pages/ChatHub.tsx`, e por isso só existia enquanto a tela de
 * Conversas estava montada. Saiu de lá junto com a notificação — ver
 * `hooks/use-notificacoes-de-mensagem.ts`.
 *
 * ── Por que isto é mais complicado do que "toca um bipe" ──
 *
 * Na web o `AudioContext` nasce SUSPENSO enquanto a pessoa não interagir com a
 * página, e `resume()` fora de um gesto é recusado. O detalhe que fazia o som
 * sumir sem deixar rastro: agendar num contexto suspenso NÃO enfileira a nota.
 * `osc.start(ctx.currentTime)` marca o instante 0; quando o contexto retoma,
 * minutos depois, `currentTime` já passou muito do `osc.stop()` e a nota
 * simplesmente nunca é audível — sem erro, sem aviso.
 *
 * No Electron nada disso aparece: o padrão de `autoplayPolicy` dele é
 * `no-user-gesture-required`. Era exatamente essa diferença que fazia o som
 * funcionar no app instalado e não na web.
 *
 * Daí as duas regras deste arquivo:
 *
 * 1. `registrarDestravamentoDeAudio()` destrava no PRIMEIRO gesto de verdade,
 *    seja ele qual for — antes só `click` contava.
 * 2. `tocarSomDeNotificacao()` devolve se o som REALMENTE saiu. Quem chama usa
 *    essa resposta para decidir o `silent` da notificação: com o áudio
 *    bloqueado, o som fica por conta do sistema operacional em vez de não
 *    existir. Ver `montarOpcoesDeNotificacao` no hook.
 */

type ConstrutorDeAudio = typeof AudioContext

let ctx: AudioContext | null = null

function construtor(): ConstrutorDeAudio | null {
  if (typeof window === 'undefined') return null
  return window.AudioContext ?? (window as unknown as { webkitAudioContext?: ConstrutorDeAudio }).webkitAudioContext ?? null
}

function obterContexto(): AudioContext | null {
  if (ctx) return ctx
  const Ctor = construtor()
  if (!Ctor) return null
  try {
    ctx = new Ctor()
  } catch {
    return null
  }
  return ctx
}

/**
 * Toca o aviso. Devolve `true` só quando a nota foi mesmo agendada num contexto
 * rodando — `false` significa "não saiu som nenhum", e não "deu erro".
 */
export function tocarSomDeNotificacao(): boolean {
  const c = obterContexto()
  if (!c) return false

  if (c.state !== 'running') {
    // Pede o resume para a PRÓXIMA vez (pode resolver se já houve gesto e o
    // contexto só estava ocioso) e desiste desta. Agendar aqui perderia a nota
    // em silêncio — ver o comentário grande no topo.
    c.resume().catch(() => {})
    return false
  }

  try {
    const gain = c.createGain()
    gain.connect(c.destination)
    gain.gain.setValueAtTime(0.12, c.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.5)

    const osc = c.createOscillator()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(523.25, c.currentTime)
    osc.frequency.setValueAtTime(659.25, c.currentTime + 0.12)
    osc.connect(gain)
    osc.start(c.currentTime)
    osc.stop(c.currentTime + 0.4)
    return true
  } catch {
    return false
  }
}

const GESTOS = ['pointerdown', 'keydown', 'touchstart'] as const

/**
 * Destrava o áudio no primeiro gesto do usuário em QUALQUER tela. Devolve a
 * função de limpeza.
 *
 * `pointerdown`/`keydown`/`touchstart` em vez de só `click`: quem entra no app e
 * vai direto digitar na busca nunca dispara um `click`, e ficava sem som até
 * clicar em algo por acaso. Em captura para não depender de nenhum handler da
 * árvore deixar o evento subir.
 *
 * O `resume()` é assíncrono, então a remoção dos listeners acontece dentro do
 * `.then()`: checar `state` logo depois da chamada leria 'suspended' e o
 * destravamento seria tentado para sempre a cada gesto.
 */
export function registrarDestravamentoDeAudio(): () => void {
  let vivo = true

  const parar = () => {
    vivo = false
    GESTOS.forEach((gesto) => window.removeEventListener(gesto, aoGesto, true))
  }

  function aoGesto() {
    // Criar o contexto DENTRO do gesto já o faz nascer 'running' no Chrome —
    // é o caminho feliz, e o `resume()` abaixo vira redundância barata.
    const c = obterContexto()
    if (!c) {
      parar()
      return
    }

    // Buffer de 1 frame com o volume que vier: alguns navegadores só consideram
    // o contexto destravado depois de ele ter de fato reproduzido alguma coisa.
    // Inaudível por ser 1 frame.
    try {
      const fonte = c.createBufferSource()
      fonte.buffer = c.createBuffer(1, 1, c.sampleRate)
      fonte.connect(c.destination)
      fonte.start(0)
    } catch {
      /* contexto ainda suspenso — o resume abaixo é quem resolve */
    }

    c.resume()
      .then(() => {
        if (vivo && c.state === 'running') parar()
      })
      .catch(() => {})
  }

  GESTOS.forEach((gesto) => window.addEventListener(gesto, aoGesto, true))
  return parar
}
