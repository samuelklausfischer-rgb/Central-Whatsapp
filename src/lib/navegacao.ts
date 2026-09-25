import {
  Home,
  Mail,
  ListTodo,
  StickyNote,
  Zap,
  CalendarClock,
  CalendarDays,
  Receipt,
  Bell,
  BarChart3,
  Percent,
  Stethoscope,
  Activity,
  Timer,
  FileText,
  FileSignature,
  Gavel,
  ClipboardList,
  Compass,
  PenLine,
  Send,
  ShieldAlert,
  Settings,
  Sun,
  Moon,
  Sparkles,
} from 'lucide-react'
import { IconeWhatsApp } from '@/components/ui/icone-whatsapp'
import { getBundleVersion } from '@/lib/app-info'
import { podeVerRota } from '@/lib/ferramentas/catalogo'
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
  /**
   * Renderiza só o ícone na barra do DESKTOP, sem rótulo. Usado no Painel, que
   * vira uma casinha de "início" — o ícone sozinho já é convenção universal e
   * devolve espaço na barra.
   *
   * As abas do rodapé do celular IGNORAM isto de propósito: lá não há tooltip
   * ao passar o mouse, e uma aba muda no meio de outras rotuladas viraria
   * adivinhação. Quem lê a bandeira é só o `Header`.
   */
  soIcone?: boolean
}

