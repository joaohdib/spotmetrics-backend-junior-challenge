import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Agent } from './agent.entity';
import { AgentMonthlyUsage } from './agent-monthly-usage.entity';
import { AgentsController } from './agents.controller';
import { AgentsService, currentMonth } from './agents.service';

const agentId = '690b224a-f858-4ed1-a430-b899a7e27f85';

describe('AgentsController: criação, atualização e desativação de agentes', () => {
  let app: INestApplication;
  let baseUrl: string;
  let agent: Agent;
  const consumption = { agentId, month: currentMonth(), tokensUsed: 700 };
  const agents = {
    create: jest.fn((dto) => ({ ...dto })),
    findOne: jest.fn(),
    // Repository.merge ignora valores undefined, incluindo campos omitidos do DTO.
    merge: jest.fn((entity, dto) => Object.assign(
      entity,
      Object.fromEntries(Object.entries(dto).filter(([, value]) => value !== undefined)),
    )),
    save: jest.fn(async (entity) => entity),
  };
  const usage = {
    findOne: jest.fn(async () => consumption),
    save: jest.fn(),
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [AgentsController],
      providers: [
        AgentsService,
        { provide: getRepositoryToken(Agent), useValue: agents },
        { provide: getRepositoryToken(AgentMonthlyUsage), useValue: usage },
      ],
    }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.listen(0, '127.0.0.1');
    baseUrl = await app.getUrl();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    agent = {
      id: agentId,
      name: 'Original',
      description: 'Existing description',
      systemPrompt: 'Existing prompt',
      active: true,
      monthlyTokenLimit: 1000,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    };
    agents.findOne.mockResolvedValue(agent);
  });

  afterAll(async () => {
    await app?.close();
  });

  function patch(body: unknown, id = agentId) {
    return fetch(`${baseUrl}/agents/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  describe('POST /agents', () => {
    function create(monthlyTokenLimit: number) {
      return fetch(`${baseUrl}/agents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Novo agente', description: 'Descrição', systemPrompt: 'Ajude o usuário.', monthlyTokenLimit }),
      });
    }

    it('cria com cota mínima e active true quando omitido', async () => {
      const input = { name: 'Novo agente', description: 'Descrição', systemPrompt: 'Ajude o usuário.', monthlyTokenLimit: 1 };
      const created = { ...agent, ...input, active: true };
      agents.save.mockResolvedValueOnce(created);

      const response = await create(1);

      expect(response.status).toBe(201);
      expect(await response.json()).toEqual(JSON.parse(JSON.stringify(created)));
      expect(agents.create).toHaveBeenCalledWith({ ...input, active: true });
      expect(agents.save).toHaveBeenCalledTimes(1);
      expect(agents.save).toHaveBeenCalledWith({ ...input, active: true });
    });

    it('preserva active false informado na criação', async () => {
      const input = { name: 'Novo agente', description: 'Descrição', systemPrompt: 'Ajude o usuário.', monthlyTokenLimit: 1, active: false };
      agents.save.mockImplementationOnce(async (entity) => ({ ...agent, ...entity }));

      const response = await fetch(`${baseUrl}/agents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });

      expect(response.status).toBe(201);
      expect(await response.json()).toMatchObject(input);
      expect(agents.create).toHaveBeenCalledWith(input);
      expect(agents.save).toHaveBeenCalledWith(input);
    });

    it.each([0, -1, 2_147_483_648])('rejeita cota %s antes de salvar', async (limit) => {
      const response = await create(limit);
      expect(response.status).toBe(400);
      expect(agents.create).not.toHaveBeenCalled();
      expect(agents.save).not.toHaveBeenCalled();
    });
  });

  describe('DELETE /agents/:id', () => {
    function deactivate(id = agentId) {
      return fetch(`${baseUrl}/agents/${id}`, { method: 'DELETE' });
    }

    it('desativa sem corpo e mantém o agente e o consumo disponíveis para consulta', async () => {
      const expected = JSON.parse(JSON.stringify({ ...agent, active: false }));
      const response = await deactivate();
      expect(response.status).toBe(204);
      expect(await response.text()).toBe('');
      expect(agents.save).toHaveBeenCalledTimes(1);
      expect(agents.save).toHaveBeenCalledWith(expect.objectContaining({ id: agentId, active: false }));
      expect(usage.save).not.toHaveBeenCalled();

      const detail = await fetch(`${baseUrl}/agents/${agentId}`);
      expect(detail.status).toBe(200);
      expect(await detail.json()).toEqual(expected);
      const consumptionResponse = await fetch(`${baseUrl}/agents/${agentId}/usage?month=${consumption.month}`);
      expect(consumptionResponse.status).toBe(200);
      expect(await consumptionResponse.json()).toMatchObject({ tokensUsed: 700, monthlyTokenLimit: 1000 });
    });

    it('retorna 204 ao repetir DELETE sem gravar novamente', async () => {
      expect((await deactivate()).status).toBe(204);
      const repeated = await deactivate();
      expect(repeated.status).toBe(204);
      expect(await repeated.text()).toBe('');
      expect(agents.save).toHaveBeenCalledTimes(1);
    });

    it('não grava um agente que já estava inativo', async () => {
      agent.active = false;
      expect((await deactivate()).status).toBe(204);
      expect(agents.save).not.toHaveBeenCalled();
    });

    it('retorna 404 para agente inexistente', async () => {
      agents.findOne.mockResolvedValueOnce(null);
      const response = await deactivate();
      expect(response.status).toBe(404);
      expect(await response.json()).toMatchObject({ message: `Agent ${agentId} not found` });
      expect(agents.save).not.toHaveBeenCalled();
    });

    it('retorna 400 para UUID inválido antes de acessar o banco', async () => {
      expect((await deactivate('invalid')).status).toBe(400);
      expect(agents.findOne).not.toHaveBeenCalled();
      expect(agents.save).not.toHaveBeenCalled();
    });

    it('permite reativar o agente pelo PATCH', async () => {
      await deactivate();
      const response = await patch({ active: true });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ id: agentId, active: true });
    });
  });

  it('updates only the name and preserves every other field', async () => {
    const expected = JSON.parse(JSON.stringify({ ...agent, name: 'Renamed' }));
    const response = await patch({ name: 'Renamed' });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(expected);
    expect(agents.findOne).toHaveBeenCalledWith({ where: { id: agentId } });
    expect(agents.merge).toHaveBeenCalledWith(agent, { name: 'Renamed' });
    expect(agents.save).toHaveBeenCalledWith(agent);
  });

  it('returns 404 for a missing agent without saving', async () => {
    agents.findOne.mockResolvedValueOnce(null);
    const response = await patch({ name: 'Renamed' });
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ message: `Agent ${agentId} not found` });
    expect(agents.merge).not.toHaveBeenCalled();
    expect(agents.save).not.toHaveBeenCalled();
  });

  it('returns 400 for an invalid UUID before querying the repository', async () => {
    expect((await patch({}, 'invalid')).status).toBe(400);
    expect(agents.findOne).not.toHaveBeenCalled();
  });

  it('preserves all values for an empty body', async () => {
    const expected = JSON.parse(JSON.stringify(agent));
    const response = await patch({});
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(expected);
  });

  it('accepts active: false', async () => {
    const response = await patch({ active: false });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ active: false });
  });

  it('clears the description with null', async () => {
    const response = await patch({ description: null });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ description: null });
  });

  it('updates description and systemPrompt', async () => {
    const changes = { description: 'New description', systemPrompt: 'New prompt' };
    const response = await patch(changes);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject(changes);
  });

  it.each([1, 500, 2147483647])('updates the quota to %s without resetting recorded consumption', async (limit) => {
    const response = await patch({ monthlyTokenLimit: limit });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ monthlyTokenLimit: limit });
    expect(usage.findOne).not.toHaveBeenCalled();
    expect(usage.save).not.toHaveBeenCalled();

    const result = await app.get(AgentsService).getUsage(agentId, consumption.month);
    expect(result).toMatchObject({ monthlyTokenLimit: limit, tokensUsed: 700 });
  });

  it.each([
    { active: null },
    { active: 'false' },
    { name: null },
    { name: 'A' },
    { name: 'A'.repeat(121) },
    { name: 123 },
    { systemPrompt: null },
    { systemPrompt: '' },
    { systemPrompt: 123 },
    { description: 123 },
    { monthlyTokenLimit: null },
    { monthlyTokenLimit: 0 },
    { monthlyTokenLimit: -1 },
    { monthlyTokenLimit: 1.5 },
    { monthlyTokenLimit: 2147483648 },
    { monthlyTokenLimit: '100' },
    { unexpected: true },
    { id: agentId },
  ])('rejects invalid or unknown fields: %j', async (body) => {
    const response = await patch(body);
    expect(response.status).toBe(400);
    expect(agents.findOne).not.toHaveBeenCalled();
    expect(agents.save).not.toHaveBeenCalled();
  });
});
