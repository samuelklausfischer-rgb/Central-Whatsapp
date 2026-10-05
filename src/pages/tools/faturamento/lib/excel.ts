// Montagem da planilha de simulação no padrão de agosto do SharePoint (aba única: exames + resumo).
import * as XLSX from 'xlsx'

export type Celula = string | number | null

export interface ExameLinha {
  nome_bruto: string
  nome_paciente?: string | null; estudo_descricao?: string | null; accession_number?: string | null
  modalidade?: string | null; prioridade?: string | null; medico?: string | null
  quantidade: number; valor_unitario: number; valor_total: number
  duplicado?: string | null; data_exame?: string | null; data_transferencia?: string | null
  data_conclusao?: string | null; data_prazo?: string | null; status_bruto?: string | null
  imagem_chave?: string | null; digitador?: string | null
}

export interface ResumoItem { rotulo: string; quantidade: number; total: number; fixo: boolean }

export const CABECALHO = [
  'Unidade', 'Nome_Paciente', 'Estudo_Descricao', 'Accession_Number', 'Modalidade', 'Prioridade', 'Medico',
  'Quantidade', 'Valor', 'Total', 'Duplicado', 'Data_Exame', 'Data_Transferencia', 'Data_Conclusao',
  'Data_Prazo', 'Status', 'Imagem_Chave', 'Digitador',
]

const FMT_NUM = '#,##0.00'

export function montarPlanilha(exames: ExameLinha[], resumo: ResumoItem[]): Celula[][] {
  const aoa: Celula[][] = [[...CABECALHO]]
  for (const e of exames) {
    aoa.push([
      e.nome_bruto, e.nome_paciente ?? null, e.estudo_descricao ?? null, e.accession_number ?? null,
      e.modalidade ?? null, e.prioridade ?? null, e.medico ?? null,
      e.quantidade, e.valor_unitario, e.valor_total,
      e.duplicado ?? null, e.data_exame ?? null, e.data_transferencia ?? null, e.data_conclusao ?? null,
      e.data_prazo ?? null, e.status_bruto ?? null, e.imagem_chave ?? null, e.digitador ?? null,
    ])
  }
  aoa.push([], [])
  aoa.push(['MODALIDADE', 'QUANTIDADE', 'TOTAL'])
  const naoFixos = resumo.filter(r => !r.fixo)
  const fixos = resumo.filter(r => r.fixo)
  for (const r of naoFixos) aoa.push([r.rotulo, r.quantidade, r.total])
  for (const r of fixos) aoa.push([r.rotulo, 1, r.total])
  const qtd = naoFixos.reduce((s, r) => s + r.quantidade, 0) + fixos.length
  const total = resumo.reduce((s, r) => s + r.total, 0)
  aoa.push(['TOTAL', qtd, Math.round(total * 100) / 100])
  return aoa
}

export function gerarXlsx(aoa: Celula[][], nomeAba = 'Planilha1'): Uint8Array {
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  const nExames = aoa.findIndex(l => l[0] === 'MODALIDADE') // linha do cabeçalho do resumo (0-based)
  for (let r = 1; r < aoa.length; r++) {
    // Valor/Total nas linhas de exame; TOTAL (3ª coluna) no bloco do resumo
    const colunas = nExames > 0 && r > nExames ? [2] : nExames > 0 && r === nExames ? [] : [8, 9]
    for (const c of colunas) {
      const cel = ws[XLSX.utils.encode_cell({ r, c })]
      if (cel && cel.t === 'n') cel.z = FMT_NUM
    }
  }
  ws['!cols'] = [{ wch: 28 }, { wch: 30 }, { wch: 34 }, { wch: 16 }, { wch: 11 }, { wch: 11 }, { wch: 24 }, { wch: 11 }, { wch: 11 }, { wch: 12 }]
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, nomeAba)
  return new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer)
}

export function nomeArquivo(nomeBruto: string, competencia: string, periodo: string): string {
  const [aaaa, mm] = competencia.split('-')
  const limpo = nomeBruto.replace(/[/:*?"<>|]/g, '').replace(/\s+/g, ' ').trim()
  return `${limpo} ${mm}.${aaaa}${periodo ? ' ' + periodo : ''}.xlsx`
}
