export interface ReleaseNote {
  version: string
  date: string
  title: string
  details: string[]
}

export const releaseNotes: ReleaseNote[] = [
  {
    version: '0.0.177',
    date: '2026-07-09 17:00',
    title: 'App mais leve, especialmente minimizado',
    details: [
      '⚡ Reduzido o consumo de CPU/memória com o app minimizado ou em segundo plano',
      '🖼️ Prévias de PDF e Excel no chat agora carregam sob demanda, só quando o anexo aparece na tela',
      '📜 Lista de mensagens otimizada para conversas longas — menos travamento ao abrir/rolar',
      '🎙️ Corrigido: gravação de áudio não fica mais ativa em segundo plano ao trocar de conversa',
    ],
  },
  {
    version: '0.0.176',
    date: '2026-07-09 11:49',
    title: 'Excluir itens do histórico no Rateio MobileMed e na Análise PRN',
    details: [
      '🗑️ Rateio MobileMed: agora dá pra excluir uma análise do histórico direto pela lista, com confirmação antes de apagar',
      '🗑️ Análise PRN: o botão de excluir arquivo do "Arquivo Histórico" ficou sempre visível e passou a mostrar um popup de confirmação (antes usava a caixa padrão do navegador)',
    ],
  },
  {
    version: '0.0.175',
    date: '2026-07-08 15:20',
    title: 'Listas do WhatsApp agora aparecem no chat',
    details: [
      '📋 Mensagens de lista/menu interativo (comum em atendimentos automáticos) agora aparecem com título, descrição e opções — antes só mostrava "[Mensagem de mídia]"',
      '👉 Clique em "Ver opções" para abrir a lista e escolher uma opção — envia o texto escolhido como mensagem normal na conversa',
      'ℹ️ Listas recebidas antes desta atualização continuam aparecendo como antes — só as novas vêm com essa prévia',
    ],
  },
  {
    version: '0.0.174',
    date: '2026-07-08 12:43',
    title: 'Correção: notificação de não lida presa + app mais leve',
    details: [
      '🔔 Corrigido: abrir uma conversa agora limpa o aviso de "não lida" na hora, sem precisar esperar',
      '⚡ Ajustes internos para reduzir o consumo de memória e processador do app',
    ],
  },
  {
    version: '0.0.173',
    date: '2026-07-08 10:37',
    title: 'Correção: chat voltava sozinho pro início da conversa',
    details: [
      '📜 Corrigido: ao rolar pra cima pra ler mensagens antigas, o chat não pula mais pro final sozinho',
      '⚡ A atualização automática da conversa e mensagens novas chegando não interrompem mais sua leitura',
    ],
  },
  {
    version: '0.0.172',
    date: '2026-07-08 09:43',
    title: 'Correção: botões do contato compartilhado não funcionavam com contatos de iPhone',
    details: [
      '📇 Contatos compartilhados de celulares iPhone agora vêm com o telefone certinho — os botões "Mensagem" e "Salvar contato" voltam a funcionar',
      'ℹ️ Contatos compartilhados antes desta atualização continuam sem telefone — só os novos são corrigidos',
    ],
  },
  {
    version: '0.0.171',
    date: '2026-07-03 12:25',
    title: 'Nova ferramenta: Rateio Mobilemed',
    details: [
      '➗ Nova ferramenta "Rateio Mobilemed" no menu Ferramentas (admin) — suba o Bruto.xlsx e gere o rateio por unidade/empresa',
      '📊 Mostra os totais, taxas fixas detalhadas, pendências e histórico das execuções anteriores',
    ],
  },
  {
    version: '0.0.170',
    date: '2026-07-02 10:40',
    title: 'Correção: mensagens recentes sumiam em conversas longas',
    details: [
      '💬 Corrigido: em conversas com muitas mensagens, as mais recentes às vezes não apareciam no chat (mesmo já tendo chegado)',
      '✅ Agora o chat sempre carrega as mensagens mais atuais, não importa o tamanho do histórico',
    ],
  },
  {
    version: '0.0.169',
    date: '2026-07-01 19:00',
    title: 'Contato compartilhado com cartão bonito + foto de todas as instâncias',
    details: [
      '👤 Contato compartilhado no chat agora aparece com nome, telefone e botões "Mensagem" e "Salvar contato" (antes só mostrava "[Contato]")',
      '💬 Botão "Mensagem" abre a conversa direto com o número compartilhado',
      '💾 Botão "Salvar contato" abre um popup pra confirmar o nome antes de salvar',
      '🖼️ Corrigida a foto de perfil que faltava em algumas instâncias no seletor (WhatsApp Adm e WhatsApp Comercial)',
      'ℹ️ Contatos compartilhados antes desta atualização continuam aparecendo como "[Contato]" — só os novos vêm com essa prévia',
    ],
  },
  {
    version: '0.0.167',
    date: '2026-07-01 16:30',
    title: 'Emoji picker com arte colorida + botão de IA mais inteligente',
    details: [
      '😀 Botão de emoji agora funciona: escolha entre os 50 emojis mais usados, com visual colorido igual o WhatsApp',
      '🤖 Botão de assistente de IA só libera quando você já digitou uma mensagem',
    ],
  },
  {
    version: '0.0.166',
    date: '2026-07-01 14:15',
    title: 'Prévia de PDF e Excel antes de baixar',
    details: [
      '📄 PDF e Excel agora abrem numa prévia (igual imagem/vídeo) antes de baixar, com botão de download no topo',
      '🎨 Balão de documento no chat ficou mais bonito: ícone e miniatura real do conteúdo por tipo de arquivo, estilo WhatsApp',
      '✅ Correção: texto "[Documento]" não aparece mais solto embaixo do anexo',
    ],
  },
  {
    version: '0.0.165',
    date: '2026-07-01 10:35',
    title: 'Atendimento em equipe: trava de posse e convite com confirmação',
    details: [
      '🔒 Só quem pegou a conversa pode designar, marcar "não posso" ou finalizar — antes qualquer pessoa da equipe conseguia mexer',
      '📨 Designar agora envia um convite: a pessoa escolhida precisa confirmar antes de assumir a conversa',
      '🏷️ Badge azul "atribuída a você" (fixa no topo) e roxo "atendido por outro" na lista de conversas',
      '✅ Correção: admins conseguem pegar/designar/finalizar conversas em qualquer setor',
    ],
  },
  {
    version: '0.0.163',
    date: '2026-06-30 16:30',
    title: 'Notificação instantânea de atualização via push',
    details: [
      '⚡ Badge de atualização agora aparece em segundos após o publish — sem polling',
      '📡 Usa Supabase Realtime: quando uma nova versão é publicada, todos os apps abertos são notificados instantaneamente',
    ],
  },
  {
    version: '0.0.162',
    date: '2026-06-30 16:00',
    title: 'Teste de notificação automática de atualização',
    details: [
      '🧪 Versão de teste — badge automático no topo sem clicar em nada',
    ],
  },
  {
    version: '0.0.161',
    date: '2026-06-30 15:30',
    title: 'Verificação automática de atualização a cada 4 horas',
    details: [
      '🔄 O app agora verifica se há nova versão automaticamente a cada 4 horas',
      '🔔 O badge de atualização aparece sozinho no topo — sem precisar clicar em "Verificar"',
    ],
  },
  {
    version: '0.0.160',
    date: '2026-06-30 15:00',
    title: 'Teste do badge de atualização',
    details: [
      '🧪 Versão de teste para validar o badge pulsante de nova atualização no topo do app',
    ],
  },
  {
    version: '0.0.159',
    date: '2026-06-30 14:30',
    title: 'Correção: atualização não travava mais em 90%',
    details: [
      '⚙️ Download de atualização agora é completo e direto — sem reconstrução de blocos que travava',
      '✅ O progresso vai de 0% a 100% sem travar no meio do caminho',
    ],
  },
  {
    version: '0.0.158',
    date: '2026-06-30 11:30',
    title: 'Badge de nova atualização no topo do app',
    details: [
      '🔔 Aparece um indicador pulsante no menu superior quando há uma nova versão disponível',
      '📥 Mostra o progresso do download ("Baixando 45%") e o botão "Instalar vX.X.X" quando pronto',
      '✅ O badge some automaticamente quando o app está atualizado — aparece só quando precisa',
    ],
  },
  {
    version: '0.0.157',
    date: '2026-06-30 10:15',
    title: 'Visualizador de imagem: botões de fechar e baixar sempre visíveis',
    details: [
      '🔧 Correção: o X (fechar) e o botão de baixar agora aparecem por cima de tudo — antes ficavam escondidos atrás do menu do topo',
      '🔍 Botões maiores e mais visíveis no visualizador (zoom, baixar, fechar)',
    ],
  },
  {
    version: '0.0.156',
    date: '2026-06-30 09:45',
    title: 'Mídia: visualizador no app, colar imagem e correção do "[Imagem]"',
    details: [
      '🖼️ Imagens e vídeos agora abrem dentro do app (não mais em nova aba), com zoom, baixar e fechar',
      '📋 Agora dá para colar imagem (Ctrl+V) direto na conversa aberta',
      '✅ Correção: ao enviar imagem/vídeo/documento não vai mais o texto "[Imagem]" junto no WhatsApp',
    ],
  },
  {
    version: '0.0.155',
    date: '2026-06-26 14:00',
    title: 'Análise PRN no menu Ferramentas (admin)',
    details: [
      '📊 "Análise PRN" agora aparece no dropdown Ferramentas — visível apenas para admins',
      '🔧 Correção: na versão anterior o botão estava no menu lateral, não no menu superior',
    ],
  },
  {
    version: '0.0.154',
    date: '2026-06-26 12:00',
    title: 'Ferramenta Análise PRN integrada (admin)',
    details: [
      '🔍 Nova seção "Ferramentas" no menu lateral — visível apenas para admins',
      '📊 Análise PRN Engine V2 integrada: cruzamento histórico, cockpit financeiro por unidade',
      '🧾 Análise de duplicidade automática ao enviar arquivos diários',
      '💾 Histórico de execuções, exportação PDF/Excel e observações por lançamento',
    ],
  },
  {
    version: '0.0.153',
    date: '2026-06-25 18:30',
    title: 'Correção: mensagem aparecia duplicada ao enviar',
    details: [
      '✅ A mensagem enviada agora aparece uma única vez, já com a assinatura',
      '🧹 Eliminada a duplicata que surgia e depois sumia ao enviar',
      '⚡ O envio continua instantâneo na tela, sem esperar o servidor',
    ],
  },
  {
    version: '0.0.152',
    date: '2026-06-25 12:00',
    title: 'Chat em tempo real e envio instantâneo',
    details: [
      '⚡ Mensagens enviadas aparecem na hora, sem esperar a confirmação do servidor',
      '🔄 Conversa e lista de contatos atualizam sozinhas — sem precisar sair e entrar',
      '📶 Reconexão automática quando a internet cai ou o computador volta do repouso',
      '🟢 Indicador de "enviando" e aviso quando uma mensagem falha',
    ],
  },
  {
    version: '0.0.151',
    date: '2026-06-18 14:00',
    title: 'Envio de arquivos grandes (até 200 MB)',
    details: [
      '📁 Limite de upload aumentado de 10 MB para 200 MB por arquivo',
      '📊 Barra de progresso exibida durante o envio de arquivos grandes',
      '☁️ Bucket de armazenamento atualizado para aceitar arquivos de até 200 MB',
    ],
  },
  {
    version: '0.0.150',
    date: '2026-06-18 12:00',
    title: 'Dashboard melhorado + Indicador de finalização redesenhado',
    details: [
      '📊 "Não lidas agora" agora mostra o número real por usuário (não mais o contador global)',
      '⏳ Novo card "Não respondidas" — conversas aguardando resposta, usando lógica de finalização real',
      '✅ Indicador de finalização de conversa redesenhado: círculo verde sólido com pulsação e ícone de badge',
      '🔄 Os dois cards do dashboard atualizam automaticamente ao marcar conversas como finalizadas',
    ],
  },
  {
    version: '0.0.149',
    date: '2026-06-17 17:00',
    title: 'Novo ícone do aplicativo',
    details: [
      '🎨 Ícone do app atualizado — novo visual azul com blocos e badge IA',
      '🖥️ O novo ícone aparece no atalho da Área de Trabalho, na barra de tarefas e no instalador',
      '🔄 Reinstale o app (caso já tenha instalado) para ver o ícone atualizado na barra de tarefas',
    ],
  },
  {
    version: '0.0.139',
    date: '2026-06-10 18:00',
    title: 'Autores de grupo com nome certo',
    details: [
      '👥 Conversas de grupo agora mostram o nome de quem enviou cada mensagem',
      '🏷️ O nome aparece em um selo destacado no começo do bloco de mensagens',
      '🔄 Quando muda de pessoa, o selo aparece de novo pra ficar claro quem falou',
      '🧹 Mensagens antigas com numeros foram limpas e agora mostram o nome correto',
      '📲 Mensagens agendadas ganharam botao Reenviar e erro mais detalhado',
    ],
  },
  {
    version: '0.0.139',
    date: '2026-06-10 14:07',
    title: 'Fechar conversa com Esc',
    details: [
      '⌨️ Agora você pode fechar a conversa apertando a tecla Esc, igual ao WhatsApp Web',
      '🪟 Se tiver uma janela aberta dentro do chat, o Esc fecha ela primeiro',
      '↩️ O botão de voltar no celular também ficou mais rápido',
    ],
  },
  {
    version: '0.0.139',
    date: '2026-06-10 13:48',
    title: 'A aba Chat ficou estável',
    details: [
      '🩹 Corrigimos um problema que fazia a conversa sumir do nada',
      '🔧 Pequenos ajustes para o menu de opções funcionar certinho',
      '✅ Tudo testado e aprovado',
    ],
  },
  {
    version: '0.0.139',
    date: '2026-06-10 13:37',
    title: 'Controle de conversas respondidas',
    details: [
      '🏷️ Cada conversa agora guarda se você já respondeu ou não',
      '🔄 Aparece um botão verde para marcar que você já respondeu',
      '📋 Também dá para marcar ou desmarcar pelo menu de opções',
      '📱 Uma bolinha azul pisca para lembrar que ainda precisa responder',
    ],
  },
  {
    version: '0.0.139',
    date: '2026-06-10 13:19',
    title: 'Filtros para organizar conversas',
    details: [
      '🔍 Filtre por período: Hoje, Ontem, Últimos 3 ou 7 dias',
      '🏁 Veja só conversas Não lidas ou Fixadas',
      '📌 Mostre ou oculte conversas Arquivadas e Não respondidas',
      '🧹 Botão "Remover" para limpar todos os filtros de uma vez',
    ],
  },
  {
    version: '0.0.139',
    date: '2026-06-10 12:03',
    title: 'Conversas não lidas organizadas',
    details: [
      '📬 Ajustamos a contagem de conversas não lidas para ficar correta',
      '🏷️ Agora você pode ver só as conversas Não lidas ou Fixadas',
      '⚡ Tudo isso sem precisar de configuração extra',
    ],
  },
  {
    version: '0.0.139',
    date: '2026-06-10 10:37',
    title: 'Login mais rápido e sem travamentos',
    details: [
      '🔓 Corrigimos um problema que fazia a tela ficar preta depois do login',
      '🚫 Aquela mensagem "Carregando..." que não sumia não aparece mais',
      '👤 Recarregar a página ou voltar de outra aba ficou muito mais suave',
    ],
  },
  {
    version: '0.0.139',
    date: '2026-06-10 09:10',
    title: 'Sistema mais rápido no dia a dia',
    details: [
      '⚡ As páginas agora carregam só quando você precisa delas',
      '🧠 A busca de conversas ficou mais rápida e fluida',
      '📱 Melhorias no consumo de bateria e desempenho geral',
      '🎨 A experiência no celular também ficou mais leve',
    ],
  },
]
