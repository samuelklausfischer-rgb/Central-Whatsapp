// Lógica pura do cartão "Como fatura (regras)": rascunho, validação, texto e comparação antes → depois.
import type { RegrasUnidade } from '../../lib/tipos'
import { MODELO } from '../../lib/format'
import { lerRegrasQuantidade, regrasQuantidadeEfetivas, rotuloJanela } from '../../lib/config'
import {
  diaCorteValido, lerAcaoIntensificada, lerJanela, linhaParaRegra, montarAcaoIntensificada, montarJanela,
  regraParaLinha, validarLinha, type AcaoIntensificadaEditavel, type LinhaRegra, type PeriodoEditavel,
} from '../../lib/regrasEditor'
import { iguais, mudancas, type Mudanca } from '../../lib/edicao'
import type { CamposRegras } from './useUnidade'

export type LinhaEdit = LinhaRegra & { chave: number }
export type CriterioRascunho = '' | 'laudo' | 'exame'

export interface RascunhoRegras {
  periodo: PeriodoEditavel
  criterio: CriterioRascunho
  todos: boolean
  linhas: LinhaEdit[]
  fimDeSemana: AcaoIntensificadaEditavel
  franquia: string
  modelo: string
}

let contador = 1
export const novaChave = () => contador++

export const DESCRICAO_MODELO: Record<string, string> = {
  preco_unico: 'Um único preço para todos os exames.',
  por_modalidade: 'O preço muda conforme a modalidade (RX, TC, RM…).',
  por_procedimento: 'Cada exame ou procedimento tem o seu preço.',
  fixo_mensal: 'Valor fixo por mês, independente da quantidade de exames.',
  misto: 'Combina mais de um jeito (por exemplo, fixo mais exames avulsos).',
  nao_identificado: 'Ainda não definido.',
}

export const rotuloModelo = (m: string) => (m === 'nao_identificado' ? 'Não identificado' : MODELO[m] ?? m)

export function rascunhoInicial(modelo: string, regras: RegrasUnidade): RascunhoRegras {
  return {
    periodo: lerJanela(regras.janela),
    criterio: regras.criterio_data ?? '',
    todos: !!regras.todos_status,
    linhas: regrasQuantidadeEfetivas(regras).map(r => ({ ...regraParaLinha(r), chave: novaChave() })),
    fimDeSemana: lerAcaoIntensificada(regras.acao_intensificada),
    franquia: regras.franquia_mensal?.toString() ?? '',
    modelo,
  }
}

/** Há diferença entre o rascunho e o original? (ignora as chaves internas das linhas) */
export function rascunhoMudou(a: RascunhoRegras, b: RascunhoRegras): boolean {
  const semChave = (r: RascunhoRegras) => ({ ...r, linhas: r.linhas.map(({ chave: _c, ...l }) => l) })
  return !iguais(semChave(a), semChave(b))
}

// ---------------------------------------------------------------- validação e gravação
export interface ResultadoValidacao {
  erroPeriodo?: string
  erroFranquia?: string
  erroQuantidade?: string
  errosLinhas: string[][]
  campos?: CamposRegras
  ok: boolean
}

export function validarRascunho(r: RascunhoRegras): ResultadoValidacao {
  let erroPeriodo: string | undefined
  if (r.periodo.tipo === 'corte' && !diaCorteValido(r.periodo.dia)) {
    erroPeriodo = r.periodo.dia === 27 ? 'O dia 27 é o Ciclo FHEMIG: escolha essa opção.' : 'Informe o dia de corte, de 2 a 28.'
  }
  // mesma regra de hoje: inteiro maior que zero, ou vazio
  const txt = r.franquia.trim()
  const n = txt === '' ? null : Number(txt.replace(/\./g, '').replace(',', '.'))
  const erroFranquia = n !== null && (!Number.isInteger(n) || n <= 0) ? 'Franquia deve ser um número inteiro maior que zero (ou vazio)' : undefined

  const errosLinhas = r.linhas.map(validarLinha)
  const regras = r.linhas.map(linhaParaRegra)
  // mesma validação de hoje (lerRegrasQuantidade), só para as linhas que passaram na validação por linha
  let erroQuantidade: string | undefined
  if (!errosLinhas.some(e => e.length)) {
    const q = lerRegrasQuantidade(regras.map(x => `${x.padrao} = ${x.quantidade}`).join('\n'))
    if (q.erros.length) erroQuantidade = `Estudos que contam mais de 1: ${q.erros.join(' · ')}`
  }
  const ok = !erroPeriodo && !erroFranquia && !erroQuantidade && !errosLinhas.some(e => e.length)
  if (!ok) return { erroPeriodo, erroFranquia, erroQuantidade, errosLinhas, ok }
  const campos: CamposRegras = {
    janela: montarJanela(r.periodo) as CamposRegras['janela'],
    criterio_data: r.criterio === '' ? null : r.criterio,
    franquia_mensal: n,
    todos_status: r.todos,
    regras_quantidade: regras,
    acao_intensificada: montarAcaoIntensificada(r.fimDeSemana),
  }
  return { errosLinhas, campos, ok }
}

