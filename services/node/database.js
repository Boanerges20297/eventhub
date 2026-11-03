'use strict';
const mysql = require('mysql2/promise');
let pool;
function db() {
  if (!pool) {
    pool = mysql.createPool({
      host: process.env.DB_HOST || 'mysql',
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      waitForConnections: true, connectionLimit: 8,
      charset: 'utf8mb4', timezone: 'Z'
    });
  }
  return pool;
}
async function init(service) {
  if (service === 'identity') {
    await db().query(`CREATE TABLE IF NOT EXISTS users (
      id CHAR(36) PRIMARY KEY, email VARCHAR(255) NOT NULL UNIQUE,
      password_hash VARCHAR(255) NOT NULL, role VARCHAR(24) NOT NULL,
      org_id VARCHAR(64), created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB`);
  }
  if (service === 'payments') {
    await db().query(`CREATE TABLE IF NOT EXISTS payment_attempts (
      id CHAR(36) NOT NULL PRIMARY KEY,
      inscricao_id CHAR(36) NOT NULL UNIQUE,
      user_id CHAR(36) NOT NULL,
      outcome VARCHAR(32) NOT NULL,
      paid_at DATETIME(6) NULL,
      delivery VARCHAR(20) NOT NULL DEFAULT 'PENDENTE',
      registration_status VARCHAR(24) NULL,
      created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
      updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
        ON UPDATE CURRENT_TIMESTAMP(6),
      INDEX idx_payment_retry (delivery,created_at)
    ) ENGINE=InnoDB`);
  }
  if (service === 'events') {
    await db().query(`CREATE TABLE IF NOT EXISTS events (
      id CHAR(36) PRIMARY KEY, owner_id CHAR(36) NOT NULL,
      org_id VARCHAR(64) NOT NULL, title VARCHAR(160) NOT NULL,
      description TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB`);
    await db().query(`CREATE TABLE IF NOT EXISTS activities (
      id CHAR(36) PRIMARY KEY, event_id CHAR(36) NOT NULL, org_id VARCHAR(64) NOT NULL,
      title VARCHAR(160) NOT NULL, capacity INT UNSIGNED NOT NULL,
      capacity_version INT UNSIGNED NOT NULL DEFAULT 0,
      capacity_state VARCHAR(20) NOT NULL DEFAULT 'PENDENTE',
      operation_id CHAR(36) NOT NULL,
      paid BOOLEAN NOT NULL DEFAULT FALSE, price_cents INT UNSIGNED NOT NULL DEFAULT 0,
      waitlist BOOLEAN NOT NULL DEFAULT TRUE, hold_minutes INT UNSIGNED NOT NULL DEFAULT 30,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (event_id) REFERENCES events(id)
    ) ENGINE=InnoDB`);
  }
}
module.exports = { db, init };
