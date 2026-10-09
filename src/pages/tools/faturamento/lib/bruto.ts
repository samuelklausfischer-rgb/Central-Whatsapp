// Leitura do Bruto.xlsx da Mobilemed no navegador (SheetJS). O arquivo não sobe inteiro para o servidor.
import * as XLSX from 'xlsx'
import type { LinhaBruto } from '../nucleo/motor'

// cabeçalho do arquivo → chave de LinhaBruto (a coluna Valor é ignorada de propósito)
const CHAVES: Record<string, keyof LinhaBruto> = {
  unidade: 'unidade', nome_paciente: 'nome_paciente', estudo_descricao: 'estudo_descricao',
  accession_number: 'accession_number', modalidade: 'modalidade', prioridade: 'prioridade', medico: 'medico',
  duplicado: 'duplicado', data_exame: 'data_exame', data_transferencia: 'data_transferencia',
  data_conclusao: 'data_conclusao', data_prazo: 'data_prazo', status: 'status',
  imagem_chave: 'imagem_chave', digitador: 'digitador',
}

export interface BrutoLido { linhas: LinhaBruto[]; nomes: Map<string, LinhaBruto[]>; grupo: string }
/** `mes`: mês do Bruto ('AAAA-MM-01'); null = não deu para saber (arquivo de mais de um mês). */
export interface ArquivoLido { nome: string; grupo: string; exames: number; repetidos: number; mes: string | null }
export interface BrutosLidos extends Omit<BrutoLido, 'grupo'> { arquivos: ArquivoLido[] }

export async function lerBruto(file: File): Promise<BrutoLido> {
  const wb = XLSX.read(await file.arrayBuffer())
  const ws = wb.Sheets[wb.SheetNames[0]]
  if (!ws) throw new Error('O arquivo não tem nenhuma aba.')
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: false, defval: '' })
  const norm = (v: unknown) => String(v ?? '').trim().toLowerCase()

  // cabeçalho = primeira linha que contém 'Unidade' e 'Nome_Paciente' (no arquivo real é a linha 2)
  const iCab = aoa.findIndex(l => {
    const cels = l.map(norm)
    return cels.includes('unidade') && cels.includes('nome_paciente')
  })
  if (iCab < 0) throw new Error("Não achei a linha de cabeçalho (colunas 'Unidade' e 'Nome_Paciente'). Confira se é o Bruto da Mobilemed.")

  // título acima do cabeçalho = grupo da Mobilemed ("Grupo PRN", "Grupo PRN /  APICE TELE"…)
  const grupo = aoa.slice(0, iCab).flat().map(c => String(c ?? '').trim()).find(Boolean) ?? ''
  const colunas = aoa[iCab].map(c => CHAVES[norm(c)] ?? null)
  const linhas: LinhaBruto[] = []
  const nomes = new Map<string, LinhaBruto[]>()
  for (const l of aoa.slice(iCab + 1)) {
    const o: Record<string, string> = {}
    colunas.forEach((k, i) => { if (k) o[k] = String(l[i] ?? '').trim() })
    if (!o.unidade) continue
    const linha = o as unknown as LinhaBruto
    linhas.push(linha)
    const g = nomes.get(linha.unidade)
    if (g) g.push(linha); else nomes.set(linha.unidade, [linha])
  }
  return { linhas, nomes, grupo }
}

// mesmo exame = mesma unidade, paciente, accession, estudo e data do exame
export const chaveExame = (l: LinhaBruto) =>
  [l.unidade, l.nome_paciente, l.accession_number, l.estudo_descricao, l.data_exame].map(v => v ?? '').join('|')

/**
 * Mês do Bruto ('AAAA-MM-01'), pelo nome do arquivo da Mobilemed (relatorio_descritivo_01_09_2026_30_09_2026.xlsx).
 * O "relatório descritivo" de um mês traz o exame transferido OU laudado (1ª assinatura) naquele mês — é o que
 * diz o mês do 1º laudo de um exame reassinado depois (motor, intervaloDoLaudo).
 * Todas as datas do nome no mesmo mês → esse mês. Datas de meses diferentes (arquivo de 2 meses) ou nome sem
 * data (arquivo renomeado) → null: aí o reassinado fica pela conclusão, como antes.
 */
