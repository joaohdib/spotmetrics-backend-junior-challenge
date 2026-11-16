import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ApiOkResponse, ApiServiceUnavailableResponse } from '@nestjs/swagger';
import { SchemaObject } from '@nestjs/swagger/dist/interfaces/open-api-spec.interface';
import { RabbitMQService } from '../../common/rabbitmq/rabbitmq.service';

const healthResponseSchema: SchemaObject = {
  type: 'object',
  required: ['status', 'database', 'rabbitmq'],
  properties: {
    status: { type: 'string', enum: ['ok', 'degraded'] },
    database: { type: 'string', enum: ['up', 'down'] },
    rabbitmq: { type: 'string', enum: ['up', 'down'] },
  },
};

@Controller('health')
export class HealthController {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly rabbit: RabbitMQService,
  ) {}

  @Get()
  @ApiOkResponse({
    description: 'Banco e RabbitMQ disponíveis.',
    schema: { ...healthResponseSchema, example: { status: 'ok', database: 'up', rabbitmq: 'up' } },
  })
  @ApiServiceUnavailableResponse({
    description: 'Estado degradado: banco ou RabbitMQ indisponível.',
    schema: { ...healthResponseSchema, example: { status: 'degraded', database: 'down', rabbitmq: 'up' } },
  })
  async check() {
    let database = 'up';
    try {
      await this.dataSource.query('SELECT 1');
    } catch {
      database = 'down';
    }
    const rabbitmq = this.rabbit.isConnected() ? 'up' : 'down';
    const body = { status: database === 'up' && rabbitmq === 'up' ? 'ok' : 'degraded', database, rabbitmq };
    if (body.status !== 'ok') throw new ServiceUnavailableException(body);
    return body;
  }
}
