import { useCallback, useEffect, useState } from 'react'
import { Bell, Volume2, VolumeX, BellOff, Smartphone, Wifi, WifiOff, ShieldAlert, CalendarDays } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Switch } from '@/components/ui/switch'
import { useAuth } from '@/hooks/use-auth'
import { useNotificationPrefs } from '@/hooks/use-notification-prefs'
import { getDevices } from '@/services/devices'
import { PREF_AGENDA } from '@/hooks/use-notificacoes'

interface Props {
  open: boolean
  onOpenChange: (v: boolean) => void
}

/** 'indisponivel' = navegador sem a API (não é o mesmo que "bloqueado"). */
type EstadoDaPermissao = NotificationPermission | 'indisponivel'

function lerPermissao(): EstadoDaPermissao {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'indisponivel'
  return Notification.permission
}

export function NotificationsDialog({ open, onOpenChange }: Props) {
  const { user } = useAuth()
  const [devices, setDevices] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const { getPrefs, toggleSound, toggleBackground, setAllSound, setAllBackground } =
    useNotificationPrefs(user?.id)

  /**
   * A permissão do NAVEGADOR, que é coisa diferente das preferências salvas aqui.
   *
   * Esta tela mostrava "2° plano" ligado (é o padrão em `use-notification-prefs`)
   * sem nunca consultar `Notification.permission`. Quem nunca autorizou via a
   * chave ligada, não recebia nada, e não tinha como descobrir por quê.
   */
  const [permissao, setPermissao] = useState<EstadoDaPermissao>(lerPermissao)

  useEffect(() => {
    if (!open) return
    setPermissao(lerPermissao())
    setLoading(true)
    getDevices()
      .then(setDevices)
      .finally(() => setLoading(false))
  }, [open])

  const podeNotificar = permissao === 'granted'

  /**
   * Pede a permissão A PARTIR DO CLIQUE.
   *
   * Isto é o ponto: o pedido antigo rodava num efeito de montagem do ChatHub,
   * sem gesto nenhum. Chrome e Edge aplicam a *quieter notification UI* a
   * pedidos assim — o prompt vira um sininho discreto na barra de endereço, que
   * quase ninguém vê, e a permissão fica em 'default' para sempre. Dentro de um
   * gesto, o navegador mostra a caixa de verdade.
   *
   * Devolve se ficou autorizado, para o clique só ligar a chave quando ligar
   * significar alguma coisa.
   */
  const pedirPermissao = useCallback(async () => {
    if (!('Notification' in window)) return false
    try {
      const resposta = await Notification.requestPermission()
      setPermissao(resposta)
      return resposta === 'granted'
    } catch {
      setPermissao(lerPermissao())
      return false
    }
  }, [])

  /**
   * Ligar "2° plano" com a permissão pendente pede a permissão primeiro.
   * Desligar nunca pede nada — desligar sempre funciona.
   */
  const alternarBackground = useCallback(
    async (deviceId: string, ligando: boolean) => {
      if (ligando && !podeNotificar) {
        if (permissao === 'denied' || permissao === 'indisponivel') return
        if (!(await pedirPermissao())) return
      }
      toggleBackground(deviceId)
    },
    [podeNotificar, permissao, pedirPermissao, toggleBackground],
  )

  const alternarBackgroundDeTodos = useCallback(
    async (ligando: boolean, ids: string[]) => {
      if (ligando && !podeNotificar) {
        if (permissao === 'denied' || permissao === 'indisponivel') return
        if (!(await pedirPermissao())) return
      }
      setAllBackground(ligando, ids)
    },
    [podeNotificar, permissao, pedirPermissao, setAllBackground],
  )

  const deviceIds = devices.map((d) => d.id)
  const allSoundOn = deviceIds.every((id) => getPrefs(id).sound)
  const allBgOn = deviceIds.every((id) => getPrefs(id).background)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md p-0 gap-0 overflow-hidden bg-popover border-border">
        <DialogHeader className="px-5 pt-5 pb-4 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center">
              <Bell className="h-4.5 w-4.5 text-blue-400" />
            </div>
            <div>
              <DialogTitle className="text-base font-semibold text-foreground">
                Notificações
              </DialogTitle>
              <p className="text-xs text-muted-foreground mt-0.5">
                Configure alertas por aparelho
              </p>
            </div>
          </div>
        </DialogHeader>

        {/*
          O estado da permissão do navegador, dito na cara. Sem isto a tela
          mostrava tudo ligado enquanto nada chegava.
        */}
        {!podeNotificar && (
          <div className="px-5 py-3 border-b border-border bg-amber-500/10 flex items-start gap-2.5">
            <ShieldAlert className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
            <p className="text-[11px] leading-relaxed text-amber-200/90">
              {permissao === 'denied' ? (
                <>
                  <span className="font-medium">O navegador bloqueou as notificações.</span>{' '}
                  O app não consegue reverter isso sozinho: libere no cadeado da barra de
                  endereço (ou nas configurações do site) e recarregue.
                </>
              ) : permissao === 'indisponivel' ? (
                <>
                  <span className="font-medium">Este navegador não tem notificações.</span>{' '}
                  Só o som vai funcionar por aqui.
                </>
              ) : (
                <>
                  <span className="font-medium">Falta autorizar o navegador.</span>{' '}
                  Ligue o "2° plano" de um aparelho abaixo — a autorização é pedida na hora.
                </>
              )}
            </p>
          </div>
        )}

        {/* Controles globais */}
        {devices.length > 1 && (
          <div className="px-5 py-3 border-b border-border bg-muted/30 flex items-center gap-4">
            <span className="text-xs font-medium text-muted-foreground flex-1">Todos os aparelhos</span>
            <div className="flex items-center gap-1.5">
              <Volume2 className="h-3.5 w-3.5 text-muted-foreground" />
              <Switch
                checked={allSoundOn}
                onCheckedChange={(v) => setAllSound(v, deviceIds)}
                className="scale-90"
              />
            </div>
            <div className="w-px h-4 bg-border" />
            <div className="flex items-center gap-1.5">
              <Bell className="h-3.5 w-3.5 text-muted-foreground" />
              <Switch
                checked={allBgOn && podeNotificar}
                disabled={permissao === 'denied' || permissao === 'indisponivel'}
                onCheckedChange={(v) => void alternarBackgroundDeTodos(v, deviceIds)}
                className="scale-90"
              />
            </div>
          </div>
        )}

        <div className="overflow-y-auto max-h-[420px]">
          {loading && (
            <div className="flex items-center justify-center py-12 text-muted-foreground text-sm">
              Carregando aparelhos...
            </div>
          )}

          {!loading && devices.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground gap-2">
              <Smartphone className="h-8 w-8 opacity-30" />
              <p className="text-sm">Nenhum aparelho encontrado</p>
            </div>
          )}

          {!loading && devices.map((device, idx) => {
            const prefs = getPrefs(device.id)
            const isConnected = device.status === 'open' || device.status === 'connected'
            const soundOff = !prefs.sound
            // A permissão do navegador entra na conta: "ligado, mas o navegador
            // não deixa" é, na prática, desligado — e é isso que a etiqueta
            // "Mudo" precisa dizer.
            const bgLigado = prefs.background && podeNotificar
            const bgOff = !bgLigado

            return (
              <div
                key={device.id}
                className={`px-5 py-4 ${idx < devices.length - 1 ? 'border-b border-border' : ''}`}
              >
                {/* Device header */}
                <div className="flex items-center gap-3 mb-3">
                  <div className="relative">
                    <div className="w-9 h-9 rounded-xl bg-accent flex items-center justify-center">
                      <Smartphone className="h-4 w-4 text-foreground/70" />
                    </div>
                    <span
                      className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-popover ${isConnected ? 'bg-emerald-500' : 'bg-gray-400'}`}
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{device.name}</p>
                    <div className="flex items-center gap-1 mt-0.5">
                      {isConnected ? (
                        <>
                          <Wifi className="h-3 w-3 text-emerald-500" />
                          <span className="text-[11px] text-emerald-500">Conectado</span>
                        </>
                      ) : (
                        <>
                          <WifiOff className="h-3 w-3 text-muted-foreground" />
                          <span className="text-[11px] text-muted-foreground">Desconectado</span>
                        </>
                      )}
                    </div>
                  </div>
                  {soundOff && bgOff && (
                    <span className="flex items-center gap-1 text-[10px] font-medium text-muted-foreground bg-muted rounded-full px-2 py-0.5">
                      <BellOff className="h-3 w-3" /> Mudo
                    </span>
                  )}
                </div>

                {/* Toggles */}
                <div className="flex gap-3">
                  <button
                    onClick={() => toggleSound(device.id)}
                    className={`flex-1 flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg border transition-all duration-150 ${
                      prefs.sound
                        ? 'border-border bg-background hover:bg-accent'
                        : 'border-dashed border-muted-foreground/30 bg-muted/30 hover:bg-muted/50'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      {prefs.sound ? (
                        <Volume2 className="h-3.5 w-3.5 text-blue-400" />
                      ) : (
                        <VolumeX className="h-3.5 w-3.5 text-muted-foreground" />
                      )}
                      <span className={`text-xs font-medium ${prefs.sound ? 'text-foreground' : 'text-muted-foreground'}`}>
                        Som
                      </span>
                    </div>
                    <Switch
                      checked={prefs.sound}
                      onCheckedChange={() => toggleSound(device.id)}
                      className="scale-75 pointer-events-none"
                    />
                  </button>

                  <button
                    onClick={() => void alternarBackground(device.id, !prefs.background)}
                    disabled={permissao === 'denied' || permissao === 'indisponivel'}
                    className={`flex-1 flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg border transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed ${
                      bgLigado
                        ? 'border-border bg-background hover:bg-accent'
                        : 'border-dashed border-muted-foreground/30 bg-muted/30 hover:bg-muted/50'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      {bgLigado ? (
                        <Bell className="h-3.5 w-3.5 text-blue-400" />
                      ) : (
                        <BellOff className="h-3.5 w-3.5 text-muted-foreground" />
                      )}
                      <span className={`text-xs font-medium ${bgLigado ? 'text-foreground' : 'text-muted-foreground'}`}>
                        2° plano
                      </span>
                    </div>
                    <Switch
                      checked={bgLigado}
                      onCheckedChange={() => void alternarBackground(device.id, !prefs.background)}
                      className="scale-75 pointer-events-none"
                    />
                  </button>
                </div>
              </div>
            )
          })}

          {/*
            A Agenda entra na MESMA lista dos aparelhos, e não numa aba à parte:
            para quem usa, "o que me avisa e como" é uma pergunta só.

            A chave `app:agenda` não é id de aparelho — o prefixo `app:` deixa
            isso explícito, e os ids de device são UUID, então não há colisão.
            Reusa toda a persistência que já existe (perfil + espelho local).
          */}
          {!loading && (
            <div className="rounded-xl border border-border/60 bg-accent/20 p-3">
              <div className="mb-2 flex items-center gap-2">
                <CalendarDays className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium">Agenda</span>
                <span className="text-xs text-muted-foreground">
                  compromisso de grupo, setor ou designado a você
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => toggleSound(PREF_AGENDA)}
                  className="flex items-center justify-between rounded-lg border border-border/60 px-3 py-2"
                >
                  <div className="flex items-center gap-2">
                    {getPrefs(PREF_AGENDA).sound ? (
                      <Volume2 className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
                    ) : (
                      <VolumeX className="h-3.5 w-3.5 text-muted-foreground" />
                    )}
                    <span className="text-xs font-medium">Som</span>
                  </div>
                  <Switch
                    checked={getPrefs(PREF_AGENDA).sound}
                    className="scale-75 pointer-events-none"
                  />
                </button>
                <button
                  type="button"
                  onClick={() => toggleBackground(PREF_AGENDA)}
                  className="flex items-center justify-between rounded-lg border border-border/60 px-3 py-2"
                >
                  <div className="flex items-center gap-2">
                    {getPrefs(PREF_AGENDA).background && podeNotificar ? (
                      <Bell className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
                    ) : (
                      <BellOff className="h-3.5 w-3.5 text-muted-foreground" />
                    )}
                    <span className="text-xs font-medium">2° plano</span>
                  </div>
                  <Switch
                    checked={getPrefs(PREF_AGENDA).background && podeNotificar}
                    className="scale-75 pointer-events-none"
                  />
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer hint */}
        <div className="px-5 py-3 border-t border-border bg-muted/20">
          <p className="text-[11px] text-muted-foreground">
            As preferências são salvas localmente neste dispositivo.
            {podeNotificar && ' O navegador já está autorizado a notificar.'}
          </p>
        </div>
      </DialogContent>
    </Dialog>
  )
}