export function mesDoArquivo(nome: string): string | null {
  const datas = [...nome.matchAll(/(?:0[1-9]|[12]\d|3[01])[_-](0[1-9]|1[0-2])[_-](20\d{2})/g)].map(m => `${m[2]}-${m[1]}-01`)
  return datas.length && new Set(datas).size === 1 ? datas[0] : null
}

/** O mais recente de dois meses 'AAAA-MM-01' (null não conta). */
const maiorMes = (a?: string | null, b?: string | null) => (!a ? b ?? null : !b ? a : a > b ? a : b)

/**
 * Lê vários Brutos (um por grupo da Mobilemed, ou um por mês) e junta.
 * Linhas iguais dentro do MESMO arquivo ficam (podem ser exames repetidos de verdade). Entre arquivos, o mesmo
 * exame não entra de novo: fica o maior número de cópias que veio num arquivo só, e a cópia sem laudo é trocada
 * pela que tem laudo. Cada exame leva o mês do último Bruto em que veio (`mes_arquivo`) e o nome do arquivo de
 * onde a linha ficou (`arquivo_nome`).
 */
export async function lerBrutos(files: File[]): Promise<BrutosLidos> {
  const linhas: LinhaBruto[] = []
  const arquivos: ArquivoLido[] = []
  const posicoes = new Map<string, number[]>() // chave -> posições em `linhas`
  for (const f of files) {
    const lido = await lerBruto(f)
    const mes = mesDoArquivo(f.name)
    const doArquivo = new Map<string, LinhaBruto[]>() // cópias de cada exame neste arquivo, na ordem
    for (const l of lido.linhas) {
      l.mes_arquivo = mes
      l.arquivo_nome = f.name
      const k = chaveExame(l)
      const g = doArquivo.get(k)
      if (g) g.push(l); else doArquivo.set(k, [l])
    }
    let repetidos = 0
    for (const [k, copias] of doArquivo) {
      const pos = posicoes.get(k) ?? []
      // o exame veio neste Bruto: as cópias já guardadas ficam com o mês mais novo
      for (const j of pos) linhas[j].mes_arquivo = maiorMes(linhas[j].mes_arquivo, mes)
      const semLaudo = pos.filter(j => !linhas[j].data_conclusao)
      copias.forEach((l, i) => {
        if (i < pos.length) {
          repetidos++
          if (l.data_conclusao && semLaudo.length) {
            const j = semLaudo.shift()!
            l.mes_arquivo = linhas[j].mes_arquivo
            linhas[j] = l
          }
          return
        }
        pos.push(linhas.length)
        linhas.push(l)
      })
      posicoes.set(k, pos)
    }
    arquivos.push({ nome: f.name, grupo: lido.grupo, exames: lido.linhas.length, repetidos, mes })
  }
  const nomes = new Map<string, LinhaBruto[]>()
  for (const l of linhas) {
    const g = nomes.get(l.unidade)
    if (g) g.push(l); else nomes.set(l.unidade, [l])
  }
  return { linhas, nomes, arquivos }
}

/**
 * Mês que predomina no Bruto (data do laudo; sem laudo, data do exame) e a fração das linhas nesse mês.
 * Usado para preencher a competência e avisar quando o arquivo é de outro mês.
 */
export function mesPredominante(linhas: LinhaBruto[]): { competencia: string; fracao: number } | null {
  const conta = new Map<string, number>()
  let total = 0
  for (const l of linhas) {
    const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec((l.data_conclusao || l.data_exame || '').trim())
    if (!m) continue
    const k = `${m[3]}-${m[2].padStart(2, '0')}`
    conta.set(k, (conta.get(k) ?? 0) + 1); total++
  }
  if (!total) return null
  const [competencia, n] = [...conta.entries()].sort((a, b) => b[1] - a[1])[0]
  return { competencia, fracao: Math.round((n / total) * 100) / 100 }
}
