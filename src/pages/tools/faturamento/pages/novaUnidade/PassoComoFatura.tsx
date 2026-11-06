import { CLASSE_CONTROLE, Campo, Interruptor } from '../../components/ui'
import { MODELO, SITUACAO } from '../../lib/format'
import { OPCOES_JANELA } from '../../lib/config'
import { SITUACOES, validarComoFatura, type FormNova } from '../../lib/unidadeNova'

export function PassoComoFatura({ form, onChange }: { form: FormNova; onChange: (p: Partial<FormNova>) => void }) {
  const erros = validarComoFatura(form)
  const temRegras = !!(form.extras.regras_quantidade || form.extras.estudos_conta_2 || form.extras.acao_intensificada)
  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <Campo rotulo="Modelo de cobrança">
          <select value={form.modelo_cobranca} onChange={e => onChange({ modelo_cobranca: e.target.value })} className={CLASSE_CONTROLE}>
            {Object.entries(MODELO).map(([v, r]) => <option key={v} value={v}>{v === 'nao_identificado' ? 'Não identificado' : r}</option>)}
          </select>
        </Campo>
        <Campo rotulo="Período do relatório">
          <select value={form.janela} onChange={e => onChange({ janela: e.target.value })} className={CLASSE_CONTROLE}>
            {OPCOES_JANELA.map(o => <option key={o.valor} value={o.valor}>{o.rotulo}</option>)}
          </select>
        </Campo>
        <Campo rotulo="Data que vale para o período" ajuda="Automático segue a regra padrão do sistema.">
          <select value={form.criterio_data} onChange={e => onChange({ criterio_data: e.target.value as FormNova['criterio_data'] })} className={CLASSE_CONTROLE}>
            <option value="">Automático</option>
            <option value="laudo">Data do laudo</option>
            <option value="exame">Data do exame</option>
          </select>
        </Campo>
        <Campo rotulo="Franquia mensal (opcional)" erro={erros.franquia_mensal} ajuda="Quantidade de exames incluída no valor fixo.">
          <input inputMode="decimal" value={form.franquia_mensal} onChange={e => onChange({ franquia_mensal: e.target.value })} className={CLASSE_CONTROLE} />
        </Campo>
        <Campo rotulo="Situação do contrato">
          <select value={form.situacao} onChange={e => onChange({ situacao: e.target.value })} className={CLASSE_CONTROLE}>
            {SITUACOES.map(s => <option key={s} value={s}>{SITUACAO[s]?.rotulo ?? s}</option>)}
          </select>
        </Campo>
      </div>
      <Interruptor ligado={form.todos_status} onChange={v => onChange({ todos_status: v })} rotulo="Faturar exames de qualquer status"
        descricao="Desligado: só entram exames com os status padrão (Assinado e Reassinado)." />
      {temRegras && (
        <p className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-900">
          As regras de “conta mais de 1 exame” e de fim de semana foram copiadas da unidade de origem. Depois de criar, ajuste na tela da unidade.
        </p>
      )}
    </div>
  )
}
