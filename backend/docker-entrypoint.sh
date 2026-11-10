#!/bin/sh
set -e

cd /app

demo_args() {
  case "$(printf '%s' "${CHANTIER3A_DEMO:-}" | tr '[:upper:]' '[:lower:]')" in
    1 | true | yes | on) printf '%s' "--demo" ;;
    *) ;;
  esac
}

run_migrate() {
  if [ "${CHANTIER3A_SKIP_MIGRATE:-0}" = "1" ]; then
    return 0
  fi
  billetterie-api migrate

  # Auto-provision initial staff admin if defined
  if [ -n "${CHANTIER3A_BOOTSTRAP_EMAIL:-}" ] && [ -n "${CHANTIER3A_BOOTSTRAP_PASSWORD:-}" ]; then
    CHANTIER3A_BOOTSTRAP_STAFF=1 billetterie-api bootstrap-staff \
      --email "${CHANTIER3A_BOOTSTRAP_EMAIL}" \
      --password "${CHANTIER3A_BOOTSTRAP_PASSWORD}" \
      --role "${CHANTIER3A_BOOTSTRAP_ROLE:-owner}" || true
  fi
}

run_serve() {
  run_migrate
  demo="$(demo_args)"
  if [ -n "$demo" ]; then
    exec billetterie-api serve "$demo" "$@"
  fi
  exec billetterie-api serve "$@"
}

case "$1" in
  migrate)
    shift
    exec billetterie-api migrate "$@"
    ;;
  serve)
    shift
    run_serve "$@"
    ;;
  "")
    run_serve
    ;;
  *)
    exec billetterie-api "$@"
    ;;
esac
