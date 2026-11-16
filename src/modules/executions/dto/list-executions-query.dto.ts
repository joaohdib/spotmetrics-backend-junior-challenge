import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';
import { ExecutionStatus } from '../execution-status.enum';

const MAX_PAGE = 1_000_000;

export class ListExecutionsQueryDto {
  @ApiPropertyOptional({ type: 'integer', default: 1, minimum: 1, maximum: MAX_PAGE })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE)
  page: number = 1;

  @ApiPropertyOptional({ type: 'integer', default: 10, minimum: 1, maximum: 100 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 10;

  @ApiPropertyOptional({ enum: ExecutionStatus })
  @IsOptional()
  @IsEnum(ExecutionStatus)
  status?: ExecutionStatus;
}
