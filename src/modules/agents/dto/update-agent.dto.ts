import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength, ValidateIf } from 'class-validator';

export class UpdateAgentDto {
  @ApiPropertyOptional({ example: 'Support Assistant', minLength: 2, maxLength: 120 })
  @ValidateIf((_, value) => value !== undefined)
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional({ type: String, nullable: true, description: 'Enviar null limpa a descrição; omitir preserva o valor atual.' })
  @IsOptional()
  @IsString()
  description?: string | null;

  @ApiPropertyOptional({ example: 'Você é um assistente de suporte cordial.', minLength: 1 })
  @ValidateIf((_, value) => value !== undefined)
  @IsString()
  @MinLength(1)
  systemPrompt?: string;

  @ApiPropertyOptional({ example: false })
  @ValidateIf((_, value) => value !== undefined)
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional({ type: 'integer', minimum: 1, maximum: 2147483647, example: 10000, description: 'Alterar o limite não modifica o consumo mensal já registrado.' })
  @ValidateIf((_, value) => value !== undefined)
  @IsInt()
  @Min(1)
  @Max(2147483647)
  monthlyTokenLimit?: number;
}
