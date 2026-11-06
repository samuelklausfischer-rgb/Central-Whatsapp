// Diagnóstico do cadastro: acha erros de configuração que o motor (fat-simular) não avisa.
// Lógica pura: recebe o cadastro já carregado (ver cadastroCompleto.ts) e devolve a lista de problemas.
// Replica as regras de motor.ts/servico.ts; nada de consulta ao banco aqui.
import { diaDeCorte, normNome } from '../nucleo/motor'
import type { ItemVigente } from './tipos'
import type { SecaoUnidade } from './irPara'
import { nomeQueRecebeFixo, regrasQuantidadeEfetivas } from './config'
import { brl, nomeExibicao } from './format'

export type Severidade = 'bloqueia' | 'valor' | 'aviso'
export type SecaoProblema = SecaoUnidade | 'regras-gerais'

export interface Problema {
  id: string // D01…D33
  severidade: Severidade
  titulo: string
  detalhe: string
  unidadeId: string | null
  secao: SecaoProblema
  alvoId?: string
}

export interface InfoRegra { titulo: string; severidade: Severidade; secao: string }

/** Catálogo: título (como aparece na tela), severidade padrão e seção de destino. */
export const CATALOGO: Record<string, InfoRegra> = {
  D01: { titulo: 'Unidade sem nenhum preço', severidade: 'bloqueia', secao: 'precos' },
  D02: { titulo: 'Item sem valor hoje', severidade: 'valor', secao: 'precos' },
  D03: { titulo: '“Preço único” com mais de um preço', severidade: 'valor', secao: 'regras' },
  D04: { titulo: '“Fixo mensal” sem valor fixo', severidade: 'bloqueia', secao: 'precos' },
  D05: { titulo: 'Valor fixo que ninguém recebe', severidade: 'valor', secao: 'nomes' },
  D06: { titulo: 'Fixo cobrado mais de uma vez', severidade: 'valor', secao: 'nomes' },
  D07: { titulo: 'Marcada “vigente”, mas a vigência já venceu', severidade: 'aviso', secao: 'contrato' },
  D08: { titulo: 'Vigência não informada', severidade: 'aviso', secao: 'contrato' },
  D09: { titulo: 'Contrato vencido, encerrado ou minuta', severidade: 'aviso', secao: 'contrato' },
  D10: { titulo: 'Regra “conta N” com erro', severidade: 'bloqueia', secao: 'regras' },
  D11: { titulo: 'Regra “conta N” que nunca vale', severidade: 'valor', secao: 'regras' },
  D12: { titulo: 'Regra antiga “conta 2” diferente da nova', severidade: 'aviso', secao: 'regras' },
  D13: { titulo: 'Período fora do formato', severidade: 'bloqueia', secao: 'regras' },
  D14: { titulo: 'Fim de semana em formato errado', severidade: 'valor', secao: 'regras' },
  D15: { titulo: 'Franquia sem preço de excedente', severidade: 'valor', secao: 'precos' },
  D16: { titulo: 'Nome da Mobilemed incerto', severidade: 'aviso', secao: 'nomes' },
  D17: { titulo: 'Unidade sem nenhum nome da Mobilemed', severidade: 'valor', secao: 'nomes' },
  D18: { titulo: 'Hospital do nome não tem preço', severidade: 'valor', secao: 'nomes' },
  D19: { titulo: 'Regra de relatório aponta para unidade que não existe', severidade: 'valor', secao: 'regras-gerais' },
  D20: { titulo: 'Instrução de NF sem unidade', severidade: 'aviso', secao: 'regras-gerais' },
  D21: { titulo: 'Termo sem data', severidade: 'valor', secao: 'aditivos' },
  D22: { titulo: 'Termo sem data de efeito', severidade: 'aviso', secao: 'aditivos' },
  D23: { titulo: 'Valor de termo em item de outra unidade', severidade: 'valor', secao: 'aditivos' },
  D24: { titulo: 'Termo sem efeito no preço', severidade: 'aviso', secao: 'aditivos' },
  D25: { titulo: 'Pastas quase iguais', severidade: 'aviso', secao: 'contrato' },
  D26: { titulo: 'Nomes da Mobilemed quase iguais', severidade: 'valor', secao: 'nomes' },
  D27: { titulo: 'Nome da unidade está na lista de ignorados', severidade: 'valor', secao: 'regras-gerais' },
  D28: { titulo: 'Item que nunca é escolhido', severidade: 'valor', secao: 'precos' },
  D29: { titulo: 'Item sem modalidade', severidade: 'aviso', secao: 'precos' },
  D30: { titulo: 'Só preço de urgência na modalidade', severidade: 'valor', secao: 'precos' },
  D31: { titulo: 'Tipo de cobrança não identificado', severidade: 'aviso', secao: 'regras' },
  D32: { titulo: 'Pendências de cadastro abertas', severidade: 'aviso', secao: 'pendencias' },
  D33: { titulo: 'Nome do Bruto sem unidade', severidade: 'bloqueia', secao: 'regras-gerais' },
}

