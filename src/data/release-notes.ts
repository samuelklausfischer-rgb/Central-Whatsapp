export interface ReleaseNote {
  version: string
  date: string
  title: string
  details: string[]
}

export const releaseNotes: ReleaseNote[] = [
  {
    version: '0.0.202',
    date: '2026-08-07 13:00',
    title: 'Cada um com a sua lista, e tarefas com dono',
    details: [
      '👥 A lista de conversas agora tem duas abas: "Geral", com tudo do aparelho, e "Minhas", só com o que está sob a sua responsabilidade — com um contador do quanto está com você',
      '✋ Voltaram os botões no topo da conversa: Pegar, Designar, Não posso e Finalizar. Pegar uma conversa agora leva ela para a sua aba, e os outros passam a ver que é você quem está atendendo',
      '➡️ Designar ficou mais direto: a conversa vai para a pessoa na hora, sem ela precisar aceitar antes',
      '✅ As tarefas ganharam responsável e prazo, e podem ser criadas soltas, sem precisar estar ligadas a um contato. Em Ferramentas → Tarefas você vê as suas, as que você direcionou e, se for administrador, as de todo mundo',
      '📅 Tarefa com prazo vencido aparece destacada no quadro',
      '📋 Ao colar algo copiado do Excel, o Central Whats pergunta se você quer mandar como imagem ou como texto — antes ia sempre como print, sem escolha',
      '❌ Um botão para sair da conversa, ao lado do menu. A tecla Esc continua funcionando igual',
      '🎤 Quando um áudio não puder ser encaminhado, a mensagem agora diz o motivo em vez de um erro genérico — inclusive quando o áudio é antigo demais e não está mais guardado no servidor',
    ],
  },
  {
    version: '0.0.201',
    date: '2026-08-04 18:00',
    title: 'Relatórios e Licitações agora abrem dentro do Central Whats',
    details: [
      '📊 O Sistema de Relatórios virou item em Ferramentas: abre já logado como você, mostra os seus projetos e salva no seu nome — sem digitar senha de novo',
      '⚖️ O PRN Licitações também entrou em Ferramentas, para quem tem acesso liberado',
      '🙋 No Licitações cada pessoa passa a entrar com a própria conta, e não mais pelo login compartilhado: quem cadastrou ou revisou um edital fica registrado com nome e sobrenome',
      '🔑 Quem libera o acesso ao Licitações é o administrador, em Gestão de Equipe — a chave fica no cadastro de cada usuário',
      'ℹ️ Os Relatórios aparecem para quem já tem perfil lá; se não aparecer para você, peça a um coordenador para criar o seu',
    ],
  },
  {
    version: '0.0.200',
    date: '2026-08-04 13:30',
    title: 'Selecionar várias mensagens de uma vez',
    details: [
      '☑️ Segure uma mensagem no celular — ou use "Selecionar mensagens" no menu dela — e marque quantas quiser. O topo da conversa vira uma barra com as ações',
      '📤 Encaminhar várias de uma vez, para várias conversas: marque os destinos, confirme e acompanhe o progresso. Se um envio falhar, "Enviar" retoma de onde parou sem repetir o que já tinha chegado',
      '📋 Copiar já sai com quem falou e a que horas ("[04/08 14:32] Maria: bom dia") — pronto para colar em prontuário, e-mail ou relatório, e em grupo dá para saber quem disse o quê',
      '⬇️ Baixar de uma vez todas as fotos e documentos das mensagens marcadas',
      '🗑️ Apagar várias mensagens suas de uma vez, para você ou para todos',
      '⌨️ No computador: shift+clique marca tudo entre uma mensagem e outra, e Esc sai da seleção',
      '🔢 Dá para marcar até 30 mensagens por vez, o mesmo limite do WhatsApp',
    ],
  },
  {
    version: '0.0.199',
    date: '2026-07-30 23:00',
    title: 'Encaminhar deixa de parecer mensagem escrita na hora',
    details: [
      '↱ Mensagem encaminhada aparece marcada como "Encaminhada", igual ao WhatsApp — tanto no que você encaminha quanto no que chega encaminhado para a clínica, que antes era indistinguível de mensagem comum',
      '✍️ O encaminhamento sai sem a sua assinatura: encaminhamento de verdade no WhatsApp não leva assinatura de quem repassou, e era isso que fazia a mensagem parecer escrita na hora',
      'ℹ️ O aviso "Encaminhada" aparece dentro do Central Whats. No WhatsApp de quem recebe ele ainda não aparece — depende de um recurso que a ferramenta que conecta ao WhatsApp não oferece hoje',
    ],
  },
  {
    version: '0.0.198',
    date: '2026-07-30 21:00',
    title: 'A conversa abre na última mensagem, como no WhatsApp',
    details: [
      '📍 Abrir um contato para de escorregar para o meio do histórico: a conversa fica na última mensagem e continua lá enquanto as fotos carregam',
      '🖼️ As fotos não empurram mais a conversa para baixo ao aparecerem — era isso que dava a impressão de que o app estava "perseguindo" os anexos',
      '📜 Rolar para cima para ler o histórico continua funcionando: a conversa só volta ao fim quando você quiser, e não é mais puxada de volta sozinha',
      '📎 Anexo cujo arquivo não existe mais no servidor deixa de aparecer como imagem quebrada e passa a mostrar o nome do arquivo com o aviso "arquivo indisponível"',
      '⚡ Conversas antigas abrem mais leves: o app parou de tentar baixar milhares de arquivos que já não existem',
    ],
  },
  {
    version: '0.0.197',
    date: '2026-07-30 18:00',
    title: 'Encaminhar, galeria, participantes do grupo, compartilhar contato e mencionar',
    details: [
      '📤 Encaminhar mensagem: no menu da mensagem, escolha a conversa de destino — vale para texto, foto, vídeo e documento',
      '🖼️ Galeria da conversa: abra as informações do contato e veja reunidas todas as fotos, documentos e links daquela conversa',
      '👥 Participantes do grupo: veja quem está no grupo, dê apelido, abra a conversa privada da pessoa ou responda a ela no privado sem o grupo receber nada',
      '📇 Compartilhar contato: pelo "+" do compositor ou pelas informações do contato. Dá para escolher vários contatos de uma vez e vários destinos',
      '🔔 Mencionar: digite @ num grupo para marcar alguém, ou escolha "Todos" — a pessoa é notificada no WhatsApp dela de verdade, como numa menção normal',
      '🏷️ A menção aparece com o nome da pessoa em vez do número, inclusive nas menções que a clínica recebe, que antes mostravam o número cru',
      '🚫 Contato sem telefone de verdade não aparece mais no compartilhamento: enviar um deles mandava um número inexistente, e o erro só aparecia do outro lado',
      '✅ Encaminhamento que falha agora avisa na tela — antes o clique não fazia nada e não dizia por quê',
      '📝 "Responder no privado" não apaga mais o que você já tinha escrito naquela conversa: a citação entra junto',
    ],
  },
  {
    version: '0.0.196',
    date: '2026-07-29 14:30',
    title: 'Conversa do contato certo, mensagens novas na hora e nomes de volta',
    details: [
      '🛡️ Ao trocar de contato, a conversa da pessoa anterior não aparece mais por alguns segundos sob o nome da nova — era o defeito mais sério, porque responder ou apagar um balão nesse intervalo agia na conversa errada',
      '📨 Mensagem que chega com a conversa fechada agora está lá quando você abre — antes a lista da esquerda já avisava mas a conversa demorava a mostrar, e dava a impressão de que a sua mensagem não tinha ido',
      '📇 Contatos que apareciam pelo número voltaram a mostrar o nome salvo: o app só enxergava os primeiros mil contatos e ignorava os outros 486 em silêncio',
      '📌 Conversas fixadas e marcadas como não lida pararam de sumir sozinhas — o mesmo limite cortava os seus marcadores',
      '⏳ Abrir uma conversa mostra linhas de carregamento em vez de dizer que ela está vazia; se a internet falhar, aparece aviso com "tentar novamente"',
      '🏷️ A etiqueta "Hoje" parou de flutuar por cima das mensagens cortando o texto',
      '🖼️ Fotos de perfil que sumiam e não voltavam mais durante o dia foram corrigidas',
    ],
  },
  {
    version: '0.0.195',
    date: '2026-07-29 01:30',
    title: 'Lista de conversas aparece na hora ao trocar de aparelho',
    details: [
      '⚡ Voltar para um aparelho que você já abriu nesta sessão mostra a lista na hora, sem esperar carregar de novo',
      '⏳ Na primeira vez que você abre um aparelho, aparecem linhas de carregamento — antes a tela dizia "Nenhuma conversa por aqui", como se o aparelho estivesse vazio',
      '🎯 A lista para de mudar de ordem sozinha logo depois de aparecer',
      '🚀 Trocar de aparelho ficou mais leve: o app para de buscar as fotos do aparelho anterior, que continuavam sendo baixadas por minutos e travavam a tela',
      '🖼️ Fotos de perfil deixam de ser buscadas repetidamente para o mesmo contato quando ele aparece em vários aparelhos',
    ],
  },
  {
    version: '0.0.194',
    date: '2026-07-28 22:30',
    title: 'Nome do contato para de voltar para o telefone e foto de grupo corrigida',
    details: [
      '✏️ O nome que você corrige no contato não é mais sobrescrito na mensagem seguinte: o app passa a proteger o nome definido por você',
      '📵 Quando o WhatsApp mandava só o número no lugar do nome, ele substituía o nome salvo — agora esse valor "fraco" é descartado e o nome anterior fica de pé',
      '👥 A foto do grupo não é mais trocada pela foto de quem mandou a última mensagem; se a foto do grupo não vier, o app mantém a que já estava em vez de gravar a errada',
      '🤳 Enviar uma mensagem não grava mais a sua própria foto no contato',
      '📇 A lista de contatos da lateral carrega mais rápido e para de "carregar errado" de vez em quando — mudanças feitas durante a abertura da tela não se perdem mais',
      '🔐 A entrada no app ficou mais leve, com uma consulta a menos na verificação de aparelho liberado',
    ],
  },
  {
    version: '0.0.193',
    date: '2026-07-28 09:00',
    title: 'Rascunho preso ao contato, chat mais rápido e aviso de mensagem apagada de volta',
    details: [
      '✍️ O que você escreve fica guardado no contato em que foi escrito: trocar de conversa não leva mais o texto junto, e a conversa mostra "Rascunho:" na lista para você voltar e terminar depois',
      '⚠️ Isso valia também para anotação, tarefa e apelido — se você digitasse em um contato, trocasse e salvasse, ia parar no contato errado. Corrigido',
      '⚡ Abrir e trocar de conversa ficou bem mais rápido, principalmente para quem não é admin: a lista de conversas era a parte mais lenta do app',
      '🖼️ A foto e o nome do contato anterior não aparecem mais por um instante ao trocar de conversa, e a lista não mostra mais as conversas do aparelho anterior durante a troca',
      '🗑️ O aviso "apagada" voltou a funcionar quando o contato apaga uma mensagem no WhatsApp dele — e agora aparece também em foto, áudio e vídeo, não só em texto',
      'ℹ️ Mensagens apagadas antes desta atualização não recebem o aviso retroativamente',
    ],
  },
  {
    version: '0.0.192',
    date: '2026-07-27 16:00',
    title: 'Correção do canal de atualização automática',
    details: [
      '🔄 O app voltou a encontrar as novas versões sozinho — a busca por atualização passou a apontar para o endereço correto',
      '⚠️ Esta é a última atualização que chega pelo canal antigo: a partir dela, todas as próximas vêm automaticamente pelo novo',
    ],
  },
  {
    version: '0.0.191',
    date: '2026-07-27 10:00',
    title: 'Botão para reportar problema ou sugerir ideia',
    details: [
      '💬 Novo ícone no topo da tela (ao lado do sino de novidades) abre um formulário rápido para relatar um problema ou sugerir uma melhoria',
      '🙋 Não precisa se identificar: o report já vai com o seu nome e a tela em que você estava',
      '📋 Tudo cai direto na fila do Central Whats no PRN Hub, onde a equipe prioriza e acompanha',
    ],
  },
  {
    version: '0.0.190',
    date: '2026-07-23 16:06',
    title: 'Análise PRN e Rateio Mobilemed liberados para o setor Financeiro',
    details: [
      '🔓 Quem tem o Setor marcado como "Financeiro" (em Gestão de Equipe) agora acessa as duas ferramentas — antes era só admin',
      '🔑 Login único: não existe mais uma segunda tela pedindo email/senha separados para entrar nessas ferramentas',
    ],
  },
  {
    version: '0.0.177',
    date: '2026-07-09 16:30',
    title: 'Aviso quando o contato apaga uma mensagem',
    details: [
      '🗑️ Quando o contato apaga uma mensagem do lado dele no WhatsApp, ela continua aparecendo no chat (com o conteúdo original), mas agora ganha um badge vermelho "apagada" ao lado do horário',
      'ℹ️ Mensagens apagadas antes desta atualização não recebem o badge retroativamente — só as apagadas a partir de agora',
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
