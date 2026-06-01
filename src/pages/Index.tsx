import { useEffect, useState } from 'react'
import { Area, AreaChart, CartesianGrid, XAxis, YAxis, ResponsiveContainer } from 'recharts'
import {
  Smartphone,
  MessageSquareText,
  ListTodo,
  StickyNote,
  Activity,
  BatteryFull,
  BatteryMedium,
  BatteryLow,
} from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart'
import { Button } from '@/components/ui/button'
import useAppStore from '@/stores/useAppStore'
import { Link, useNavigate } from 'react-router-dom'
import { Badge } from '@/components/ui/badge'
import { getDevices } from '@/services/devices'
import { useRealtime } from '@/hooks/use-realtime'
import { getNotes } from '@/services/notes'

const chartData = [
  { date: '14 Mai', mensagens: 120 },
  { date: '15 Mai', mensagens: 180 },
  { date: '16 Mai', mensagens: 250 },
  { date: '17 Mai', mensagens: 190 },
  { date: '18 Mai', mensagens: 310 },
  { date: '19 Mai', mensagens: 280 },
  { date: '20 Mai', mensagens: 400 },
]

export default function Index() {
  const navigate = useNavigate()
  const { tasks } = useAppStore()
  const [devices, setDevices] = useState<any[]>([])
  const [notesCount, setNotesCount] = useState(0)

  useEffect(() => {
    getDevices().then(setDevices)
    getNotes()
      .then((data) => setNotesCount(data.length))
      .catch(() => {})
  }, [])

  useRealtime('devices', (e) => {
    if (e.action === 'create') setDevices((prev) => [e.record, ...prev])
    else if (e.action === 'update')
      setDevices((prev) => prev.map((d) => (d.id === e.record.id ? e.record : d)))
    else if (e.action === 'delete') setDevices((prev) => prev.filter((d) => d.id !== e.record.id))
  })

  useRealtime('notes', (e) => {
    if (e.action === 'create') setNotesCount((prev) => prev + 1)
    else if (e.action === 'delete') setNotesCount((prev) => Math.max(0, prev - 1))
  })

  const totalDevices = devices.length
  const totalUnreadMessages = devices.reduce((sum, d) => sum + (d.unread_count || 0), 0)
  const activeTasks = tasks.filter((t) => t.status !== 'concluido').length

  const getBatteryIcon = (level: number) => {
    if (level > 80) return <BatteryFull className="h-4 w-4 text-emerald-500" />
    if (level > 30) return <BatteryMedium className="h-4 w-4 text-amber-500" />
    return <BatteryLow className="h-4 w-4 text-destructive" />
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="bg-clip-text text-transparent bg-gradient-to-br from-gray-200 to-gray-600 text-3xl font-bold tracking-tight">
            Visão Geral
          </h1>
          <p className="text-muted-foreground mt-1">
            Resumo das comunicações internas e aparelhos corporativos.
          </p>
        </div>
        <div className="flex gap-3">
          <Button variant="outline" asChild>
            <Link to="/settings/devices">Gerenciar Aparelhos</Link>
          </Button>
          <Button asChild>
            <Link to="/chat">Abrir Mensagens</Link>
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card className="shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Aparelhos Conectados
            </CardTitle>
            <Smartphone className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-foreground">{totalDevices}</div>
            <p className="text-xs text-emerald-500 flex items-center mt-1">
              <Activity className="h-3 w-3 mr-1" /> Aparelhos da rede
            </p>
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total Mensagens Não Lidas
            </CardTitle>
            <MessageSquareText className="h-4 w-4 text-amber-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-foreground">{totalUnreadMessages}</div>
            <p className="text-xs text-muted-foreground mt-1">Soma de todos os setores</p>
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Tarefas Internas</CardTitle>
            <ListTodo className="h-4 w-4 text-emerald-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-foreground">{activeTasks}</div>
            <p className="text-xs text-muted-foreground mt-1">Acompanhamentos pendentes</p>
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Anotações Gerais</CardTitle>
            <StickyNote className="h-4 w-4 text-purple-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-foreground">{notesCount}</div>
            <p className="text-xs text-muted-foreground mt-1">Registros recentes</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-7">
        <Card className="md:col-span-4 shadow-sm">
          <CardHeader>
            <CardTitle>Comunicação Corporativa</CardTitle>
            <CardDescription>Tráfego de mensagens nos celulares departamentais</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[300px] w-full">
              <ChartContainer
                config={{ mensagens: { label: 'Mensagens', color: 'hsl(var(--primary))' } }}
                className="h-full w-full"
              >
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="fillColor" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="var(--color-mensagens)" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="var(--color-mensagens)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid
                      strokeDasharray="3 3"
                      vertical={false}
                      stroke="hsl(var(--border))"
                    />
                    <XAxis
                      dataKey="date"
                      axisLine={false}
                      tickLine={false}
                      tick={{ fill: '#a1a1aa', fontSize: 12 }}
                      dy={10}
                    />
                    <YAxis
                      axisLine={false}
                      tickLine={false}
                      tick={{ fill: '#a1a1aa', fontSize: 12 }}
                    />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Area
                      type="monotone"
                      dataKey="mensagens"
                      stroke="var(--color-mensagens)"
                      strokeWidth={3}
                      fillOpacity={1}
                      fill="url(#fillColor)"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </ChartContainer>
            </div>
          </CardContent>
        </Card>

        <Card className="md:col-span-3 shadow-sm">
          <CardHeader>
            <CardTitle>Status por Aparelho</CardTitle>
            <CardDescription>Detalhamento de alertas e mensagens não lidas</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {devices.map((device) => (
                <div
                  key={device.id}
                  onClick={() => navigate(`/chat?device=${device.id}`)}
                  className="flex items-center justify-between p-3 rounded-lg border border-border bg-card hover:bg-accent cursor-pointer transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <div className="bg-primary/20 p-2 rounded-full">
                      <Smartphone className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <p className="font-medium text-sm text-foreground leading-none">
                        {device.name}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1 flex items-center gap-2">
                        <span>{device.department}</span>
                        <span className="flex items-center">
                          {getBatteryIcon(80)}
                          <span className="ml-0.5">80%</span>
                        </span>
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    {device.unread_count > 0 ? (
                      <Badge
                        variant="default"
                        className="bg-amber-500 hover:bg-amber-600 text-amber-950"
                      >
                        {device.unread_count} não lidas
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-muted-foreground border-border">
                        Em dia
                      </Badge>
                    )}
                    <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${device.status === 'online' ? 'bg-emerald-500' : 'bg-slate-500'}`}
                      ></span>
                      {device.status === 'online' ? 'Online' : 'Offline'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