export const ROTULO_SEVERIDADE: Record<Severidade, string> = { bloqueia: 'Bloqueia', valor: 'Pode errar valor', aviso: 'Aviso' }
const ORDEM_SEVERIDADE: Record<Severidade, number> = { bloqueia: 0, valor: 1, aviso: 2 }
export const SEVERIDADES: Severidade[] = ['bloqueia', 'valor', 'aviso']

// ---------------------------------------------------------------- dados de entrada (formato do cadastro carregado)
export interface UnidadeCad {
  id: string; empresa: string; pasta: string; modelo_cobranca: string; situacao: string
  vigencia_inicio: string | null; vigencia_fim: string | null
  janela: string | null; franquia_mensal: number | null
  estudos_conta_2: string | null
  regras_quantidade: { padrao: string; quantidade: number }[] | null
  acao_intensificada: unknown
}
export interface ItemCad {
  id: string; unidade_id: string; papel: string; exame: string; modalidade: string | null
  subunidade: string | null; codigo: string | null; valor_original: number | null; ordem?: number | null
}
export interface EventoCad {
  id: string; unidade_id: string; tipo: string; numero: string | null
  data_assinatura: string | null; data_efeito: string | null; data_referencia: string | null; percentual: number | null
}
export interface EventoValorCad { evento_id: string; item_preco_id: string; valor: number | null }
export interface AliasCad {
  id: string; nome_bruto: string; unidade_id: string; subunidade: string | null
  principal: boolean; incerto: boolean; grupo?: string | null
}
export interface InstrucaoCad { id: string; unidade_id: string | null; nome_planilha: string }
export interface IgnoradoCad { nome_bruto: string; motivo: string | null }
export interface PendenciaAberta { id?: string; unidade_id: string | null; tipo: string; detalhe?: string }

export interface Cadastro {
  unidades: UnidadeCad[]
  itens: ItemCad[]
  vigentesHoje: Map<string, ItemVigente[]>
  eventos: EventoCad[]
  eventoValores: EventoValorCad[]
  aliases: AliasCad[]
  instrucoes: InstrucaoCad[]
  config: Record<string, string>
  ignorados: IgnoradoCad[]
  desconhecidos?: { nome_bruto: string; qtd: number }[]
  pendencias?: PendenciaAberta[]
  /** true quando só uma unidade foi carregada: as regras que cruzam unidades (D19, D25…) ficam de fora. */
  parcial?: boolean
}

export const CHAVES_PASTAS = ['separar_urgencia_pastas', 'desdobrar_quantidade_pastas', 'juntar_cr_dx_pastas'] as const

// ---------------------------------------------------------------- funções que repetem o motor
/** Item de preço passa no filtro de hospital? Igual a `doSub` de motor.ts (calcular). */
export function doSub(item: { exame: string; subunidade?: string | null }, subunidade: string | null | undefined): boolean {
  if (!subunidade) return true
  if (item.subunidade) return normNome(item.subunidade) === normNome(subunidade)
  return normNome(item.exame).startsWith(normNome(subunidade)) || !item.exame.includes(' — ')
}

