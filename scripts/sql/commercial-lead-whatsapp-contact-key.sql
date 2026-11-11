-- Executar se DB_SYNC=false (coluna usada na deduplicação de leads WhatsApp).
ALTER TABLE acaf_commercial_leads
  ADD COLUMN IF NOT EXISTS whatsapp_contact_key VARCHAR(64) NULL AFTER source;

CREATE INDEX IF NOT EXISTS idx_acaf_commercial_leads_whatsapp_contact_key
  ON acaf_commercial_leads (whatsapp_contact_key);
