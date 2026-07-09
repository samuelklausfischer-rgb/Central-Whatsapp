# Documentação — Central Whats

Índice central de toda a documentação do projeto.

## Aplicações

O projeto possui **duas aplicações** que compartilham o mesmo código-fonte React:

| Aplicação | Pasta | Descrição |
|-----------|-------|-----------|
| [Web App](./web-app/README.md) | `src/` + `Dockerfile` + `nginx.conf` | SPA React servida via Nginx em Docker |
| [Desktop App](./desktop-app/README.md) | `central-whats-app/` | Aplicativo Electron para Windows |

## Navegação Rápida

### Web App
- [Visão Geral](./web-app/README.md)
- [Arquitetura](./web-app/arquitetura.md)
- [Páginas e Rotas](./web-app/paginas-e-rotas.md)
- [Componentes Chave](./web-app/componentes-chave.md)
- [Serviços e API](./web-app/servicos-e-api.md)
- [Backend — Edge Functions](./web-app/backend-edge-functions.md)
- [Variáveis de Ambiente](./web-app/variaveis-de-ambiente.md)
- [Deploy (Docker + EasyPanel)](./web-app/deploy.md)

### Desktop App
- [Visão Geral](./desktop-app/README.md)
- [Arquitetura Electron](./desktop-app/arquitetura-electron.md)
- [Build e Distribuição](./desktop-app/build-e-distribuicao.md)
- [Sistema de Auto-atualização](./desktop-app/auto-atualizacao.md)

### Sessões de Desenvolvimento (Handoff)
- [Contexto do Projeto](./central-whats/contexto.md)
- [Histórico](./central-whats/historico.md)
- [Estado Atual](./central-whats/estado-atual.md)
- [Decisões Técnicas](./central-whats/decisoes.md)
- [Problemas Conhecidos](./central-whats/problemas-conhecidos.md)
- [Próximos Passos](./central-whats/proximos-passos.md)

### Análise Estratégica
- [Análise Completa do Sistema](./analise-estrategica.md) — O que é, como funciona, o que está pronto e lacunas para novas ideias

## Como Usar Esta Documentação

- **Novo no projeto?** Leia [web-app/README.md](./web-app/README.md) primeiro.
- **Vai fazer deploy?** Vá direto para [web-app/deploy.md](./web-app/deploy.md).
- **Vai publicar o desktop?** Veja [desktop-app/build-e-distribuicao.md](./desktop-app/build-e-distribuicao.md).
- **Encontrou um bug?** Consulte [central-whats/problemas-conhecidos.md](./central-whats/problemas-conhecidos.md).
- **Continuando de outra sessão?** Leia [central-whats/proximos-passos.md](./central-whats/proximos-passos.md).