/** Nomes que recebem o valor fixo, igual a servico.ts (montarContexto): os marcados ★ ou, sem marcação, o primeiro "não tele". */
export function principaisEfetivos<A extends { nome_bruto: string; principal: boolean }>(aliases: A[]): A[] {
  const r = nomeQueRecebeFixo(aliases)
  if (!r) return []
  const alvos = new Set(r.todos.map(normNome))
  const achados: A[] = []
  const vistos = new Set<string>()
  for (const a of aliases) {
    const n = normNome(a.nome_bruto)
    if (alvos.has(n) && !vistos.has(n) && (!r.automatico || achados.length === 0)) { achados.push(a); vistos.add(n) }
  }
  return achados
}

/** Data de hoje (local) como AAAA-MM-DD. */
export function isoLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Janela aceita pelo motor: mes, quinzena, ciclo_27_26 ou corte_2..28. */
export function janelaValida(j: string | null | undefined): boolean {
  if (j == null) return true
  if (j === 'mes' || j === 'quinzena' || j === 'ciclo_27_26') return true
  return /^corte_\d{1,2}$/.test(j) && diaDeCorte(j) != null
}

/**
 * Por que um padrão "conta N" nunca casa. O motor testa o padrão contra normNome(estudo), que só tem A–Z, 0–9 e espaço:
 * letra com acento e pontuação ( - / , ; : . ) escrita como texto nunca aparecem lá.
 */
export function motivoPadraoNuncaCasa(padrao: string): string | null {
  const semClasses = padrao.replace(/\[(?:\\.|[^\]\\])*\]/g, '')
  const escapada = /\\([^A-Za-z0-9\s])/.exec(semClasses)
  if (escapada) return `o trecho “\\${escapada[1]}” procura o sinal “${escapada[1]}”, que não existe na descrição já limpa do estudo`
  const livre = semClasses.replace(/\\./g, '')
  const acento = /[^\x00-\x7F]/.exec(livre)
  if (acento) return `a letra “${acento[0]}” tem acento, e a descrição do estudo é comparada sem acento e em maiúsculas`
  const sinal = /[-/,;:]/.exec(livre)
  if (sinal) return `o sinal “${sinal[0]}” nunca aparece na descrição do estudo (a comparação tira a pontuação)`
  return null
}

// ---------------------------------------------------------------- diagnóstico
const nomeU = (u: UnidadeCad | undefined) => (u ? nomeExibicao(u.pasta) : 'unidade')
const MODALIDADES_SEM_CASAR = new Set(['FIXO', 'OUTRO'])

