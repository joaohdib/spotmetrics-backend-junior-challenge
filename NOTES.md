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
- **Falha na atualização do consumo de tokens:** O consumer salvava a execução como `COMPLETED` antes de atualizar o consumo mensal. Se a segunda gravação falhasse, a execução ficava como concluída e os tokens ainda não apareciam no consumo do agente.
  - **Como validei:** Forcei um erro no consumer logo depois de salvar a execução como `COMPLETED`. Conferi no Postgres que a execução aparecia como concluída, mas o consumo mensal continuava no valor anterior.
  - **Como resolvi:** Coloquei a conclusão da execução e a atualização do consumo na mesma transação. Depois da correção, simulei a falha novamente no Postgres e confirmei que a execução permaneceu em `PROCESSING` e o consumo ficou inalterado.
- A admissão de execuções permitia input só com espaços quando o consumo estava exatamente na cota, pois essa entrada conta zero tokens. A checagem agora recusa novos disparos quando o consumo registrado já atingiu ou ultrapassou o limite, além de recusar entradas que excedem o saldo. A admissão considera os tokens de entrada. Os tokens de saída são contabilizados depois e ainda podem fazer a última execução aceita ultrapassar a cota.
  - **Como validei:** Testes unitários no `executions.service.spec.ts` cobrem consumo de 10 ou 11 de 10 tokens com input `" "` (429, sem salvar nem publicar), 9 de 10 com `"oi"` (aceita, salva e publica) e 9 de 10 com `"oi mundo"` (429, sem salvar nem publicar).
- O Swagger do POST de execuções omitia a faixa de 1 a 10.000 caracteres do `input` e a resposta `429` por saldo mensal insuficiente. Documentei os dois pontos e mantive o comportamento da rota.
  - **Como validei:** Comparei a documentação com as validações do `CreateExecutionDto` e com o `429` retornado pelo service. Depois da alteração, abri o `/docs` e conferi que o exemplo do `input` aparecia em **Request body** e que o `429` aparecia em **Responses**.
- Na criação do agente, `monthlyTokenLimit` só era validado como inteiro. Isso permitia cadastrar agentes com cota zero ou negativa, embora o PATCH já rejeitasse esses valores. Com uma cota assim, o agente podia receber `429` no primeiro pedido de execução, mesmo com consumo zerado.
  - **Como validei:** Comparei os DTOs de criação e atualização. O POST usava apenas `@IsInt()`, enquanto o PATCH também validava a faixa. Conferi no service que uma entrada com pelo menos um token já ultrapassava uma cota zero ou negativa.
- **Reentrega sem limite de tentativas**: Quando o processamento lança uma exceção, o consumer chama `nack` com `requeue: true` e o RabbitMQ coloca a mensagem de volta na fila. Como o código não limita as tentativas, o worker pode continuar tentando processar a mesma execução enquanto a falha persistir.
  - **Como validei**: Adicionei temporariamente uma exceção no `executions.consumer.ts` e enviei uma única solicitação de execução. Nos logs, vi o worker tentar processar o mesmo ID várias vezes. Depois que removi o trecho e reiniciei o worker, a mesma execução concluiu normalmente.
  

## Validação

- PATCH - Enviei apenas `name` e conferi que os outros campos foram preservados. Também confirmei que `description: null` limpa a descrição e que `active: null` retorna `400`.
- DELETE e reativação - Desativei um agente pelo DELETE, conferi que `active` mudou para `false` e tentei criar uma execução. A solicitação foi recusada. Depois, reativei o mesmo agente pelo PATCH com `active: true` e confirmei que ele voltou a aceitar novas execuções.
- GET de listar execuções - Criei 20 execuções para um agente e aumentei o `PROCESSING_DELAY_MS` para 60000 (60 segundos). Depois fiz chamadas ao GET para conferir se o filtro por status, a paginação e a ordenação por data de criação funcionavam como esperado.
- GET de métricas - Reaproveitei as execuções que criei para testar o histórico e consultei o GET de métricas para conferir os valores retornados. Também inseri no banco uma execução com status `FAILED` e conferi se ela entrou no total de execuções e na contagem de falhas.

## Perguntas para a entrevista
- Faz sentido permitir a alteração do limite mensal de tokens pelo PATCH? Fiquei em dúvida se esse valor deveria poder mudar depois da criação do agente. Optei por permitir a alteração e preservar o consumo já registrado no mês.
- A média de tokens deveria considerar todas as execuções registradas ou apenas as concluídas? Como o enunciado não especifica quais status entram na média e o consumer preenche totalTokens na conclusão, optei por considerar apenas as execuções `COMPLETED`.
- O limite mensal deve funcionar como um teto absoluto ou a última execução aceita pode ultrapassá-lo por causa dos tokens de saída? Mantive o comportamento atual porque o enunciado pede que novos disparos sejam bloqueados quando o consumo registrado já atingiu a cota. Hoje a API verifica se a entrada cabe no saldo, contabiliza a saída ao concluir e recusa novos pedidos com `429` se a cota tiver sido atingida ou ultrapassada.
