export interface ReleaseNote {
  version: string
  date: string
  title: string
  details: string[]
  /**
   * ITEM 4: um exemplo curto de COMO usar o que chegou nesta versão. Opcional
   * de propósito — as versões antigas não têm, e reescrever o histórico só para
   * preencher um campo não ajudaria ninguém. Vale para as próximas.
   */
  usabilidade?: string
}

export type CategoriaNota = 'novidade' | 'correcao'

/**
 * ITEM 4: separa o que é função nova do que é bug corrigido.
 *
 * Lê a convenção que os dados JÁ seguem — correção abre com 🐛, e o texto
 * costuma começar com "Corrigido". O diálogo por sua vez já fatiava a string
 * em `slice(0, 2)` para o ícone e `slice(2)` para o texto, então esta função só
 * formaliza o mesmo corte.
 *
 * Feito assim, e não com um campo novo por item, porque a alternativa era
 * reescrever mais de 600 linhas de histórico para ganhar uma informação que já
 * está escrita ali — com risco de errar na transcrição e sem ninguém revisando.
 */
export function classificarNota(detalhe: string): CategoriaNota {
  const icone = detalhe.slice(0, 2)
  const texto = detalhe.slice(2).trim()
  if (icone === '🐛') return 'correcao'
  return /^corrigid/i.test(texto) ? 'correcao' : 'novidade'
}