/** Itens de ação (abrem diálogo/alternam algo em vez de navegar). */
export interface AcaoNav {
  title: string
  description: string
  icon: React.ElementType
  action: 'notifications' | 'tour' | 'tema' | 'novidades'
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
/**
 * ⚠️ LISTA CRUA, sem filtro de permissão. Quem monta menu usa
 * `destinosPrincipais(acesso)` logo abaixo; esta aqui existe inteira porque o
 * `lib/hub/onde-estou.ts` precisa nomear qualquer tela, inclusive uma que a
 * pessoa não possa mais abrir.
 */
export const DESTINOS_PRINCIPAIS: DestinoNav[] = [
  { title: 'Painel', description: 'Visão geral', icon: Home, url: '/dashboard', soIcone: true },
  // O ícone é o glifo do WhatsApp desenhado à mão (`ui/icone-whatsapp`): o
  // lucide não tem logos de marca e não havia SVG nenhum no projeto.
  { title: 'Whats', description: 'WhatsApp', icon: IconeWhatsApp, url: '/chat' },
  { title: 'Email', description: 'Caixa de entrada', icon: Mail, url: '/email' },
  /*
    ITEM 1: "deve ser um botão ao lado de emails e ferramentas" — é literalmente
    aqui. Vira a quarta aba do rodapé no celular; conferir o aperto na tela
    estreita antes de acrescentar uma quinta.
  */
  { title: 'Agenda', description: 'Compromissos', icon: CalendarDays, url: '/agenda' },
]

/**
 * Os destinos do topo que ESTA pessoa pode ver.
 *
 * O Painel nunca some — é a casa do app e o destino de todo bloqueio, então
 * `podeVerRota` devolve `true` para ele por não haver chave no catálogo.
 */
export function destinosPrincipais(acesso?: AcessoFerramentasExternas): DestinoNav[] {
  return DESTINOS_PRINCIPAIS.filter((d) => podeVerRota(d.url, acesso?.podeUsar ?? {}))
}

/**
 * O que roda DENTRO do app: Tarefas, Anotações, Atalhos, Agendamentos e
 * Assinaturas. A maioria mexe nas conversas, nas tarefas e nas notas daqui;
 * Assinaturas entra no grupo pelo mesmo critério — não é uma tela de WhatsApp,
 * mas é interna, não depende de sistema nenhum e todo funcionário precisa dela
 * para montar a própria assinatura de e-mail.
 *
 * Exportada desde 08/09 para o `lib/hub/onde-estou.ts` ler os NOMES daqui em vez
 * de repetir os cinco à mão. O relato do "Reportar problema" agora leva o nome da
 * tela na frente do título (`[Anotações] ...`), e um nome copiado envelheceria —
 * foi exatamente o que aconteceu com "Análise PRN" depois do renome de 04/09.
 */
export const FERRAMENTAS_DO_APP: DestinoNav[] = [
  { title: 'Tarefas', description: 'Kanban interno', icon: ListTodo, url: '/crm' },
  { title: 'Anotações', description: 'Notas rápidas', icon: StickyNote, url: '/notes' },
  {
    title: 'Atalhos de mensagem',
    description: 'Respostas prontas',
    icon: Zap,
    url: '/triggers',
  },
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
  /*
    ITEM 4: envio mensal de nota fiscal. "Campanhas de e-mail" (a referência
    pedida para este item) não é uma entrada desta lista — ela é um link
    interno dentro do próprio `EmailHub.tsx`, que está fora do escopo desta
    tarefa. Notas Fiscais entra aqui, junto de Assinaturas, por ser a mesma
    categoria (ferramenta interna ligada a e-mail, atrás do porteiro
    `tela-email` — ver `App.tsx`), e não por baixo de "Campanhas".
  */
  {
    title: 'Notas Fiscais',
    description: 'Envio mensal por e-mail',
    icon: Receipt,
    url: '/email/notas-fiscais',
  },
]

const ANALISE_PRN: DestinoNav = {
  // Renomeada em 04/09: "Análise PRN" não dizia o que a ferramenta faz. Ela
  // cruza registros de meses/fontes diferentes e aponta duplicidade.
  title: 'Cruzar Contas',
  description: 'Cruzamento e duplicidade',
  icon: BarChart3,
  url: '/ferramentas/analise-prn',
}

const RATEIO: DestinoNav = {
  title: 'Rateio Mobilemed',
  description: 'Rateio PRN/MedImagem',
  icon: Percent,
  url: '/ferramentas/rateio-mobilemed',
}

/**
 * Gestão Médica: cadastro de médicos, contratos e documentos. Padrão pelo SETOR
 * (Administrativo), como Cruzar Contas e Rateio são pelo Financeiro — mas desde
 * 09/09/2026 aceita exceção pessoa a pessoa por cima do setor, e a regra está
 * espelhada em `gestao_medica._pode_usar()`, no banco.
 *
 * Embutido por iframe, mas no mesmo projeto Supabase (schema `gestao_medica`),
 * então a sessão atravessa direto — ver `pages/tools/GestaoMedica.tsx`.
 */
const GESTAO_MEDICA: DestinoNav = {
  title: 'Gestão Médica',
  description: 'Cadastro de médicos',
  icon: Stethoscope,
  url: '/ferramentas/gestao-medica',
}

/** Padrão: só super-admin. A razão de ser tão fechado está em `lib/ferramentas/catalogo.ts`. */
const RELATORIO_APP: DestinoNav = {
  title: 'Relatório App',
  description: 'Uso por usuário',
  icon: Activity,
  url: '/ferramentas/relatorio-app',
}

/**
 * Liberado pessoa a pessoa por `public.tool_access` desde 26/08/2026 — este
 * comentário dizia "só super-admin, mesmo gate do Relatório App", que deixou de
 * ser verdade naquele dia e ficou para trás até 09/09.
 */
const CONTROLE_MENSAGENS: DestinoNav = {
  title: 'Controle de Mensagens',
  description: 'Tempo de resposta',
  icon: Timer,
  url: '/ferramentas/controle-mensagens',
}

/** Apps externos embutidos em iframe, com a sessão do Central Whats. */
const RELATORIOS: DestinoNav = {
  title: 'Gestor de Tarefas',
  description: 'Tarefas e relatórios',
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
  title: 'PRN Hub Dev',
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

/**
 * Nativa como o Controle de Mensagens, mas liberada por `tool_access` e não por
 * super-admin: a ideia é que quem precisa disparar consiga, sem depender do
 * Samuel. Fica junto das outras porque o risco (queimar o número do atendimento)
 * pede que ela seja tão visível quanto qualquer sistema.
 */
const DISPARADOR_EM_MASSA: DestinoNav = {
  title: 'Disparador em massa',
  description: 'Listas de transmissão e envio em massa',
  icon: Send,
  url: '/ferramentas/disparador-em-massa',
}

type UsuarioDeNav = Pick<Profile, 'is_admin' | 'department'> & { is_super_admin?: boolean | null }

/**
 * Quem pode usar cada ferramenta, POR SLUG. Chega de `useToolAccess()`.
 *
 * Era uma interface com um campo por ferramenta até 09/09/2026. Virou registro
 * porque a mesma informação vivia em três lugares — aqui, no hook e na união do
 * guard de rota —, e foi assim que `prn-hub` e `controle-mensagens` acabaram
 * funcionando sem ninguém conseguir liberá-los pela tela.
 *
 * Opcional para que quem só monta menu estático continue chamando
 * `gruposDeFerramentas(user)` sem mudar nada.
 */
export interface AcessoFerramentasExternas {
  podeUsar: Record<string, boolean>
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
 * A rota já é protegida em `App.tsx` (`FerramentaRoute`, um só desde 09/09);
 * esconder aqui é para não oferecer porta que bate na cara.
 *
 * ⚠️ TODAS passam pelo mesmo `podeUsar` agora, inclusive as que saíam do setor.
 * O `user` continua no parâmetro porque quem calcula `podeUsar` é o hook, que
 * já leu o perfil — aqui ele serve só para o menu funcionar sem o hook (menu
 * estático), caso em que só o Disparador aparece.
 */
export function gruposDeFerramentas(
  externas?: AcessoFerramentasExternas,
): GrupoDeFerramentas[] {
  const pode = (slug: string) => Boolean(externas?.podeUsar[slug])
  const sistemas: DestinoNav[] = [
    ...(pode('analise-prn') ? [ANALISE_PRN] : []),
    ...(pode('rateio-mobilemed') ? [RATEIO] : []),
    ...(pode('gestao-medica') ? [GESTAO_MEDICA] : []),
    ...(pode('proposta-comercial') ? [PROPOSTA_COMERCIAL] : []),
    ...(pode('relatorios') ? [RELATORIOS] : []),
    ...(pode('licitacoes') ? [LICITACOES] : []),
    ...(pode('prn-hub') ? [PRN_HUB] : []),
    // De todo mundo POR PADRÃO, como desde 26/08/2026 — quem entrar na equipe
    // amanhã já tem, sem ninguém precisar lembrar de liberar. A diferença desde
    // 09/09 é que dá para bloquear uma pessoa, e por isso ele passa por `pode`.
    ...(pode('disparador-em-massa') ? [DISPARADOR_EM_MASSA] : []),
    ...(pode('controle-mensagens') ? [CONTROLE_MENSAGENS] : []),
    // O RELATÓRIO APP CONTINUA SÓ SUPER-ADMIN POR PADRÃO — a diferença desde
    // 09/09 é que dá para abrir exceção sem promover ninguém a super-admin. A
    // razão de ser tão fechado está no catálogo, junto do padrão dele.
    ...(pode('relatorio-app') ? [RELATORIO_APP] : []),
  ]

  return [
    /*
      O filtro é feito aqui, e não na lista: `FERRAMENTAS_DO_APP` também é lida
      pelo `lib/hub/onde-estou.ts` para descobrir o NOME da tela, e lá ela
      precisa estar inteira — quem foi bloqueado no Whats continua reportando
      problema com `[Whats]` na frente, se chegar lá por outro caminho.
    */
    {
      titulo: 'Do app',
      itens: FERRAMENTAS_DO_APP.filter((item) => podeVerRota(item.url, externas?.podeUsar ?? {})),
    },
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
 *
 * **Tema e Últimas atualizações entraram aqui em 04/09**, saindo dos botões
 * soltos da barra do desktop. A barra estava virando um paliteiro de ícones sem
 * rótulo, e as duas são coisas que se mexe uma vez por semana, não a cada
 * atendimento. Como o celular já tinha as duas escritas à mão na folha "Mais",
 * elas foram REMOVIDAS de lá — agora as duas cascas leem esta lista, que é o
 * ponto desta função existir.
 *
 * `temaEscuro` entra por parâmetro para o item de tema poder trocar rótulo e
 * ícone (Sol/"Modo claro" quando está escuro, e vice-versa) sem que Header e
 * folha do celular precisem cada um repetir esse `if`. É opcional: quem não
 * passar recebe o rótulo do modo escuro, que é o padrão do app.
 */
export function itensDeConta(
  user: UsuarioDeNav | null | undefined,
  opcoes?: { temaEscuro?: boolean },
): ItemDeFerramenta[] {
  const escuro = opcoes?.temaEscuro ?? true
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
      // Rótulo e ícone dizem PARA ONDE vai, não onde está: com o tema escuro
      // ligado, mostra sol e "Modo claro". É o mesmo comportamento do botão que
      // vivia solto na barra.
      title: escuro ? 'Modo claro' : 'Modo escuro',
      description: 'Aparência do app',
      icon: escuro ? Sun : Moon,
      action: 'tema',
    },
    {
      title: 'Últimas atualizações',
      // A versão fica na descrição porque a folha do celular já mostrava assim,
      // e é o único lugar do app onde dá para conferir em que build você está.
      // O menu do desktop não renderiza descrição, então lá isso é inócuo.
      description: `Versão ${getBundleVersion() ?? '—'}`,
      icon: Sparkles,
      action: 'novidades',
    },
    {
      title: 'Configurações',
      description: 'Preferências do app',
      icon: Settings,
      url: '/settings/general',
    },
  ]
}
