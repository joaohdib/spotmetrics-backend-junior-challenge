import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBadRequestResponse, ApiBody, ApiNoContentResponse, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { AgentsService } from './agents.service';
import { CreateAgentDto } from './dto/create-agent.dto';
import { UpdateAgentDto } from './dto/update-agent.dto';

@ApiTags('agents')
@Controller('agents')
export class AgentsController {
  constructor(private readonly agentsService: AgentsService) {}

  @Post()
  @ApiOperation({ summary: 'Cria um agente' })
  create(@Body() dto: CreateAgentDto) {
    return this.agentsService.create(dto);
  }

  @Get()
  @ApiOperation({ summary: 'Lista agentes' })
  findAll() {
    return this.agentsService.findAll();
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Atualiza um agente' })
  @ApiBody({ type: UpdateAgentDto, description: 'Atualização parcial: campos omitidos são preservados e {} não altera valores.' })
  @ApiOkResponse({
    description: 'Agente atualizado.',
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string', format: 'uuid' },
        name: { type: 'string' },
        description: { type: 'string', nullable: true },
        systemPrompt: { type: 'string' },
        active: { type: 'boolean' },
        monthlyTokenLimit: { type: 'integer' },
        createdAt: { type: 'string', format: 'date-time' },
        updatedAt: { type: 'string', format: 'date-time' },
      },
    },
  })
  @ApiBadRequestResponse({ description: 'UUID inválido, campos inválidos ou propriedades desconhecidas no body.' })
  @ApiNotFoundResponse({ description: 'Agente não encontrado.' })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateAgentDto) {
    return this.agentsService.update(id, dto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Busca agente por id' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.agentsService.findOne(id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Desativa um agente', description: 'Preserva o histórico e o consumo. Execuções já aceitas continuam; PATCH com active: true reativa o agente.' })
  @ApiNoContentResponse({ description: 'Agente desativado ou já inativo. Sem corpo de resposta.' })
  @ApiBadRequestResponse({ description: 'UUID inválido.' })
  @ApiNotFoundResponse({ description: 'Agente não encontrado.' })
  deactivate(@Param('id', ParseUUIDPipe) id: string) {
    return this.agentsService.deactivate(id);
  }

  @Get(':id/usage')
  @ApiOperation({ summary: 'Consumo de tokens do agente no mês' })
  @ApiQuery({ name: 'month', required: false, example: '2026-09' })
  usage(@Param('id', ParseUUIDPipe) id: string, @Query('month') month?: string) {
    return this.agentsService.getUsage(id, month);
  }
}
