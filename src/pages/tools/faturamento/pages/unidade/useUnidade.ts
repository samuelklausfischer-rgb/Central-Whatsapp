import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { db } from '../../lib/supabase'
import { paginar } from '../../lib/pool'
import type { Alias, Evento, ItemVigente, PapelItem, Pendencia, RegraQuantidade, RegrasUnidade, UnidadeResumo } from '../../lib/tipos'
import type { AcaoIntensificada } from '../../nucleo/motor'
import type { Grupo } from '../../lib/relatorioUnidade'
import { hojeISO, nomeExibicao } from '../../lib/format'
import { baixarBackup, capturar, guardarUltimo, type Backup, type TabelaCadastro } from '../../lib/backup'
import { consumirAlvo } from '../../lib/irPara'
import { paraBanco, type ItemAlterado, type ItemCompleto, type RascunhoItem } from './EditorPrecos'
import { traduzirErro, type AtualizacaoConfig, type CamposContrato, type LinhaConfig, ehChavePastas } from './EditorContrato'
import { notaReaberta } from './EditorPendencias'
import type { CamposTermo, ValorTermo } from './EditorTermo'

export type NovoEvento = {
  tipo: string; numero: string | null; data_assinatura: string | null; data_efeito: string | null; percentual: number | null; indice: string | null
  objeto: string | null; ordem: number; nova_vigencia_fim?: string | null; fonte_doc?: string | null; fonte_uri?: string | null
}
export type ValorEvento = { item_preco_id: string; valor: number }
export type CamposRegras = { janela: RegrasUnidade['janela']; criterio_data: RegrasUnidade['criterio_data']; franquia_mensal: number | null; todos_status: boolean; regras_quantidade: RegraQuantidade[]; acao_intensificada: AcaoIntensificada | null }
/** Termo com todas as colunas editáveis e o id do item em cada valor. */
export type EventoCompleto = Omit<Evento, 'evento_valor'> & {
  nova_vigencia_fim: string | null; fonte_uri: string | null
  evento_valor: { item_preco_id: string; valor: number; item_preco: { exame: string } | null }[]
}
export type UnidadeLista = { id: string; pasta: string; empresa: string }

/** Falha de gravação vira Error com frase legível. */
function lancar(error: { message: string } | null): void {
  if (error) throw new Error(traduzirErro(error.message))
}