export const releaseNotes: ReleaseNote[] = [
  {
    version: '0.0.216',
    date: '2026-08-26 17:00',
    title: 'Gestão Médica no menu, disparo em massa, e o contato fica de quem responde',
    details: [
      '🩺 Gestão Médica agora abre dentro do PRN Hub, em Ferramentas — já logado, sem senha de novo. São 148 médicos com contratos, documentos e pendências. Liberado para o setor Administrativo',
      '📣 Disparador em massa: monte listas de transmissão, dispare para todas e acompanhe a fila andando. O envio é espaçado de propósito, para não parecer robô',
      '📧 Email Hub conectado de verdade à Microsoft: as contas entram por login da própria Microsoft, sem senha guardada. Chegaram também campanhas de e-mail e organização das caixas por setor',
      '🔔 O sino de notificações agora vale no app inteiro, e não só dentro das Conversas. Tem som, e a sua preferência passou a ficar guardada no seu perfil — antes cada navegador tinha a dele, e trocar de computador zerava tudo',
      '🏷️ Etiqueta agora é da equipe. Quando alguém cria uma etiqueta num contato, ela aparece para todos — antes só quem criou enxergava, e ninguém sabia de quem era a unidade sem perguntar. Renomear e apagar continua com quem criou',
      '👤 Respondeu um contato que não tinha dono? Ele passa a ser seu automaticamente, até você finalizar ou designar para outra pessoa. Conversa que já está com um colega não muda de mão — ninguém rouba atendimento sem querer',
      '🐛 Conversa aberta por um colega parou de contar como não lida para os outros',
      '🐛 Pegar e Finalizar mexem na lista no clique, sem esperar a rede responder',
      '🐛 O Controle de Mensagens parou de liderar por um número que mentia',
    ],
    usabilidade:
      'Para achar o Gestão Médica: menu Ferramentas → Sistemas PRN → Gestão Médica. Se você é do Administrativo ele já está lá; se não aparece, é porque o acesso vai pelo setor do seu cadastro.',
  },
  {
    version: '0.0.215',
    date: '2026-08-24 18:10',
    title: 'A fila do Hub inteira: agenda, tarefas e um monte de correção',
    details: [
      '📅 Agenda nova: compromissos seus, do seu setor e de grupos, com quatro formas de ver — só os seus, do setor, dos grupos, ou tudo junto. Dá para marcar importância, anexar um link ou um e-mail, e o administrador pode designar um compromisso para alguém do próprio setor',
      '✅ Tarefas ficaram completas: agora dá para abrir a tarefa, escrever um checklist dentro dela, e marcar como "aguardando" ou "em validação" dizendo o motivo. O motivo aparece no cartão, para quem confere entender na hora por que a tarefa ainda não terminou',
      '🎨 O quadro de tarefas ficou seu: escolha quais colunas aparecem, em que ordem, com que nome e cor. Muda só o seu quadro — a situação de cada tarefa continua a mesma para a equipe inteira',
      '🧭 Tour do app: uma apresentação rápida das ferramentas na primeira vez que você entra, e que dá para rever quando quiser',
      '🎉 Aviso de novidades: ao entrar depois de uma atualização, aparece uma vez o que mudou, separando o que é função nova do que é correção',
      '🧩 PRN Hub dentro do app: a fila de melhorias virou uma ferramenta, para acompanhar o que foi pedido sem sair daqui',
      '💬 Clicar numa mensagem citada leva você até a mensagem original, como no WhatsApp',
      '🐛 Corrigido: editar uma mensagem agora vale também no WhatsApp de quem recebe. Antes o texto mudava só aqui, e os dois lados ficavam diferentes sem ninguém perceber',
      '🐛 Corrigido: a resposta mostrava a pessoa errada na prévia — às vezes o seu próprio nome — e, ao responder uma resposta, mostrava o texto errado',
      '🐛 Corrigido: a citação chegava quebrada no celular de quem recebe quando a mensagem original era antiga',
      '🐛 Corrigido: a barra de texto cresce conforme você escreve, até cinco linhas, em vez de ficar presa numa linha só',
      '🐛 Corrigido: dar zoom e arrastar uma foto aberta funciona de verdade, inclusive com dois dedos, e a foto não some mais da tela ao arrastar',
      '🐛 Corrigido: a foto enviada no chat ficou mais parecida com o WhatsApp, sem moldura e maior',
      '🐛 Corrigido: o app não volta mais para a tela inicial ao abrir uma conversa. Quando sai uma versão nova, agora ele avisa e espera você mandar recarregar, em vez de recarregar sozinho no meio do que você estava fazendo',
    ],
    usabilidade:
      'Para experimentar a Agenda: clique em Agenda no topo, escolha um dia no calendário e use "Novo compromisso". Em Agenda do compromisso, escolha "Do meu setor" para todo o setor enxergar. Nas Tarefas, clique no título de uma tarefa para abrir o checklist, e use o botão "Colunas" para deixar o quadro do seu jeito.',
  },
  {
    version: '0.0.214',
    date: '2026-08-20 15:50',
    title: 'A fila de melhorias que vocês pediram',
    details: [
      '🎙️ Gravar áudio ficou como no WhatsApp: ao começar a gravar, o botão do microfone dá lugar ao de enviar, no mesmo canto. Antes ele continuava ali e, quem clicava esperando enviar, apagava a gravação sem querer. Agora também dá para descartar no meio, ou parar para ouvir antes de mandar',
      '📝 A IA de organizar texto voltou a funcionar. O serviço que usávamos foi desativado pelo fornecedor e por isso ela vinha dando erro — trocamos pelo substituto oficial, que é mais rápido',
      '🔊 Áudio recebido agora ganha transcrição automática, logo abaixo do player, como no WhatsApp. Vale para os áudios novos',
      '🗣️ E, ao gravar, dá para transcrever antes de enviar: o texto cai no campo da mensagem, você lê, corrige o que quiser e manda como texto',
      '💬 O painel de informações do contato foi reorganizado por assunto e voltou a abrir — na versão anterior ele ficava só uma tela escura, sem conteúdo',
      '🏷️ Etiquetas: agora dá para criar, renomear, mudar a cor e excluir ali mesmo no contato, sem ir em Configurações. E elas aparecem na lista de conversas, com cor e nome, além de virarem filtro',
      '📱 As instâncias mostram a própria foto do WhatsApp na lista, no lugar do ícone genérico de telefone',
      '🔀 Novo botão ao lado de Filtros para esconder as conversas já atribuídas, deixando à vista só o que ninguém pegou',
      '📎 Dá para arrastar um arquivo direto para cima da conversa e anexar, sem passar pelo clipe',
      '✍️ Toggle para mandar uma mensagem sem assinatura, ao lado de "Enviando como". Vale só para aquela conversa e volta ao normal na seguinte',
      '💾 No app do computador, baixar arquivo não pergunta mais onde salvar: vai direto para a pasta Downloads. E áudios e vídeos sem nome recebem nome com data e hora, então um não sobrescreve o outro',
      '📋 O botão de reportar problema ganhou a aba "Meus reportes": você acompanha o status, o prazo e o checklist do que enviou',
      '🐛 Corrigido em Anotações: quando a internet caía, a tela dizia "Nenhuma anotação" — o contrário da verdade',
      '🐛 Corrigido: excluir, editar e cancelar só apareciam ao passar o mouse e ficavam invisíveis no celular',
    ],
  },
  {
    version: '0.0.213',
    date: '2026-08-18 17:05',
    title: 'A cara nova chega para todo mundo',
    details: [
      '🔁 Mesmas novidades da 0.0.212 — o app inteiro com fundo próprio e cartões de vidro. Quem tinha instalado uma versão de teste com o mesmo número 0.0.212 não recebia a atualização, porque o app compara os números e concluía que já estava em dia. Esta versão corrige a entrega e coloca todo mundo na mesma tela',
    ],
  },
  {
    version: '0.0.212',
    date: '2026-08-18 16:32',
    title: 'O app inteiro ganhou cara nova',
    details: [
      '🎨 Todas as telas passaram a dividir o mesmo fundo — uma arte azul do PRN Hub, feita dos mesmos quadrados que formam o globo da nossa marca. A tela de Conversas ficou de fora de propósito: lá o que importa é a conversa, não o cenário',
      '🧊 Os cartões viraram vidro: translúcidos, com o fundo aparecendo por trás. Saiu a barrinha colorida na lateral e a caixinha do ícone, que davam ao app um ar de modelo pronto',
      '📊 A Visão Geral foi redesenhada por inteiro: os números do topo, Minhas tarefas, Anotações, Aparelhos, Conversas mais ativas, Volume por aparelho e Agendamentos. As listas perderam as bordas e ganharam respiro, e o volume por aparelho agora separa recebidas de enviadas na mesma barra',
      '📱 Os aparelhos voltaram a mostrar a própria foto do WhatsApp. Quando a foto não existe ou não carrega, entra o globo do PRN no lugar — antes aparecia um ícone de imagem quebrada. E o app busca a foto de novo sozinho quando ela vence',
      '🌙 O modo escuro acompanha tudo: o mesmo desenho de fundo, repintado para a noite',
      '🗂️ Configurações, Gestão de Equipe, Anotações, Gatilhos, Agendamentos, CRM, E-mails e as ferramentas de Assinaturas, Proposta e Rateio seguem agora o mesmo padrão da Visão Geral',
      '🐛 Corrigido em Anotações: quando a internet caía, a tela dizia "Nenhuma anotação" — exatamente o contrário da verdade. Agora avisa que não deu para carregar e oferece tentar de novo',
      '🖼️ Abrir o app agora tem cenário: seis artes do PRN Hub, uma sorteada a cada vez que você abre. A tela de verificar atualização, a de entrar e a de carregar passaram a usar a mesma arte da vez, com um painel de vidro por cima',
      '🔄 A verificação de atualização ficou clara: um anel mostra o andamento e, quando há versão nova, o download aparece em porcentagem grande, com um botão de "Instalar e reiniciar" no fim',
      '⏱️ A abertura fica cinco segundos verificando, de propósito, para dar tempo de ler o que está acontecendo. Quem já está logado cai direto na home quando eles terminam — o app carrega a sua sessão DURANTE a espera, então não é tempo perdido',
      '🐛 Corrigido: quando a checagem de atualização respondia muito rápido, a abertura ficava dez segundos parada em "Verificando" antes de liberar',
      '🔐 Entrar continua igual no que importa: mesmo usuário, mesma senha. O botão agora trava enquanto processa, para dois cliques não dispararem dois logins',
    ],
  },
  {
    version: '0.0.211',
    date: '2026-08-18 11:00',
    title: 'Assinatura de e-mail e proposta comercial agora são do app',
    details: [
      '✍️ Nova ferramenta Assinaturas: monte a sua assinatura de e-mail, escolha entre cinco desenhos e as três empresas, e copie direto para o Outlook ou o Gmail. Tem também "Vários de uma vez", para gerar a equipe inteira de uma vez. Liberada para todo mundo — ninguém precisa mais pedir o arquivo por anexo',
      '📄 Nova ferramenta Proposta Comercial: preencha cliente, volumetria e cases e saia com o PDF de 13 slides pronto para enviar. Liberada pessoa a pessoa na Gestão de Equipe',
      '🗂️ As propostas geradas ficam num histórico compartilhado: clicar numa proposta antiga traz o formulário de volta preenchido, para montar a do próximo cliente sem digitar tudo outra vez',
      '🖨️ No app instalado o PDF baixa sozinho, já com o nome certo. Pelo navegador abre a caixa de impressão para salvar como PDF',
    ],
  },
  {
    version: '0.0.210',
    date: '2026-08-14 16:30',
    title: 'Agora é PRN Hub, e pegar contato deixa de mexer nas outras instâncias',
    details: [
      '🎨 O app passa a se chamar PRN Hub, com a marca nova no login, no cabeçalho, no ícone da área de trabalho e no celular',
      '📌 O atalho FIXADO na barra de tarefas precisa ser refixado uma vez: ele apontava para o programa com o nome antigo. O da área de trabalho e o do menu iniciar se atualizam sozinhos',
      '👤 Pegar um contato numa instância marcava o MESMO contato como pego nas outras, e a conversa sumia da aba Geral de quem estava no outro WhatsApp. O atendimento agora é de cada instância, como sempre foi no banco — era só a tela que misturava',
      '🔔 Mensagem que chega numa instância que você não está vendo volta a notificar. Antes o aviso podia ser silenciado consultando quem tinha pego a conversa em OUTRO WhatsApp',
      '✅ Sua sessão e suas conversas continuam como estavam: a atualização instala por cima, ninguém precisa entrar de novo',
    ],
  },
  {
    version: '0.0.209',
    date: '2026-08-13 17:00',
    title: 'Contato compartilhado, resposta citada e a mensagem que sumia',
    details: [
      '👥 Compartilhar VÁRIOS contatos de uma vez chegava como um balão vazio, sem nada dentro. Agora aparecem todos os cartões, um por contato, como no WhatsApp',
      '↩️ Quando alguém responde citando uma mensagem, a citação agora aparece por cima da resposta — antes o texto chegava solto e quem estava atendendo perdia o contexto do atendimento',
      '📤 Mensagem enviada para número digitado à mão podia sumir: ia parar numa conversa paralela, e quando o contato respondia a resposta caía em outra. A conversa agora se junta sozinha quando isso acontece',
      '✍️ A assinatura saía em dobro ao reaproveitar uma mensagem já enviada — copiar e colar trazia a assinatura junto, e o sistema acrescentava a dele. Agora sai uma só',
      '👻 Balões vazios que apareciam do nada no meio da conversa deixaram de ser criados: vinham de avisos internos do WhatsApp, que não são mensagem',
      '📎 Na versão web, enviar documento logo depois de uma atualização falhava com um erro em inglês. Agora a página se atualiza sozinha, e o aviso é em português',
      'ℹ️ Mensagem editada no WhatsApp ainda não atualiza aqui: o WhatsApp manda o texto novo criptografado, e sem a chave não há como aplicar',
    ],
  },
  {
    version: '0.0.208',
    date: '2026-08-12 15:00',
    title: 'Relatórios e Licitações voltam a abrir',
    details: [
      '🔧 Em Ferramentas, Relatórios e Licitações abriam com o aviso "não está configurado" em vez do sistema. Voltaram a funcionar normalmente',
      '✅ Análise PRN e Rateio não foram afetados e seguem como estavam',
    ],
  },
  {
    version: '0.0.207',
    date: '2026-08-11 15:00',
    title: 'Ferramentas separadas em dois grupos, e a Análise PRN diz o que está faltando',
    details: [
      '🧰 O menu Ferramentas estava com item demais e sem ordem: o que é do próprio Central Whats aparecia embolado com os outros sistemas da empresa. Agora são dois grupos lado a lado — "Do app" (Tarefas, Anotações, Gatilhos, Agendamentos) e "Sistemas PRN" (Análise PRN, Rateio, Relatórios, Licitações)',
      '📱 No celular a divisão é a mesma, em duas seções dentro de "Mais" — o que você aprende num lugar vale no outro',
      '🔔 Notificações saiu de Ferramentas e foi para junto de Configurações: no computador, no menu do seu nome; no celular, na seção "Conta". Ela ajusta som e alerta, não abre uma tela, e ali fica ao lado das outras preferências',
      '👤 Quem não tem nenhum sistema liberado vê só o grupo "Do app", sem seção vazia prometendo o que não está lá',
      '⌨️ O menu passou a fechar com Esc e a aceitar as setas do teclado, e não escapa mais da tela em janela estreita',
      '📊 Na Análise PRN, o aviso "Meses não detectados" acusava falha de leitura da planilha quando, na maioria das vezes, faltava só selecionar a segunda base do cofre. Agora a mensagem diz o que já está coberto e pede o que falta — e só fala em erro de leitura quando nenhuma data foi reconhecida mesmo, apontando quais arquivos estão sem a aba "financas"',
      '🔍 O seletor de arquivos históricos mostra a cobertura ANTES de processar: quais meses os arquivos escolhidos cobrem e se ainda falta alguma coisa',
    ],
  },
  {
    version: '0.0.205',
    date: '2026-08-11 14:00',
    title: 'Quem viu cada mensagem, quem designou a conversa, e a lista só com o que é seu',
    details: [
      '👀 "Informações da mensagem", no menu de qualquer mensagem: mostra quem da equipe já viu aquela mensagem, com dia e hora, e quem ainda não viu. O horário fica registrado como o momento em que a pessoa viu — não muda depois',
      '🕓 O histórico foi reconstruído a partir de quem respondeu cada conversa, então boa parte das conversas antigas já aparece com o "visto por" preenchido',
      '🙋 A conversa atribuída passa a dizer quem designou e quando, no topo da conversa e nas informações do contato — antes ela chegava sem dizer de onde veio',
      '📥 O card "Taxa de resposta" deu lugar a "Meus atendimentos": quantas conversas estão na sua mão agora, e quantas chegaram para você hoje',
      '🔔 O card "Não lidas" virou clicável e abre a lista das conversas com mensagem nova, da mais recente para a mais antiga; clicar em uma abre a conversa',
      '🙈 Conversa que já tem dono sai da sua lista: quem olha "Geral" está atrás do que ainda não tem responsável. Para ver as dos colegas, marque "De outros atendentes" nos filtros',
      '🔎 A busca continua achando todo mundo, inclusive quem está com outro atendente — procurar pelo nome traz o contato mesmo quando ele está escondido da lista',
      '🧹 Administradores ganharam "Zerar todas as notificações": marca como lida toda conversa de todos os aparelhos, para a equipe inteira. Pede confirmação, e não tem como desfazer',
      '🛡️ O instalador passou a ser assinado digitalmente — primeiro passo para o antivírus parar de bloquear o app. O bloqueio só termina de vez depois que o certificado da empresa for instalado em cada computador, e disso o pessoal de TI cuida',
    ],
  },
  {
    version: '0.0.204',
    date: '2026-08-10 18:00',
    title: 'Designar volta a funcionar, e o app para de trocar de aparelho sozinho',
    details: [
      '➡️ Designar uma conversa para um colega voltou a funcionar. Estava falhando para todo mundo, em qualquer conversa, desde que Designar passou a atribuir direto',
      '📱 O app não troca mais de aparelho sozinho: deixar o Central Whats aberto, sair para fazer outra coisa e voltar podia mudar a instância por conta própria e fechar a conversa que estava aberta',
      '🔗 Trocar de aparelho pela lista agora atualiza o endereço da janela, então o aparelho escolhido é o que continua valendo ao voltar',
      '👥 Grupos ganharam ações: mudar a foto, o nome e a descrição, e promover ou rebaixar administradores',
      '🔒 Criar grupo, sair de um grupo e remover participante ficam com quem é administrador do Central Whats, sempre pedindo confirmação antes',
      '🔄 Relatórios e Licitações avisam quando existe versão nova, com uma faixa discreta no topo. A atualização só acontece quando você clicar — nada recarrega no meio do seu trabalho',
      '💬 Os erros ao designar deixaram de aparecer em inglês',
    ],
  },
  {
    version: '0.0.203',
    date: '2026-08-07 16:30',
    title: 'Ferramentas não recomeçam do zero, e o painel fala de pessoas',
    details: [
      '🧰 Sair de uma ferramenta para o WhatsApp e voltar não perde mais o que você estava fazendo: formulário preenchido, arquivo escolhido, resultado na tela e o ponto da página continuam lá',
      '🔐 Em Relatórios e Licitações isso vale também para o login — antes, voltar pedia para entrar de novo',
      '🗂️ Ao abrir uma segunda ferramenta aparecem abas discretas no topo para alternar entre elas; ficam até três abertas ao mesmo tempo',
      '👥 O painel agora conta PESSOAS, não mensagens: quantas procuraram a empresa, em quanto tempo foram respondidas (mediana) e qual a taxa de resposta. Dez mensagens podiam ser uma pessoa escrevendo dez linhas ou dez pessoas na fila — o número não distinguia',
      '✅ Suas tarefas e suas anotações agora aparecem logo ao abrir o painel, sem precisar rolar. Anotação sem contato vinculado também aparece, o que antes não acontecia',
      '⏰ "Não respondidas" passou a ser só do dia, e dá para clicar no card: abre a lista de quem está esperando, e clicar na pessoa leva direto para a conversa dela',
      '🔎 Na conversa, busca e etiquetas foram para dentro do menu de três pontinhos, deixando o topo mais limpo. O Ctrl+F continua funcionando igual',
      '◀️ Sair da conversa agora é uma seta única à esquerda; a tecla Esc continua valendo',
      '🎨 Os botões de atendimento (Pegar, Designar, Não posso, Finalizar) estavam ilegíveis no tema claro — agora a ação esperada fica destacada e as demais discretas',
      '🏷️ As etiquetas do contato aparecem ao lado do nome. Marcar e desmarcar passou a funcionar de verdade: havia uma falha antiga que impedia o visto de aparecer',
    ],
  },
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
