import { useState } from 'react'
import { Building2, FileText, Hash, Layers, Pencil, Save, TriangleAlert, Wallet } from 'lucide-react'
import type { UnidadeResumo } from '../../lib/tipos'
import { MODELO, SITUACAO, brl, hojeISO, nomeExibicao } from '../../lib/format'
import { mudancas } from '../../lib/edicao'
import { BarraVigencia, Botao, BotaoSharePoint, Campo, CLASSE_CONTROLE, Cartao, Definicoes, RevisaoAlteracoes, Selo } from '../../components/ui'
import {
  atualizarPastasConfig, diffContrato, formDeUnidade, mudancasConfig, validarContrato,
  type AtualizacaoConfig, type CamposContrato, type FormContrato, type LinhaConfig,
} from './EditorContrato'

type Fase = 'leitura' | 'editando' | 'revisando'

export function SecaoCabecalho({ u, onSalvarSituacao, onSalvarContrato, onCarregarPastas }: {
  u: UnidadeResumo; onSalvarSituacao: (sit: string, motivo: string) => void | Promise<unknown>
  onSalvarContrato: (dados: Partial<CamposContrato>, config: AtualizacaoConfig[]) => Promise<void>
  onCarregarPastas: () => Promise<LinhaConfig[]>
}) {
  const [fase, setFase] = useState<Fase>('leitura')
  const [sit, setSit] = useState(u.situacao)
  const [motivo, setMotivo] = useState(u.motivo_situacao ?? '')
  const [salvando, setSalvando] = useState(false)
  const [salvo, setSalvo] = useState(false)
  const [f, setF] = useState<FormContrato>(() => formDeUnidade(u))
  const [pastaLiberada, setPastaLiberada] = useState(false)
  const [confirmaPasta, setConfirmaPasta] = useState('')
  const [regrasPasta, setRegrasPasta] = useState<LinhaConfig[] | null>(null)
  const [erro, setErro] = useState<string | undefined>()
  const set = <K extends keyof FormContrato>(k: K, v: FormContrato[K]) => setF(x => ({ ...x, [k]: v }))

  const rotuloSit = (s: string) => SITUACAO[s]?.rotulo ?? s
  const listaSit = mudancas(
    { situacao: u.situacao, motivo: u.motivo_situacao ?? '' },
    { situacao: sit, motivo: motivo.trim() },
    { situacao: { rotulo: 'Situação', formatar: v => rotuloSit(String(v)) }, motivo: { rotulo: 'Motivo' } },
  )
  const { mudancas: listaContrato, dados } = diffContrato(u, f)
  const pastaMudou = f.pasta.trim() !== u.pasta
  const atualizacoes = pastaMudou && regrasPasta ? atualizarPastasConfig(regrasPasta, u.pasta, f.pasta) : []
  const lista = [...listaContrato, ...mudancasConfig(atualizacoes), ...listaSit]
  const erros = validarContrato(f)
  const frasePasta = nomeExibicao(u.pasta)

  const abrir = () => {
    setSit(u.situacao); setMotivo(u.motivo_situacao ?? ''); setF(formDeUnidade(u)); setPastaLiberada(false); setConfirmaPasta('')
    setRegrasPasta(null); setErro(undefined); setSalvo(false); setFase('editando')
    // lê as regras por unidade só para saber se a pasta aparece nelas
    onCarregarPastas().then(setRegrasPasta).catch(() => setRegrasPasta([]))
  }
  const descartar = () => { setFase('leitura'); setErro(undefined) }
  const revisar = () => {
    const msgs = Object.values(erros)
    if (msgs.length) { setErro(msgs.join(' ')); return }
    if (pastaMudou && confirmaPasta !== frasePasta) { setErro(`Para mudar a pasta, digite “${frasePasta}” no campo de confirmação.`); return }
    if (pastaMudou && !regrasPasta) { setErro('Aguarde: ainda estou lendo as regras que citam a pasta.'); return }
    setErro(undefined); setFase('revisando')
  }
  const confirmar = async () => {
    setSalvando(true); setErro(undefined)
    try {
      if (Object.keys(dados).length || atualizacoes.length) await onSalvarContrato(dados, atualizacoes)
      if (listaSit.length) await onSalvarSituacao(sit, motivo)
      setFase('leitura'); setSalvo(true); setTimeout(() => setSalvo(false), 4000)
    } catch (e) { setErro(e instanceof Error ? e.message : 'Não foi possível salvar.') }
    finally { setSalvando(false) }
  }

  const acoes = fase === 'leitura'
    ? <>{salvo && <Selo cor="emerald">Salvo</Selo>}<Botao icone={Pencil} tamanho="pequeno" onClick={abrir}>Editar</Botao></>
    : fase === 'editando' ? <Selo cor="sky">Editando</Selo> : <Selo cor="sky">Revisão</Selo>

  return (
    <Cartao id="contrato" titulo="Contrato e vigência" icone={FileText} cor="sky" acoes={acoes} destaque={fase === 'leitura' ? undefined : 'edicao'}>
      <div className="space-y-5">
        <BarraVigencia inicio={u.vigencia_inicio} fim={u.vigencia_fim} hoje={hojeISO()} />
        <Definicoes itens={[
          { rotulo: 'Órgão', icone: Building2, valor: u.orgao ?? '—' },
          { rotulo: 'Nº do contrato', icone: Hash, valor: u.numero_contrato ?? '—' },
          ...(u.objeto ? [{ rotulo: 'Objeto', valor: u.objeto }] : []),
          { rotulo: 'Valor total', icone: Wallet, valor: <span className="tabular-nums">{brl(u.valor_total)}</span> },
          { rotulo: 'Modelo de cobrança', icone: Layers, valor: MODELO[u.modelo_cobranca] ?? u.modelo_cobranca },
          { rotulo: 'Empresa / grupo', icone: Building2, valor: `${u.empresa}${u.grupo ? ` · ${u.grupo}` : ''}` },
          { rotulo: 'Situação', valor: (
            <span className="inline-flex flex-wrap items-center gap-2">
              <span>{rotuloSit(u.situacao)}</span>
              {u.situacao_manual && <span className="text-xs text-slate-600">(definida à mão)</span>}
              {u.motivo_situacao && <span className="text-xs text-slate-600">— {u.motivo_situacao}</span>}
            </span>
          ) },
        ]} />

        {fase === 'leitura' && <BotaoSharePoint url={u.sharepoint_url} tamanho="medio" />}

        {fase === 'editando' && (
          <div className="space-y-4 rounded-lg border border-sky-200 bg-white p-4">
            <div className="grid gap-3 md:grid-cols-2">
              <Campo rotulo="Órgão"><input className={CLASSE_CONTROLE} value={f.orgao} onChange={e => set('orgao', e.target.value)} /></Campo>
              <Campo rotulo="Nº do contrato"><input className={CLASSE_CONTROLE} value={f.numero_contrato} onChange={e => set('numero_contrato', e.target.value)} /></Campo>
              <Campo rotulo="Início da vigência"><input type="date" className={CLASSE_CONTROLE} value={f.vigencia_inicio} onChange={e => set('vigencia_inicio', e.target.value)} /></Campo>
              <Campo rotulo="Fim da vigência" erro={erros.vigencia_fim}><input type="date" className={CLASSE_CONTROLE} value={f.vigencia_fim} onChange={e => set('vigencia_fim', e.target.value)} /></Campo>
              <Campo rotulo="Valor total do contrato (R$)" erro={erros.valor_total}><input inputMode="decimal" className={`${CLASSE_CONTROLE} tabular-nums`} value={f.valor_total} onChange={e => set('valor_total', e.target.value)} /></Campo>
              <Campo rotulo="Grupo"><input className={CLASSE_CONTROLE} value={f.grupo} onChange={e => set('grupo', e.target.value)} /></Campo>
              <Campo rotulo="Empresa" ajuda="Muda a empresa que emite a fatura desta unidade." erro={erros.empresa}>
                <select className={CLASSE_CONTROLE} value={f.empresa} onChange={e => set('empresa', e.target.value as FormContrato['empresa'])}>
                  <option value="PRN">PRN</option><option value="MEDIMAGEM">MEDIMAGEM</option>
                </select>
              </Campo>
              <Campo rotulo="Link da pasta no SharePoint" erro={erros.sharepoint_url}><input className={CLASSE_CONTROLE} placeholder="https://…" value={f.sharepoint_url} onChange={e => set('sharepoint_url', e.target.value)} /></Campo>
            </div>
            <Campo rotulo="Objeto do contrato"><textarea rows={2} className={CLASSE_CONTROLE} value={f.objeto} onChange={e => set('objeto', e.target.value)} /></Campo>
            <div className="grid gap-3 md:grid-cols-[14rem_1fr]">
              <Campo rotulo="Situação do contrato">
                <select className={CLASSE_CONTROLE} value={sit} onChange={e => setSit(e.target.value)}>
                  {Object.entries(SITUACAO).map(([k, v]) => <option key={k} value={k}>{v.rotulo}</option>)}
                </select>
              </Campo>
              <Campo rotulo="Motivo" ajuda="Fica registrado junto da situação.">
                <input className={CLASSE_CONTROLE} placeholder="ex.: renovado até 12/2027 — ofício X" value={motivo} onChange={e => setMotivo(e.target.value)} />
              </Campo>
            </div>

            <div className="space-y-2 rounded-lg border border-rose-200 bg-rose-50/60 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <TriangleAlert className="size-4 text-rose-600" aria-hidden="true" />
                <p className="flex-1 text-sm font-semibold text-rose-900">Pasta (nome da unidade no sistema)</p>
                {!pastaLiberada && <Botao tamanho="pequeno" onClick={() => setPastaLiberada(true)}>Alterar pasta</Botao>}
              </div>
              <Campo rotulo="Pasta" erro={erros.pasta}>
                <input className={CLASSE_CONTROLE} value={f.pasta} disabled={!pastaLiberada} onChange={e => set('pasta', e.target.value)} />
              </Campo>
              {pastaLiberada && (
                <div className="space-y-2 text-sm text-rose-900">
                  <p>
                    As regras “por unidade” (juntar CR e DX, separar urgência, desdobrar quantidade) ligam a unidade <b>pelo nome da pasta</b>. Se a pasta mudar e a regra não for
                    atualizada, a regra deixa de valer sem aviso. {regrasPasta ? 'Se a pasta aparecer nessas regras, eu atualizo junto.' : 'Lendo as regras…'}
                  </p>
                  {pastaMudou && (
                    <Campo rotulo={`Digite “${frasePasta}” para liberar a mudança`}>
                      <input className={CLASSE_CONTROLE} autoComplete="off" spellCheck={false} value={confirmaPasta} onChange={e => setConfirmaPasta(e.target.value)} />
                    </Campo>
                  )}
                </div>
              )}
            </div>

            {erro && <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">{erro}</p>}
            <div className="flex flex-wrap gap-2">
              <Botao variante="primario" icone={Save} disabled={!lista.length} onClick={revisar}>Revisar alterações</Botao>
              <Botao variante="fantasma" onClick={descartar}>Descartar</Botao>
              {!lista.length && <span className="self-center text-xs text-slate-600">Nada alterado ainda.</span>}
            </div>
          </div>
        )}
        {fase === 'revisando' && (
          <RevisaoAlteracoes mudancas={lista} salvando={salvando} erro={erro} onConfirmar={confirmar} onVoltar={() => { setErro(undefined); setFase('editando') }} />
        )}
      </div>
    </Cartao>
  )
}
