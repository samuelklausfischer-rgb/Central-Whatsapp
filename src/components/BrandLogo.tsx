import logoClaroUrl from '/logo-prnhub.png'
import logoEscuroUrl from '/logo-prnhub-invertida.png'

/**
 * Lockup horizontal "PRN Hub", alternando a variante clara/escura por CSS
 * (classes `dark:hidden` / `hidden dark:block`), NUNCA por `useTheme()` do
 * next-themes.
 *
 * Motivo: `resolvedTheme` volta `undefined` na primeira renderização (o
 * next-themes só resolve depois de montar no cliente), então usar o hook
 * daria uma piscada da logo errada a cada abertura do app. Já a classe `dark`
 * no `<html>` é aplicada por um script inline em `index.html` ANTES do React
 * montar, e o `tailwind.config.ts` está em `darkMode: ['class']` — então as
 * duas imagens já nascem com a visibilidade certa, sem piscar.
 */
export function BrandLogo({ className, alt = 'PRN Hub' }: { className?: string; alt?: string }) {
  return (
    <>
      <img src={logoClaroUrl} alt={alt} className={`dark:hidden ${className ?? ''}`} />
      <img src={logoEscuroUrl} alt={alt} className={`hidden dark:block ${className ?? ''}`} />
    </>
  )
}
