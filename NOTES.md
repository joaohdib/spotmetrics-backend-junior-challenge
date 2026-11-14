## Decisões técnicas

- No início, pensei em usar o `CreateAgentDto` como base para o DTO de atualização com `PartialType`. Preferi criar um `UpdateAgentDto` próprio porque são poucos campos e assim consigo definir as regras do PATCH sem criar uma dependência entre os dois DTOs.
- Validei `monthlyTokenLimit` como um inteiro positivo de até `2.147.483.647`, o maior valor que a coluna de inteiro do PostgreSQL aceita. Como o enunciado não define um teto de negócio, usei o limite do banco.
- O PATCH altera apenas os campos enviados. Se `description` for omitido, a descrição atual é mantida. Se vier como `null`, a descrição é limpa.

## Problemas e riscos

## Validação
- PATCH: enviei apenas `name` e conferi que os outros campos
  foram preservados. Também conferi que `description: null` limpa
  a descrição e `active: null` retorna `400`.

## Perguntas para a entrevista
- Faz sentido permitir a alteração do limite mensal de tokens pelo PATCH? Fiquei em dúvida se esse valor deveria poder mudar depois da criação do agente. Optei por permitir a alteração e preservar o consumo já registrado no mês.