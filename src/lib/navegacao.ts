import {
  LayoutDashboard,
  MessageSquare,
  Mail,
  ListTodo,
  StickyNote,
  Zap,
  CalendarClock,
  CalendarDays,
  Bell,
  BarChart3,
  Percent,
  Activity,
  Timer,
  FileText,
  FileSignature,
  Gavel,
  ClipboardList,
  Compass,
  PenLine,
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
  action: 'notifications' | 'tour'
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
  /*
    ITEM 1: "deve ser um botão ao lado de emails e ferramentas" — é literalmente
    aqui. Vira a quarta aba do rodapé no celular; conferir o aperto na tela
    estreita antes de acrescentar uma quinta.
  */
  { title: 'Agenda', description: 'Compromissos', icon: CalendarDays, url: '/agenda' },
]

/**
 * O que roda DENTRO do app e não tem o que liberar: quem entrou no PRN Hub já
 * pode usar todas. A maioria mexe nas conversas, nas tarefas e nas notas daqui;
 * Assinaturas entra no grupo pelo mesmo critério — não é uma tela de WhatsApp,
 * mas é interna, não depende de sistema nenhum e todo funcionário precisa dela
 * para montar a própria assinatura de e-mail.
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
  {
    title: 'Assinaturas',
    description: 'Assinatura de e-mail',
    icon: PenLine,
    url: '/ferramentas/assinaturas',
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

/** Só super-admin, mesmo gate do Relatório App. */
const CONTROLE_MENSAGENS: DestinoNav = {
  title: 'Controle de Mensagens',
  description: 'Tempo de resposta',
  icon: Timer,
  url: '/ferramentas/controle-mensagens',
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

/**
 * Roda dentro do app, mas fica em "Sistemas PRN" e não em "Do app": é liberada
 * pessoa a pessoa (`public.tool_access`), como Licitações — o critério do grupo
 * é o gate, não onde o código mora.
 */
/**
 * ITEM 2: o PRN-hub, onde nasce esta fila de melhorias. Liberado pessoa a pessoa
 * por `public.tool_access`, como Licitações — hoje só para quem cuida da fila.
 */
const PRN_HUB: DestinoNav = {
  title: 'PRN Hub',
  description: 'Fila de melhorias',
  icon: ClipboardList,
  url: '/ferramentas/prn-hub',
}

const PROPOSTA_COMERCIAL: DestinoNav = {
  title: 'Proposta Comercial',
  description: 'PDF de 13 slides',
  icon: FileSignature,
  url: '/ferramentas/proposta-comercial',
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
  propostaComercial: boolean
  prnHub: boolean
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
    ...(externas?.propostaComercial ? [PROPOSTA_COMERCIAL] : []),
    ...(externas?.relatorios ? [RELATORIOS] : []),
    ...(externas?.licitacoes ? [LICITACOES] : []),
    ...(externas?.prnHub ? [PRN_HUB] : []),
    ...(user?.is_super_admin ? [RELATORIO_APP, CONTROLE_MENSAGENS] : []),
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
    /*
      ITEM 5: rever a apresentação do app. Fica aqui, junto de Notificações e
      Configurações, porque foi exatamente onde você pediu — e porque é o lugar
      de onde ninguém abre por engano no meio do atendimento.
    */
    { title: 'Tour do app', description: 'Rever a apresentação', icon: Compass, action: 'tour' },
    {
      title: 'Configurações',
      description: 'Preferências do app',
      icon: Settings,
      url: '/settings/general',
    },
  ]
}
