import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ConsumeMessage } from 'amqplib';
import { In, Repository } from 'typeorm';
import { env } from '../../config/env';
import { Agent } from '../agents/agent.entity';
import { RabbitMQService } from '../../common/rabbitmq/rabbitmq.service';
import { AgentExecution } from './agent-execution.entity';
import { ExecutionStatus } from './execution-status.enum';
import { ExecutionMessage, ExecutionsService } from './executions.service';
import { countTokens, simulateAgentOutput } from './tokens';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

@Injectable()
export class ExecutionsConsumer implements OnModuleInit {
  private readonly logger = new Logger(ExecutionsConsumer.name);
  private readonly queue = process.env.RABBITMQ_EXECUTIONS_QUEUE ?? 'agent-executions';
  private readonly delayMs = Number(process.env.PROCESSING_DELAY_MS ?? 2000);
  private readonly prefetch = Number(process.env.RABBITMQ_PREFETCH ?? 5);
  private readonly maxAttempts = env.executionMaxAttempts;

  constructor(
    @InjectRepository(Agent) private readonly agents: Repository<Agent>,
    @InjectRepository(AgentExecution) private readonly executions: Repository<AgentExecution>,
    private readonly executionsService: ExecutionsService,
    private readonly rabbit: RabbitMQService,
  ) {}

  async onModuleInit(): Promise<void> {
    const channel = this.rabbit.getChannel();
    await channel.assertQueue(this.queue, { durable: true });
    await channel.prefetch(this.prefetch);
    await channel.consume(this.queue, (msg) => void this.handle(msg));
    this.logger.log(`Consuming queue "${this.queue}"`);
  }

  private async handle(msg: ConsumeMessage | null): Promise<void> {
    if (!msg) return;
    const channel = this.rabbit.getChannel();

    let payload: ExecutionMessage;
    try {
      payload = JSON.parse(msg.content.toString()) as ExecutionMessage;
    } catch {
      this.logger.warn('Discarding malformed message');
      channel.nack(msg, false, false);
      return;
    }

    try {
      await this.process(payload.executionId);
      channel.ack(msg);
    } catch (err) {
      this.logger.error(`Error processing ${payload.executionId}, requeueing`, (err as Error).stack);
      channel.nack(msg, false, true);
    }
  }

  async process(executionId: string): Promise<void> {
    const execution = await this.executions.findOne({ where: { id: executionId } });
    if (!execution) {
      this.logger.warn(`Execution ${executionId} not found, skipping`);
      return;
    }

    if (execution.status === ExecutionStatus.COMPLETED || execution.status === ExecutionStatus.FAILED) return;

    if (execution.attempts >= this.maxAttempts) {
      await this.failExecution(execution.id, `Attempt limit reached (${this.maxAttempts})`);
      return;
    }

    execution.attempts += 1;
    execution.status = ExecutionStatus.PROCESSING;
    execution.startedAt = new Date();
    await this.executions.save(execution);
    this.logger.log(`Execution ${execution.id} started`);

    try {
      const agent = await this.agents.findOne({ where: { id: execution.agentId } });
      if (!agent) {
        return this.failExecution(execution.id, `Agent ${execution.agentId} not found`);
      }

      await sleep(this.delayMs);

      const output = simulateAgentOutput(agent.name, execution.input);
      const outputTokens = countTokens(output);
      const totalTokens = execution.inputTokens + outputTokens;
      await this.executionsService.completeExecution(execution.id, { output, outputTokens, totalTokens });
      this.logger.log(`Execution ${execution.id} completed (${totalTokens} tokens)`);
    } catch (err) {
      if (execution.attempts < this.maxAttempts) throw err;
      await this.failExecution(execution.id,
        `Attempt limit reached (${this.maxAttempts}): ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async failExecution(id: string, error: string): Promise<void> {
    // A conditional UPDATE cannot overwrite a completion already committed.
    await this.executions.update(
      { id, status: In([ExecutionStatus.PENDING, ExecutionStatus.PROCESSING]) },
      { status: ExecutionStatus.FAILED, error, completedAt: new Date() },
    );
  }
}
