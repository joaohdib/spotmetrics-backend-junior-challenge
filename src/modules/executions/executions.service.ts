import {
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Agent } from '../agents/agent.entity';
import { AgentMonthlyUsage } from '../agents/agent-monthly-usage.entity';
import { currentMonth } from '../agents/agents.service';
import { RabbitMQService } from '../../common/rabbitmq/rabbitmq.service';
import { AgentExecution } from './agent-execution.entity';
import { CreateExecutionDto } from './dto/create-execution.dto';
import { ListExecutionsQueryDto } from './dto/list-executions-query.dto';
import { AgentMetricsResponseDto } from './dto/agent-metrics-response.dto';
import { ExecutionStatus } from './execution-status.enum';
import { countTokens } from './tokens';

export interface ExecutionMessage {
  executionId: string;
}

@Injectable()
export class ExecutionsService {
  private readonly logger = new Logger(ExecutionsService.name);
  private readonly queue = process.env.RABBITMQ_EXECUTIONS_QUEUE ?? 'agent-executions';

  constructor(
    @InjectRepository(Agent) private readonly agents: Repository<Agent>,
    @InjectRepository(AgentExecution) private readonly executions: Repository<AgentExecution>,
    @InjectRepository(AgentMonthlyUsage) private readonly usage: Repository<AgentMonthlyUsage>,
    private readonly rabbit: RabbitMQService,
    private readonly dataSource: DataSource,
  ) {}

  async create(agentId: string, dto: CreateExecutionDto): Promise<AgentExecution> {
    const agent = await this.agents.findOne({ where: { id: agentId } });
    if (!agent) throw new NotFoundException(`Agent ${agentId} not found`);
    if (!agent.active) {
      throw new ConflictException('Agente inativo não aceita novas execuções. Reative o agente para continuar.');
    }

    const inputTokens = countTokens(dto.input);
    const used = await this.getTokensUsed(agentId, currentMonth());
    const limit = agent.monthlyTokenLimit;
    if (used >= limit || used + inputTokens > limit) {
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message: 'Monthly token limit exceeded',
          monthlyTokenLimit: agent.monthlyTokenLimit,
          tokensUsed: used,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const execution = await this.executions.save(
      this.executions.create({ agentId, input: dto.input, inputTokens, status: ExecutionStatus.PENDING }),
    );

    try {
      await this.rabbit.publish(this.queue, { executionId: execution.id } satisfies ExecutionMessage);
    } catch (err) {
      // Não deixa uma execução "PENDING" órfã caso a fila esteja fora.
      execution.status = ExecutionStatus.FAILED;
      execution.error = `Failed to enqueue: ${(err as Error).message}`;
      execution.completedAt = new Date();
      await this.executions.save(execution);
      this.logger.error(`Failed to publish execution ${execution.id}`, (err as Error).stack);
      throw new HttpException('Queue unavailable, try again later', HttpStatus.SERVICE_UNAVAILABLE);
    }

    return execution;
  }

  async findOne(id: string): Promise<AgentExecution> {
    const execution = await this.executions.findOne({ where: { id } });
    if (!execution) throw new NotFoundException(`Execution ${id} not found`);
    return execution;
  }

  async findByAgent(agentId: string, query: ListExecutionsQueryDto) {
    await this.findAgent(agentId);

    const { page, limit, status } = query;
    const [items, total] = await this.executions.findAndCount({
      where: { agentId, ...(status !== undefined ? { status } : {}) },
      order: { createdAt: 'DESC', id: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    return { items, page, limit, total };
  }

  async getMetrics(agentId: string): Promise<AgentMetricsResponseDto> {
    await this.findAgent(agentId);

    const raw = await this.executions.createQueryBuilder('execution')
      .select('COUNT(*)', 'totalExecutions')
      .addSelect('COUNT(*) FILTER (WHERE execution.status = :completed)', 'completedExecutions')
      .addSelect('COUNT(*) FILTER (WHERE execution.status = :failed)', 'failedExecutions')
      .addSelect('COALESCE(SUM(execution.totalTokens) FILTER (WHERE execution.status = :completed), 0)', 'totalTokensConsumed')
      .addSelect('COALESCE(AVG(execution.totalTokens) FILTER (WHERE execution.status = :completed), 0)', 'averageTokensPerExecution')
      .where('execution.agentId = :agentId', { agentId })
      .setParameters({ completed: ExecutionStatus.COMPLETED, failed: ExecutionStatus.FAILED })
      .getRawOne<Record<keyof AgentMetricsResponseDto, string | number>>();

    return {
      totalExecutions: Number(raw?.totalExecutions ?? 0),
      completedExecutions: Number(raw?.completedExecutions ?? 0),
      failedExecutions: Number(raw?.failedExecutions ?? 0),
      totalTokensConsumed: Number(raw?.totalTokensConsumed ?? 0),
      averageTokensPerExecution: Number(raw?.averageTokensPerExecution ?? 0),
    };
  }

  private async findAgent(agentId: string): Promise<Agent> {
    const agent = await this.agents.findOne({ where: { id: agentId } });
    if (!agent) throw new NotFoundException(`Agent ${agentId} not found`);
    return agent;
  }

  async getTokensUsed(agentId: string, month: string): Promise<number> {
    const row = await this.usage.findOne({ where: { agentId, month } });
    return row?.tokensUsed ?? 0;
  }

  async completeExecution(
    executionId: string,
    result: Pick<AgentExecution, 'output' | 'outputTokens' | 'totalTokens'>,
  ): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const executions = manager.getRepository(AgentExecution);
      const usage = manager.getRepository(AgentMonthlyUsage);
      const execution = await executions.findOne({ where: { id: executionId } });
      if (!execution) throw new NotFoundException(`Execution ${executionId} not found`);

      Object.assign(execution, result, {
        status: ExecutionStatus.COMPLETED,
        completedAt: new Date(),
      }); 
      await executions.save(execution);
      await this.addTokensUsed(execution.agentId, currentMonth(), execution.totalTokens, usage);
    });
  }

  async addTokensUsed(
    agentId: string,
    month: string,
    tokens: number,
    usage: Repository<AgentMonthlyUsage> = this.usage,
  ): Promise<void> {
    let row = await usage.findOne({ where: { agentId, month } });
    if (!row) {
      row = usage.create({ agentId, month, tokensUsed: 0 });
    }
    row.tokensUsed += tokens;
    await usage.save(row);
  }
}
