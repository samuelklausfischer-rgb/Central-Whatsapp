import { Mail } from 'lucide-react'

export default function EmailAccountSettings() {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Contas de Email</h2>
        <p className="text-muted-foreground mt-1">Integração de e-mail no painel.</p>
      </div>

      <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed py-16 text-center">
        <Mail className="h-8 w-8 text-muted-foreground" />
        <span className="text-lg font-medium">Em breve</span>
        <p className="max-w-sm text-sm text-muted-foreground">
          Este recurso está em desenvolvimento e ficará disponível em breve.
        </p>
      </div>
    </div>
  )
}
