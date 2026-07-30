import {
  LayoutDashboard,
  MessageSquare,
  Mail,
  ListTodo,
  StickyNote,
  Zap,
  CalendarClock,
  Bell,
  BarChart3,
  Percent,
  Activity,
  ShieldAlert,
  Settings,
} from 'lucide-react'
import { canAccessFinanceiroTools } from '@/lib/permissions'
import type { Profile } from '@/lib/supabase/types'

/**
 * Fonte ÚNICA dos destinos do app.
 *
 * Esta lista morava dentro do `Header`, que é a barra do desktop. Quando o
 * celular ganhou casca própria, copiar a lista significaria que a primeira
 * ferramenta nova apareceria num lugar e não no outro — e, pior, que um gate de
 * permissão corrigido de um lado continuaria furado do outro.
 *
 * Aqui ficam também as REGRAS de quem vê o quê, para que "só admin" seja uma
 * decisão só, e não duas.
 */

export interface DestinoNav {
  title: string
  description: string
  icon: React.ElementType
  url: string
}

/** Itens de ação (abrem diálogo em vez de navegar). */
export interface AcaoNav {
  title: string
  description: string
  icon: React.ElementType
  action: 'notifications'
}

export type ItemDeFerramenta = DestinoNav | AcaoNav

export function ehAcao(item: ItemDeFerramenta): item is AcaoNav {
  return 'action' in item
}

/**
 * Os três destinos do dia a dia. No celular viram as abas do rodapé; no desktop,
 * os links da barra. A ORDEM é a mesma nos dois de propósito — quem usa o app no
 * computador e no celular não deveria ter que reaprender onde as coisas ficam.
 */
export const DESTINOS_PRINCIPAIS: DestinoNav[] = [
  { title: 'Painel', description: 'Visão geral', icon: LayoutDashboard, url: '/dashboard' },
  { title: 'Conversas', description: 'WhatsApp', icon: MessageSquare, url: '/chat' },
  { title: 'Email', description: 'Caixa de entrada', icon: Mail, url: '/email' },
]

/** Sempre visíveis, para qualquer usuário. */
const FERRAMENTAS_BASE: ItemDeFerramenta[] = [
  { title: 'Tarefas', description: 'Kanban interno', icon: ListTodo, url: '/crm' },
  { title: 'Anotações', description: 'Notas rápidas', icon: StickyNote, url: '/notes' },
  { title: 'Gatilhos', description: 'Mensagens auto', icon: Zap, url: '/triggers' },
  { title: 'Agendamentos', description: 'Envios futuros', icon: CalendarClock, url: '/scheduled-messages' },
  { title: 'Notificações', description: 'Som e alertas', icon: Bell, action: 'notifications' },
]

const ANALISE_PRN: DestinoNav = {
  title: 'Análise PRN',
  description: 'Cockpit financeiro',
  icon: BarChart3,
  url: '/ferramentas/analise-prn',
}

const RATEIO: DestinoNav = {
  title: 'Rateio Mobilemed',
  description: 'Rateio PRN/MedImagem',
  icon: Percent,
  url: '/ferramentas/rateio-mobilemed',
}

/** Só super-admin. Ver a explicação em `SuperAdminRoute` (App.tsx). */
const RELATORIO_APP: DestinoNav = {
  title: 'Relatório App',
  description: 'Uso por usuário',
  icon: Activity,
  url: '/ferramentas/relatorio-app',
}

type UsuarioDeNav = Pick<Profile, 'is_admin' | 'department'> & { is_super_admin?: boolean | null }

/**
 * Ferramentas que ESTE usuário pode ver.
 *
 * As rotas já são protegidas em `App.tsx` (`FinanceiroToolRoute`,
 * `SuperAdminRoute`); esconder aqui é para não oferecer porta que bate na cara.
 */
export function ferramentasDoUsuario(user: UsuarioDeNav | null | undefined): ItemDeFerramenta[] {
  return [
    ...FERRAMENTAS_BASE,
    ...(canAccessFinanceiroTools(user) ? [ANALISE_PRN, RATEIO] : []),
    ...(user?.is_super_admin ? [RELATORIO_APP] : []),
  ]
}

/** Itens de conta: no desktop vivem no menu do avatar; no celular, na folha "Mais". */
export function itensDeConta(user: UsuarioDeNav | null | undefined): DestinoNav[] {
  return [
    ...(user?.is_admin
      ? [{ title: 'Gestão de Equipe', description: 'Usuários e acessos', icon: ShieldAlert, url: '/admin' }]
      : []),
    { title: 'Configurações', description: 'Preferências do app', icon: Settings, url: '/settings/general' },
  ]
}
