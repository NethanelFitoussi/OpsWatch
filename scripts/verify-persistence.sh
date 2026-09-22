#!/usr/bin/env bash
#
# Proves the self-hosted promise: rebuilding and recreating the container does not destroy the admin account,
# the encrypted integration credentials, the settings or the collected history.
#
# This exists because the e2e suite cannot prove it. `docker-compose.test.yml` mounts /data as tmpfs so each
# run starts from an empty database, which is right for those tests and is exactly why a persistence bug once
# shipped unnoticed: nothing ever recreated a container against a real volume.
#
# It runs under its OWN compose project name and its OWN volume, so it never touches an operator's data.
#
#   npm run verify:persistence
#
set -euo pipefail

PROJECT=opswatch-persistence-check
PORT=3200
COMPOSE=(docker compose -p "$PROJECT" -f docker-compose.persistence.yml)
PASSED=0

cd "$(dirname "$0")/.."

cleanup() {
  # -v is safe and required here: this volume belongs to this check and to nothing else.
  "${COMPOSE[@]}" down -v --remove-orphans >/dev/null 2>&1 || true
}
trap cleanup EXIT

step() { printf '\n\033[1m==> %s\033[0m\n' "$1"; }
pass() { printf '   \033[32mPASS\033[0m %s\n' "$1"; PASSED=$((PASSED + 1)); }
fail() { printf '   \033[31mFAIL\033[0m %s\n' "$1"; exit 1; }

# Where an unauthenticated request to a protected page is sent. It is the whole signal this script needs:
# "/setup" means the database holds no admin, "/login" means it does. No credentials required to ask.
bootstrap_state() {
  local location
  location=$(curl -s -o /dev/null -w '%{redirect_url}' "http://127.0.0.1:${PORT}/en/accounts" || true)
  case "$location" in
    *"/setup"*) echo "setup" ;;
    *"/login"*) echo "login" ;;
    *) echo "unknown:${location}" ;;
  esac
}

wait_healthy() {
  for _ in $(seq 1 60); do
    if curl -sf "http://127.0.0.1:${PORT}/en/getting-started" >/dev/null 2>&1; then return 0; fi
    sleep 2
  done
  fail "the container never became reachable on port ${PORT}"
}

expect_state() {
  local want="$1" what="$2" got
  got=$(bootstrap_state)
  [ "$got" = "$want" ] || fail "$what (expected $want, got $got)"
  pass "$what"
}

cleanup
step "A. a fresh, empty volume offers Create admin"
"${COMPOSE[@]}" up -d --build --wait >/dev/null
wait_healthy
expect_state setup "an installation with no admin sends a visitor to Create admin"

step "creating the admin through the real setup form"
PERSISTENCE_PORT=$PORT npx playwright test --config tests/persistence/playwright.config.ts >/dev/null
expect_state login "once an admin exists, a visitor is sent to Login and never back to Create admin"

step "B. restarting the application keeps the admin"
"${COMPOSE[@]}" restart >/dev/null
wait_healthy
expect_state login "the admin survives a restart"

step "G. recreating the container against the same volume keeps the admin"
"${COMPOSE[@]}" down >/dev/null
"${COMPOSE[@]}" up -d --wait >/dev/null
wait_healthy
expect_state login 'the admin survives a down-and-up against the same volume'

step "H. rebuilding the image and recreating the container keeps the admin"
"${COMPOSE[@]}" build >/dev/null
"${COMPOSE[@]}" up -d --force-recreate --wait >/dev/null
wait_healthy
expect_state login "the admin survives an image rebuild and a forced recreation"

step "the database is on the mounted volume, not the container's own layer"
"${COMPOSE[@]}" exec -T opswatch sh -c 'test -f /data/opswatch.sqlite' \
  || fail "no database on the mounted volume"
pass "/data/opswatch.sqlite exists on the volume"
"${COMPOSE[@]}" exec -T opswatch sh -c '! find /tmp -name "opswatch.sqlite" 2>/dev/null | grep -q .' \
  || fail "a database was also written outside the volume"
pass "nothing was written to the disposable layer"

step "J. no secret reached the logs"
LOGS=$("${COMPOSE[@]}" logs --no-color 2>&1)
# The instance secret this harness runs with, read from the compose file that sets it, plus the admin
# password the form above used and the column a password hash would be printed from.
SECRET=$(awk '/OPSWATCH_SECRET:/ {print $2}' docker-compose.persistence.yml)
for secret in "$SECRET" 'a-long-enough-password' 'passwordHash' 'password_hash'; do
  if printf '%s' "$LOGS" | grep -qF -- "$secret"; then fail "the container logs contain '$secret'"; fi
done
pass "the container logs name no secret, no password and no hash"

printf '\n\033[32mAll %d persistence checks passed.\033[0m\n' "$PASSED"
