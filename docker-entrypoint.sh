#!/bin/sh
set -eu
umask 077
: "${DATA_DIR:=/app/data}"
export DATA_DIR
if [ "${NODE_ENV:-}" = production ]; then
  case "$DATA_DIR" in
    /*) ;;
    *) echo "DATA_DIR_MUST_BE_ABSOLUTE: set DATA_DIR=/app/data on Railway" >&2; exit 1 ;;
  esac
fi
mkdir -p "$DATA_DIR"
if [ "$(id -u)" = 0 ]; then
  chown -R node:node "$DATA_DIR"
  chmod 700 "$DATA_DIR"
  exec su-exec node:node node server.js
fi
exec node server.js
