import type { ToolName } from '@/services/tool_access'
import { canAccessFinanceiroTools, canAccessGestaoMedica } from '@/lib/permissions'
import type { Profile } from '@/lib/supabase/types'

/**
 * O catálogo das ferramentas e de QUEM PODE USAR CADA UMA.
 *
 * POR QUE ISTO EXISTE. Havia quatro listas discordando sobre o que é
 * "ferramenta": a união `ToolName` (`services/tool_access.ts`), o
 * `AcessoFerramentasExternas` (`lib/navegacao.ts`), o que o `use-tool-access`
 * lê, e `FERRAMENTAS_HOSPEDADAS` (`ToolHost.tsx`, 11). O sintoma que o Samuel
 * viu: a Gestão de Equipe só tinha caixa para DUAS ferramentas, enquanto
 * `prn-hub` e `controle-mensagens` já funcionavam por liberação pessoa a pessoa
 * e **só podiam ser liberadas por SQL**, porque ninguém lembrou de criar o
 * botão.
 *
 * Desde 09/09/2026 ele cobre o app INTEIRO: as onze ferramentas e as telas do
 * próprio Central Whats — Whats, Email, Agenda, Tarefas, Anotações, Atalhos e
 * Agendamentos. Cada uma tem um padrão, e o padrão aceita exceção pessoa a
 * pessoa. `podeUsarFerramenta`, no fim do arquivo, é a regra inteira num lugar
 * só.
 *
 * A única sem controle é o PAINEL, e por um motivo mecânico: todo bloqueio
 * redireciona para `/dashboard`. Escondê-lo transformaria o redirecionamento
 * num laço.
 */

/**
 * Como a Gestão de Equipe desenha o controle.
 *
 * - `excecao` — TODAS, menos o Painel. Cada uma tem um padrão (ninguém, setor,
 *   admin, super-admin, cadastro em outro sistema, ou todo mundo) e aceita
 *   exceção por cima: seguir o padrão, liberar à força, bloquear à força.
 *
 *   Havia um `'pessoa'` aqui até 09/09/2026, para as quatro cujo padrão é
 *   "ninguém tem" — elas viravam caixa de sim/não, e a lista ficava com três
 *   controles diferentes na mesma tela. O tipo saiu: "ninguém tem" é só mais um
 *   padrão, e uma forma só de linha é o que o Samuel pediu. Nelas o "bloquear"
 *   dá no mesmo resultado do padrão, mas registra que a negação foi decisão.
 * - `fixa` — não há o que controlar. Só o Painel: ele é a casa do app e o
 *   destino de TODO redirecionamento de bloqueio, então esconder-lo criaria
 *   laço. Aparece na lista assim mesmo, com a explicação, pelo mesmo motivo que
 *   as outras aparecem: mostrar o quadro completo evita a pergunta "cadê?".
 */
export type TipoDeLiberacao = 'excecao' | 'fixa'

/**
 * Onde a coisa vive.
 *
 * `tela` são as páginas do próprio Central Whats; `sistema`, as ferramentas.
 * A Gestão de Equipe separa em dois blocos — vinte itens numa lista corrida
 * viram um paredão que ninguém lê.
 */
export type GrupoDeFerramenta = 'tela' | 'sistema'

/** O que a regra precisa saber sobre a pessoa. Subconjunto do perfil. */
export type PerfilDeAcesso = Pick<Profile, 'is_admin' | 'department'> & {
  is_super_admin?: boolean | null
}

export interface ContextoDeAcesso {
  perfil: PerfilDeAcesso
  /**
   * Tem cadastro no Sistema de Relatórios (`relatorios.profiles`)?
   *
   * `null` quando ninguém consultou — é o caso da Gestão de Equipe, que decide
   * sobre OUTRA pessoa e não tem como ler o cadastro dela no outro sistema.
   */
  temPerfilRelatorios: boolean | null
}

