import { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { isNativeAndroid } from '@/lib/app-info'
import { consumirVoltarRegistrado, fecharCamadaAberta } from '@/lib/android-back'

/** Telas em que o voltar não tem para onde ir: dali ele minimiza o app. */
const RAIZES = ['/dashboard', '/chat', '/login']

/**
 * Liga o botão voltar do Android à navegação do app.
 *
 * Montado UMA vez, no `Layout`. Fora do APK o efeito não faz nada — nem importa
 * o plugin —, então `npm run dev`, a build web e o Electron seguem intocados.
 */
export function useAndroidBack() {
  const navigate = useNavigate()
  const location = useLocation()

  useEffect(() => {
    if (!isNativeAndroid()) return

    let remover: (() => void) | undefined
    let cancelado = false

    import('@capacitor/app')
      .then(({ App }) =>
        App.addListener('backButton', ({ canGoBack }) => {
          // 1. diálogo/gaveta aberto fecha só ele
          if (fecharCamadaAberta()) return
          // 2. conversa aberta volta para a lista
          if (consumirVoltarRegistrado()) return
          // 3. tela interna volta uma
          if (!RAIZES.includes(location.pathname) && canGoBack) {
            navigate(-1)
            return
          }
          // 4. na raiz, MINIMIZA. `App.exitApp()` mataria o processo: a conexão
          //    em tempo real cairia e o próximo retorno seria uma abertura fria.
          App.minimizeApp()
        }),
      )
      .then((handle) => {
        if (cancelado) handle.remove()
        else remover = () => handle.remove()
      })
      .catch(() => {
        /* sem o plugin, o voltar volta ao padrão do sistema */
      })

    return () => {
      cancelado = true
      remover?.()
    }
  }, [navigate, location.pathname])
}
