import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBadRequestResponse, ApiConflictResponse, ApiCreatedResponse, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiParam, ApiServiceUnavailableResponse, ApiTags, ApiTooManyRequestsResponse } from '@nestjs/swagger';
import { SchemaObject } from '@nestjs/swagger/dist/interfaces/open-api-spec.interface';
import { CreateExecutionDto } from './dto/create-execution.dto';
import { ListExecutionsQueryDto } from './dto/list-executions-query.dto';
import { AgentMetricsResponseDto } from './dto/agent-metrics-response.dto';
import { ExecutionStatus } from './execution-status.enum';
import { ExecutionsService } from './executions.service';

const executionResponseSchema: SchemaObject = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    agentId: { type: 'string', format: 'uuid' },
    input: { type: 'string' },
    output: { type: 'string', nullable: true },
    status: { type: 'string', enum: Object.values(ExecutionStatus) },
    attempts: { type: 'integer' },
    error: { type: 'string', nullable: true },
    inputTokens: { type: 'integer' },
    outputTokens: { type: 'integer' },
    totalTokens: { type: 'integer' },
    createdAt: { type: 'string', format: 'date-time' },
    startedAt: { type: 'string', format: 'date-time', nullable: true },
    completedAt: { type: 'string', format: 'date-time', nullable: true },
  },
};

@ApiTags('executions')
@Controller()
export class ExecutionsController {
  constructor(private readonly executionsService: ExecutionsService) {}

  @Post('agents/:agentId/executions')
  @ApiCreatedResponse({ description: 'Execução criada com status PENDING e enviada para processamento assíncrono.', schema: executionResponseSchema })
  @ApiTooManyRequestsResponse({ description: 'O consumo mensal já atingiu ou ultrapassou o limite, ou os tokens de entrada excedem o saldo disponível do agente.' })
  @ApiConflictResponse({ description: 'Agente inativo não aceita novas execuções. Reative o agente para continuar.' })
  @ApiBadRequestResponse({ description: 'UUID inválido, corpo inválido ou propriedades desconhecidas no body.' })
  @ApiNotFoundResponse({ description: 'Agente não encontrado.' })
  @ApiServiceUnavailableResponse({ description: 'Falha ao publicar a execução na fila. Tente novamente mais tarde.' })
  create(@Param('agentId', ParseUUIDPipe) agentId: string, @Body() dto: CreateExecutionDto) {
    return this.executionsService.create(agentId, dto);
  }

  @Get('agents/:agentId/executions')
  @ApiOperation({ summary: 'Lista o histórico de execuções de um agente', description: 'Disponível também para agentes inativos. Ordenação por createdAt DESC e id DESC. Total calculado antes da paginação.' })
  @ApiParam({ name: 'agentId', type: String, format: 'uuid' })
  @ApiOkResponse({
    description: 'Histórico paginado. Páginas sem resultados retornam items vazio e preservam o total do filtro.',
    schema: {
      type: 'object',
      properties: {
        items: { type: 'array', items: executionResponseSchema },
        page: { type: 'integer', example: 1 },
        limit: { type: 'integer', example: 10 },
        total: { type: 'integer', example: 0 },
      },
    },
  })
  @ApiBadRequestResponse({ description: 'UUID inválido ou parâmetros de consulta inválidos.' })
  @ApiNotFoundResponse({ description: 'Agente não encontrado.' })
  findByAgent(@Param('agentId', ParseUUIDPipe) agentId: string, @Query() query: ListExecutionsQueryDto) {
    return this.executionsService.findByAgent(agentId, query);
  }

  @Get('executions/:id')
  @ApiBadRequestResponse({ description: 'UUID inválido.' })
  @ApiOkResponse({ description: 'Execução encontrada.', schema: executionResponseSchema })
  @ApiNotFoundResponse({ description: 'Execução não encontrada para o UUID informado.' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.executionsService.findOne(id);
  }

  @Get('agents/:agentId/metrics')
  @ApiOperation({ summary: 'Consulta as métricas de um agente', description: 'Disponível também para agentes inativos. Usa todo o histórico; o consumo e a média consideram apenas execuções COMPLETED, sendo a quantidade de concluídas o denominador da média.' })
  @ApiParam({ name: 'agentId', type: String, format: 'uuid' })
  @ApiOkResponse({ description: 'Métricas do histórico; todos os campos são zero quando não há execuções.', type: AgentMetricsResponseDto })
  @ApiBadRequestResponse({ description: 'UUID inválido.' })
  @ApiNotFoundResponse({ description: 'Agente não encontrado.' })
  getMetrics(@Param('agentId', ParseUUIDPipe) agentId: string) {
    return this.executionsService.getMetrics(agentId);
  }
}
