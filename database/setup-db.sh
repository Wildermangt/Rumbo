#!/usr/bin/env bash
# -----------------------------------------------------------------------------
# Espera a que SQL Server acepte conexiones y ejecuta init.sql (idempotente).
# Se ejecuta en el servicio `db-init` de docker-compose.
# -----------------------------------------------------------------------------
set -euo pipefail

DB_HOST="${DB_HOST:-sqlserver}"
DB_PORT="${DB_PORT:-1433}"
SA_USER="${SA_USER:-sa}"
: "${MSSQL_SA_PASSWORD:?MSSQL_SA_PASSWORD es obligatorio}"
DB_NAME="${DB_NAME:-TasksDb}"
APP_DB_USER="${APP_DB_USER:-tasks_app}"
: "${APP_DB_PASSWORD:?APP_DB_PASSWORD es obligatorio}"
SEED_DATA="${SEED_DATA:-1}"
MAX_ATTEMPTS="${MAX_ATTEMPTS:-60}"
SLEEP_SECONDS="${SLEEP_SECONDS:-2}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Las imágenes recientes de SQL Server 2022 traen mssql-tools18 (requiere -C);
# las antiguas traen mssql-tools.
if [[ -x /opt/mssql-tools18/bin/sqlcmd ]]; then
  SQLCMD=(/opt/mssql-tools18/bin/sqlcmd -C)
elif [[ -x /opt/mssql-tools/bin/sqlcmd ]]; then
  SQLCMD=(/opt/mssql-tools/bin/sqlcmd)
else
  echo "[setup-db] ERROR: sqlcmd no encontrado" >&2
  exit 1
fi

SQLCMD+=(-S "${DB_HOST},${DB_PORT}" -U "${SA_USER}" -P "${MSSQL_SA_PASSWORD}" -b)

echo "[setup-db] Esperando a SQL Server en ${DB_HOST}:${DB_PORT}..."
attempt=1
until "${SQLCMD[@]}" -l 5 -Q "SET NOCOUNT ON; SELECT 1" > /dev/null 2>&1; do
  if (( attempt >= MAX_ATTEMPTS )); then
    echo "[setup-db] ERROR: SQL Server no respondió tras ${MAX_ATTEMPTS} intentos" >&2
    exit 1
  fi
  echo "[setup-db] Intento ${attempt}/${MAX_ATTEMPTS}: aún no disponible, reintentando en ${SLEEP_SECONDS}s..."
  attempt=$(( attempt + 1 ))
  sleep "${SLEEP_SECONDS}"
done

echo "[setup-db] SQL Server disponible. Ejecutando init.sql..."
"${SQLCMD[@]}" \
  -i "${SCRIPT_DIR}/init.sql" \
  -v DB_NAME="${DB_NAME}" \
     APP_DB_USER="${APP_DB_USER}" \
     APP_DB_PASSWORD="${APP_DB_PASSWORD}" \
     SEED_DATA="${SEED_DATA}"

echo "[setup-db] Base de datos '${DB_NAME}' lista."
