-- EventHub / Inscricoes / MySQL 8.4+ (schema isolado e dedicado).
-- Executar somente na base eventhub_inscricoes com usuario proprio. Sem CREATE DATABASE.
-- Testar em base de desenvolvimento antes de producao.
CREATE TABLE IF NOT EXISTS activity_capacity (
  atividade_id VARCHAR(64) NOT NULL PRIMARY KEY,
  capacity INT UNSIGNED NOT NULL,
  version INT UNSIGNED NOT NULL,
  lista_espera_habilitada BOOLEAN NOT NULL DEFAULT TRUE,
  prazo_reserva_min INT UNSIGNED NOT NULL DEFAULT 30,
  atividade_paga BOOLEAN NOT NULL DEFAULT FALSE,
  last_ingested_ticket BIGINT UNSIGNED NOT NULL DEFAULT 0,
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
    ON UPDATE CURRENT_TIMESTAMP(6),
  CONSTRAINT chk_prazo CHECK (prazo_reserva_min BETWEEN 1 AND 1440)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS capacity_operations (
  operation_id CHAR(36) NOT NULL PRIMARY KEY,
  atividade_id VARCHAR(64) NOT NULL,
  expected_version INT UNSIGNED NOT NULL,
  target_version INT UNSIGNED NOT NULL,
  desired_capacity INT UNSIGNED NOT NULL,
  lista_espera_habilitada BOOLEAN NOT NULL,
  prazo_reserva_min INT UNSIGNED NOT NULL,
  atividade_paga BOOLEAN NOT NULL,
  result VARCHAR(20) NOT NULL,
  reason VARCHAR(60) NULL,
  applied_version INT UNSIGNED NOT NULL,
  effective_capacity INT UNSIGNED NOT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  INDEX idx_cap_op_activity (atividade_id, created_at),
  CONSTRAINT chk_cap_op_result CHECK (result IN ('APLICADA','REJEITADA'))
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS registrations (
  inscricao_id CHAR(36) NOT NULL PRIMARY KEY,
  user_id VARCHAR(64) NOT NULL,
  atividade_id VARCHAR(64) NOT NULL,
  numero_ticket BIGINT UNSIGNED NOT NULL,
  cpf_digest CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  status VARCHAR(24) NOT NULL,
  granted_at DATETIME(6) NULL,
  reserva_expira_em DATETIME(6) NULL,
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
    ON UPDATE CURRENT_TIMESTAMP(6),
  active_cpf_digest CHAR(64) CHARACTER SET ascii COLLATE ascii_bin
    GENERATED ALWAYS AS (
      CASE WHEN status IN ('REGISTRADO','EM_FILA','RESERVADO','EM_VERIFICACAO','CONFIRMADO')
           THEN cpf_digest ELSE NULL END
    ) STORED,
  UNIQUE KEY uq_activity_ticket (atividade_id, numero_ticket),
  UNIQUE KEY uq_active_cpf (atividade_id, active_cpf_digest),
  INDEX idx_fifo_wait (atividade_id, status, numero_ticket),
  CONSTRAINT chk_reg_state CHECK (status IN
    ('REGISTRADO','EM_FILA','RESERVADO','EM_VERIFICACAO','CONFIRMADO',
     'RECUSADO','EXPIRADO','CANCELADO','SEM_VAGA')),
  CONSTRAINT fk_reg_activity FOREIGN KEY (atividade_id)
    REFERENCES activity_capacity (atividade_id)
) ENGINE=InnoDB;
