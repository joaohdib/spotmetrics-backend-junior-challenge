import { ApiProperty } from '@nestjs/swagger';

export class AgentMetricsResponseDto {
  @ApiProperty({ type: 'integer', example: 5, description: 'Quantidade de execuções de todos os status.' })
  totalExecutions: number;

  @ApiProperty({ type: 'integer', example: 2, description: 'Quantidade de execuções COMPLETED.' })
  completedExecutions: number;

  @ApiProperty({ type: 'integer', example: 1, description: 'Quantidade de execuções FAILED.' })
  failedExecutions: number;

  @ApiProperty({ type: 'integer', example: 31, description: 'Soma de totalTokens somente das execuções COMPLETED, em todo o histórico. Zero se não houver concluídas.' })
  totalTokensConsumed: number;

  @ApiProperty({ type: Number, example: 15.5, description: 'Consumo total das execuções COMPLETED dividido pela quantidade de execuções COMPLETED. Zero se não houver concluídas.' })
  averageTokensPerExecution: number;
}
