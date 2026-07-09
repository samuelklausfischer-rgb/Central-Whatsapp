import { useEffect, useState } from 'react'
import { Bell, Volume2, VolumeX, BellOff, Smartphone, Wifi, WifiOff } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Switch } from '@/components/ui/switch'
import { useAuth } from '@/hooks/use-auth'
import { useNotificationPrefs } from '@/hooks/use-notification-prefs'
import { getDevices } from '@/services/devices'

interface Props {
  open: boolean
  onOpenChange: (v: boolean) => void
}

export function NotificationsDialog({ open, onOpenChange }: Props) {
  const { user } = useAuth()
  const [devices, setDevices] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const { getPrefs, toggleSound, toggleBackground, setAllSound, setAllBackground } =
    useNotificationPrefs(user?.id)

  useEffect(() => {
    if (!open) return
    setLoading(true)
    getDevices()
      .then(setDevices)
      .finally(() => setLoading(false))
  }, [open])

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
                checked={allBgOn}
                onCheckedChange={(v) => setAllBackground(v, deviceIds)}
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
            const bgOff = !prefs.background

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
                    onClick={() => toggleBackground(device.id)}
                    className={`flex-1 flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg border transition-all duration-150 ${
                      prefs.background
                        ? 'border-border bg-background hover:bg-accent'
                        : 'border-dashed border-muted-foreground/30 bg-muted/30 hover:bg-muted/50'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      {prefs.background ? (
                        <Bell className="h-3.5 w-3.5 text-blue-400" />
                      ) : (
                        <BellOff className="h-3.5 w-3.5 text-muted-foreground" />
                      )}
                      <span className={`text-xs font-medium ${prefs.background ? 'text-foreground' : 'text-muted-foreground'}`}>
                        2° plano
                      </span>
                    </div>
                    <Switch
                      checked={prefs.background}
                      onCheckedChange={() => toggleBackground(device.id)}
                      className="scale-75 pointer-events-none"
                    />
                  </button>
                </div>
              </div>
            )
          })}
        </div>

        {/* Footer hint */}
        <div className="px-5 py-3 border-t border-border bg-muted/20">
          <p className="text-[11px] text-muted-foreground">
            As preferências são salvas localmente neste dispositivo.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  )
}
