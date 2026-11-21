import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';

@Injectable()
export class ProjectTasksMigrationService implements OnModuleInit {
  private readonly logger = new Logger(ProjectTasksMigrationService.name);

  constructor(private readonly dataSource: DataSource) {}

  async onModuleInit() {
    await this.ensureTables();
  }

  private async ensureTables() {
    await this.dataSource.query(`
      CREATE TABLE IF NOT EXISTS acaf_project_tasks (
        id CHAR(36) NOT NULL PRIMARY KEY,
        code VARCHAR(32) NULL,
        phase VARCHAR(80) NOT NULL,
        name VARCHAR(500) NOT NULL,
        start_date DATE NOT NULL,
        end_date DATE NOT NULL,
        status ENUM('todo','in_progress','blocked','postponed','cancelled','done') NOT NULL,
        progress TINYINT UNSIGNED NOT NULL DEFAULT 0,
        owner VARCHAR(200) NULL,
        notes TEXT NULL,
        is_milestone TINYINT(1) NOT NULL DEFAULT 0,
        sort_order INT NOT NULL DEFAULT 0,
        updated_by CHAR(36) NULL,
        created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        UNIQUE KEY uq_project_tasks_code (code),
        KEY idx_project_tasks_phase_start (phase, start_date, sort_order)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await this.dataSource.query(`
      CREATE TABLE IF NOT EXISTS acaf_project_task_events (
        id CHAR(36) NOT NULL PRIMARY KEY,
        task_id CHAR(36) NOT NULL,
        user_id CHAR(36) NULL,
        field VARCHAR(64) NOT NULL,
        old_value TEXT NULL,
        new_value TEXT NULL,
        created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        KEY idx_project_task_events_task (task_id, created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await this.ensureOwnerUserIdsColumn();
    await this.ensureStatusEnumExtended();

    this.logger.log('Tabelas de cronograma (project tasks) verificadas.');
  }

  private async ensureStatusEnumExtended() {
    const rows = await this.dataSource.query(
      `SELECT COLUMN_TYPE AS columnType FROM information_schema.COLUMNS WHERE table_schema = DATABASE() AND table_name = 'acaf_project_tasks' AND column_name = 'status' LIMIT 1`,
    );
    const columnType = String(rows[0]?.columnType ?? '');
    if (columnType.includes('postponed') && columnType.includes('cancelled')) return;
    await this.dataSource.query(`
      ALTER TABLE acaf_project_tasks
      MODIFY COLUMN status ENUM('todo','in_progress','blocked','postponed','cancelled','done') NOT NULL
    `);
    this.logger.log('ENUM status do cronograma atualizado (adiada, cancelada).');
  }

  private async ensureOwnerUserIdsColumn() {
    const rows = await this.dataSource.query(
      `SELECT 1 FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'acaf_project_tasks' AND column_name = 'owner_user_ids' LIMIT 1`,
    );
    if (rows.length) return;
    await this.dataSource.query(`ALTER TABLE acaf_project_tasks ADD COLUMN owner_user_ids JSON NULL`);
    this.logger.log('Coluna acaf_project_tasks.owner_user_ids criada.');
  }
}