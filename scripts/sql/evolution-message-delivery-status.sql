-- Status de entrega/leitura (ticks) das mensagens enviadas pelo WhatsApp conectado.
-- Em ambientes com DB_SYNC=true a coluna pode ser criada automaticamente.
ALTER TABLE acaf_evolution_messages
  ADD COLUMN delivery_status VARCHAR(16) NULL;
