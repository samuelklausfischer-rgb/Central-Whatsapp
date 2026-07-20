import { useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { useToast } from '@/hooks/use-toast'
import { useTheme } from 'next-themes'
import { useAuth } from '@/hooks/use-auth'
import supabase from '@/lib/supabase/client'

export default function GeneralSettings() {
  const { user, refreshProfile } = useAuth()
  const { theme, setTheme } = useTheme()
  const { toast } = useToast()

  const [name, setName] = useState(user?.name || '')
  const [username, setUsername] = useState(user?.username || '')
  const [signature, setSignature] = useState(user?.signature || '')
  const [isSaving, setIsSaving] = useState(false)

  const handleSaveUserProfile = async () => {
    if (!user) return
    try {
      setIsSaving(true)
      await supabase.from('profiles').update({ name, username, signature }).eq('id', user.id)
      await refreshProfile()
      toast({ title: 'Sucesso', description: 'Perfil de usuário atualizado com sucesso.' })
    } catch (e: any) {
      toast({
        title: 'Erro',
        description: e.message || 'Não foi possível salvar as informações do perfil.',
        variant: 'destructive',
      })
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="grid gap-6 pb-12">
      <Card>
        <CardHeader>
          <CardTitle>Perfil do Usuário</CardTitle>
          <CardDescription>Informações pessoais e perfil.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6 max-w-2xl">
          <div className="space-y-4 w-full">
            <div className="space-y-2">
              <Label htmlFor="userName">Nome</Label>
              <Input
                id="userName"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Seu nome"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="userUsername">Nome de Usuário</Label>
              <Input
                id="userUsername"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="username"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="userSignature">Assinatura Pessoal</Label>
              <textarea
                id="userSignature"
                className="w-full flex min-h-[80px] rounded-md border border-border bg-muted px-3 py-2 text-[14px] placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-blue-500/50 resize-y text-foreground"
                value={signature}
                onChange={(e) => setSignature(e.target.value)}
                placeholder="Sua assinatura pessoal (usada se o aparelho não tiver uma)"
              />
            </div>
            <Button onClick={handleSaveUserProfile} disabled={isSaving}>
              {isSaving ? 'Salvando...' : 'Salvar Perfil'}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Preferências do Sistema</CardTitle>
          <CardDescription>Configure como o sistema deve se comportar.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6 max-w-2xl">
          <div className="flex items-center justify-between space-x-2">
            <Label htmlFor="notifications" className="flex flex-col space-y-1">
              <span className="text-base font-medium">Notificações Sonoras</span>
              <span className="font-normal text-sm text-muted-foreground">
                Tocar som ao receber nova mensagem ou alerta.
              </span>
            </Label>
            <Switch id="notifications" defaultChecked />
          </div>
          <div className="flex items-center justify-between space-x-2">
            <Label htmlFor="darkMode" className="flex flex-col space-y-1">
              <span className="text-base font-medium">Tema Escuro Automático</span>
              <span className="font-normal text-sm text-muted-foreground">
                Sincronizar com as preferências do sistema operacional.
              </span>
            </Label>
            <Switch id="darkMode" checked={theme === 'system'} onCheckedChange={(checked) => setTheme(checked ? 'system' : 'light')} />
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
