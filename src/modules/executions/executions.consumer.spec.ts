import { ExecutionsConsumer } from './executions.consumer';
import { ExecutionStatus } from './execution-status.enum';
import { countTokens, simulateAgentOutput } from './tokens';

describe('ExecutionsConsumer.process', () => {
  beforeEach(() => {
    process.env.PROCESSING_DELAY_MS = '0';
  });

  function build(execution: object | null, agent: object | null) {
    const agents = { findOne: jest.fn().mockResolvedValue(agent) };
    const executions = { findOne: jest.fn().mockResolvedValue(execution), save: jest.fn(async (x) => x) };
    const service = { completeExecution: jest.fn().mockResolvedValue(undefined) };
    const channel = { ack: jest.fn(), nack: jest.fn() };
    const rabbit = { getChannel: jest.fn(() => channel) };
    const consumer = new ExecutionsConsumer(agents as any, executions as any, service as any, rabbit as any);
    return { consumer, executions, service, channel };
  }

  it('completes a pending execution and records token usage', async () => {
    const execution = { id: 'e1', agentId: 'a1', input: 'hello world', inputTokens: 2, status: ExecutionStatus.PENDING };
    const { consumer, executions, service } = build(execution, { id: 'a1', name: 'Bot', active: true });

    await consumer.process('e1');

    const output = simulateAgentOutput('Bot', execution.input);
    const outputTokens = countTokens(output);
    expect(service.completeExecution).toHaveBeenCalledWith('e1', { output, outputTokens, totalTokens: 2 + outputTokens });
    expect(executions.save).toHaveBeenCalledTimes(1);
    expect(executions.save).toHaveBeenCalledWith(expect.objectContaining({
      status: ExecutionStatus.PROCESSING, startedAt: expect.any(Date),
    }));
  });

  it('fails when the agent does not exist', async () => {
    const execution = { id: 'e1', agentId: 'a1', input: 'x', inputTokens: 1, status: ExecutionStatus.PENDING };
    const { consumer, service } = build(execution, null);

    await consumer.process('e1');

    expect(execution.status).toBe(ExecutionStatus.FAILED);
    expect(service.completeExecution).not.toHaveBeenCalled();
  });

  it.each([ExecutionStatus.PENDING, ExecutionStatus.PROCESSING])(
    'conclui execução já aceita com status %s mesmo com agente inativo',
    async (status) => {
      const execution = { id: 'e1', agentId: 'a1', input: 'hello world', inputTokens: 2, status };
      const { consumer, executions, service } = build(execution, { id: 'a1', name: 'Bot', active: false });

      await consumer.process('e1');

      expect(executions.save).toHaveBeenCalledTimes(1);
      expect(service.completeExecution).toHaveBeenCalledWith('e1', {
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
    const execution = { id: 'e1', agentId: 'a1', input: 'hello', inputTokens: 1, status: ExecutionStatus.PENDING };
    const { consumer, service, channel } = build(execution, { id: 'a1', name: 'Bot' });
    let commit!: () => void;
    let entered: () => void;
    const committing = new Promise<void>((resolve) => { entered = resolve; });
    const committed = new Promise<void>((resolve) => { commit = resolve; });
    service.completeExecution.mockImplementationOnce(() => {
      entered();
      return committed;
    });
    const msg = { content: Buffer.from(JSON.stringify({ executionId: 'e1' })) };

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
    const execution = { id: 'e1', agentId: 'a1', input: 'hello', inputTokens: 1, status: ExecutionStatus.PROCESSING };
    const { consumer, service, channel } = build(execution, { id: 'a1', name: 'Bot' });
    const failure = new Error('usage write failed');
    service.completeExecution.mockRejectedValue(failure);

    await expect(consumer.process('e1')).rejects.toBe(failure);
    const msg = { content: Buffer.from(JSON.stringify({ executionId: 'e1' })) };
    await consumer['handle'](msg as any);

    expect(channel.ack).not.toHaveBeenCalled();
    expect(channel.nack).toHaveBeenCalledWith(msg, false, true);
  });
});
