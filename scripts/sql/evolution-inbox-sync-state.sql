-- Executar se DB_SYNC=false ou após deploy da entidade EvolutionInboxSyncState
CREATE TABLE IF NOT EXISTS acaf_evolution_inbox_sync_state (
  instance_id CHAR(36) NOT NULL,
  last_webhook_at DATETIME NULL,
  last_local_message_at DATETIME NULL,
  last_incremental_pull_at DATETIME NULL,
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (instance_id),
  CONSTRAINT FK_evolution_inbox_sync_instance
    FOREIGN KEY (instance_id) REFERENCES acaf_evolution_instances (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
