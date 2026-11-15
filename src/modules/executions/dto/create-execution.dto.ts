import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class CreateExecutionDto {
  @ApiProperty({ type: String, required: true, minLength: 1, maxLength: 10000, example: 'Resuma o relatório de vendas', description: 'Texto de entrada obrigatório, com 1 a 10.000 caracteres.' })
  @IsString()
  @MinLength(1)
  @MaxLength(10000)
  input: string;
}