export interface FerramentaDoCatalogo {
  /** Slug da rota, o mesmo de `FERRAMENTAS_HOSPEDADAS` e do `App.tsx`. */
  slug: string
  /** Nome como aparece no menu. */
  titulo: string
  grupo: GrupoDeFerramenta
  liberacao: TipoDeLiberacao
  /** Chave em `tool_access`. Todas as controláveis têm; a `fixa` não. */
  chave?: ToolName
  /** Rota da tela. Só nas do grupo `tela`, para o menu casar por URL. */
  url?: string
  /** O que dizer na Gestão de Equipe. */
  explicacao?: string
  /** Quem tem a ferramenta sem exceção nenhuma gravada. */
  padrao?: (ctx: ContextoDeAcesso) => boolean
  /** Como explicar o padrão na tela: "Financeiro e administradores". */
  padraoDescricao?: string
  /**
   * O padrão não é calculável na Gestão de Equipe (depende de outro sistema),
   * então o botão não promete "tem" nem "não tem".
   */
  padraoDependeDeOutroSistema?: boolean
}

export const CATALOGO_DE_FERRAMENTAS: FerramentaDoCatalogo[] = [
  /*
    ── AS TELAS DO PRÓPRIO APP ──────────────────────────────────────────────
    Padrão "todos", porque é o que sempre foi: até 09/09/2026 nenhuma delas
    tinha porteiro. A novidade é poder esconder uma tela de uma pessoa.
  */
  {
    slug: 'tela-dashboard',
    titulo: 'Painel',
    grupo: 'tela',
    liberacao: 'fixa',
    url: '/dashboard',
    explicacao:
      'A casa do app, e o destino de todo bloqueio — por isso não pode ser escondida. Sem ela, quem perdesse a última tela ficaria num laço de redirecionamento.',
  },
  {
    slug: 'tela-chat',
    titulo: 'Whats',
    grupo: 'tela',
    liberacao: 'excecao',
    chave: 'tela-chat',
    url: '/chat',
    explicacao:
      'Conversas do WhatsApp. Bloquear esconde a tela e cala o som de mensagem nova. ⚠️ Não revoga os dados: para tirar o WhatsApp de verdade, use a lista de aparelhos abaixo.',
    padrao: () => true,
    padraoDescricao: 'Todos',
  },
  {
    slug: 'tela-email',
    titulo: 'Email',
    grupo: 'tela',
    liberacao: 'excecao',
    chave: 'tela-email',
    url: '/email',
    explicacao: 'Caixa de entrada do Outlook dentro do app.',
    padrao: () => true,
    padraoDescricao: 'Todos',
  },
  {
    slug: 'tela-email-campanhas',
    titulo: 'Campanhas de e-mail',
    grupo: 'tela',
    liberacao: 'excecao',
    chave: 'tela-email-campanhas',
    url: '/email/campanhas',
    explicacao:
      'Disparo para listas. É uma tela à parte do Email; quem tiver o Email escondido não vê a entrada, mas o bloqueio dela é independente.',
    padrao: () => true,
    padraoDescricao: 'Todos',
  },
  {
    slug: 'tela-agenda',
    titulo: 'Agenda',
    grupo: 'tela',
    liberacao: 'excecao',
    chave: 'tela-agenda',
    url: '/agenda',
    explicacao: 'Compromissos. Bloquear esconde a tela e os avisos de compromisso.',
    padrao: () => true,
    padraoDescricao: 'Todos',
  },
  {
    slug: 'tela-crm',
    titulo: 'Tarefas',
    grupo: 'tela',
    liberacao: 'excecao',
    chave: 'tela-crm',
    url: '/crm',
    explicacao: 'Kanban interno.',
    padrao: () => true,
    padraoDescricao: 'Todos',
  },
  {
    slug: 'tela-notes',
    titulo: 'Anotações',
    grupo: 'tela',
    liberacao: 'excecao',
    chave: 'tela-notes',
    url: '/notes',
    explicacao: 'Notas rápidas.',
    padrao: () => true,
    padraoDescricao: 'Todos',
  },
  {
    slug: 'tela-triggers',
    titulo: 'Atalhos de mensagem',
    grupo: 'tela',
    liberacao: 'excecao',
    chave: 'tela-triggers',
    url: '/triggers',
    explicacao: 'Respostas prontas do atendimento.',
    padrao: () => true,
    padraoDescricao: 'Todos',
  },
  {
    slug: 'tela-scheduled-messages',
    titulo: 'Agendamentos',
    grupo: 'tela',
    liberacao: 'excecao',
    chave: 'tela-scheduled-messages',
    url: '/scheduled-messages',
    explicacao: 'Envios futuros de WhatsApp.',
    padrao: () => true,
    padraoDescricao: 'Todos',
  },
  {
    slug: 'licitacoes',
    titulo: 'Licitações',
    grupo: 'sistema',
    liberacao: 'excecao',
    chave: 'licitacoes',
    explicacao: 'Cria a conta da pessoa lá no primeiro acesso.',
    padrao: () => false,
    padraoDescricao: 'Ninguém, sem liberar',
  },
  {
    slug: 'proposta-comercial',
    titulo: 'Proposta Comercial',
    grupo: 'sistema',
    liberacao: 'excecao',
    chave: 'proposta-comercial',
    explicacao: 'Gerador de proposta em PDF, Word, Excel e ZIP.',
    padrao: () => false,
    padraoDescricao: 'Ninguém, sem liberar',
  },
  {
    slug: 'prn-hub',
    titulo: 'PRN Hub Dev',
    grupo: 'sistema',
    liberacao: 'excecao',
    chave: 'prn-hub',
    explicacao: 'Fila de problemas e ideias dos projetos.',
    padrao: () => false,
    padraoDescricao: 'Ninguém, sem liberar',
  },
  {
    slug: 'controle-mensagens',
    titulo: 'Controle de Mensagens',
    grupo: 'sistema',
    liberacao: 'excecao',
    chave: 'controle-mensagens',
    explicacao: 'Relatório de tempo de resposta da equipe.',
    padrao: () => false,
    padraoDescricao: 'Ninguém, sem liberar',
  },
  {
    slug: 'analise-prn',
    titulo: 'Cruzar Contas',
    grupo: 'sistema',
    liberacao: 'excecao',
    chave: 'analise-prn',
    explicacao: 'Cruzamento de registros e duplicidade.',
    padrao: (c) => canAccessFinanceiroTools(c.perfil),
    padraoDescricao: 'Financeiro e administradores',
  },
  {
    slug: 'rateio-mobilemed',
    titulo: 'Rateio',
    grupo: 'sistema',
    liberacao: 'excecao',
    chave: 'rateio-mobilemed',
    explicacao: 'Rateio PRN/MedImagem.',
    padrao: (c) => canAccessFinanceiroTools(c.perfil),
    padraoDescricao: 'Financeiro e administradores',
  },
  {
    slug: 'gestao-medica',
    titulo: 'Gestão Médica',
    grupo: 'sistema',
    liberacao: 'excecao',
    chave: 'gestao-medica',
    // A diferença importa: esta é a única das de setor cuja regra também vive
    // DENTRO do banco (`gestao_medica._pode_usar()`), espelhada desde 09/09.
    explicacao: 'Cadastro de médicos, contratos e documentos.',
    padrao: (c) => canAccessGestaoMedica(c.perfil),
    padraoDescricao: 'Administrativo',
  },
  {
    slug: 'relatorio-app',
    titulo: 'Relatório App',
    grupo: 'sistema',
    liberacao: 'excecao',
    chave: 'relatorio-app',
    explicacao: 'Uso do app por usuário.',
    /*
      SUPER-ADMIN, e não `is_admin` — a razão vinha do `SuperAdminRoute`, que
      esta linha aposentou: `is_admin` não considera `devices_restricted`, então
      um admin com acesso deliberadamente limitado a aparelhos ainda leria a
      atividade da equipe inteira por aqui. Liberar mesmo assim continua
      possível, agora sem precisar promover ninguém a super-admin.
    */
    padrao: (c) => Boolean(c.perfil.is_super_admin),
    padraoDescricao: 'Só administração',
  },
  {
    slug: 'relatorios',
    titulo: 'Gestor de Tarefas',
    grupo: 'sistema',
    liberacao: 'excecao',
    chave: 'relatorios',
    explicacao:
      'O padrão é ter conta no Sistema de Relatórios. ⚠️ "Liberar" abre a porta daqui, mas não cria a conta lá — sem ela a ferramenta abre e nega.',
    padrao: (c) => c.temPerfilRelatorios === true,
    padraoDescricao: 'Quem tem conta no Sistema de Relatórios',
    padraoDependeDeOutroSistema: true,
  },
  {
    slug: 'disparador-em-massa',
    titulo: 'Disparador em massa',
    grupo: 'sistema',
    liberacao: 'excecao',
    chave: 'disparador-em-massa',
    explicacao:
      'Envio em massa por WhatsApp e campanhas de e-mail. Bloquear aqui vale também no banco, pela `pode_disparar()`.',
    padrao: () => true,
    padraoDescricao: 'Todos',
  },
  {
    slug: 'assinaturas',
    titulo: 'Assinaturas',
    grupo: 'sistema',
    liberacao: 'excecao',
    chave: 'assinaturas',
    explicacao: 'Gerador da assinatura de e-mail. Todo funcionário monta a sua.',
    padrao: () => true,
    padraoDescricao: 'Todos',
  },
]

