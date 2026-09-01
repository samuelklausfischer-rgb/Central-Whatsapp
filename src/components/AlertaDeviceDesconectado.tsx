import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Loader2, RefreshCw, WifiOff } from 'lucide-react'
import { useAuth } from '@/hooks/use-auth'
import { useRealtime } from '@/hooks/use-realtime'
import { getDevices } from '@/services/devices'
import { tocarSomDeNotificacao } from '@/lib/som-de-notificacao'
import { mostrarNotificacao } from '@/lib/notificacao-do-sistema'
import { reconectarAparelho, type QrCodeData } from '@/services/evolution_instances'
import { useToast } from '@/hooks/use-toast'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import type { Device } from '@/lib/supabase/types'

/**
 * Faixa vermelha fixa: "o WhatsApp do seu setor caiu e continua caído".
 *
 * ── Por que mora no Layout, e não numa página ──
 *
 * Mesmo motivo do `use-notificacoes-de-mensagem`, documentado ali e no
 * `Layout.tsx`: o ChatHub é rota `lazy()` e desmonta ao navegar. Um alerta que
 * só existisse dentro da tela de Conversas sumiria assim que a pessoa fosse
 * para o Painel ou para uma ferramenta — exatamente quando ela mais precisa
 * ser avisada, porque não está olhando para o WhatsApp.
 *
 * ── De onde vem o dado ──
 *
 * `getDevices()` já devolve só os aparelhos que ESTA pessoa usa (a RLS de
 * `user_allowed_devices` cuida disso), então não há filtro extra a fazer aqui.
 * O Realtime da tabela `devices` mantém a lista atualizada sem polling: o
 * webhook da Evolution grava `status` a cada `connection.update` e o
 * `useRealtime('devices', ...)` só reflete o que já está acontecendo no banco.
 *
 * ── Carência de ~30s ──
 *
 * Uma queda de sinal de alguns segundos não pode gritar — só vira alarme se o
 * aparelho continuar fora do ar depois da carência. Por isso cada aparelho tem
 * o próprio `setTimeout` (guardado em `timersRef`, fora do React state para não
 * disparar re-render a cada tick): se a reconexão chegar antes do timer disparar,
 * ele é cancelado em silêncio e a faixa nunca aparece para aquela queda.
 *
 * ── Um alarme (som + notificação) por episódio ──
 *
 * "Episódio" = do instante em que o aparelho entra no estado alarmado (passou
 * da carência) até a próxima reconexão. `jaAvisadoRef` guarda quem já tocou o
 * som/notificação neste episódio; ao reconectar, o id sai do set — se cair de
 * novo depois, é um episódio novo e pode alarmar de novo. A faixa em si (visual)
 * não tem esse limite: ela fica exibida o tempo todo em que o aparelho segue
 * desconectado, só o som/notificação é que dispara uma vez só.
 */

/** Abaixo disto, uma queda é só instabilidade — não é "permanece desconectado". */
const CARENCIA_MS = 30_000

/**
 * `'open'` é valor legado (ver `pages/Index.tsx`, que ainda trata os dois como
 * "online"); `'connected'` é o que o webhook grava hoje. Aceitar os dois evita
 * um alarme falso se algum ponto do sistema ainda escrever o valor antigo.
 */
function estaConectado(status: string): boolean {
  return status === 'connected' || status === 'open'
}

/** `'connecting'` também conta como desconectado para o timer, mas com texto próprio. */
function estaReconectando(status: string): boolean {
  return status === 'connecting'
}

