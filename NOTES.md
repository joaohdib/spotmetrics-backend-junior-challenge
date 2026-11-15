## Decisões técnicas

- No início, pensei em usar o `CreateAgentDto` como base para o DTO de atualização com `PartialType`. Preferi criar um `UpdateAgentDto` próprio porque são poucos campos e assim consigo definir as regras do PATCH sem criar uma dependência entre os dois DTOs.
- Validei `monthlyTokenLimit` como um inteiro positivo de até `2.147.483.647`, o maior valor que a coluna de inteiro do PostgreSQL aceita. Como o enunciado não define um teto de negócio, usei o limite do banco.
- O PATCH altera apenas os campos enviados. Se `description` for omitido, a descrição atual é mantida. Se vier como `null`, a descrição é limpa.
- No DELETE, optei por desativar o agente com `active = false`. Isso preserva o registro e o histórico de execuções. A desativação é reversível pelo PATCH com `active: true`.
- Enquanto o agente estiver inativo, novos pedidos de execução retornam `409 Conflict` antes da consulta à cota. Os jobs que já foram aceitos seguem normalmente, estejam na fila ou em processamento.
- No GET de listar execuções escolhi apresentar primeiro as execuções mais recentes, pois no `README.md` apesar de especificado que era para ser ordenado por data de criação, não tinha dito por onde iria começar.
- Para as métricas do agente, escolhi considerar apenas as execuções `COMPLETED` no total de tokens consumidos e na média, porque o consumer registra `totalTokens` quando conclui a execução. O total de execuções continua contando todos os status.
- Alinhei a validação do POST com a do PATCH. Assumi que todo agente deve ter um orçamento positivo, então defini o mínimo como 1. Como o enunciado não define um teto de negócio, mantive 2.147.483.647, o maior valor que a coluna de inteiro do PostgreSQL aceita.

## Problemas e riscos
- O Swagger do POST de execuções omitia o limite do `input` (1 a 10.000 caracteres) e a resposta `429` por saldo mensal insuficiente. Ambos foram documentados, sem alterar as validações ou o comportamento da rota.
- Na criação do agente, monthlyTokenLimit só era validado como inteiro. Isso permitia cadastrar agentes com cota zero ou negativa, embora o PATCH já rejeitasse esses valores. Um agente criado assim podia receber 429 logo no primeiro pedido de execução, mesmo sem ter consumido tokens.


## Validação

- PATCH - Enviei apenas `name` e conferi que os outros campos foram preservados. Também confirmei que `description: null` limpa a descrição e que `active: null` retorna `400`.
- DELETE e reativação - Desativei um agente pelo DELETE, conferi que `active` mudou para `false` e tentei criar uma execução. A solicitação foi recusada. Depois, reativei o mesmo agente pelo PATCH com `active: true` e confirmei que ele voltou a aceitar novas execuções.
- GET de listar execuções - Criei 20 execuções para um agente e aumentei o `PROCESSING_DELAY_MS` para 60000 (60 segundos). Depois fiz chamadas ao GET para conferir se o filtro por status, a paginação e a ordenação por data de criação funcionavam como esperado.
- GET de métricas - Reaproveitei as execuções que criei para testar o histórico e consultei o GET de métricas para conferir os valores retornados. Também inseri no banco uma execução com status `FAILED` e conferi se ela entrou no total de execuções e na contagem de falhas.

## Perguntas para a entrevista
- Faz sentido permitir a alteração do limite mensal de tokens pelo PATCH? Fiquei em dúvida se esse valor deveria poder mudar depois da criação do agente. Optei por permitir a alteração e preservar o consumo já registrado no mês.
- A média de tokens deveria considerar todas as execuções registradas ou apenas as concluídas? Como o enunciado não especifica quais status entram na média e o consumer preenche totalTokens na conclusão, optei por considerar apenas as execuções `COMPLETED`.
