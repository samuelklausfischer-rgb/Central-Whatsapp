import { FERRAMENTAS_HOSPEDADAS } from '@/components/tools/ToolHost'
import { DESTINOS_PRINCIPAIS } from '@/lib/navegacao'

/**
 * Descobre de ONDE a pessoa está reportando, e para qual projeto do PRN Hub
 * aquilo pertence.
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
  | 'emails-organizado-prn-hub'

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
 * Telas que não são ferramenta mas têm projeto próprio.
 *
 * Só o Email tem, por decisão do Samuel (08/09): o código está neste
 * repositório, mas a frente de email é acompanhada à parte no Hub.
 */
const PROJETO_DA_ROTA: { prefixo: string; projeto: ProjetoDoHub }[] = [
  { prefixo: '/email', projeto: 'emails-organizado-prn-hub' },
]

export interface OndeEstou {
  /** Slug do projeto no Hub, para onde o relato vai. */
  projeto: ProjetoDoHub
  /** Nome amigável do lugar, para mostrar na tela e gravar no relato. */
  lugar: string
  /** Slug da ferramenta, quando é uma. `null` nas telas comuns. */
  ferramentaSlug: string | null
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
    return {
      projeto: PROJETO_DA_FERRAMENTA[ferramentaAtiva] ?? 'central-whats',
      lugar: hospedada?.titulo ?? ferramentaAtiva,
      ferramentaSlug: ferramentaAtiva,
    }
  }

  const porRota = PROJETO_DA_ROTA.find((r) => pathname.startsWith(r.prefixo))
  // O nome da tela sai do próprio menu, para o relato falar a mesma língua que a
  // pessoa vê no topo do app.
  const destino = DESTINOS_PRINCIPAIS.find(
    (d) => pathname === d.url || pathname.startsWith(`${d.url}/`),
  )

  return {
    projeto: porRota?.projeto ?? 'central-whats',
    lugar: destino?.title ?? 'Central Whats',
    ferramentaSlug: null,
  }
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
  'emails-organizado-prn-hub': 'Emails Organizado',
}
