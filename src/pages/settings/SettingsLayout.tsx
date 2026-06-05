import { Link, Outlet, useLocation } from 'react-router-dom'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useAuth } from '@/hooks/use-auth'

export default function SettingsLayout() {
  const location = useLocation()
  const { user } = useAuth()

  const currentTab = location.pathname.includes('/settings/devices')
    ? 'devices'
    : location.pathname.includes('/settings/labels')
      ? 'labels'
      : location.pathname.includes('/settings/ai-assistant')
        ? 'ai-assistant'
        : location.pathname.includes('/settings/instances')
          ? 'instances'
          : 'general'

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Configurações</h1>
        <p className="text-muted-foreground mt-1">
          Gerencie os aparelhos internos, etiquetas e preferências gerais do sistema.
        </p>
      </div>

      <Tabs value={currentTab} className="w-full">
        <TabsList>
          <TabsTrigger value="general" asChild>
            <Link to="/settings/general">Perfil / Geral</Link>
          </TabsTrigger>
          <TabsTrigger value="devices" asChild>
            <Link to="/settings/devices">Aparelhos Corporativos</Link>
          </TabsTrigger>
          <TabsTrigger value="labels" asChild>
            <Link to="/settings/labels">Etiquetas</Link>
          </TabsTrigger>
          <TabsTrigger value="ai-assistant" asChild>
            <Link to="/settings/ai-assistant">Assistente IA</Link>
          </TabsTrigger>
          {user?.is_admin && (
            <TabsTrigger value="instances" asChild>
              <Link to="/settings/instances">Instâncias Evolution</Link>
            </TabsTrigger>
          )}
        </TabsList>
      </Tabs>

      <div className="mt-2">
        <Outlet />
      </div>
    </div>
  )
}
