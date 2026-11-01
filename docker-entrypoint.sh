#!/bin/sh
set -eu
umask 077
: "${DATA_DIR:=/app/data}"
export DATA_DIR
mkdir -p "$DATA_DIR"
if [ "$(id -u)" = 0 ]; then
  chown -R node:node "$DATA_DIR"
  chmod 700 "$DATA_DIR"
  exec su-exec node:node node server.js
fi
exec node server.js
