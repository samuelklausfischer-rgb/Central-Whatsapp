import { useEffect } from 'react'
import { ativarFerramenta, desativarFerramenta } from '@/stores/ferramentasVivas'

/**
 * O que a ROTA da ferramenta passa a renderizar: nada visível.
 *
 * A ferramenta em si é desenhada pelo `ToolHost`, que mora no `Layout` e não
 * desmonta ao trocar de tela. Este componente só avisa qual está ativa.
 *
 * Fazer assim, em vez de mover as ferramentas para fora do `<Routes>`, mantém
 * cada guarda de permissão exatamente onde estava (`FinanceiroToolRoute`,
 * `SuperAdminRoute`, `ExternalToolRoute`): quem não pode entrar continua sem
 * entrar, porque a rota nem chega a montar este registrador.
 */
export function FerramentaHospedada({ slug }: { slug: string }) {
  useEffect(() => {
    ativarFerramenta(slug)
    // Ao sair da rota, marca que nenhuma está em foco — mas NÃO desmonta:
    // continuar viva escondida é o ponto da funcionalidade.
    return () => desativarFerramenta()
  }, [slug])

  return null
}
