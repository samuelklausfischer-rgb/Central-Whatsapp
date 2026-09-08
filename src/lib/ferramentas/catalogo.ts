import type { ToolName } from '@/services/tool_access'

/**
 * O catálogo das ferramentas e de COMO cada uma é liberada.
 *
 * POR QUE ISTO EXISTE. Havia quatro listas discordando sobre o que é
 * "ferramenta": a união `ToolName` (`services/tool_access.ts`, 4 chaves),
 * `AcessoFerramentasExternas` (`lib/navegacao.ts`, 5), o que o
 * `use-tool-access` lê (5), e `FERRAMENTAS_HOSPEDADAS` (`ToolHost.tsx`, 11).
 * O sintoma que o Samuel viu: a Gestão de Equipe só tinha caixa para DUAS
 * ferramentas, enquanto `prn-hub` e `controle-mensagens` já funcionavam por
 * liberação pessoa a pessoa e **só podiam ser liberadas por SQL**, porque
 * ninguém lembrou de criar o botão.
 *
 * O catálogo não substitui as outras listas de uma vez — quem decide rota é o
 * `App.tsx`, quem decide menu é o `navegacao.ts`. Ele responde uma pergunta só,
 * e é a que a tela de Gestão de Equipe precisa: **quais ferramentas existem e
 * quem manda em cada uma**.
 */

/**
 * Como uma ferramenta é liberada.
 *
 * - `pessoa` — linha em `public.tool_access`. É a única que vira caixa de
 *   seleção, porque é a única que se decide por pessoa.
 * - `setor` — depende do setor no perfil. Mudar isso é mudar o setor da pessoa,
 *   não marcar uma caixa; e no caso da Gestão Médica a mesma regra está
 *   espelhada numa função do banco (`gestao_medica._pode_usar()`), então uma
 *   caixa aqui abriria o menu para uma tela que negaria na cara.
 * - `super-admin` — só o Samuel.
 * - `externo` — depende de cadastro em OUTRO sistema (o Gestor de Tarefas exige
 *   linha em `relatorios.profiles`). Liberar aqui sem o cadastro de lá abriria
 *   uma porta que bate na cara — está escrito assim no `use-tool-access`.
 * - `livre` — qualquer pessoa logada.
 */
export type TipoDeLiberacao = 'pessoa' | 'setor' | 'super-admin' | 'externo' | 'livre'

export interface FerramentaDoCatalogo {
  /** Slug da rota, o mesmo de `FERRAMENTAS_HOSPEDADAS` e do `App.tsx`. */
  slug: string
  /** Nome como aparece no menu. */
  titulo: string
  liberacao: TipoDeLiberacao
  /** Chave em `tool_access` — só quando `liberacao === 'pessoa'`. */
  chave?: ToolName
  /** O que dizer na Gestão de Equipe quando não há caixa para marcar. */
  explicacao?: string
}

export const CATALOGO_DE_FERRAMENTAS: FerramentaDoCatalogo[] = [
  {
    slug: 'licitacoes',
    titulo: 'Licitações',
    liberacao: 'pessoa',
    chave: 'licitacoes',
    explicacao: 'Cria a conta da pessoa lá no primeiro acesso.',
  },
  {
    slug: 'proposta-comercial',
    titulo: 'Proposta Comercial',
    liberacao: 'pessoa',
    chave: 'proposta-comercial',
    explicacao: 'Gerador de proposta em PDF, Word, Excel e ZIP.',
  },
  {
    slug: 'prn-hub',
    titulo: 'PRN Hub Dev',
    liberacao: 'pessoa',
    chave: 'prn-hub',
    explicacao: 'Fila de problemas e ideias dos projetos.',
  },
  {
    slug: 'controle-mensagens',
    titulo: 'Controle de Mensagens',
    liberacao: 'pessoa',
    chave: 'controle-mensagens',
    explicacao: 'Relatório de tempo de resposta da equipe.',
  },
  {
    slug: 'relatorios',
    titulo: 'Gestor de Tarefas',
    liberacao: 'externo',
    explicacao:
      'Depende de a pessoa estar cadastrada no Sistema de Relatórios. Marcar aqui não bastaria: o menu abriria e a ferramenta negaria.',
  },
  {
    slug: 'analise-prn',
    titulo: 'Cruzar Contas',
    liberacao: 'setor',
    explicacao: 'Liberada para quem é do setor Financeiro, e para administradores.',
  },
  {
    slug: 'rateio-mobilemed',
    titulo: 'Rateio',
    liberacao: 'setor',
    explicacao: 'Liberada para quem é do setor Financeiro, e para administradores.',
  },
  {
    slug: 'gestao-medica',
    titulo: 'Gestão Médica',
    liberacao: 'setor',
    explicacao:
      'Liberada para quem é do setor Administrativo. A mesma regra vale dentro do banco — mudar só aqui abriria o menu para uma tela que negaria.',
  },
  {
    slug: 'relatorio-app',
    titulo: 'Relatório App',
    liberacao: 'super-admin',
    explicacao: 'Uso interno de quem administra o app.',
  },
  { slug: 'disparador-em-massa', titulo: 'Disparador em massa', liberacao: 'livre' },
  { slug: 'assinaturas', titulo: 'Assinaturas', liberacao: 'livre' },
]

/** As que viram caixa de seleção na Gestão de Equipe. */
export const FERRAMENTAS_POR_PESSOA = CATALOGO_DE_FERRAMENTAS.filter(
  (f): f is FerramentaDoCatalogo & { chave: ToolName } => f.liberacao === 'pessoa' && !!f.chave,
)

export const ROTULO_DA_LIBERACAO: Record<TipoDeLiberacao, string> = {
  pessoa: 'pessoa a pessoa',
  setor: 'pelo setor',
  'super-admin': 'só administração',
  externo: 'por outro sistema',
  livre: 'todos têm acesso',
}