export function AlertaDeviceDesconectado() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const { toast } = useToast()

  /**
   * Reconexão SEM admin — decisão de 01/09/2026, junto com esta faixa.
   *
   * A faixa avisava todo mundo, mas só admin podia agir: o setor inteiro ficava
   * esperando alguém com permissão aparecer para escanear o QR. Reconectar não
   * é administração de instância — é reestabelecer o que já existia. O gate
   * real está na edge function (`reconnect_device`, por acesso ao aparelho);
   * aqui é só a porta.
   */
  const [qrAberto, setQrAberto] = useState<{ device: Device; qr: QrCodeData | null } | null>(null)
  const [gerandoQr, setGerandoQr] = useState(false)

  const abrirReconexao = useCallback(
    async (device: Device) => {
      setGerandoQr(true)
      setQrAberto({ device, qr: null })
      try {
        const res = await reconectarAparelho(device.id)
        // Fecha-e-abre no meio da espera? O funcional `prev` garante que só
        // preenche se o dialog ainda é o deste aparelho.
        setQrAberto((prev) => (prev?.device.id === device.id ? { device, qr: res.qrcode } : prev))
      } catch (err) {
        setQrAberto(null)
        toast({
          title: err instanceof Error ? err.message : 'Não foi possível gerar o QR',
          variant: 'destructive',
        })
      } finally {
        setGerandoQr(false)
      }
    },
    [toast],
  )

  // Snapshot renderizável: só os aparelhos que já passaram da carência.
  const [alarmados, setAlarmados] = useState<Device[]>([])

  // Fonte de verdade dos aparelhos, fora do React state: os timers de carência
  // e os handlers do Realtime leem/escrevem aqui sem precisar re-render a cada
  // mudança — só `alarmados` (o que realmente aparece na tela) vira state.
  const devicesRef = useRef<Map<string, Device>>(new Map())
  // Timer de carência pendente por aparelho.
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  // Quem já tocou som/notificação no episódio atual (limpo ao reconectar).
  const jaAvisadoRef = useRef<Set<string>>(new Set())

  const alarmar = useCallback((device: Device) => {
    tocarSomDeNotificacao()
    if (!('Notification' in window) || Notification.permission !== 'granted') return
    void mostrarNotificacao(
      'WhatsApp desconectado',
      {
        body: `"${device.name}" caiu e continua fora do ar. Reconecte para não perder mensagens.`,
        icon: '/pwa-192.png',
        badge: '/favicon-96.png',
        tag: `device-desconectado-${device.id}`,
        renotify: true,
        requireInteraction: true,
        url: '/settings/instances',
      } as NotificationOptions & { url: string },
      (url) => navigate(url),
    )
  }, [navigate])

  // Quem já passou da carência e está com a faixa acesa neste momento.
  const alarmadosIdsRef = useRef<Set<string>>(new Set())

  const recalcularAlarmados = useCallback(() => {
    const lista = Array.from(devicesRef.current.values())
      .filter((d) => alarmadosIdsRef.current.has(d.id))
      .sort((a, b) => a.name.localeCompare(b.name))
    setAlarmados(lista)
  }, [])

  /** Processa um aparelho (fetch inicial ou evento do Realtime). */
  const processarDevice = useCallback(
    (device: Device) => {
      devicesRef.current.set(device.id, device)

      if (estaConectado(device.status)) {
        // Reconectou: cancela carência pendente, sai do alarme e libera o
        // episódio — uma queda futura pode alarmar de novo.
        const timer = timersRef.current.get(device.id)
        if (timer) {
          clearTimeout(timer)
          timersRef.current.delete(device.id)
        }
        jaAvisadoRef.current.delete(device.id)
        if (alarmadosIdsRef.current.delete(device.id)) recalcularAlarmados()
        return
      }

      // Já desconectado e já em carência (ou já alarmado)? Nada a fazer — só
      // atualiza os dados do aparelho (feito acima) para o texto ficar certo.
      if (timersRef.current.has(device.id) || alarmadosIdsRef.current.has(device.id)) return

      const timer = setTimeout(() => {
        timersRef.current.delete(device.id)
        const atual = devicesRef.current.get(device.id)
        // Confere de novo: pode ter reconectado durante a espera.
        if (!atual || estaConectado(atual.status)) return

        alarmadosIdsRef.current.add(device.id)
        recalcularAlarmados()

        if (!jaAvisadoRef.current.has(device.id)) {
          jaAvisadoRef.current.add(device.id)
          alarmar(atual)
        }
      }, CARENCIA_MS)
      timersRef.current.set(device.id, timer)
    },
    [alarmar, recalcularAlarmados],
  )

  const removerDevice = useCallback(
    (id: string) => {
      const timer = timersRef.current.get(id)
      if (timer) clearTimeout(timer)
      timersRef.current.delete(id)
      jaAvisadoRef.current.delete(id)
      devicesRef.current.delete(id)
      if (alarmadosIdsRef.current.delete(id)) recalcularAlarmados()
    },
    [recalcularAlarmados],
  )

  useEffect(() => {
    let vivo = true
    void getDevices().then((lista) => {
      if (!vivo) return
      lista.forEach(processarDevice)
    })
    return () => {
      vivo = false
    }
    // Só no mount: eventos depois disso chegam pelo Realtime abaixo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    // Limpa todos os timers pendentes ao desmontar (troca de usuário, logout).
    // Ler `.current` só na hora da limpeza é o comportamento CERTO aqui — o
    // Map muda o tempo todo (timer entra e sai a cada conexão/queda) e é o
    // conteúdo mais recente que precisa ser cancelado, não uma foto de quando
    // o efeito montou. Por isso o disable: a regra foi pensada para nó de DOM,
    // não para um Map guardado em ref.
    return () => {
      // eslint-disable-next-line react-hooks/exhaustive-deps
      timersRef.current.forEach((t) => clearTimeout(t))
      // eslint-disable-next-line react-hooks/exhaustive-deps
      timersRef.current.clear()
    }
  }, [])

  useRealtime('devices', (e) => {
    // `useRealtime` é genérico em `Record<string, unknown>` (ver o hook); um
    // `Device` de verdade não satisfaz essa constraint por causa dos campos
    // opcionais/estreitos. O cast por `unknown` é o mesmo caminho que
    // `ChatHub.tsx` já usa para os outros payloads de Realtime.
    const device = e.record as unknown as Device
    if (e.action === 'delete') {
      removerDevice(device.id)
      return
    }
    // Soft delete chega como UPDATE com `deleted_at` preenchido — some da
    // lista do mesmo jeito que um DELETE de verdade.
    if (device.deleted_at) {
      removerDevice(device.id)
      return
    }
    processarDevice(device)
  })

  // Reconectou com o dialog do QR aberto: fecha sozinho e comemora. O sinal é o
  // mesmo que apaga a faixa — o aparelho saiu de `alarmados` E está conectado
  // (sair da lista por soft-delete não conta como sucesso).
  useEffect(() => {
    if (!qrAberto) return
    if (alarmados.some((d) => d.id === qrAberto.device.id)) return
    const atual = devicesRef.current.get(qrAberto.device.id)
    if (atual && estaConectado(atual.status)) {
      setQrAberto(null)
      toast({ title: `WhatsApp "${qrAberto.device.name}" reconectado!` })
    }
  }, [alarmados, qrAberto, toast])

  if (alarmados.length === 0 && !qrAberto) return null

  const nomes = alarmados.map((d) => d.name).join(', ')
  const algumReconectando = alarmados.some((d) => estaReconectando(d.status))
  const texto =
    alarmados.length === 1
      ? `WhatsApp "${nomes}" ${algumReconectando ? 'reconectando…' : 'desconectado'} — reconecte para não perder mensagens.`
      : `WhatsApp desconectados: ${nomes} — reconecte para não perder mensagens.`

  return (
    <>
      {alarmados.length > 0 && (
        <div
          role="alert"
          className="relative z-50 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 bg-destructive px-4 py-2 text-center text-sm font-medium text-destructive-foreground"
        >
          {/* Só o ícone pulsa — a faixa inteira piscando seria cansativo de olhar
              pelo tempo em que o aparelho ficar fora do ar (pode ser horas). */}
          <WifiOff className="h-4 w-4 shrink-0 animate-pulse" aria-hidden="true" />
          <span>⚠️ {texto}</span>
          {/* Reconectar é de TODO MUNDO — ver o comentário em `abrirReconexao`.
              Com mais de um aparelho caído, um botão por aparelho, senão não dá
              para escolher qual QR gerar. */}
          {alarmados.map((d) => (
            <button
              key={d.id}
              type="button"
              onClick={() => abrirReconexao(d)}
              className="shrink-0 underline underline-offset-2 hover:no-underline"
            >
              {alarmados.length === 1 ? 'Reconectar' : `Reconectar ${d.name}`}
            </button>
          ))}
          {user?.is_admin && (
            <button
              type="button"
              onClick={() => navigate('/settings/instances')}
              className="shrink-0 opacity-80 underline underline-offset-2 hover:no-underline"
            >
              Configurações
            </button>
          )}
        </div>
      )}

      <Dialog open={!!qrAberto} onOpenChange={(aberto) => { if (!aberto) setQrAberto(null) }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Reconectar "{qrAberto?.device.name}"</DialogTitle>
            <DialogDescription>
              No celular desse número: WhatsApp → Configurações → Aparelhos
              conectados → Conectar aparelho, e aponte a câmera para o código.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col items-center gap-3">
            {gerandoQr ? (
              <div className="flex h-56 w-56 items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : qrAberto?.qr?.base64 ? (
              // O QR já vem como data-URI (ou base64 puro) da Evolution; fundo
              // branco fixo porque QR sobre fundo escuro não é lido pela câmera.
              <img
                src={qrAberto.qr.base64.startsWith('data:') ? qrAberto.qr.base64 : `data:image/png;base64,${qrAberto.qr.base64}`}
                alt="QR code de conexão do WhatsApp"
                className="h-56 w-56 rounded-lg bg-white p-2"
              />
            ) : (
              <p className="py-8 text-center text-sm text-muted-foreground">
                {/* Sem QR na resposta geralmente significa que a instância já
                    está voltando sozinha — o dialog fecha quando confirmar. */}
                A Evolution não devolveu um QR agora. O aparelho pode estar
                reconectando sozinho; aguarde alguns segundos ou gere de novo.
              </p>
            )}

            {qrAberto?.qr?.pairingCode && (
              <p className="text-center text-sm">
                Ou use o código de pareamento:{' '}
                <span className="font-mono font-semibold tracking-widest">{qrAberto.qr.pairingCode}</span>
              </p>
            )}

            {/* O QR da Evolution expira em ~40s. Botão manual, e não
                auto-refresh: regenerar invalida o código anterior no meio do
                escaneio, e quem decide o ritmo é quem está com o celular na mão. */}
            <Button
              variant="outline"
              size="sm"
              disabled={gerandoQr}
              onClick={() => qrAberto && abrirReconexao(qrAberto.device)}
            >
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
              Gerar novo código
            </Button>
            <p className="text-center text-xs text-muted-foreground">
              O código expira em cerca de 40 segundos. Este aviso fecha sozinho
              quando a conexão voltar.
            </p>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}

export default AlertaDeviceDesconectado
