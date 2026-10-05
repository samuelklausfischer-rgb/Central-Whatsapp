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
export interface ArquivoLido { nome: string; grupo: string; exames: number; repetidos: number }
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
const chaveExame = (l: LinhaBruto) =>
  [l.unidade, l.nome_paciente, l.accession_number, l.estudo_descricao, l.data_exame].map(v => v ?? '').join('|')

/**
 * Lê vários Brutos (um por grupo da Mobilemed: PRN, PRN/Ápice, Medimagem, Medimagem/Ápice…) e junta.
 * Linhas iguais dentro do MESMO arquivo ficam (podem ser exames repetidos de verdade); um exame que já veio
 * num arquivo anterior não entra de novo — se a versão nova tem laudo e a antiga não, fica a nova.
 */
export async function lerBrutos(files: File[]): Promise<BrutosLidos> {
  const linhas: LinhaBruto[] = []
  const arquivos: ArquivoLido[] = []
  const vistos = new Map<string, number[]>() // chave -> posições em `linhas`
  for (const f of files) {
    const lido = await lerBruto(f)
    const novas = new Map<string, number[]>()
    let repetidos = 0
    for (const l of lido.linhas) {
      const k = chaveExame(l)
      const antes = vistos.get(k)
      if (antes?.length) {
        repetidos++
        const i = antes.find(j => !linhas[j].data_conclusao)
        if (i !== undefined && l.data_conclusao) { linhas[i] = l; antes.splice(antes.indexOf(i), 1) }
        continue
      }
      const pos = novas.get(k)
      if (pos) pos.push(linhas.length); else novas.set(k, [linhas.length])
      linhas.push(l)
    }
    for (const [k, pos] of novas) vistos.set(k, pos)
    arquivos.push({ nome: f.name, grupo: lido.grupo, exames: lido.linhas.length, repetidos })
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
