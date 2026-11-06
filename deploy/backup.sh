#!/usr/bin/env bash
# Copia diaria de la base de datos (cron). Requiere el paquete sqlite3.
set -euo pipefail

DATA_DIR="${DATA_DIR:-/var/lib/kanban}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/kanban}"
KEEP_DAYS="${KEEP_DAYS:-14}"

mkdir -p "$BACKUP_DIR"
out="$BACKUP_DIR/kanban-$(date +%F-%H%M).db"

# .backup produce una copia consistente aunque la app esté escribiendo (WAL)
sqlite3 "$DATA_DIR/kanban.db" ".backup '$out'"
gzip -f "$out"

find "$BACKUP_DIR" -name 'kanban-*.db.gz' -mtime +"$KEEP_DAYS" -delete
echo "Copia creada: $out.gz"
