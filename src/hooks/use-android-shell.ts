import { useEffect } from 'react'
import { isNativeAndroid } from '@/lib/app-info'

/**
 * Ajustes da casca nativa: barra de status e teclado.
 *
 * Montado uma vez, no `Layout`. Fora do APK não faz nada — nem importa os
 * plugins —, então `npm run dev`, a build web e o Electron seguem intocados.
 */
export function useAndroidShell() {
  useEffect(() => {
    if (!isNativeAndroid()) return
    let vivo = true

    ;(async () => {
      try {
        const { StatusBar, Style } = await import('@capacitor/status-bar')
        if (!vivo) return
        // O app abre no tema escuro (o `<html>` nasce com `class="dark"`), então
        // os ícones do relógio e da bateria precisam ser CLAROS. Com o padrão
        // eles saem escuros sobre fundo escuro e somem.
        await StatusBar.setStyle({ style: Style.Dark })
        // O conteúdo desenha por baixo da barra; quem reserva o espaço é o
        // `env(safe-area-inset-top)` do CSS. A partir do Android 15 isto é
        // obrigatório de qualquer forma — o sistema não deixa mais recusar.
        await StatusBar.setOverlaysWebView({ overlay: true })
      } catch {
        /* sem o plugin, fica o padrão do sistema */
      }

      try {
        const { Keyboard } = await import('@capacitor/keyboard')
        if (!vivo) return
        // Sem a barra "Concluído" acima do teclado: ela come altura útil e não
        // faz nada que o próprio compositor já não faça.
        await Keyboard.setAccessoryBarVisible({ isVisible: false })
      } catch {
        /* idem */
      }
    })()

    return () => {
      vivo = false
    }
  }, [])
}
