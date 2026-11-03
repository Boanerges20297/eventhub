-- EventHub Inscricoes: idempotencia dos resultados financeiros.
-- Somente no banco eventhub_inscricoes; repetivel.
USE eventhub_inscricoes;
CREATE TABLE IF NOT EXISTS payment_events (
  event_id CHAR(36) NOT NULL PRIMARY KEY,
  attempt_id CHAR(36) NOT NULL,
  inscricao_id CHAR(36) NOT NULL,
  outcome VARCHAR(32) NOT NULL,
  paid_at DATETIME(6) NULL,
  registration_status VARCHAR(24) NOT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  INDEX idx_financial_attempt (attempt_id),
  CONSTRAINT fk_payment_registration FOREIGN KEY (inscricao_id)
    REFERENCES registrations(inscricao_id)
) ENGINE=InnoDB;
