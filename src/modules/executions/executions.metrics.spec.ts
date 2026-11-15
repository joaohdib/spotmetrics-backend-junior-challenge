import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { RabbitMQService } from '../../common/rabbitmq/rabbitmq.service';
import { Agent } from '../agents/agent.entity';
import { AgentMonthlyUsage } from '../agents/agent-monthly-usage.entity';
import { AgentExecution } from './agent-execution.entity';
import { ExecutionStatus } from './execution-status.enum';
import { ExecutionsController } from './executions.controller';
import { ExecutionsService } from './executions.service';

const agentId = '690b224a-f858-4ed1-a430-b899a7e27f85';
const otherAgentId = '690b224a-f858-4ed1-a430-b899a7e27f86';
const zeroMetrics = {
  totalExecutions: 0, completedExecutions: 0, failedExecutions: 0,
  totalTokensConsumed: 0, averageTokensPerExecution: 0,
};
const selections = {
  totalExecutions: 'COUNT(*)',
  completedExecutions: 'COUNT(*) FILTER (WHERE execution.status = :completed)',
  failedExecutions: 'COUNT(*) FILTER (WHERE execution.status = :failed)',
  totalTokensConsumed: 'COALESCE(SUM(execution.totalTokens) FILTER (WHERE execution.status = :completed), 0)',
  averageTokensPerExecution: 'COALESCE(AVG(execution.totalTokens) FILTER (WHERE execution.status = :completed), 0)',
};

describe('GET /agents/:agentId/metrics', () => {
  let app: INestApplication;
  let baseUrl: string;
  let records: { agentId: string; status: ExecutionStatus; totalTokens: number }[];
  const agents = { findOne: jest.fn() };
  const builder = {
    select: jest.fn().mockReturnThis(),
    addSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    setParameters: jest.fn().mockReturnThis(),
    getRawOne: jest.fn(),
  };
  const executions = { createQueryBuilder: jest.fn(() => builder) };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [ExecutionsController],
      providers: [
        ExecutionsService,
        { provide: getRepositoryToken(Agent), useValue: agents },
        { provide: getRepositoryToken(AgentExecution), useValue: executions },
        { provide: getRepositoryToken(AgentMonthlyUsage), useValue: {} },
        { provide: RabbitMQService, useValue: {} },
        { provide: DataSource, useValue: {} },
      ],
    }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.listen(0, '127.0.0.1');
    baseUrl = await app.getUrl();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    records = [];
    agents.findOne.mockResolvedValue({ id: agentId, active: true });
    // Simula o retorno textual das agregações do PostgreSQL e confere a consulta enviada.
    builder.getRawOne.mockImplementation(async () => {
      expect(builder.select).toHaveBeenCalledWith(selections.totalExecutions, 'totalExecutions');
      for (const [alias, sql] of Object.entries(selections).slice(1)) {
        expect(builder.addSelect).toHaveBeenCalledWith(sql, alias);
      }
      expect(builder.where).toHaveBeenCalledWith('execution.agentId = :agentId', { agentId });
      expect(builder.setParameters).toHaveBeenCalledWith({ completed: 'COMPLETED', failed: 'FAILED' });
      const filtered = records.filter((row) => row.agentId === agentId);
      const completed = filtered.filter((row) => row.status === ExecutionStatus.COMPLETED);
      const tokens = completed.reduce((sum, row) => sum + row.totalTokens, 0);
      return {
        totalExecutions: String(filtered.length),
        completedExecutions: String(completed.length),
        failedExecutions: String(filtered.filter((row) => row.status === ExecutionStatus.FAILED).length),
        totalTokensConsumed: String(tokens),
        averageTokensPerExecution: String(completed.length ? tokens / completed.length : 0),
      };
    });
  });

  afterAll(async () => { await app?.close(); });

  function get(id = agentId) {
    return fetch(`${baseUrl}/agents/${id}/metrics`);
  }

  it('retorna 400 para UUID inválido antes de consultar o banco', async () => {
    expect((await get('invalid')).status).toBe(400);
    expect(agents.findOne).not.toHaveBeenCalled();
    expect(executions.createQueryBuilder).not.toHaveBeenCalled();
  });

  it('retorna 404 para agente inexistente antes de agregar o histórico', async () => {
    agents.findOne.mockResolvedValueOnce(null);
    const response = await get();
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ message: `Agent ${agentId} not found` });
    expect(executions.createQueryBuilder).not.toHaveBeenCalled();
  });

  it('retorna os cinco campos numéricos em zero quando não há execuções', async () => {
    const response = await get();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(zeroMetrics);
    expect(builder.getRawOne).toHaveBeenCalledTimes(1);
  });

  it('agrega os quatro status de um agente inativo e calcula a média apenas das concluídas', async () => {
    agents.findOne.mockResolvedValueOnce({ id: agentId, active: false });
    records = [
      { agentId, status: ExecutionStatus.COMPLETED, totalTokens: 10 },
      { agentId, status: ExecutionStatus.COMPLETED, totalTokens: 21 },
      { agentId, status: ExecutionStatus.FAILED, totalTokens: 100 },
      { agentId, status: ExecutionStatus.PENDING, totalTokens: 200 },
      { agentId, status: ExecutionStatus.PROCESSING, totalTokens: 300 },
      { agentId: otherAgentId, status: ExecutionStatus.COMPLETED, totalTokens: 900 },
    ];
    const response = await get();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      totalExecutions: 5, completedExecutions: 2, failedExecutions: 1,
      totalTokensConsumed: 31, averageTokensPerExecution: 15.5,
    });
    expect(agents.findOne).toHaveBeenCalledWith({ where: { id: agentId } });
    expect(agents.findOne.mock.invocationCallOrder[0]).toBeLessThan(executions.createQueryBuilder.mock.invocationCallOrder[0]);
    expect(executions.createQueryBuilder).toHaveBeenCalledWith('execution');
    expect(builder.getRawOne).toHaveBeenCalledTimes(1);
  });

  it('retorna consumo e média zero quando existem execuções mas nenhuma concluída', async () => {
    records = [ExecutionStatus.FAILED, ExecutionStatus.PENDING, ExecutionStatus.PROCESSING].map((status) => ({
      agentId, status, totalTokens: 100,
    }));
    const response = await get();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ...zeroMetrics, totalExecutions: 3, failedExecutions: 1 });
  });

  it('documenta o DTO numérico e os retornos 200, 400 e 404 no Swagger', () => {
    const document = SwaggerModule.createDocument(app, new DocumentBuilder().build());
    const operation = document.paths['/agents/{agentId}/metrics'].get;
    expect(operation?.responses).toEqual(expect.objectContaining({
      '200': expect.any(Object), '400': expect.any(Object), '404': expect.any(Object),
    }));
    const schema = document.components?.schemas?.AgentMetricsResponseDto;
    expect(schema).toHaveProperty('properties.averageTokensPerExecution.type', 'number');
    expect(schema).toHaveProperty('properties.totalTokensConsumed.type', 'integer');
  });
});
