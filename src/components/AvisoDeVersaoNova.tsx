import { useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  EVENTO_VERSAO_NOVA,
  lerRastro,
  limparRastro,
  marcarAvisoAtendido,
} from '@/lib/recarga-forcada'

/**
 * ITEM 3: a faixa que explica a recarga, em vez de o app pular sozinho.
 *
 * Duas situações, e as duas vinham sem explicação nenhuma antes:
 *
 * 1. **Saiu versão nova agora.** Um pedaço do app não carregou porque o deploy
 *    trocou os arquivos por baixo desta aba. Em vez de recarregar no meio do
 *    que a pessoa estava fazendo, oferecemos o botão.
 *
 * 2. **A recarga já aconteceu.** Quando a rede de segurança de `main.tsx`
 *    precisou recarregar sozinha, sobra um rastro; ao voltar, a faixa diz o que
 *    houve. É a diferença entre "o app bugou" e "o app foi atualizado".
 *
 * Fica no `Layout`, e não numa rota: o pedaço que falhou costuma ser justamente
 * o da rota, então um aviso que morasse lá dentro não teria como aparecer.
 */
export function AvisoDeVersaoNova() {
  const [versaoNova, setVersaoNova] = useState(false)
  const [recarregou, setRecarregou] = useState(false)

  useEffect(() => {
    const aoAvisar = () => {
      // Avisa o `main.tsx` de que alguém vai desenhar — é o que cancela a
      // recarga automática da rede de segurança.
      marcarAvisoAtendido()
      setVersaoNova(true)
    }
    window.addEventListener(EVENTO_VERSAO_NOVA, aoAvisar)
    return () => window.removeEventListener(EVENTO_VERSAO_NOVA, aoAvisar)
  }, [])

  useEffect(() => {
    // Rastro de uma recarga que JÁ aconteceu (a rede de segurança agiu). Some
    // do armazenamento assim que é lido, para não reaparecer na navegação
    // seguinte da mesma aba.
    if (!lerRastro()) return
    limparRastro()
    setRecarregou(true)
    const t = setTimeout(() => setRecarregou(false), 8000)
    return () => clearTimeout(t)
  }, [])

  if (!versaoNova && !recarregou) return null

  return (
    <div className="sticky top-0 z-50 flex flex-wrap items-center justify-center gap-3 border-b border-border bg-accent px-4 py-2 text-sm">
      <RefreshCw className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
      {versaoNova ? (
        <>
          <span>Saiu uma versão nova do app. Recarregue para continuar.</span>
          <Button size="sm" onClick={() => window.location.reload()}>
            Recarregar
          </Button>
        </>
      ) : (
        <span>O app foi atualizado para a versão mais nova.</span>
      )}
    </div>
  )
}
