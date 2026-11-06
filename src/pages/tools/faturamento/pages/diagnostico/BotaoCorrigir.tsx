import { Link } from '../../navegacao'
import { ArrowRight } from 'lucide-react'
import { alvoPara } from '../../lib/irPara'
import type { Problema } from '../../lib/diagnostico'
import { LINK_CORRIGIR } from './estilo'

/**
 * [Corrigir]: grava o alvo (seção e linha) e navega. O Link só tem to/className/children (portável ao Central Whats);
 * a gravação do alvo vai no clique do invólucro (captura), antes da navegação.
 */
export function BotaoCorrigir({ problema }: { problema: Problema }) {
  const { unidadeId, secao, alvoId } = problema
  if (!unidadeId || secao === 'regras-gerais') {
    return <Link to="/faturamento/regras-gerais" className={LINK_CORRIGIR}>Corrigir<ArrowRight className="size-3.5" aria-hidden="true" /></Link>
  }
  return (
    <span onClickCapture={() => alvoPara(unidadeId, secao, alvoId)}>
      <Link to={`/faturamento/unidade/${unidadeId}`} className={LINK_CORRIGIR}>Corrigir<ArrowRight className="size-3.5" aria-hidden="true" /></Link>
    </span>
  )
}
