/**
 * Histórico de alterações de cadastro e permissão.
 *
 * Existe por causa de 18/08/2026: alguém editou o cadastro da Renata pela tela
 * de Usuários e, no mesmo movimento, apagou todos os aparelhos dela — e não
 * sobrou nenhum registro de quem foi. A tela passa pela edge function
 * `manage-user`, que usa a service_role, então o `auth.audit_log_entries` só
 * guardou "service_role".
 *
 * Sem esta lista o histórico só seria acessível por SQL, o que na prática não
 * responde a pergunta na hora em que ela aparece.
 */
import { useEffect, useState } from 'react'
import { History, Loader2 } from 'lucide-react'

import { CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { GlassCard } from '@/components/ui/surface'
import { ListRow, ListRowPill } from '@/components/ui/list-row'
import { getAdminAuditLog, type AdminAuditEntry } from '@/services/users'

const ROTULO_CAMPO: Record<string, string> = {
  name: 'Nome',
  username: 'Usuário',
  email: 'E-mail',
  is_admin: 'Administrador',
  is_super_admin: 'Super admin',
  department: 'Setor',
  devices_restricted: 'Restrição de instâncias',
  password: 'Senha',
}

function formatarValor(valor: unknown): string {
  if (valor === true) return 'sim'
  if (valor === false) return 'não'
  if (valor === null || valor === undefined || valor === '') return '(vazio)'
  return String(valor)
}

/** Uma frase por linha do histórico, em português e sem nome de coluna. */
function descrever(entrada: AdminAuditEntry): string[] {
  const changes = (entrada.changes ?? {}) as Record<string, any>

  if (entrada.entity === 'user_allowed_devices') {
    const instancia = changes.device_name || changes.device_id || 'instância desconhecida'
    return [
      entrada.action === 'delete'
        ? `Removeu o acesso à instância ${instancia}`
        : `Liberou o acesso à instância ${instancia}`,
    ]
  }

  if (entrada.entity === 'tool_access') {
    const ferramenta = changes.tool || 'ferramenta desconhecida'
    return [
      entrada.action === 'delete'
        ? `Removeu o acesso à ferramenta ${ferramenta}`
        : `Liberou o acesso à ferramenta ${ferramenta}`,
    ]
  }

  if (entrada.action === 'insert') return ['Cadastro criado']
  if (entrada.action === 'delete') return ['Cadastro removido']

  // Update de profiles (e a linha de auth.users da troca de senha): cada campo
  // vira "Rótulo: antes → depois".
  const linhas = Object.entries(changes).map(([campo, diff]) => {
    const rotulo = ROTULO_CAMPO[campo] ?? campo
    if (diff && typeof diff === 'object' && 'para' in diff) {
      return `${rotulo}: ${formatarValor(diff.de)} → ${formatarValor(diff.para)}`
    }
    return `${rotulo}: ${formatarValor(diff)}`
  })

  return linhas.length > 0 ? linhas : ['Alteração sem detalhe registrado']
}

function formatarQuando(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function AdminAuditLog() {
  const [entradas, setEntradas] = useState<AdminAuditEntry[]>([])
  const [carregando, setCarregando] = useState(true)

  useEffect(() => {
    getAdminAuditLog()
      .then(setEntradas)
      .finally(() => setCarregando(false))
  }, [])

  return (
    <GlassCard>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <History className="h-5 w-5 text-primary" /> Histórico de Alterações
        </CardTitle>
        <CardDescription>
          Quem mexeu em cadastro, setor, permissão de administrador ou acesso a instâncias — e o
          que exatamente mudou. Senha aparece como alterada, nunca o valor.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {carregando ? (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Carregando o histórico…
          </div>
        ) : entradas.length === 0 ? (
          <div className="py-8 text-center text-muted-foreground border border-dashed border-border rounded-xl">
            Nenhuma alteração registrada ainda.
          </div>
        ) : (
          <div className="grid gap-1 max-h-[28rem] overflow-y-auto pr-1">
            {entradas.map((entrada) => (
              <ListRow key={entrada.id} className="flex-col items-stretch gap-1">
                <div className="flex items-start justify-between gap-3 w-full">
                  <p className="min-w-0 text-sm font-medium text-foreground truncate">
                    {/* Sem autor = alteração feita fora do app (SQL direto). Dizer
                        isso é melhor que deixar o campo em branco. */}
                    {entrada.actor_label ?? 'Autor não identificado'}
                    <span className="font-normal text-muted-foreground">
                      {' '}em {entrada.target_label ?? 'usuário removido'}
                    </span>
                  </p>
                  <ListRowPill tom={entrada.source === 'sql' ? 'ambar' : 'azul'}>
                    {formatarQuando(entrada.occurred_at)}
                  </ListRowPill>
                </div>
                <ul className="text-xs text-muted-foreground space-y-0.5">
                  {descrever(entrada).map((linha, i) => (
                    <li key={i}>{linha}</li>
                  ))}
                </ul>
              </ListRow>
            ))}
          </div>
        )}
      </CardContent>
    </GlassCard>
  )
}
