# Decisões Técnicas Importantes

## Formato de Identificação de Contatos

### Decisão
- Usar `55` + `DDD` + `número` como formato de dígitos apenas.
- Armazenar como `remote_jid` sem sufixos (`@s.whatsapp.net`, `@lid`, etc.).

### Justificativa
- Padronização para comparação direta em banco de dados.
- Facilita a lógica de normalização em qualquer formato de entrada.
- Segue o padrão brasileiro de números de telefone.

## Uso de `DropdownMenu` (Radix UI)

### Decisão
- Usar `DropdownMenu` (Radix UI) para o menu de clique em números de telefone.

### Justificativa
- Consistência com o restante da interface (Shadcn/Radix).
- Acessibilidade e comportamento nativo de menu.
- Suporte a ações como "Copiar número" e "Abrir conversa".

## Uso de `navigator.clipboard`

### Decisão
- Usar `navigator.clipboard.writeText()` para a ação de "Copiar número".

### Justificativa
- API nativa moderna de copia para área de transferência.
- Dispensa biblotecas externas.
- Compatível com a maioria dos navegadores modernos.

## Normalização de Contatos

### Decisão
- Criar utilitário central `src/lib/contacts/normalize.ts` para normalização.
- Funções: `buildContactIndex`, `findContactByIdentifier`, `resolveContactDisplayName`.

### Justificativa
- Elimina duplicação de lógica de resolução de nomes.
- Performance melhorada com índice em memória O(1).
- Suporte a variações de formato de números brasileiros.

## Prioridade de Nome de Contato

### Decisão
- Prioridade: `nickname` > `name` > `sender_name` > número formatado.

### Justificativa
- `nickname` é o alias manual do usuário (maior prioridade).
- `name` é o nome salvo no contato.
- `sender_name` vem da mensagem/conversa (fallback).
- Número formatado é o último recurso visual.

## Detecção de Números de Telefone

### Decisão
- Regex `PHONE_REGEX` para detecção em mensagens.
- Função `splitByPhoneNumbers` para separar e renderizar gatilhos.

### Justificativa
- Regex cobre formatos brasileiros comuns.
- Separação permite inserir `PhoneNumberTrigger` com menu.
- Não altera o texto original irreversivelmente.

## Armazenamento de Avatar

### Decisão
- URL do avatar armazenada em `contacts.avatar_url`.
- `SmartAvatar` tenta buscar via `fetchAvatar` se faltar ou estiver desatualizado.

### Justificativa
- Separação entre dados persistidos e busca dinâmica.
- Fallback visual via iniciais do nome se a imagem falhar (inclusive 403 do CDN).

## Tratamento de Grupos vs. Contatos

### Decisão
- `isGroupJid()` para identificar `@g.us`.
- Resolução de nome separada para grupos e pessoas.

### Justificativa
- Evita misturar contatos normais com grupos.
- Mantém o nome do grupo como rótulo principal da conversa.
- Participantes de grupo usam sua própria resolução de nome.

## Validação de Datas

### Decisão
- Verificar `isNaN(new Date(value).getTime())` antes de chamar `format()`.

### Justificativa
- Evita crash em tempo de execução com datas inválidas.
- Protege o render tanto da lista quanto da folha de mensagens.

## Proteção de Attachments

### Decisão
- Verificar `att && typeof att === 'object' && att.url` antes de acessar propriedades.

### Justificativa
- Evita erro de leitura de propriedade em itens nulos do array.
- Protege o render da mensagem contra dados malformados.