export function useUnidade(id: string | undefined) {
  const [u, setU] = useState<UnidadeResumo | null>(null)
  const [itens, setItens] = useState<ItemVigente[]>([])
  const [itensCompletos, setItensCompletos] = useState<ItemCompleto[]>([])
  const [eventos, setEventos] = useState<EventoCompleto[]>([])
  const [pend, setPend] = useState<Pendencia[]>([])
  const [regras, setRegras] = useState<RegrasUnidade | null>(null)
  const [nomes, setNomes] = useState<Alias[]>([])
  const [dataRef, setDataRef] = useState(hojeISO())
  const [erro, setErro] = useState<string | null>(null)
  const [versao, setVersao] = useState(0)
  const [alvoId, setAlvoId] = useState<string | undefined>()
  const alvoLido = useRef<{ id: string; alvo: ReturnType<typeof consumirAlvo> } | null>(null)

  const carregar = useCallback(async () => {
    if (!id) return
    const [r1, r2, r3, r4, r5, r6, r7] = await Promise.all([
      db.from('v_unidade_resumo').select('*').eq('id', id).single(),
      db.rpc('preco_vigente', { p_unidade: id, p_data: dataRef }),
      db.from('evento').select('*, evento_valor(item_preco_id, valor, item_preco(exame))').eq('unidade_id', id)
        .order('data_referencia', { nullsFirst: false }).order('ordem'),
      db.from('pendencia_cadastro').select('*').eq('unidade_id', id).order('resolvida').order('tipo'),
      // as colunas novas ficam na tabela (a view v_unidade_resumo não as traz)
      db.from('unidade').select('id, janela, criterio_data, franquia_mensal, todos_status, estudos_conta_2, regras_quantidade, acao_intensificada').eq('id', id).single(),
      db.from('alias').select('*').eq('unidade_id', id).order('nome_bruto'),
      db.from('item_preco').select('id, ordem, papel, exame, modalidade, subunidade, codigo, unidade_medida, quantidade_estimada, valor_original').eq('unidade_id', id).order('ordem').order('exame'),
    ])
    const e = r1.error || r2.error || r3.error || r4.error || r5.error || r6.error || r7.error
    if (e) { setErro(e.message); return }
    setU(r1.data as unknown as UnidadeResumo); setItens((r2.data ?? []) as unknown as ItemVigente[])
    setEventos((r3.data ?? []) as unknown as EventoCompleto[]); setPend((r4.data ?? []) as unknown as Pendencia[])
    setRegras(r5.data as unknown as RegrasUnidade); setNomes((r6.data ?? []) as unknown as Alias[])
    setItensCompletos(((r7.data ?? []) as unknown as (Omit<ItemCompleto, 'quantidade_estimada' | 'valor_original'> & { quantidade_estimada: number | string | null; valor_original: number | string | null })[])
      .map(x => ({ ...x, quantidade_estimada: x.quantidade_estimada == null ? null : Number(x.quantidade_estimada), valor_original: x.valor_original == null ? null : Number(x.valor_original) })))
  }, [id, dataRef])

  useEffect(() => { carregar() }, [carregar])

  const papeis = useMemo(() => new Map<string, PapelItem>(itensCompletos.map(i => [i.id, i.papel])), [itensCompletos])

  // Vindo do diagnóstico ("Corrigir"): rola até a seção e destaca a linha por 3 s. O alvo é lido uma vez por unidade.
  const uid0 = u?.id
  useEffect(() => {
    if (!uid0) return
    if (alvoLido.current?.id !== uid0) alvoLido.current = { id: uid0, alvo: consumirAlvo(uid0) }
    const alvo = alvoLido.current.alvo
    if (!alvo) return
    const rolar = setTimeout(() => document.getElementById(alvo.secao)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 150)
    setAlvoId(alvo.alvoId)
    const apagar = setTimeout(() => setAlvoId(undefined), 3000)
    return () => { clearTimeout(rolar); clearTimeout(apagar) }
  }, [uid0])

  /** Recarrega e soma 1 em `versao` (quem observa `versao`, como o cartão de erros, recalcula). */
  const recarregar = useCallback(async () => { await carregar(); setVersao(v => v + 1) }, [carregar])

  // Falha de GRAVAÇÃO rejeita (cada cartão mostra o erro dentro dele); só falha de CARGA vira tela cheia (`erro`).
  async function salvar(p: PromiseLike<{ error: { message: string } | null }>): Promise<void> {
    const { error } = await p
    if (error) throw new Error(traduzirErro(error.message))
    await recarregar()
  }

  // as ações abaixo só são acionadas pelas seções, que só renderizam com `u` carregado
  const uid = u?.id as string
  const rotuloPasta = u ? nomeExibicao(u.pasta) : ''

  const tentarDeNovo = () => { setErro(null); carregar() }

  /** Lê tudo que vai sumir, baixa o arquivo de backup, guarda o último na sessão e só então apaga. Devolve o backup para o "Desfazer". */
  async function apagarComBackup(
    descricao: string, leituras: { tabela: TabelaCadastro; coluna: string; valores: string[]; filtro?: (l: Record<string, unknown>) => boolean }[],
    apagar: () => PromiseLike<{ error: { message: string } | null }>,
  ): Promise<Backup> {
    const tabelas: Backup['tabelas'] = []
    for (const l of leituras) {
      const linhas = await capturar(l.tabela, l.coluna, l.valores)
      tabelas.push({ tabela: l.tabela, linhas: l.filtro ? linhas.filter(l.filtro) : linhas })
    }
    if (!tabelas[0]?.linhas.length) throw new Error('Não achei este registro no banco (talvez já tenha sido apagado). Recarregue a página.')
    const backup: Backup = { versao: 1, criadoEm: new Date().toISOString(), descricao, tabelas }
    baixarBackup(backup)
    guardarUltimo(backup)
    await salvar(apagar())
    return backup
  }

  const salvarSituacao = (sit: string, motivo: string) =>
    salvar(db.from('unidade').update({ situacao: sit, motivo_situacao: motivo, situacao_manual: true, atualizado_em: new Date().toISOString() }).eq('id', uid))

  const salvarRegras = (r: CamposRegras, modelo: string) =>
    salvar(db.from('unidade').update({
      janela: r.janela, criterio_data: r.criterio_data, franquia_mensal: r.franquia_mensal, todos_status: r.todos_status,
      acao_intensificada: r.acao_intensificada,
      regras_quantidade: r.regras_quantidade.length ? r.regras_quantidade : null,
      // formato antigo ("conta 2") mantido em dia para a fat-simular anterior à 2026-10-06c
      estudos_conta_2: r.regras_quantidade.filter(x => x.quantidade === 2).map(x => x.padrao).join('|') || null,
      modelo_cobranca: modelo, atualizado_em: new Date().toISOString(),
    }).eq('id', uid))

  // ── contrato ──────────────────────────────────────────────────────────────
  /** Regras `config *_pastas` (para ver se a pasta aparece nelas antes de renomear). */
  const carregarPastasConfig = async (): Promise<LinhaConfig[]> => {
    const { data, error } = await db.from('config').select('chave, valor')
    lancar(error)
    return ((data ?? []) as LinhaConfig[]).filter(l => ehChavePastas(l.chave))
  }

  /** Grava os campos do contrato; se a pasta mudou, atualiza junto as regras `*_pastas` que a citam. */
  const salvarContrato = async (dados: Partial<CamposContrato>, config: AtualizacaoConfig[]): Promise<void> => {
    try {
      if (Object.keys(dados).length) {
        const { error } = await db.from('unidade').update({ ...dados, atualizado_em: new Date().toISOString() }).eq('id', uid)
        lancar(error)
      }
      for (const c of config) {
        const { error } = await db.from('config').update({ valor: c.valor }).eq('chave', c.chave)
        if (error) throw new Error(`A unidade foi salva, mas a regra “${c.chave}” não pôde ser atualizada (${error.message}). Ajuste a pasta nessa regra à mão.`)
      }
    } finally { await recarregar() }
  }

  // ── nomes da Mobilemed ────────────────────────────────────────────────────
  const adicionarNome = (nome_bruto: string, subunidade: string | null, principal: boolean, grupo: Grupo) =>
    salvar(db.from('alias').insert({ nome_bruto, unidade_id: uid, subunidade, principal, grupo }))
  const removerNome = (a: Alias): Promise<Backup> =>
    apagarComBackup(`${rotuloPasta} nome ${a.nome_bruto}`, [{ tabela: 'alias', coluna: 'id', valores: [a.id] }], () => db.from('alias').delete().eq('id', a.id))
  const marcarPrincipal = (a: Alias, v: boolean) => salvar(db.from('alias').update({ principal: v }).eq('id', a.id))
  const mudarGrupo = (a: Alias, g: Grupo) => salvar(db.from('alias').update({ grupo: g }).eq('id', a.id))
  const editarNome = (a: Alias, d: { subunidade: string | null; incerto: boolean }) =>
    salvar(db.from('alias').update({ subunidade: d.subunidade, incerto: d.incerto }).eq('id', a.id))
  const moverNome = (a: Alias, destinoId: string, subunidade: string | null) =>
    salvar(db.from('alias').update({ unidade_id: destinoId, subunidade, principal: false }).eq('id', a.id))
  /** Lista id/pasta/empresa de todas as unidades (só quando o usuário abre "Mover"). */
  const listarUnidades = (): Promise<UnidadeLista[]> =>
    paginar<UnidadeLista>((de, ate) => db.from('unidade').select('id, pasta, empresa').order('pasta').range(de, ate))

  // ── preços ────────────────────────────────────────────────────────────────
  /**
   * Grava em sequência: primeiro as alterações, depois os itens novos (id gerado no cliente + upsert, então repetir é seguro).
   * `onFeito` avisa a tela de cada linha gravada, para ela tirar do rascunho se um passo seguinte falhar.
   */
  const salvarItens = async (novos: RascunhoItem[], alterados: ItemAlterado[], onFeito?: (r: { id?: string; chave?: string }) => void): Promise<void> => {
    try {
      for (const a of alterados) {
        const { error } = await db.from('item_preco').update(a.dados).eq('id', a.antes.id)
        lancar(error); onFeito?.({ id: a.antes.id })
      }
      let ordem = itensCompletos.reduce((m, i) => Math.max(m, i.ordem), -1) + 1
      for (const r of novos) {
        const { error } = await db.from('item_preco').upsert({ id: r.chave, unidade_id: uid, ordem: ordem++, ...paraBanco(r) }, { onConflict: 'id' })
        lancar(error); onFeito?.({ chave: r.chave })
      }
    } finally { await recarregar() }
  }
  const apagarItem = (i: ItemCompleto): Promise<Backup> =>
    apagarComBackup(`${rotuloPasta} item ${i.exame}`, [
      { tabela: 'item_preco', coluna: 'id', valores: [i.id] },
      { tabela: 'evento_valor', coluna: 'item_preco_id', valores: [i.id] },
    ], () => db.from('item_preco').delete().eq('id', i.id))

  // ── termos ────────────────────────────────────────────────────────────────
  const criarAditivo = async (ev: NovoEvento, valores: ValorEvento[]): Promise<void> => {
    const { data, error } = await db.from('evento').insert({ ...ev, unidade_id: uid }).select('id').single()
    if (error) throw new Error(error.message)
    if (!valores.length) { await recarregar(); return }
    try { await salvar(db.from('evento_valor').insert(valores.map(v => ({ evento_id: data!.id, ...v })))) }
    catch (e) { await recarregar(); throw e } // o termo já foi criado: recarrega para ele aparecer
  }

  /** Edita o termo e seus valores por item. Valores removidos vão para um backup baixado antes do delete (devolvido). */
  const salvarTermo = async (e: EventoCompleto, campos: CamposTermo | null, upserts: ValorTermo[], removidos: string[]): Promise<Backup | null> => {
    let backup: Backup | null = null
    try {
      if (campos) { const { error } = await db.from('evento').update(campos).eq('id', e.id); lancar(error) }
      if (upserts.length) {
        const { error } = await db.from('evento_valor').upsert(upserts.map(v => ({ evento_id: e.id, ...v })), { onConflict: 'evento_id,item_preco_id' })
        lancar(error)
      }
      if (removidos.length) {
        const linhas = (await capturar('evento_valor', 'evento_id', [e.id])).filter(l => removidos.includes(String(l.item_preco_id)))
        if (linhas.length) {
          backup = { versao: 1, criadoEm: new Date().toISOString(), descricao: `${rotuloPasta} valores do termo ${e.numero ?? e.tipo}`, tabelas: [{ tabela: 'evento_valor', linhas }] }
          baixarBackup(backup); guardarUltimo(backup)
        }
        const { error } = await db.from('evento_valor').delete().eq('evento_id', e.id).in('item_preco_id', removidos)
        lancar(error)
      }
    } finally { await recarregar() }
    return backup
  }
  const apagarTermo = (e: EventoCompleto): Promise<Backup> =>
    apagarComBackup(`${rotuloPasta} termo ${e.numero ?? e.tipo}`, [
      { tabela: 'evento', coluna: 'id', valores: [e.id] },
      { tabela: 'evento_valor', coluna: 'evento_id', valores: [e.id] },
    ], () => db.from('evento').delete().eq('id', e.id))

  // ── pendências ────────────────────────────────────────────────────────────
  const resolverPendencia = (pendId: string, nota: string) =>
    salvar(db.from('pendencia_cadastro').update({ resolvida: true, resolvida_em: new Date().toISOString(), nota }).eq('id', pendId))
  const criarPendencia = (tipo: string, detalhe: string) =>
    salvar(db.from('pendencia_cadastro').insert({ unidade_id: uid, tipo, detalhe: detalhe.trim() }))
  const reabrirPendencia = (p: Pendencia) =>
    salvar(db.from('pendencia_cadastro').update({ resolvida: false, resolvida_em: null, nota: notaReaberta(p.nota) }).eq('id', p.id))
  const editarNotaPendencia = (pendId: string, nota: string) =>
    salvar(db.from('pendencia_cadastro').update({ nota: nota.trim() || null }).eq('id', pendId))
  const apagarPendencia = (p: Pendencia): Promise<Backup> =>
    apagarComBackup(`${rotuloPasta} pendencia`, [{ tabela: 'pendencia_cadastro', coluna: 'id', valores: [p.id] }], () => db.from('pendencia_cadastro').delete().eq('id', p.id))

  return {
    u, itens, itensCompletos, eventos, pend, regras, nomes, papeis, dataRef, erro, versao, alvoId,
    setDataRef, tentarDeNovo, recarregar,
    salvarSituacao, salvarRegras,
    carregarPastasConfig, salvarContrato,
    salvarItens, apagarItem,
    adicionarNome, removerNome, marcarPrincipal, mudarGrupo, editarNome, moverNome, listarUnidades,
    criarAditivo, salvarTermo, apagarTermo,
    resolverPendencia, criarPendencia, reabrirPendencia, editarNotaPendencia, apagarPendencia,
  }
}
export type DadosUnidade = ReturnType<typeof useUnidade>
