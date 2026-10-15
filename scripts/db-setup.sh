#!/usr/bin/env bash
# Runs db-setup.sql against a Postgres you already have (no Docker).
# Usage: PGHOST=localhost PGUSER=postgres bash scripts/db-setup.sh
set -euo pipefail
cd "$(dirname "$0")"
psql -v ON_ERROR_STOP=1 -d postgres -f db-setup.sql
echo "Database roles and the cullinari database are ready."
