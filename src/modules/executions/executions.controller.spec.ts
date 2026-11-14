import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { FindManyOptions } from 'typeorm';
import { RabbitMQService } from '../../common/rabbitmq/rabbitmq.service';
import { Agent } from '../agents/agent.entity';
import { AgentMonthlyUsage } from '../agents/agent-monthly-usage.entity';
import { AgentExecution } from './agent-execution.entity';
import { ExecutionStatus } from './execution-status.enum';
import { ExecutionsController } from './executions.controller';
import { ExecutionsService } from './executions.service';

const agentId = '690b224a-f858-4ed1-a430-b899a7e27f85';
const otherAgentId = '690b224a-f858-4ed1-a430-b899a7e27f86';

function execution(sequence: number, owner: string, status: ExecutionStatus, date: string) {
  return {
    id: `00000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`,
    agentId: owner,
    status,
    createdAt: new Date(date),
  };
}

// As datas empatadas e a execução de outro agente verificam ordenação e isolamento.
const fixtures = [
  execution(1, agentId, ExecutionStatus.COMPLETED, '2026-01-01'),
  execution(2, agentId, ExecutionStatus.FAILED, '2026-01-03'),
  execution(3, agentId, ExecutionStatus.COMPLETED, '2026-01-03'),
  execution(4, agentId, ExecutionStatus.COMPLETED, '2026-01-02'),
  execution(5, otherAgentId, ExecutionStatus.COMPLETED, '2026-01-05'),
  execution(6, agentId, ExecutionStatus.PENDING, '2026-01-04'),
];

describe('GET /agents/:agentId/executions', () => {
  let app: INestApplication;
  let baseUrl: string;
  let records: typeof fixtures;
  const agents = { findOne: jest.fn() };
  const executions = { findAndCount: jest.fn() };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [ExecutionsController],
      providers: [
        ExecutionsService,
        { provide: getRepositoryToken(Agent), useValue: agents },
        { provide: getRepositoryToken(AgentExecution), useValue: executions },
        { provide: getRepositoryToken(AgentMonthlyUsage), useValue: {} },
        { provide: RabbitMQService, useValue: {} },
      ],
    }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.listen(0, '127.0.0.1');
    baseUrl = await app.getUrl();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    records = [...fixtures];
    agents.findOne.mockResolvedValue({ id: agentId, active: true });
    // Simula apenas a consulta do repositório; controller, pipes e serviço são reais.
    executions.findAndCount.mockImplementation(async (options: Required<Pick<FindManyOptions<AgentExecution>, 'where' | 'order' | 'skip' | 'take'>>) => {
      const where = options.where as { agentId: string; status?: ExecutionStatus };
      const matching = records.filter((row) => row.agentId === where.agentId &&
        (where.status === undefined || row.status === where.status));
      matching.sort((a, b) => {
        const dateOrder = a.createdAt.getTime() - b.createdAt.getTime();
        if (dateOrder) return options.order.createdAt === 'DESC' ? -dateOrder : dateOrder;
        return options.order.id === 'DESC' ? b.id.localeCompare(a.id) : a.id.localeCompare(b.id);
      });
      return [matching.slice(options.skip, options.skip + options.take), matching.length];
    });
  });

  afterAll(async () => { await app?.close(); });

  function get(query = '', id = agentId) {
    return fetch(`${baseUrl}/agents/${id}/executions${query}`);
  }

  it('usa os padrões e retorna somente o agente solicitado, em ordem de data e ID decrescentes', async () => {
    const response = await get();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ page: 1, limit: 10, total: 5 });
    expect(body.items.map((item) => item.id)).toEqual([6, 3, 2, 4, 1].map((n) => fixtures.find((row) => row.id.endsWith(String(n)))!.id));
    expect(body.items.every((item) => item.agentId === agentId)).toBe(true);
    expect(agents.findOne).toHaveBeenCalledWith({ where: { id: agentId } });
    expect(executions.findAndCount).toHaveBeenCalledWith({
      where: { agentId }, order: { createdAt: 'DESC', id: 'DESC' }, skip: 0, take: 10,
    });
    expect(agents.findOne.mock.invocationCallOrder[0]).toBeLessThan(executions.findAndCount.mock.invocationCallOrder[0]);
  });

  it.each([
    [ExecutionStatus.COMPLETED, [3, 4, 1]],
    [ExecutionStatus.FAILED, [2]],
    [ExecutionStatus.PENDING, [6]],
    [ExecutionStatus.PROCESSING, []],
  ])('filtra status %s sem incluir outro agente', async (status, sequences: number[]) => {
    const response = await get(`?status=${status}`);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.total).toBe(sequences.length);
    expect(body.items.map((item) => item.id)).toEqual(sequences.map((n) => fixtures.find((row) => row.id.endsWith(String(n)))!.id));
    expect(executions.findAndCount).toHaveBeenCalledWith(expect.objectContaining({ where: { agentId, status } }));
  });

  it.each([
    [1, undefined, [6, 3], 5],
    [2, undefined, [2, 4], 5],
    [2, ExecutionStatus.COMPLETED, [1], 3],
    [9, ExecutionStatus.COMPLETED, [], 3],
  ])('pagina no banco: página %s e status %s', async (page, status, sequences: number[], total) => {
    const response = await get(`?page=${page}&limit=2${status ? `&status=${status}` : ''}`);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ page, limit: 2, total });
    expect(body.items.map((item) => item.id)).toEqual(sequences.map((n) => fixtures.find((row) => row.id.endsWith(String(n)))!.id));
    expect(executions.findAndCount).toHaveBeenCalledWith({
      where: { agentId, ...(status ? { status } : {}) },
      order: { createdAt: 'DESC', id: 'DESC' }, skip: (page - 1) * 2, take: 2,
    });
  });

  it('retorna lista vazia para agente sem execuções', async () => {
    records = fixtures.filter((row) => row.agentId === otherAgentId);
    const response = await get();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ items: [], page: 1, limit: 10, total: 0 });
  });

  it('mantém histórico de agente inativo disponível', async () => {
    agents.findOne.mockResolvedValueOnce({ id: agentId, active: false });
    const response = await get();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ total: 5 });
  });

  it('retorna 404 sem consultar execuções se o agente não existir', async () => {
    agents.findOne.mockResolvedValueOnce(null);
    const response = await get();
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ message: `Agent ${agentId} not found` });
    expect(executions.findAndCount).not.toHaveBeenCalled();
  });

  it('rejeita UUID inválido antes de consultar o banco', async () => {
    expect((await get('', 'invalid')).status).toBe(400);
    expect(agents.findOne).not.toHaveBeenCalled();
    expect(executions.findAndCount).not.toHaveBeenCalled();
  });

  it.each([
    'status=INVALID', 'status=completed', 'status=',
    'page=0', 'page=-1', 'page=1.5', 'page=abc', 'page=',
    'limit=0', 'limit=-1', 'limit=1.5', 'limit=abc', 'limit=101',
  ])('rejeita query inválida: %s', async (query) => {
    expect((await get(`?${query}`)).status).toBe(400);
    expect(agents.findOne).not.toHaveBeenCalled();
    expect(executions.findAndCount).not.toHaveBeenCalled();
  });
});
