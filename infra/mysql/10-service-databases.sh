#!/bin/bash
set -euo pipefail
# Called only by MySQL 8.4 entrypoint on an empty data volume.
# Passwords are generated as hexadecimal strings in the local .env (gitignored).
for variable in EVENTHUB_MYSQL_IDENTITY_PASSWORD EVENTHUB_MYSQL_EVENTS_PASSWORD EVENTHUB_MYSQL_PAYMENTS_PASSWORD EVENTHUB_MYSQL_NOTIFICATIONS_PASSWORD; do
  value="${!variable:-}"
  if [[ ! "$value" =~ ^[[:xdigit:]]{48}$ ]]; then
    echo "Invalid environment secret for $variable" >&2
    exit 1
  fi
done
mysql --protocol=socket -uroot -p"$MYSQL_ROOT_PASSWORD" <<SQL
CREATE DATABASE IF NOT EXISTS eventhub_identity CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE DATABASE IF NOT EXISTS eventhub_events CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE DATABASE IF NOT EXISTS eventhub_payments CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE DATABASE IF NOT EXISTS eventhub_notifications CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS 'eventhub_identity'@'%' IDENTIFIED BY '$EVENTHUB_MYSQL_IDENTITY_PASSWORD';
CREATE USER IF NOT EXISTS 'eventhub_events'@'%' IDENTIFIED BY '$EVENTHUB_MYSQL_EVENTS_PASSWORD';
CREATE USER IF NOT EXISTS 'eventhub_payments'@'%' IDENTIFIED BY '$EVENTHUB_MYSQL_PAYMENTS_PASSWORD';
CREATE USER IF NOT EXISTS 'eventhub_notifications'@'%' IDENTIFIED BY '$EVENTHUB_MYSQL_NOTIFICATIONS_PASSWORD';
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX ON eventhub_identity.* TO 'eventhub_identity'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, REFERENCES ON eventhub_events.* TO 'eventhub_events'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX ON eventhub_payments.* TO 'eventhub_payments'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX ON eventhub_notifications.* TO 'eventhub_notifications'@'%';
SQL