// ---------------------------------------------------------------- textos
const listaOu = (l: string[]) => (l.length > 1 ? `${l.slice(0, -1).join(', ')} ou ${l[l.length - 1]}` : (l[0] ?? ''))

/** "Estudo que contém ABDOME TOTAL, TRIFASICO ou … → conta 2". */
export function fraseRegra(l: LinhaRegra): string {
  if (l.tipo === 'avancada') return `Padrão avançado ${l.padrao} → conta ${l.quantidade}`
  return `Estudo que contém ${listaOu(l.termos)} → conta ${l.quantidade}`
}

export const textoFimDeSemana = (x: AcaoIntensificadaEditavel) =>
  !x.ligado ? 'Não tem' : x.modalidades.length ? `Relatório à parte: ${x.modalidades.join(', ')}` : 'Relatório à parte, todas as modalidades'

export const textoFranquia = (s: string) => (s.trim() === '' ? 'Sem franquia' : `${s.trim()} exames/mês`)

export const ROTULO_CRITERIO: Record<CriterioRascunho, string> = { '': 'Automático', laudo: 'Data do laudo', exame: 'Data do exame' }

/** Data que vale na prática (igual ao motor): sem escolha, fixo mensal usa a data do exame e os demais a do laudo. */
export function dataEfetiva(modelo: string, criterio: CriterioRascunho): 'laudo' | 'exame' {
  return criterio || (modelo === 'fixo_mensal' ? 'exame' : 'laudo')
}

/** Frases normalizadas da regra (a volta pelo salvamento): usadas na comparação antes → depois. */
const frasesNormalizadas = (linhas: LinhaEdit[]) => linhas.map(l => fraseRegra(regraParaLinha(linhaParaRegra(l))))

// ---------------------------------------------------------------- comparação antes → depois
interface Plano {
  periodo: string; criterio: string; todos: boolean; quantidade: string
  fimDeSemana: string; franquia: string; modelo: string
}

function plano(r: RascunhoRegras): Plano {
  const frases = frasesNormalizadas(r.linhas)
  return {
    periodo: rotuloJanela(montarJanela(r.periodo)),
    criterio: ROTULO_CRITERIO[r.criterio],
    todos: r.todos,
    quantidade: frases.length ? frases.join('; ') : 'Nenhuma',
    fimDeSemana: textoFimDeSemana(r.fimDeSemana),
    franquia: textoFranquia(r.franquia),
    modelo: rotuloModelo(r.modelo),
  }
}

export function mudancasRegras(antes: RascunhoRegras, depois: RascunhoRegras): Mudanca[] {
  return mudancas(plano(antes), plano(depois), {
    periodo: { rotulo: 'Período' },
    criterio: { rotulo: 'Data que define o mês' },
    todos: { rotulo: 'Cobrar também exame sem laudo' },
    quantidade: { rotulo: 'Contam mais de 1' },
    fimDeSemana: { rotulo: 'Fim de semana' },
    franquia: { rotulo: 'Franquia mensal' },
    modelo: { rotulo: 'Tipo de cobrança' },
  })
}

/** Forma aceita por comoFatura() para um rascunho já validado. */
export function regrasParaComoFatura(c: CamposRegras): Pick<RegrasUnidade, 'janela' | 'criterio_data' | 'franquia_mensal' | 'todos_status' | 'regras_quantidade' | 'estudos_conta_2' | 'acao_intensificada'> {
  return { janela: c.janela, criterio_data: c.criterio_data, franquia_mensal: c.franquia_mensal, todos_status: c.todos_status,
    regras_quantidade: c.regras_quantidade, estudos_conta_2: null, acao_intensificada: c.acao_intensificada }
}
