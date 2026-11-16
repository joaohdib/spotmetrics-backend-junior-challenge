import { ExecutionsConsumer } from './executions.consumer';
import { ExecutionStatus } from './execution-status.enum';
import { countTokens, simulateAgentOutput } from './tokens';

const executionId = '690b224a-f858-4ed1-a430-b899a7e27f85';

describe('ExecutionsConsumer.process', () => {
  beforeEach(() => {
    process.env.PROCESSING_DELAY_MS = '0';
    process.env.EXECUTION_MAX_ATTEMPTS = '5';
  });

  function build(execution: object | null, agent: object | null) {
    if (execution && !('attempts' in execution)) Object.assign(execution, { attempts: 0 });
    const agents = { findOne: jest.fn().mockResolvedValue(agent) };
    const executions = {
      findOne: jest.fn().mockResolvedValue(execution), save: jest.fn(async (x) => x),
      update: jest.fn(async (_criteria, values) => {
        if (execution && ![ExecutionStatus.COMPLETED, ExecutionStatus.FAILED].includes((execution as any).status)) {
          Object.assign(execution, values);
          return { affected: 1 };
        }
        return { affected: 0 };
      }),
    };
    const service = { completeExecution: jest.fn().mockResolvedValue(undefined) };
    const channel = { ack: jest.fn(), nack: jest.fn() };
    const rabbit = { getChannel: jest.fn(() => channel) };
    const consumer = new ExecutionsConsumer(agents as any, executions as any, service as any, rabbit as any);
    return { consumer, executions, service, channel };
  }

  it.each([
    ['JSON malformado', '{'],
    ['payload nulo', 'null'],
    ['ID ausente', '{}'],
    ['UUID inválido', '{"executionId":"not-a-uuid"}'],
    ['ID numérico', '{"executionId":123}'],
    ['ID nulo', '{"executionId":null}'],
    ['array', '[]'],
    ['valor primitivo', 'true'],
  ])('rejeita %s sem reentrega nem consulta ao repositório', async (_scenario, content) => {
    const { consumer, executions, channel } = build(null, null);
    const processing = jest.spyOn(consumer, 'process');
    const warning = jest.spyOn(consumer['logger'], 'warn').mockImplementation(() => {});
    const msg = { content: Buffer.from(content) };

    await consumer['handle'](msg as any);

    expect(warning).toHaveBeenCalledTimes(1);
    expect(channel.nack).toHaveBeenCalledTimes(1);
    expect(channel.nack).toHaveBeenCalledWith(msg, false, false);
    expect(channel.ack).not.toHaveBeenCalled();
    expect(processing).not.toHaveBeenCalled();
    expect(executions.findOne).not.toHaveBeenCalled();
    expect(executions.save).not.toHaveBeenCalled();
    expect(executions.update).not.toHaveBeenCalled();
  });

  it('encaminha UUID válido ao process e confirma execução não encontrada', async () => {
    const { consumer, executions, channel } = build(null, null);
    const processing = jest.spyOn(consumer, 'process');
    const msg = { content: Buffer.from(JSON.stringify({ executionId })) };

    await consumer['handle'](msg as any);

    expect(processing).toHaveBeenCalledTimes(1);
    expect(processing).toHaveBeenCalledWith(executionId);
    expect(executions.findOne).toHaveBeenCalledWith({ where: { id: executionId } });
    expect(executions.save).not.toHaveBeenCalled();
    expect(channel.ack).toHaveBeenCalledWith(msg);
    expect(channel.nack).not.toHaveBeenCalled();
  });

  function retryScenario(attempts: number) {
    const execution = { id: executionId, agentId: 'a1', input: 'hello', inputTokens: 1,
      status: ExecutionStatus.PROCESSING, attempts };
    const mocks = build(execution, { id: 'a1', name: 'Bot' });
    const msg = { content: Buffer.from(JSON.stringify({ executionId: executionId })) };
    return { ...mocks, execution, msg };
  }

  it('persiste tentativa e pede reentrega quando falha antes do limite', async () => {
    const { consumer, execution, executions, service, channel, msg } = retryScenario(0);
    service.completeExecution.mockRejectedValue(new Error('database write failed'));
    await consumer['handle'](msg as any);
    expect(execution.attempts).toBe(1);
    expect(executions.save).toHaveBeenCalledWith(expect.objectContaining({ attempts: 1, status: ExecutionStatus.PROCESSING }));
    expect(executions.update).not.toHaveBeenCalled();
    expect(channel.nack).toHaveBeenCalledWith(msg, false, true);
    expect(channel.ack).not.toHaveBeenCalled();
  });

  it('registra FAILED na última falha antes do ACK', async () => {
    const { consumer, execution, executions, service, channel, msg } = retryScenario(4);
    service.completeExecution.mockRejectedValue(new Error('usage write failed'));
    let finish!: () => void;
    let entered!: () => void;
    const entering = new Promise<void>((resolve) => { entered = resolve; });
    const writing = new Promise<void>((resolve) => { finish = resolve; });
    executions.update.mockImplementationOnce(async (_criteria, values) => {
      entered();
      await writing;
      Object.assign(execution, values);
      return { affected: 1 };
    });
    const handling = consumer['handle'](msg as any);
    await entering;
    expect(channel.ack).not.toHaveBeenCalled();
    expect(channel.nack).not.toHaveBeenCalled();
    finish();
    await handling;
    expect(execution).toEqual(expect.objectContaining({ attempts: 5, status: ExecutionStatus.FAILED,
      completedAt: expect.any(Date), error: 'Attempt limit reached (5): usage write failed' }));
    expect(channel.ack).toHaveBeenCalledWith(msg);
    expect(channel.nack).not.toHaveBeenCalled();
  });

  it('permite sucesso na última tentativa', async () => {
    const { consumer, execution, executions, service, channel, msg } = retryScenario(4);
    service.completeExecution.mockImplementationOnce(async () => {
      execution.status = ExecutionStatus.COMPLETED;
    });
    await consumer['handle'](msg as any);
    expect(execution.attempts).toBe(5);
    expect(execution.status).toBe(ExecutionStatus.COMPLETED);
    expect(service.completeExecution).toHaveBeenCalledTimes(1);
    expect(executions.update).not.toHaveBeenCalled();
    expect(channel.ack).toHaveBeenCalledWith(msg);
  });

  it('finaliza reentrega com contador no limite sem nova tentativa', async () => {
    const { consumer, execution, executions, service, channel, msg } = retryScenario(5);
    await consumer['handle'](msg as any);
    expect(execution).toEqual(expect.objectContaining({ attempts: 5, status: ExecutionStatus.FAILED,
      completedAt: expect.any(Date), error: 'Attempt limit reached (5)' }));
    expect(executions.save).not.toHaveBeenCalled();
    expect(service.completeExecution).not.toHaveBeenCalled();
    expect(channel.ack).toHaveBeenCalledWith(msg);
  });

  it.each([4, 5])('pede reentrega se gravar FAILED falhar com contador %s', async (attempts) => {
    const { consumer, executions, service, channel, msg } = retryScenario(attempts);
    service.completeExecution.mockRejectedValue(new Error('processing failed'));
    executions.update.mockRejectedValue(new Error('database unavailable'));
    await consumer['handle'](msg as any);
    expect(executions.update).toHaveBeenCalledTimes(1);
    expect(channel.ack).not.toHaveBeenCalled();
    expect(channel.nack).toHaveBeenCalledWith(msg, false, true);
  });

  it('preserva COMPLETED se o commit tiver ocorrido antes do erro', async () => {
    const { consumer, execution, executions, service, channel, msg } = retryScenario(4);
    service.completeExecution.mockImplementationOnce(async () => {
      execution.status = ExecutionStatus.COMPLETED;
      throw new Error('connection lost after commit');
    });
    await consumer['handle'](msg as any);
    expect(executions.update).toHaveBeenCalledWith(
      { id: executionId, status: expect.objectContaining({ value: [ExecutionStatus.PENDING, ExecutionStatus.PROCESSING] }) },
      expect.objectContaining({ status: ExecutionStatus.FAILED }),
    );
    expect(execution.status).toBe(ExecutionStatus.COMPLETED);
    expect(channel.ack).toHaveBeenCalledWith(msg);
  });

  it.each([ExecutionStatus.COMPLETED, ExecutionStatus.FAILED])('confirma status final %s sem alterações', async (status) => {
    const { consumer, execution, executions, service, channel, msg } = retryScenario(5);
    execution.status = status;
    const persisted = { ...execution };
    await consumer['handle'](msg as any);
    expect(execution).toEqual(persisted);
    expect(executions.save).not.toHaveBeenCalled();
    expect(executions.update).not.toHaveBeenCalled();
    expect(service.completeExecution).not.toHaveBeenCalled();
    expect(channel.ack).toHaveBeenCalledWith(msg);
  });

  it('completes a pending execution and records token usage', async () => {
    const execution = { id: executionId, agentId: 'a1', input: 'hello world', inputTokens: 2, status: ExecutionStatus.PENDING };
    const { consumer, executions, service } = build(execution, { id: 'a1', name: 'Bot', active: true });

    await consumer.process(executionId);

    const output = simulateAgentOutput('Bot', execution.input);
    const outputTokens = countTokens(output);
    expect(service.completeExecution).toHaveBeenCalledWith(executionId, { output, outputTokens, totalTokens: 2 + outputTokens });
    expect(executions.save).toHaveBeenCalledTimes(1);
    expect(executions.save).toHaveBeenCalledWith(expect.objectContaining({
      status: ExecutionStatus.PROCESSING, startedAt: expect.any(Date),
    }));
  });

  it('confirma reentrega após o commit sem processar nem contabilizar tokens novamente', async () => {
    const execution = { id: executionId, agentId: 'a1', input: 'hello', inputTokens: 1, status: ExecutionStatus.PENDING };
    const { consumer, executions, service, channel } = build(execution, { id: 'a1', name: 'Bot' });
    service.completeExecution.mockImplementationOnce(async (_id, result) => {
      Object.assign(execution, result, { status: ExecutionStatus.COMPLETED, completedAt: new Date() });
    });

    // Simula commit confirmado e queda antes do ACK da primeira entrega.
    await consumer.process(executionId);
    expect(execution.status).toBe(ExecutionStatus.COMPLETED);
    expect(service.completeExecution).toHaveBeenCalledTimes(1);
    expect(channel.ack).not.toHaveBeenCalled();
    const persistedExecution = { ...execution };
    executions.findOne.mockClear();
    executions.save.mockClear();

    const msg = { content: Buffer.from(JSON.stringify({ executionId: executionId })), fields: { redelivered: true } };
    await consumer['handle'](msg as any);

    expect(executions.findOne).toHaveBeenCalledWith({ where: { id: executionId } });
    expect(execution).toEqual(persistedExecution);
    expect(executions.save).not.toHaveBeenCalled();
    expect(service.completeExecution).toHaveBeenCalledTimes(1);
    expect(channel.ack).toHaveBeenCalledTimes(1);
    expect(channel.ack).toHaveBeenCalledWith(msg);
    expect(channel.nack).not.toHaveBeenCalled();
  });

  it('fails when the agent does not exist', async () => {
    const execution = { id: executionId, agentId: 'a1', input: 'x', inputTokens: 1, status: ExecutionStatus.PENDING };
    const { consumer, service } = build(execution, null);

    await consumer.process(executionId);

    expect(execution.status).toBe(ExecutionStatus.FAILED);
    expect(service.completeExecution).not.toHaveBeenCalled();
  });

  it.each([ExecutionStatus.PENDING, ExecutionStatus.PROCESSING])(
    'conclui execução já aceita com status %s mesmo com agente inativo',
    async (status) => {
      const execution = { id: executionId, agentId: 'a1', input: 'hello world', inputTokens: 2, status };
      const { consumer, executions, service } = build(execution, { id: 'a1', name: 'Bot', active: false });

      await consumer.process(executionId);

      expect(executions.save).toHaveBeenCalledTimes(1);
      expect(service.completeExecution).toHaveBeenCalledWith(executionId, {
        output: expect.any(String), outputTokens: expect.any(Number), totalTokens: expect.any(Number),
      });
    },
  );

  it('skips unknown executions', async () => {
    const { consumer, executions } = build(null, null);

    await consumer.process('missing');

    expect(executions.save).not.toHaveBeenCalled();
  });

  it('só envia ACK depois de completeExecution resolver (commit)', async () => {
    const execution = { id: executionId, agentId: 'a1', input: 'hello', inputTokens: 1, status: ExecutionStatus.PENDING };
    const { consumer, service, channel } = build(execution, { id: 'a1', name: 'Bot' });
    let commit!: () => void;
    let entered: () => void;
    const committing = new Promise<void>((resolve) => { entered = resolve; });
    const committed = new Promise<void>((resolve) => { commit = resolve; });
    service.completeExecution.mockImplementationOnce(() => {
      entered();
      return committed;
    });
    const msg = { content: Buffer.from(JSON.stringify({ executionId: executionId })) };

    const handling = consumer['handle'](msg as any);
    await committing;
    expect(channel.ack).not.toHaveBeenCalled();
    expect(channel.nack).not.toHaveBeenCalled();
    commit();
    await handling;

    expect(channel.ack).toHaveBeenCalledWith(msg);
    expect(channel.nack).not.toHaveBeenCalled();
  });

  it('propaga falha na conclusão para handle pedir reentrega sem ACK', async () => {
    const execution = { id: executionId, agentId: 'a1', input: 'hello', inputTokens: 1, status: ExecutionStatus.PROCESSING };
    const { consumer, service, channel } = build(execution, { id: 'a1', name: 'Bot' });
    const failure = new Error('usage write failed');
    service.completeExecution.mockRejectedValue(failure);

    await expect(consumer.process(executionId)).rejects.toBe(failure);
    const msg = { content: Buffer.from(JSON.stringify({ executionId: executionId })) };
    await consumer['handle'](msg as any);

    expect(channel.ack).not.toHaveBeenCalled();
    expect(channel.nack).toHaveBeenCalledWith(msg, false, true);
  });
});