/** As que a Gestão de Equipe controla — todas menos o Painel. */
export const FERRAMENTAS_CONTROLAVEIS = CATALOGO_DE_FERRAMENTAS.filter(
  (f): f is FerramentaDoCatalogo & { chave: ToolName } => !!f.chave,
)

/**
 * Rota → slug, para o menu poder perguntar "posso ver este item?" tendo em mãos
 * só a URL.
 *
 * As telas trazem a `url` escrita; as ferramentas moram todas em
 * `/ferramentas/<slug>`, então a delas é derivada — repetir seria só mais uma
 * chance de as duas discordarem.
 */
export const SLUG_DA_ROTA: Record<string, string> = Object.fromEntries(
  CATALOGO_DE_FERRAMENTAS.map((f) => [f.url ?? `/ferramentas/${f.slug}`, f.slug]),
)

/**
 * Um item de menu pode aparecer?
 *
 * O que NÃO está no catálogo aparece: Configurações, Gestão de Equipe e as
 * ações do menu de conta não são ferramentas, e têm os próprios porteiros.
 */
export function podeVerRota(url: string, podeUsar: Record<string, boolean>): boolean {
  const slug = SLUG_DA_ROTA[url]
  return slug === undefined || Boolean(podeUsar[slug])
}

export const ROTULO_DA_LIBERACAO: Record<TipoDeLiberacao, string> = {
  excecao: 'padrão, com exceção por pessoa',
  fixa: 'sempre visível',
}