function agrupar<T>(lista: T[], chave: (t: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>()
  for (const x of lista) {
    const k = chave(x)
    const l = m.get(k)
    if (l) l.push(x); else m.set(k, [x])
  }
  return m
}

/** Roda todas as regras D01–D33 sobre o cadastro. A lista sai ordenada: severidade, regra, unidade. */
export function diagnosticar(c: Cadastro, hoje: Date = new Date()): Problema[] {
  const out: Problema[] = []
  const hojeIso = isoLocal(hoje)
  const unidades = new Map(c.unidades.map(u => [u.id, u]))
  const itensPorU = agrupar(c.itens, i => i.unidade_id)
  const itemPorId = new Map(c.itens.map(i => [i.id, i]))
  const aliasesPorU = agrupar(c.aliases, a => a.unidade_id)
  const eventosPorU = agrupar(c.eventos, e => e.unidade_id)
  const valoresPorEv = agrupar(c.eventoValores, v => v.evento_id)

  // valor vigente hoje de cada item (sem linha na consulta de preços vigentes → cai no valor original)
  const vig = new Map<string, number | null>()
  for (const lista of c.vigentesHoje.values()) for (const v of lista) vig.set(v.item_preco_id, v.valor == null ? null : Number(v.valor))
  const valorHoje = (i: ItemCad): number | null => vig.has(i.id) ? vig.get(i.id)! : (i.valor_original == null ? null : Number(i.valor_original))
  const comValor = (i: ItemCad) => valorHoje(i) != null

  const add = (id: string, u: UnidadeCad | null, detalhe: string, o: { severidade?: Severidade; secao?: SecaoProblema; alvoId?: string; unidadeId?: string | null } = {}) => {
    const info = CATALOGO[id]
    out.push({
      id, severidade: o.severidade ?? info.severidade, titulo: info.titulo, detalhe,
      unidadeId: o.unidadeId !== undefined ? o.unidadeId : (u ? u.id : null),
      secao: o.secao ?? (info.secao as SecaoProblema),
      ...(o.alvoId ? { alvoId: o.alvoId } : {}),
    })
  }

  for (const u of c.unidades) {
    const itens = itensPorU.get(u.id) ?? []
    const aliases = aliasesPorU.get(u.id) ?? []
    const normaisUrg = itens.filter(i => i.papel === 'normal' || i.papel === 'urgencia')
    const fixosComValor = itens.filter(i => i.papel === 'fixo' && comValor(i))
    const excedenteComValor = itens.some(i => i.papel === 'excedente' && comValor(i))
    const nome = nomeU(u)

    // ---- preços
    if (!itens.length) add('D01', u, `${nome} não tem nenhum item de preço: todo exame dela sai como “sem preço” e o cálculo para.`)

    for (const i of itens) {
      if (comValor(i)) continue
      if (i.papel === 'fixo' && u.modelo_cobranca === 'fixo_mensal' && !fixosComValor.length) continue // já é o D04
      const unico = (i.papel === 'normal' || i.papel === 'urgencia') &&
        !normaisUrg.some(o => o.id !== i.id && comValor(o) && (!o.modalidade || !i.modalidade || o.modalidade === i.modalidade))
      add('D02', u, `O item “${i.exame}” não tem valor hoje, então o cálculo ignora ele.` +
        (unico ? ` É o único preço${i.modalidade ? ` de ${i.modalidade}` : ''}: os exames dele saem como “sem preço”.` : ''),
      { severidade: unico ? 'bloqueia' : 'valor', alvoId: i.id })
    }

    const nUnico = normaisUrg.filter(comValor).length
    if (u.modelo_cobranca === 'preco_unico' && nUnico > 1)
      add('D03', u, `Marcada como “preço único”, mas tem ${nUnico} preços com valor. Com mais de um, o sistema escolhe por modalidade e pelo nome do exame, não mais um preço só.`)

    if (u.modelo_cobranca === 'fixo_mensal' && !fixosComValor.length)
      add('D04', u, 'Marcada como “fixo mensal”, mas não tem item de valor fixo com valor: o relatório sai com a pendência “fixo sem valor”.')

    if (u.franquia_mensal && u.franquia_mensal > 0 && !excedenteComValor)
      add('D15', u, `Franquia de ${u.franquia_mensal.toLocaleString('pt-BR')} exames/mês sem preço de excedente. ` +
        (u.modelo_cobranca === 'fixo_mensal' ? 'O relatório sai com a pendência “franquia”.' : 'Fora do valor fixo, a franquia é ignorada.'))

    for (const i of itens) {
      if (i.papel !== 'normal' && i.papel !== 'urgencia') continue
      if (i.modalidade && MODALIDADES_SEM_CASAR.has(i.modalidade))
        add('D28', u, `O item “${i.exame}” está com modalidade ${i.modalidade}, que não casa com RX, TC, RM, MG ou US: ele nunca é escolhido.`, { alvoId: i.id })
      else if (!i.modalidade)
        add('D29', u, `O item “${i.exame}” está sem modalidade: concorre com exames de qualquer modalidade.`, { alvoId: i.id })
    }

    const mods = new Set(normaisUrg.filter(i => i.modalidade && i.papel === 'urgencia' && comValor(i)).map(i => i.modalidade!))
    for (const m of mods) {
      const temNormal = normaisUrg.some(i => i.papel === 'normal' && comValor(i) && (!i.modalidade || i.modalidade === m))
      if (!temNormal) {
        const it = normaisUrg.find(i => i.papel === 'urgencia' && i.modalidade === m && comValor(i))!
        add('D30', u, `Em ${m} só existe preço de urgência: o exame eletivo de ${m} é cobrado pelo valor da urgência.`, { alvoId: it.id })
      }
    }

    // ---- como fatura
    if (u.modelo_cobranca === 'nao_identificado')
      add('D31', u, 'O tipo de cobrança ainda não foi identificado.')
    if (!janelaValida(u.janela) || u.janela === 'corte_27') {
      add('D13', u, u.janela === 'corte_27'
        ? 'O período está como “corte_27”. Provavelmente é o ciclo FHEMIG (dia 27 ao dia 26): escolha essa opção.'
        : `O período “${u.janela}” não é um formato que o motor conhece (mês, quinzena, ciclo FHEMIG ou corte do dia 2 ao 28).`)
    }
    const ai = u.acao_intensificada
    if (ai) {
      const mods2 = (ai as { modalidades?: unknown }).modalidades
      const formatoOk = typeof ai === 'object' && !Array.isArray(ai) &&
        (mods2 == null || (Array.isArray(mods2) && mods2.every(m => typeof m === 'string')))
      if (!formatoOk) add('D14', u, 'A regra de fim de semana está num formato que o motor não entende: ela vai valer para todas as modalidades ou ser ignorada.')
    }

    const regras = regrasQuantidadeEfetivas(u)
    regras.forEach((r, k) => {
      const alvoId = `regra-${k}`
      let valida = true
      try { new RegExp(r.padrao, 'i') } catch { valida = false }
      if (!valida) {
        add('D10', u, `A regra “${r.padrao}” = ${r.quantidade} tem um padrão inválido: o motor ignora a regra e gera pendência.`, { alvoId })
        return
      }
      const q = Number(r.quantidade)
      if (!Number.isInteger(q) || q < 2 || q > 20) {
        add('D11', u, `A regra “${r.padrao}” conta ${r.quantidade}; a quantidade tem que ser um número inteiro de 2 a 20.`, { alvoId })
        return
      }
      const motivo = motivoPadraoNuncaCasa(r.padrao)
      if (motivo) add('D11', u, `A regra “${r.padrao}” = ${r.quantidade} nunca vale: ${motivo}.`, { alvoId })
    })
    if (u.estudos_conta_2 && u.regras_quantidade?.length) {
      const espelho = u.regras_quantidade.filter(r => Number(r.quantidade) === 2).map(r => r.padrao).join('|')
      if (u.estudos_conta_2 !== espelho)
        add('D12', u, 'A regra antiga “conta 2” é diferente da nova. O motor usa a nova; salvar as regras de novo regrava as duas.')
    }

    // ---- contrato
    if (u.situacao === 'vigente' && u.vigencia_fim && u.vigencia_fim.slice(0, 10) < hojeIso)
      add('D07', u, `Marcada como vigente, mas a vigência terminou em ${u.vigencia_fim.slice(8, 10)}/${u.vigencia_fim.slice(5, 7)}/${u.vigencia_fim.slice(0, 4)}.`)
    if (!u.vigencia_inicio || !u.vigencia_fim) {
      const falta = !u.vigencia_inicio && !u.vigencia_fim ? 'início e fim' : !u.vigencia_fim ? 'fim' : 'início'
      add('D08', u, `A vigência não tem ${falta} informado.`)
    }
    if (u.situacao === 'vencido' || u.situacao === 'encerrado' || u.situacao === 'minuta')
      add('D09', u, `Contrato ${u.situacao}: toda geração de relatório avisa “faturado mesmo assim, confirmar”.`)

    // ---- nomes da Mobilemed
    if (!aliases.length) add('D17', u, `${nome} não tem nenhum nome da Mobilemed ligado: ela nunca é faturada.`)
    for (const a of aliases) {
      if (a.incerto) add('D16', u, `O nome “${a.nome_bruto}” está marcado como incerto: confirme se é mesmo desta unidade.`, { alvoId: a.id })
    }

    // fixo: quem recebe e se o item fixo vale para o hospital dele
    if (fixosComValor.length) {
      const soma = fixosComValor.reduce((s, i) => s + (valorHoje(i) ?? 0), 0)
      if (!aliases.length) {
        add('D05', u, `Há valor fixo de ${brl(soma)}, mas a unidade não tem nenhum nome da Mobilemed para recebê-lo.`)
      } else {
        const receptores = principaisEfetivos(aliases)
        for (const a of receptores) {
          if (a.subunidade && !fixosComValor.some(i => doSub(i, a.subunidade)))
            add('D05', u, `O nome “${a.nome_bruto}”, que recebe o fixo, é do hospital “${a.subunidade}”, e o valor fixo (${brl(soma)}) é de outro hospital: ninguém recebe o fixo.`, { alvoId: a.id })
        }
        const marcados = aliases.filter(a => a.principal)
        const recebem = marcados.filter(a => fixosComValor.some(i => doSub(i, a.subunidade)))
        if (marcados.length > 1 && recebem.length > 1)
          add('D06', u, `${recebem.length} nomes estão marcados como principal (${recebem.map(a => `“${a.nome_bruto}”`).join(', ')}) e todos recebem o fixo de ${brl(soma)}: ele sai uma vez para cada um.`, { alvoId: recebem[0].id })
      }
    }

    // hospital do nome × preços
    if (itens.length) {
      for (const a of aliases) {
        if (a.subunidade) {
          if (!itens.some(i => doSub(i, a.subunidade)))
            add('D18', u, `O nome “${a.nome_bruto}” é do hospital “${a.subunidade}”, mas nenhum preço da unidade vale para esse hospital: os exames dele saem como “sem preço”.`, { severidade: 'bloqueia', alvoId: a.id })
        } else if (itens.every(i => !!i.subunidade)) {
          add('D18', u, `Todos os preços da unidade são por hospital, mas o nome “${a.nome_bruto}” não tem hospital: ele concorre com o preço de qualquer hospital.`, { alvoId: a.id })
        }
      }
    }

    // ---- aditivos
    for (const e of eventosPorU.get(u.id) ?? []) {
      const valores = valoresPorEv.get(e.id) ?? []
      const rotulo = `${e.numero ? `Termo ${e.numero}` : 'Termo'} (${e.tipo.replace(/_/g, ' ')})`
      if (!(e.data_referencia ?? e.data_efeito ?? e.data_assinatura))
        add('D21', u, `${rotulo} não tem nenhuma data: o cálculo ignora o termo${valores.length ? `, e os ${valores.length} valores dele nunca entram` : ''}.`, { alvoId: e.id })
      else if (!e.data_efeito && e.data_assinatura)
        add('D22', u, `${rotulo} não tem data de efeito: vale a data da assinatura.`, { alvoId: e.id })
      if ((e.tipo === 'reajuste' || e.tipo === 'aditivo_valor') && !valores.length && e.percentual == null)
        add('D24', u, `${rotulo} não tem valores por item nem percentual: não muda nenhum preço.`, { alvoId: e.id })
      for (const v of valores) {
        const it = itemPorId.get(v.item_preco_id)
        if (!it || it.unidade_id !== e.unidade_id)
          add('D23', u, `${rotulo} tem um valor (${brl(v.valor)}) para um item que ${it ? `é de outra unidade (“${it.exame}”)` : 'não é desta unidade'}.`, { alvoId: e.id })
      }
    }
  }

  // ---- nomes: quase iguais entre si e contra a lista de ignorados
  const ignoradosNorm = new Set(c.ignorados.map(i => normNome(i.nome_bruto)))
  for (const a of c.aliases) {
    if (ignoradosNorm.has(normNome(a.nome_bruto)))
      add('D27', unidades.get(a.unidade_id) ?? null, `O nome “${a.nome_bruto}” está ligado a “${nomeU(unidades.get(a.unidade_id))}”, mas também está na lista de ignorados — e o ignorado vence: o nome não fatura.`, { alvoId: a.nome_bruto, unidadeId: a.unidade_id })
  }
  for (const grupo of agrupar(c.aliases, a => normNome(a.nome_bruto)).values()) {
    if (grupo.length < 2) continue
    const u0 = unidades.get(grupo[0].unidade_id) ?? null
    add('D26', u0, `Os nomes ${grupo.map(a => `“${a.nome_bruto}” (${nomeU(unidades.get(a.unidade_id))})`).join(' e ')} são iguais para o motor: ele usa só o primeiro que achar.`, { alvoId: grupo[0].id })
  }

  // ---- pastas parecidas e regras de relatório (só com todas as unidades carregadas)
  if (!c.parcial) {
    for (const grupo of agrupar(c.unidades, u => normNome(u.pasta)).values()) {
      if (grupo.length < 2) continue
      const ord = [...grupo].sort((a, b) => a.pasta.localeCompare(b.pasta, 'pt-BR'))
      add('D25', ord[0], `As pastas ${ord.map(u => `“${u.pasta}”`).join(' e ')} são parecidas (só mudam caixa, acento ou sinal): pode ser uma unidade duplicada.`, { alvoId: ord[1].id })
    }
    const pastasNorm = new Set(c.unidades.map(u => normNome(u.pasta)))
    for (const chave of CHAVES_PASTAS) {
      for (const p of (c.config[chave] ?? '').split(',').map(s => s.trim()).filter(Boolean)) {
        if (!pastasNorm.has(normNome(p)))
          add('D19', null, `A regra “${chave}” cita a pasta “${p}”, que não existe: a regra está desligada para ela.`, { alvoId: chave })
      }
    }
  }
  for (const n of c.instrucoes) {
    if (!n.unidade_id) add('D20', null, `A instrução de NF “${n.nome_planilha}” não está ligada a nenhuma unidade.`, { alvoId: n.id })
  }

  // ---- pendências abertas (uma linha por unidade, com a contagem)
  for (const [uid, lista] of agrupar((c.pendencias ?? []).filter(p => p.unidade_id), p => p.unidade_id!)) {
    add('D32', unidades.get(uid) ?? null, `${lista.length} ${lista.length === 1 ? 'pendência aberta' : 'pendências abertas'} no cadastro desta unidade.`, { unidadeId: uid })
  }

  // ---- nomes do Bruto sem unidade (última geração)
  const aliasNorm = new Set(c.aliases.map(a => normNome(a.nome_bruto)))
  for (const d of c.desconhecidos ?? []) {
    const n = normNome(d.nome_bruto)
    if (aliasNorm.has(n) || ignoradosNorm.has(n)) continue
    add('D33', null, `O nome “${d.nome_bruto}” apareceu no último relatório com ${d.qtd.toLocaleString('pt-BR')} exame(s) e não está ligado a nenhuma unidade nem na lista de ignorados.`, { alvoId: d.nome_bruto })
  }

  const nomeDaUnidade = (p: Problema) => (p.unidadeId ? (unidades.get(p.unidadeId)?.pasta ?? '') : '')
  return out
    .map((p, k) => ({ p, k }))
    .sort((a, b) =>
      ORDEM_SEVERIDADE[a.p.severidade] - ORDEM_SEVERIDADE[b.p.severidade] ||
      a.p.id.localeCompare(b.p.id) ||
      nomeDaUnidade(a.p).localeCompare(nomeDaUnidade(b.p), 'pt-BR') ||
      a.k - b.k)
    .map(x => x.p)
}

/** Contagem por severidade. */
export function contarPorSeveridade(ps: Problema[]): Record<Severidade, number> {
  const r: Record<Severidade, number> = { bloqueia: 0, valor: 0, aviso: 0 }
  for (const p of ps) r[p.severidade]++
  return r
}
