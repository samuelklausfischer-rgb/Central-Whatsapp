/* Main entry point for the application - renders the root React component */
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import './main.css'
import { notifyMobileUpdaterReady } from './lib/mobile-updater'

// @skip-protected: Do not remove. Required for React rendering.
createRoot(document.getElementById('root')!).render(<App />)

// Chamado logo após o `render()`, sem esperar dados ou autenticação: o plugin
// de OTA (`@capgo/capacitor-updater`) só quer saber se o bundle JS carregou e
// executou, não se o app terminou de montar a tela. Ver `mobile-updater.ts`
// para o porquê disto ser obrigatório (sem isto, rollback automático do OTA).
notifyMobileUpdaterReady()