/** O estado de uma pessoa numa ferramenta, como a Gestão de Equipe desenha. */
export type EstadoDeAcesso = 'padrao' | 'liberar' | 'bloquear'

/**
 * A REGRA INTEIRA, em ordem.
 *
 *   super-admin      -> tem. Nunca bloqueável: é a escotilha contra alguém se
 *                       trancar para fora da própria tela de permissões.
 *   exceção bloquear -> não tem. Vence o setor E o `is_admin` — foi a decisão do
 *                       Samuel em 09/09, e sem ela o bloqueio erraria a maioria:
 *                       das 9 pessoas que viam Cruzar Contas, 5 entravam por
 *                       serem admin, não pelo setor.
 *   exceção liberar  -> tem.
 *   senão            -> o padrão da ferramenta.
 *
 * ⚠️ ESTA REGRA É PORTEIRO DE TELA. Duas ferramentas têm o espelho dela dentro
 * do banco, que é o que vale de verdade: `gestao_medica._pode_usar()` e
 * `public.pode_disparar()`. Se divergirem, o banco ganha — mudar uma exige
 * mudar a outra.
 */
export function podeUsarFerramenta(
  slug: string,
  perfil: PerfilDeAcesso | null | undefined,
  excecoes: Map<string, boolean>,
  temPerfilRelatorios: boolean | null = null,
): boolean {
  if (!perfil) return false
  if (perfil.is_super_admin) return true

  const ferramenta = CATALOGO_DE_FERRAMENTAS.find((f) => f.slug === slug)
  if (!ferramenta) return false

  // Sem chave é a `fixa`: o Painel, que ninguém esconde.
  if (!ferramenta.chave) return true

  const excecao = excecoes.get(ferramenta.chave)
  if (excecao !== undefined) return excecao

  return ferramenta.padrao?.({ perfil, temPerfilRelatorios }) ?? false
}
