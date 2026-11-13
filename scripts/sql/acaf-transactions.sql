-- Executar se DB_SYNC=false.
-- Com DB_SYNC=true as tabelas são criadas pelo TypeORM.

CREATE TABLE IF NOT EXISTS acaf_transactions (
  id CHAR(36) NOT NULL PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  kind VARCHAR(40) NOT NULL,
  status ENUM('pending', 'in_progress', 'completed', 'failed', 'cancelled') NOT NULL DEFAULT 'pending',
  amount_total DECIMAL(15, 2) NOT NULL,
  currency VARCHAR(8) NOT NULL DEFAULT 'BRL',
  description VARCHAR(255) NOT NULL,
  metadata JSON NULL,
  partner_unit_id CHAR(36) NULL,
  connect_holder_key VARCHAR(64) NULL,
  asaas_subscription_id VARCHAR(40) NULL,
  external_ref VARCHAR(120) NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  UNIQUE KEY uq_acaf_transactions_external_ref (external_ref),
  KEY idx_acaf_transactions_user_id (user_id),
  KEY idx_acaf_transactions_asaas_subscription (asaas_subscription_id),
  CONSTRAINT fk_acaf_transactions_user FOREIGN KEY (user_id) REFERENCES acaf_users (id)
);

CREATE TABLE IF NOT EXISTS acaf_transaction_gateway_attempts (
  id CHAR(36) NOT NULL PRIMARY KEY,
  transaction_id CHAR(36) NOT NULL,
  gateway VARCHAR(24) NOT NULL DEFAULT 'asaas',
  asaas_payment_id VARCHAR(40) NULL,
  payment_method VARCHAR(32) NULL,
  status VARCHAR(40) NOT NULL,
  status_at DATETIME NOT NULL,
  amount DECIMAL(15, 2) NULL,
  webhook_event VARCHAR(48) NULL,
  metadata JSON NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  UNIQUE KEY uq_acaf_tx_gateway_asaas_payment (asaas_payment_id),
  KEY idx_acaf_tx_gateway_transaction (transaction_id),
  CONSTRAINT fk_acaf_tx_gateway_transaction FOREIGN KEY (transaction_id) REFERENCES acaf_transactions (id) ON DELETE CASCADE
);

-- MySQL: executar manualmente se a coluna ainda não existir.
-- ALTER TABLE acaf_accounts_receivable ADD COLUMN transaction_id CHAR(36) NULL;
-- CREATE INDEX idx_acaf_receivable_transaction ON acaf_accounts_receivable (transaction_id);
