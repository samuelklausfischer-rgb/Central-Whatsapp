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
  FileText,
  Gavel,
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

/**
 * O que é do PRÓPRIO app: mexe nas conversas, nas tarefas e nas notas que vivem
 * aqui dentro. Sempre visíveis, para qualquer usuário.
 *
 * Estas não passam por gate porque não há o que liberar — quem entrou no Central
 * Whats já pode usar todas.
 */
const FERRAMENTAS_DO_APP: DestinoNav[] = [
  { title: 'Tarefas', description: 'Kanban interno', icon: ListTodo, url: '/crm' },
  { title: 'Anotações', description: 'Notas rápidas', icon: StickyNote, url: '/notes' },
  { title: 'Gatilhos', description: 'Mensagens auto', icon: Zap, url: '/triggers' },
  {
    title: 'Agendamentos',
    description: 'Envios futuros',
    icon: CalendarClock,
    url: '/scheduled-messages',
  },
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

/** Apps externos embutidos em iframe, com a sessão do Central Whats. */
const RELATORIOS: DestinoNav = {
  title: 'Relatórios',
  description: 'Relatório semanal',
  icon: FileText,
  url: '/ferramentas/relatorios',
}

const LICITACOES: DestinoNav = {
  title: 'Licitações',
  description: 'Editais e análises',
  icon: Gavel,
  url: '/ferramentas/licitacoes',
}

type UsuarioDeNav = Pick<Profile, 'is_admin' | 'department'> & { is_super_admin?: boolean | null }

/**
 * Liberação das ferramentas externas. Não sai do `profile` como as outras: mora
 * no banco (`public.tool_access` e `relatorios.profiles`) e chega por
 * `useToolAccess()`. Opcional para que quem só monta menu estático continue
 * chamando `gruposDeFerramentas(user)` sem mudar nada.
 */
export interface AcessoFerramentasExternas {
  relatorios: boolean
  licitacoes: boolean
}

export interface GrupoDeFerramentas {
  titulo: string
  itens: DestinoNav[]
}

/**
 * Ferramentas que ESTE usuário pode ver, JÁ SEPARADAS em dois grupos.
 *
 * A lista era plana e crescia sem hierarquia: para um admin com tudo liberado
 * eram dez itens seguidos, misturando o que é do próprio app com sistemas que
 * nem WhatsApp são. A divisão vive aqui, e não em cada menu, para que o desktop
 * e a folha do celular nunca discordem sobre onde uma ferramenta nova entra.
 *
 * Grupo VAZIO é descartado: quem não tem nenhum sistema liberado veria só um
 * título "Sistemas PRN" solto, prometendo algo que não está ali.
 *
 * As rotas já são protegidas em `App.tsx` (`FinanceiroToolRoute`,
 * `SuperAdminRoute`, `ExternalToolRoute`); esconder aqui é para não oferecer
 * porta que bate na cara.
 */
export function gruposDeFerramentas(
  user: UsuarioDeNav | null | undefined,
  externas?: AcessoFerramentasExternas,
): GrupoDeFerramentas[] {
  const sistemas: DestinoNav[] = [
    ...(canAccessFinanceiroTools(user) ? [ANALISE_PRN, RATEIO] : []),
    ...(externas?.relatorios ? [RELATORIOS] : []),
    ...(externas?.licitacoes ? [LICITACOES] : []),
    ...(user?.is_super_admin ? [RELATORIO_APP] : []),
  ]

  return [
    { titulo: 'Do app', itens: FERRAMENTAS_DO_APP },
    { titulo: 'Sistemas PRN', itens: sistemas },
  ].filter((grupo) => grupo.itens.length > 0)
}

/**
 * Itens de conta: no desktop vivem no menu do avatar; no celular, na folha "Mais".
 *
 * **Notificações** mora aqui, e não entre as ferramentas: ela não abre uma tela,
 * abre um diálogo de preferências de som e alerta. Ao lado de Configurações ela
 * é o que é; no meio das ferramentas era mais um item competindo por atenção.
 * Por causa dela o retorno é `ItemDeFerramenta[]`, e não `DestinoNav[]` — quem
 * renderiza precisa desviar por `ehAcao`.
 */
export function itensDeConta(user: UsuarioDeNav | null | undefined): ItemDeFerramenta[] {
  return [
    ...(user?.is_admin
      ? [
          {
            title: 'Gestão de Equipe',
            description: 'Usuários e acessos',
            icon: ShieldAlert,
            url: '/admin',
          },
        ]
      : []),
    { title: 'Notificações', description: 'Som e alertas', icon: Bell, action: 'notifications' },
    {
      title: 'Configurações',
      description: 'Preferências do app',
      icon: Settings,
      url: '/settings/general',
    },
  ]
}
