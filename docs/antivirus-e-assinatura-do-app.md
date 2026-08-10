# Antivírus bloqueando o Central Whats — diagnóstico e implantação

## O problema

O instalador era detectado como vírus e bloqueado (Windows Defender/SmartScreen e
McAfee). Diagnóstico feito em 10/08/2026 sobre a v0.0.200/0.0.204.

Causas, por peso na decisão de bloqueio (não são independentes — a nº 1 é a raiz):

| # | Causa | Peso |
|---|---|---|
| 1 | **Binário sem assinatura Authenticode.** `Get-AuthenticodeSignature` retornava `NotSigned` no instalador e no exe interno. Defender trata "sem assinatura + baixa prevalência" como sinal forte de malware — é o gatilho dos veredictos genéricos de ML (`Wacatac`, `Sabsik`), que indicam origem não atestada, não código malicioso encontrado. | ~55% |
| 2 | **Metadados diziam `CompanyName: GitHub, Inc.`** (default do Electron, nunca sobrescrito porque faltavam `author` e `publisherName`). Afirmar ser de empresa conhecida sem assinatura que prove é padrão de masquerading. | ~15% |
| 3 | **Cadência altíssima + auto-updater que baixa e executa .exe.** Sem certificado a reputação só acumula por hash; com `differentialPackage: false` cada versão é hash novo (houve 3 releases em 5 horas em 30/07). E baixar `.exe` para `%LOCALAPPDATA%` e executá-lo com elevação é a assinatura comportamental de trojan-downloader. | ~12% |
| 4 | **Instalador NSIS de 117 MB**: auto-extrator de alta entropia, `app.asar` de 201 MB opaco ao scanner, `elevate.exe` embutido. | ~8% |
| 5 | **Instalação em `%LOCALAPPDATA%`** (McAfee ENS costuma bloquear execução em pasta gravável pelo usuário) e nunca submetido a portal de falso-positivo. | ~5% |

## O que já foi corrigido no repositório

- `package.json`: adicionado `author: "Central Whats"`.
- `central-whats-app/builder.json`: adicionado `win.signtoolOptions` com
  `certificateSubjectName`, `publisherName`, `signingHashAlgorithms: ["sha256"]`
  (sem SHA-1) e timestamp RFC3161.
- `.gitignore`: `*.pfx`, `*.p12`, `*.pvk`, `*.snk` — a chave privada nunca vai ao repo.
- `scripts/gerar-certificado-assinatura.ps1`: gera o certificado autoassinado.
- `central-whats-app/central-whats-codesign.cer`: **chave pública** do certificado,
  para distribuir à frota. Não contém segredo.

Resultado do build de verificação (v0.0.200, 10/08/2026):

```
Signer CN  : CN=Central Whats
Thumbprint : D3E0B00A24EB9F508A7FA1A56811797231DB632C
Algoritmo  : sha256RSA
Timestamp  : DigiCert SHA256 RSA4096 Timestamp Responder 2025
CompanyName: Central Whats     (antes: GitHub, Inc.)
```

Assinados: exe principal, `elevate.exe`, desinstalador e instalador NSIS.

### Limite honesto desta solução

O certificado é **autoassinado**. Ele só vale nas máquinas onde for implantado como
confiável — ou seja, **serve para a frota interna e para nada além dela**. Ele **não**
melhora reputação no SmartScreen, que depende de CA pública. Se um dia o app for
distribuído fora da frota, o caminho é Azure Trusted Signing (~US$ 10/mês) ou um
certificado EV (único com reputação SmartScreen imediata).

---

## Implantação na frota (executar pelo TI)

### 1. Confiar no certificado nas máquinas

Sem este passo o app continua sendo tratado como não assinado. O `.cer` precisa entrar
em **dois** armazenamentos — só a raiz não basta.

**Por GPO** (`Configuração do Computador → Configurações do Windows → Configurações de
Segurança → Políticas de Chave Pública`): importar
`central-whats-app/central-whats-codesign.cer` em:
- *Autoridades de Certificação Raiz Confiáveis*
- *Editores Confiáveis*

**Máquina avulsa** (PowerShell **como administrador**):

```powershell
Import-Certificate -FilePath '.\central-whats-app\central-whats-codesign.cer' -CertStoreLocation Cert:\LocalMachine\Root
Import-Certificate -FilePath '.\central-whats-app\central-whats-codesign.cer' -CertStoreLocation Cert:\LocalMachine\TrustedPublisher
```

Conferir depois: `Get-AuthenticodeSignature` no instalador deve passar de
`UnknownError` para **`Valid`**.

> Instalar certificado raiz é decisão de segurança: qualquer binário assinado com essa
> chave passa a ser confiável na máquina. Por isso o `.pfx` não existe em arquivo — a
> chave privada vive só no armazenamento do usuário da máquina de build.

### 2. Exclusões de antivírus (destrava quem está bloqueado hoje)

Vale enquanto a assinatura não estiver implantada em todas as máquinas.

Windows Defender — por GPO/Intune (`Componentes do Windows → Antivírus do Microsoft
Defender → Exclusões`) ou, avulso, PowerShell como administrador:

```powershell
Add-MpPreference -ExclusionPath "$env:LOCALAPPDATA\Programs\Central Whats"
Add-MpPreference -ExclusionPath "$env:LOCALAPPDATA\central-whats-updater"
```

McAfee ENS (ePO ou console local): os mesmos dois caminhos, em *On-Access Scan* e nas
regras de *Exploit Prevention* que bloqueiam execução a partir de pasta de usuário.

**Liberar a quarentena:** exclusão não restaura o que já foi removido. Nas máquinas
afetadas, restaurar o arquivo antes de reinstalar.

### 3. Reduzir reincidência

- Submeter cada release aos portais de falso-positivo da Microsoft e da McAfee. Grátis,
  resolve em dias, e é o que impede o veredicto genérico de voltar.
- **Agrupar releases.** Três versões em cinco horas garante que nenhum binário acumule
  reputação.
- **Não mexer** em `differentialPackage: false` — é deliberado desde a v0.0.159, para
  evitar o histórico de mismatch de sha512.

---

## Notas para quem for buildar

- O certificado já está no armazenamento pessoal da máquina de build atual. Em
  **máquina nova**, rodar antes:
  `powershell -ExecutionPolicy Bypass -File scripts\gerar-certificado-assinatura.ps1`
  — mas atenção: isso gera uma chave **diferente**, que a frota não confia. Para manter
  a mesma identidade, exportar o certificado existente com chave privada (`.pfx`, via
  `certmgr.msc`, com senha própria) e importá-lo na máquina nova, em vez de gerar outro.
- Se `certificateSubjectName` não encontrar o certificado, o electron-builder falha o
  build — não gera binário não assinado em silêncio.
- A primeira versão assinada instala normalmente sobre a frota não assinada de hoje:
  o `app-update.yml` já instalado não tem `publisherName`, e o `electron-updater` pula
  a verificação nesse caso (`NsisUpdater.js`, `verifySignature`). Das versões seguintes
  em diante a verificação passa a valer, comparando com `publisherName: Central Whats`.
