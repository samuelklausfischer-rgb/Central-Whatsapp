import { Capacitor } from '@capacitor/core'
import { releaseNotes } from '@/data/release-notes'

export type AppPlatform = 'app' | 'android' | 'web'

interface ElectronBridge {
  getAppVersion?: () => Promise<string>
}

function bridge(): ElectronBridge | undefined {
  return (window as any).electronAPI
}

/**
 * Rodando dentro do APK.
 *
 * `isNativePlatform()` é falso no navegador mesmo com o Capacitor instalado —
 * é isso que mantém `npm run dev`, a build web e o Electron intactos: nenhum
 * caminho nativo é tomado fora do aparelho.
 */
export function isNativeAndroid(): boolean {
  try {
    return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android'
  } catch {
    return false
  }
}

/**
 * 'app' = desktop Electron, 'android' = APK, 'web' = navegador.
 *
 * Android é checado ANTES do Electron: os dois nunca coexistem, e pôr a
 * checagem nativa primeiro evita depender da ordem em que a ponte aparece.
 *
 * Mesmo critério já usado em `use-updater.ts` (presença da ponte do preload),
 * com o userAgent como reforço — `App.tsx` usa o userAgent para escolher o
 * Router, então os dois caminhos ficam consistentes.
 */
export function getAppPlatform(): AppPlatform {
  if (isNativeAndroid()) return 'android'
  if (bridge()) return 'app'
  if (typeof navigator !== 'undefined' && navigator.userAgent.includes('Electron')) return 'app'
  return 'web'
}

/**
 * Versão do bundle carregado. É a mesma fonte que o botão "Reportar problema"
 * já usa (`releaseNotes[0].version`), mantida como padrão único do projeto.
 */
export function getBundleVersion(): string | null {
  return releaseNotes[0]?.version ?? null
}

/**
 * Versão real do binário instalado, quando houver ponte do Electron. Cai para a
 * versão do bundle na web. As duas coincidem em produção; divergem só em dev.
 */
export async function getAppVersion(): Promise<string | null> {
  const api = bridge()
  if (api?.getAppVersion) {
    try {
      const version = await api.getAppVersion()
      if (version) return version
    } catch {
      /* cai para a versão do bundle */
    }
  }
  return getBundleVersion()
}
