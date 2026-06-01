import { useState } from 'react'
import {
  Smartphone,
  Wifi,
  WifiOff,
  Battery,
  BatteryFull,
  BatteryMedium,
  BatteryLow,
  RefreshCcw,
  MoreVertical,
  Plus,
  QrCode,
} from 'lucide-react'
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import useAppStore from '@/stores/useAppStore'
import { useToast } from '@/hooks/use-toast'
import { SignatureManagerDialog } from '@/components/SignatureManagerDialog'

export default function Devices() {
  const { devices, syncDevice } = useAppStore()
  const { toast } = useToast()
  const [newDeviceName, setNewDeviceName] = useState('')
  const [isDialogOpen, setIsDialogOpen] = useState(false)

  const handleSync = () => {
    if (!newDeviceName) return
    syncDevice(newDeviceName)
    setIsDialogOpen(false)
    setNewDeviceName('')
    toast({
      title: 'Aparelho Conectado',
      description: `O aparelho ${newDeviceName} foi sincronizado com sucesso.`,
    })
  }

  const getBatteryIcon = (level: number) => {
    if (level > 80) return <BatteryFull className="h-4 w-4 text-emerald-500" />
    if (level > 30) return <BatteryMedium className="h-4 w-4 text-amber-500" />
    return <BatteryLow className="h-4 w-4 text-destructive" />
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col sm:flex-row items-center justify-end gap-4">
        <SignatureManagerDialog />
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button className="gap-2">
              <Plus className="h-4 w-4" /> Conectar Novo Aparelho
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Sincronizar Novo Aparelho</DialogTitle>
              <DialogDescription>
                Abra o aplicativo da central no celular e escaneie o código QR abaixo para conectar.
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col items-center justify-center py-6 gap-6">
              <div className="bg-background p-4 rounded-lg shadow-sm border border-border">
                <QrCode className="h-48 w-48 text-slate-800" />
              </div>
              <div className="w-full space-y-2">
                <Label htmlFor="name">Nome de Identificação (Opcional)</Label>
                <Input
                  id="name"
                  placeholder="Ex: Celular Almoxarifado"
                  value={newDeviceName}
                  onChange={(e) => setNewDeviceName(e.target.value)}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
                Cancelar
              </Button>
              <Button onClick={handleSync}>Simular Conexão</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {devices.map((device) => (
          <Card
            key={device.id}
            className="group overflow-hidden transition-all hover:shadow-md hover:-translate-y-1"
          >
            <CardHeader className="pb-4">
              <div className="flex justify-between items-start">
                <div className="flex items-center gap-3">
                  <div
                    className={`p-3 rounded-xl ${device.status === 'online' ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'}`}
                  >
                    <Smartphone className="h-6 w-6" />
                  </div>
                  <div>
                    <CardTitle className="text-lg">{device.name}</CardTitle>
                    <p className="text-xs text-muted-foreground">{device.model}</p>
                  </div>
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <MoreVertical className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem>Renomear</DropdownMenuItem>
                    <DropdownMenuItem>Re-sincronizar</DropdownMenuItem>
                    <DropdownMenuItem className="text-destructive">Desconectar</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground flex items-center gap-2">
                    Status da Conexão
                  </span>
                  {device.status === 'online' ? (
                    <Badge
                      variant="outline"
                      className="border-border bg-emerald-950/30 text-emerald-400"
                    >
                      <Wifi className="h-3 w-3 mr-1" /> Online
                    </Badge>
                  ) : (
                    <Badge
                      variant="outline"
                      className="border-border bg-slate-950/30 text-slate-400"
                    >
                      <WifiOff className="h-3 w-3 mr-1" /> Offline
                    </Badge>
                  )}
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground flex items-center gap-2">Bateria</span>
                  <span className="flex items-center font-medium">
                    {getBatteryIcon(device.battery)} <span className="ml-1">{device.battery}%</span>
                  </span>
                </div>
              </div>
            </CardContent>
            <CardFooter className="bg-muted py-3 border-t border-border">
              <Button
                variant="ghost"
                className="w-full text-xs h-8 text-primary hover:text-primary/80"
              >
                <RefreshCcw className="h-3 w-3 mr-2" /> Forçar Sincronização
              </Button>
            </CardFooter>
          </Card>
        ))}
      </div>
    </div>
  )
}
