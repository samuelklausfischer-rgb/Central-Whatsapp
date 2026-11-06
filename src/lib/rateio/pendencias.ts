import type { RateioPendencia } from '@/services/rateio/rateio-service'

// Como cada pendência do motor (n8n) aparece na tela. `critica` = o valor rateado
// está errado ou incompleto e o rateio não deve ser usado antes de corrigir; as demais
// são avisos de cadastro. Tipo desconhecido aparece como veio, como aviso.
const PENDENCIA_INFO: Record<string, { titulo: string; critica: boolean }> = {
  PORTAL_QTDE_DIVERGENTE: { titulo: 'Portal dividido por quantidade diferente da cobrada', critica: true },
  PORTAL_TOTAL_DIVERGENTE: { titulo: 'Total de portal diferente da fatura da Mobilemed', critica: true },
  PORTAL_SEM_UNIDADE_ELEGIVEL: { titulo: 'Nenhuma unidade marcada com portal', critica: true },
  ADICIONAL_SEM_UNIDADE_ATIVA: { titulo: 'Serviço adicional não foi rateado', critica: true },
  ADICIONAL_TOTAL_DIVERGENTE: { titulo: 'Total do serviço adicional não fecha', critica: true },
  PORTAL_LISTA_AUSENTE: { titulo: 'Aba PORTAL não encontrada — portal dividido pelo cadastro', critica: false },
  UNIDADE_SEM_CADASTRO: { titulo: 'Unidade sem cadastro', critica: false },
  MODALIDADE_SEM_PRECO: { titulo: 'Modalidade sem preço na planilha VALORES', critica: false },
  PRODUTO_SHEET_DESCONHECIDO: { titulo: 'Produto da planilha não mapeado', critica: false },
  ADICIONAL_UNIDADE_FORA_DO_RESULTADO: {
    titulo: 'Serviço adicional em unidade sem exames no mês ou fora do cadastro (valor lançado em linha própria)',
    critica: false,
  },
}

export function tituloPendencia(tipo: string): string {
  return PENDENCIA_INFO[tipo]?.titulo || tipo
}

export function pendenciaCritica(p: RateioPendencia): boolean {
  return PENDENCIA_INFO[p.tipo]?.critica === true
}

// Críticas primeiro, mantendo a ordem do motor dentro de cada grupo.
export function ordenarPendencias(pendencias: RateioPendencia[]): RateioPendencia[] {
  return [...pendencias.filter(pendenciaCritica), ...pendencias.filter((p) => !pendenciaCritica(p))]
}

// O portal só fica com o valor cheio por unidade quando a quantidade de unidades que
// receberam portal bate com a quantidade cobrada pela Mobilemed.
const TIPOS_PORTAL_DIVERGENTE = ['PORTAL_QTDE_DIVERGENTE', 'PORTAL_TOTAL_DIVERGENTE']

export function pendenciaPortalDivergente(
  pendencias: RateioPendencia[] | null | undefined,
): RateioPendencia | undefined {
  return (pendencias || []).find((p) => TIPOS_PORTAL_DIVERGENTE.includes(p.tipo))
}
