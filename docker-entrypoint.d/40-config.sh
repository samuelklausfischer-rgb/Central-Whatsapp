#!/bin/sh
set -e

# Gera /env-config.js (window.__APP_CONFIG__) a partir das variáveis do
# container, na SUBIDA. A imagem oficial do nginx roda todo
# /docker-entrypoint.d/*.sh executável antes de iniciar o nginx. Assim a chave
# anon do Supabase não fica gravada na imagem nem no repositório: trocar o
# JWT_SECRET do Supabase vira só atualizar o Environment do serviço e reiniciar,
# sem rebuild. `src/lib/env.ts` lê `window.__APP_CONFIG__` antes de
# `import.meta.env`.

CONFIG_PATH="/usr/share/nginx/html/env-config.js"

# Escapa `\`/`"` e descarta quebra de linha antes de interpolar: um valor com
# aspas ou \n geraria JS inválido e o navegador descartaria o arquivo inteiro.
escapar() {
  printf '%s' "$1" \
    | tr -d '\r\n' \
    | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'
}

E_VITE_SUPABASE_URL=$(escapar "${VITE_SUPABASE_URL:-}")
E_VITE_SUPABASE_PUBLISHABLE_KEY=$(escapar "${VITE_SUPABASE_PUBLISHABLE_KEY:-}")
E_VITE_RELATORIOS_APP_URL=$(escapar "${VITE_RELATORIOS_APP_URL:-}")
E_VITE_LICITACAO_APP_URL=$(escapar "${VITE_LICITACAO_APP_URL:-}")
E_VITE_GESTAO_MEDICA_APP_URL=$(escapar "${VITE_GESTAO_MEDICA_APP_URL:-}")
E_VITE_PROPOSTA_APP_URL=$(escapar "${VITE_PROPOSTA_APP_URL:-}")
E_VITE_CONCILIACAO_APP_URL=$(escapar "${VITE_CONCILIACAO_APP_URL:-}")

cat > "$CONFIG_PATH" <<CONFIG
window.__APP_CONFIG__ = {
  "VITE_SUPABASE_URL": "${E_VITE_SUPABASE_URL}",
  "VITE_SUPABASE_PUBLISHABLE_KEY": "${E_VITE_SUPABASE_PUBLISHABLE_KEY}",
  "VITE_RELATORIOS_APP_URL": "${E_VITE_RELATORIOS_APP_URL}",
  "VITE_LICITACAO_APP_URL": "${E_VITE_LICITACAO_APP_URL}",
  "VITE_GESTAO_MEDICA_APP_URL": "${E_VITE_GESTAO_MEDICA_APP_URL}",
  "VITE_PROPOSTA_APP_URL": "${E_VITE_PROPOSTA_APP_URL}",
  "VITE_CONCILIACAO_APP_URL": "${E_VITE_CONCILIACAO_APP_URL}"
};
CONFIG

# Sem a chave o app sobe mas não consegue falar com o Supabase ("supabaseKey is
# required"). Deixa o motivo no log do container, sem expor valores.
if [ -z "${VITE_SUPABASE_PUBLISHABLE_KEY:-}" ]; then
  echo "[40-config] ERRO: VITE_SUPABASE_PUBLISHABLE_KEY não definida no Environment do serviço — o app não vai conseguir logar nem consultar o Supabase." >&2
fi
if [ -z "${VITE_SUPABASE_URL:-}" ]; then
  echo "[40-config] ERRO: VITE_SUPABASE_URL não definida no Environment do serviço." >&2
fi

PREENCHIDAS=$(grep -cE '": "[^"]+"' "$CONFIG_PATH" || true)
echo "[40-config] /env-config.js gerado — $PREENCHIDAS variável(is) preenchida(s) de 7."
