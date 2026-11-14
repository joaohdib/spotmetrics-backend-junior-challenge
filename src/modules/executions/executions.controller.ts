import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBadRequestResponse, ApiConflictResponse, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { CreateExecutionDto } from './dto/create-execution.dto';
import { ListExecutionsQueryDto } from './dto/list-executions-query.dto';
import { ExecutionStatus } from './execution-status.enum';
import { ExecutionsService } from './executions.service';

@ApiTags('executions')
@Controller()
export class ExecutionsController {
  constructor(private readonly executionsService: ExecutionsService) {}

  @Post('agents/:agentId/executions')
  @ApiConflictResponse({ description: 'Agente inativo não aceita novas execuções. Reative o agente para continuar.' })
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
        items: { type: 'array', items: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            agentId: { type: 'string', format: 'uuid' },
            input: { type: 'string' },
            output: { type: 'string', nullable: true },
            status: { type: 'string', enum: Object.values(ExecutionStatus) },
            error: { type: 'string', nullable: true },
            inputTokens: { type: 'integer' },
            outputTokens: { type: 'integer' },
            totalTokens: { type: 'integer' },
            createdAt: { type: 'string', format: 'date-time' },
            startedAt: { type: 'string', format: 'date-time', nullable: true },
            completedAt: { type: 'string', format: 'date-time', nullable: true },
          },
        } },
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
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.executionsService.findOne(id);
  }
}
