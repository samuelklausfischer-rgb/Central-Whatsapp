import { FERRAMENTAS_HOSPEDADAS } from '@/components/tools/ToolHost'
import { DESTINOS_PRINCIPAIS, FERRAMENTAS_DO_APP } from '@/lib/navegacao'

/**
 * Descobre de ONDE a pessoa está reportando, para qual projeto do PRN Hub aquilo
 * pertence, e que etiqueta o título deve levar na frente.
 *
 * O problema que isto resolve: o botão "Reportar problema" mandava tudo para o
 * projeto `central-whats`, fixo. Medido no banco, os 26 relatos feitos pelo
 * botão foram todos para lá — mesmo os escritos de dentro do PRN Hub Dev ou da
 * Proposta Comercial, que têm fila própria. O relato chegava no lugar errado e
 * alguém tinha que mover na mão.
 *
 * ⚠️ O QUE NÃO DÁ PARA SABER. As ferramentas embutidas são iframes de outros
 * apps. Com a pessoa dentro do PRN Hub, `window.location.href` é o NOSSO
 * endereço (`/ferramentas/prn-hub`) — a navegação interna do app filho é
 * inacessível por ser outra origem. Dá para dizer em que FERRAMENTA a pessoa
 * está, nunca em que tela dentro dela.
 */

/** Slug do projeto em `hub_projetos`, do lado do PRN Hub. */
export type ProjetoDoHub =
  | 'central-whats'
  | 'prn-hub'
  | 'prn-proposta-comercial'
  | 'prn-gestao-medica'
  | 'prn-licitacao-emails'
  | 'sistema-relatorios'
  | 'prn-rateio'
  | 'prn-financeiro'

/**
 * Ferramenta embutida → projeto dono dela.
 *
 * As chaves são os slugs de `FERRAMENTAS_HOSPEDADAS`. O que não estiver aqui
 * cai em `central-whats`, que é onde o código mora — é o padrão certo, não um
 * descarte: Controle de Mensagens, Disparador, Assinaturas e Relatório App são
 * telas deste repositório.
 */
const PROJETO_DA_FERRAMENTA: Record<string, ProjetoDoHub> = {
  'prn-hub': 'prn-hub',
  'proposta-comercial': 'prn-proposta-comercial',
  'gestao-medica': 'prn-gestao-medica',
  licitacoes: 'prn-licitacao-emails',
  relatorios: 'sistema-relatorios',
  'rateio-mobilemed': 'prn-rateio',
  // Decisão do Samuel (08/09): a tela mora aqui, mas o acompanhamento é feito
  // na fila financeira.
  'analise-prn': 'prn-financeiro',
}

/**
 * As telas internas do app, para o relato dizer o NOME em vez de deixar o link
 * ser a única pista.
 *
 * POR QUE ISTO EXISTE. Até 08/09 o nome saía só de `DESTINOS_PRINCIPAIS`, que
 * tem quatro entradas. Quem reportava de Tarefas, Anotações, Atalhos de
 * mensagem, Agendamentos, Gestão de Equipe ou Configurações não era reconhecido
 * e caía no rótulo genérico "Central Whats" — numa fila com 87 itens
 * misturados, isso não diz nada.
 *
 * O EMAIL NÃO TEM MAIS FILA PRÓPRIA. De manhã `/email` apontava para o projeto
 * `emails-organizado-prn-hub`; na mesma tarde o Samuel decidiu que as telas
 * internas dividem uma fila só e quem separa é a etiqueta. Foi seguro desfazer
 * porque aquele projeto tinha **0 relatos** — nada ficou órfão, e ele continua
 * existindo no Hub para lançamento manual.
 *
 * OS NOMES SÃO LIDOS DO MENU, não copiados: `DESTINOS_PRINCIPAIS` e
 * `FERRAMENTAS_DO_APP` são as mesmas listas que desenham a barra do desktop e a
 * folha do celular. Nome copiado envelhece — foi o que aconteceu com "Análise
 * PRN" depois do renome de 04/09. Só três ficam escritos aqui, porque não têm
 * entrada de menu para ler: `/email/campanhas` é rota irmã alcançada por um
 * `<Link>` dentro do EmailHub, e `/admin` e `/settings` moram dentro de
 * `itensDeConta(user, …)`, que exige usuário e devolve itens de ação
 * misturados.
 */
