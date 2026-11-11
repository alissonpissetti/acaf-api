-- Executar se DB_SYNC=false ou após deploy da entidade EvolutionLeadIgnoreContact.
-- Em ambientes com DB_SYNC=true a tabela pode ser criada automaticamente.

CREATE TABLE IF NOT EXISTS acaf_evolution_lead_ignore_contacts (
  id CHAR(36) NOT NULL PRIMARY KEY,
  instance_id CHAR(36) NOT NULL,
  match_kind VARCHAR(16) NOT NULL,
  match_value VARCHAR(128) NOT NULL,
  label VARCHAR(120) NULL,
  note VARCHAR(512) NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  UNIQUE KEY UQ_evolution_lead_ignore (instance_id, match_kind, match_value),
  KEY IDX_evolution_lead_ignore_instance (instance_id)
);
