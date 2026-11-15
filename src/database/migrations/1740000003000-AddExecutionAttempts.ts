import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddExecutionAttempts1740000003000 implements MigrationInterface {
  name = 'AddExecutionAttempts1740000003000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE "agent_executions" ADD "attempts" integer NOT NULL DEFAULT 0');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE "agent_executions" DROP COLUMN "attempts"');
  }
}