const TELAS_INTERNAS: { prefixo: string; nome: string }[] = [
  ...DESTINOS_PRINCIPAIS.map((d) => ({ prefixo: d.url, nome: d.title })),
  ...FERRAMENTAS_DO_APP.map((d) => ({ prefixo: d.url, nome: d.title })),
  { prefixo: '/email/campanhas', nome: 'Campanhas de e-mail' },
  { prefixo: '/admin', nome: 'Gestão de Equipe' },
  { prefixo: '/settings', nome: 'Configurações' },
  // Prefixo mais LONGO primeiro: sem isto `/email` engoliria
  // `/email/campanhas`, e a ordem passaria a depender de quem foi escrito antes.
].sort((a, b) => b.prefixo.length - a.prefixo.length)

export interface OndeEstou {
  /** Slug do projeto no Hub, para onde o relato vai. */
  projeto: ProjetoDoHub
  /** Nome amigável do lugar, para mostrar na tela e gravar no relato. */
  lugar: string
  /** Slug da ferramenta, quando é uma. `null` nas telas comuns. */
  ferramentaSlug: string | null
  /**
   * O que vai entre colchetes na frente do título. `null` = sem etiqueta.
   *
   * A regra é uma só: **etiqueta quando a fila é compartilhada**. Proposta,
   * Licitações, Rateio, Gestão Médica, Gestor de Tarefas, Cruzar Contas e PRN
   * Hub Dev têm fila própria, onde todo item já é daquele assunto — ali a
   * etiqueta seria repetição em toda linha. O mesmo critério alcança
   * Assinaturas, Controle de Mensagens, Disparador e Relatório App: são
   * ferramentas, mas dividem a fila do Central Whats com Agenda e Whats.
   */
  etiqueta: string | null
}

/**
 * @param ferramentaAtiva `ativa` da store `ferramentasVivas` — e nunca
 *   `vivas[0]`: até três ferramentas ficam montadas ao mesmo tempo, e só `ativa`
 *   responde "onde estou agora".
 * @param pathname `location.pathname`, para as telas que não são ferramenta.
 */
export function descobrirOndeEstou(
  ferramentaAtiva: string | null,
  pathname: string,
): OndeEstou {
  if (ferramentaAtiva) {
    const hospedada = FERRAMENTAS_HOSPEDADAS[ferramentaAtiva]
    const projeto = PROJETO_DA_FERRAMENTA[ferramentaAtiva] ?? 'central-whats'
    const lugar = hospedada?.titulo ?? ferramentaAtiva
    return {
      projeto,
      lugar,
      ferramentaSlug: ferramentaAtiva,
      etiqueta: projeto === 'central-whats' ? lugar : null,
    }
  }

  const tela = TELAS_INTERNAS.find(
    (t) => pathname === t.prefixo || pathname.startsWith(`${t.prefixo}/`),
  )

  return {
    projeto: 'central-whats',
    // Sem correspondência sobra o nome do app. Ele NÃO vira etiqueta: um
    // `[Central Whats]` na fila do Central Whats não informaria nada, e ainda
    // esconderia que aquela tela ficou sem mapeamento.
    lugar: tela?.nome ?? 'Central Whats',
    ferramentaSlug: null,
    etiqueta: tela?.nome ?? null,
  }
}

/**
 * O título como ele vai para a fila: `[Agenda] não consigo criar evento`.
 *
 * Existe como função para que a prévia mostrada no diálogo e o valor realmente
 * enviado não possam divergir — os dois chamam isto.
 */
export function comEtiqueta(titulo: string, onde: OndeEstou): string {
  if (!onde.etiqueta) return titulo
  // Quem já escreveu a própria etiqueta não recebe uma segunda.
  if (titulo.startsWith('[')) return titulo
  return `[${onde.etiqueta}] ${titulo}`
}

/** Nome do projeto como ele aparece no Hub, para confirmar antes de enviar. */
export const NOME_DO_PROJETO: Record<ProjetoDoHub, string> = {
  'central-whats': 'Central Whats',
  'prn-hub': 'PRN Hub Dev',
  'prn-proposta-comercial': 'PRN Proposta Comercial',
  'prn-gestao-medica': 'PRN Gestão Médica',
  'prn-licitacao-emails': 'PRN Licitação Emails',
  'sistema-relatorios': 'Sistema de Relatórios',
  'prn-rateio': 'PRN Rateio',
  'prn-financeiro': 'PRN Financeiro',
}
