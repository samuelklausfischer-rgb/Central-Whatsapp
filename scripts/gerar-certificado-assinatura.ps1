# Gera o certificado autoassinado usado para assinar o Central Whats na frota interna.
#
# Rode UMA VEZ, na maquina que faz o build. O certificado fica no armazenamento
# pessoal do usuario (Cert:\CurrentUser\My) e o electron-builder o encontra pelo
# nome do titular ("Central Whats"), configurado em central-whats-app/builder.json.
#
# A chave privada NUNCA sai daqui em arquivo: nao ha .pfx e nao ha senha para guardar.
# O que se distribui para a frota e o .cer, que contem apenas a chave publica.
#
# Uso:  powershell -ExecutionPolicy Bypass -File scripts\gerar-certificado-assinatura.ps1

$ErrorActionPreference = 'Stop'

$subject = 'CN=Central Whats'
$destino = Join-Path $PSScriptRoot '..\central-whats-app\central-whats-codesign.cer'

$existente = Get-ChildItem Cert:\CurrentUser\My |
  Where-Object { $_.Subject -eq $subject -and $_.NotAfter -gt (Get-Date) }

if ($existente) {
  Write-Host "Ja existe um certificado valido para $subject - reaproveitando." -ForegroundColor Yellow
  $cert = $existente | Sort-Object NotAfter -Descending | Select-Object -First 1
}
else {
  $cert = New-SelfSignedCertificate -Type CodeSigningCert -Subject $subject -KeyAlgorithm RSA -KeyLength 3072 -HashAlgorithm SHA256 -KeyUsage DigitalSignature -KeyExportPolicy Exportable -NotAfter (Get-Date).AddYears(10) -CertStoreLocation 'Cert:\CurrentUser\My' -FriendlyName 'Central Whats - Assinatura de Codigo (frota interna)'
  Write-Host "Certificado criado." -ForegroundColor Green
}

# Exporta so a chave publica, para distribuir por GPO/Intune.
Export-Certificate -Cert $cert -FilePath $destino -Type CERT -Force | Out-Null

Write-Host ''
$cert | Format-List Subject, Thumbprint, NotBefore, NotAfter, FriendlyName
Write-Host "Chave publica exportada em: $(Resolve-Path $destino)"
Write-Host ''
Write-Host 'Proximo passo: distribuir esse .cer para a frota nos armazenamentos' -ForegroundColor Cyan
Write-Host '"Autoridades de Certificacao Raiz Confiaveis" E "Editores Confiaveis".' -ForegroundColor Cyan
