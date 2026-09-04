import { appEnv } from '@/lib/env'
import { ToolFrame } from '@/components/tools/ToolFrame'

/**
 * Proposta Comercial embutida.
 *
 * SEM APERTO DE MÃO, e é o primeiro caso assim. Os outros quatro embutidos
 * (Relatórios, Licitações, PRN Hub, Gestão Médica) são apps React que espelham
 * `src/lib/embed.ts`; este é um Flask que serve um `index.html` de HTML/CSS/JS
 * puro — repositório `samuelklausfischer-rgb/PRN-proposta-comercial`, arquivo
 * `work/webui/index.html`. Ele não conhece o protocolo e nunca manda `ready`,
 * daí `prontidao="ao-carregar"`.
 *
 * Não precisa de credencial porque não tem login: quem decide quem entra é o
 * `tool_access` chave `'proposta-comercial'`, deste lado, no `ExternalToolRoute`
 * do `App.tsx`. Do lado de lá o serviço é aberto.
 *
 * POR QUE A CHAVE TEVE QUE SAIR DE LÁ ANTES: a página pedia o `X-API-Key` por
 * `window.prompt()`, e o Chrome IGNORA `prompt()` dentro de um quadro de outra
 * origem. Embutida com a chave ainda exigida, ela abriria bonita, a pessoa
 * clicaria em "Gerar" e não aconteceria nada — sem prompt e sem erro.
 *
 * O que existia aqui até 04/09/2026: uma reimplementação em React de 814 linhas
 * deste mesmo gerador, mais `src/lib/proposta/**`, `src/services/proposta*.ts`,
 * `public/proposta/**` (638 KB) e a ponte IPC `gerarPdfProposta` do Electron.
 * Foi removida junto — não tinha a extração por IA nem Word/Excel/ZIP, e
 * desatualizava a cada publicação do outro repositório.
 */
export default function PropostaComercial() {
  return (
    <ToolFrame
      title="Proposta Comercial"
      baseUrl={appEnv.VITE_PROPOSTA_APP_URL}
      envVarName="VITE_PROPOSTA_APP_URL"
      prontidao="ao-carregar"
    />
  )
}
