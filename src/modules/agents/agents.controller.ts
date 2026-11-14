import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBadRequestResponse, ApiBody, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
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

  @Get(':id/usage')
  @ApiOperation({ summary: 'Consumo de tokens do agente no mês' })
  @ApiQuery({ name: 'month', required: false, example: '2026-09' })
  usage(@Param('id', ParseUUIDPipe) id: string, @Query('month') month?: string) {
    return this.agentsService.getUsage(id, month);
  }
}
