#!/usr/bin/env bash
set -euo pipefail
umask 077

usage() {
  cat <<'USAGE'
Usage:
  scripts/create-agent-api-key.sh <key-name> <output-env-file> [monthly-request-limit]

Environment:
  ADMIN_API_ORIGIN          Admin API origin. Default: http://127.0.0.1:18789
  PUBLIC_MODEL_API_BASE_URL Public OpenAI-compatible base URL ending in /v1.
                            Default: http://127.0.0.1:18789/v1
  MODEL_ALIAS               Model alias written to the output file. Default: coding

The script prompts for the console username and password, creates a dedicated
API key through the local admin API, and writes a mode-600 environment file.
The plaintext key is never printed to stdout.
USAGE
}

if [[ $# -lt 2 || $# -gt 3 ]]; then
  usage >&2
  exit 2
fi

key_name=$1
output_file=$2
monthly_limit=${3:-}
admin_origin=${ADMIN_API_ORIGIN:-http://127.0.0.1:18789}
public_base_url=${PUBLIC_MODEL_API_BASE_URL:-http://127.0.0.1:18789/v1}
model_alias=${MODEL_ALIAS:-coding}
admin_origin=${admin_origin%/}
public_base_url=${public_base_url%/}

if [[ -z "$key_name" || "$key_name" == *$'\n'* ]]; then
  echo "Key name must be non-empty and single-line." >&2
  exit 2
fi

if [[ -n "$monthly_limit" && ! "$monthly_limit" =~ ^[1-9][0-9]*$ ]]; then
  echo "monthly-request-limit must be a positive integer." >&2
  exit 2
fi

if [[ ! "$admin_origin" =~ ^https?://[^[:space:]]+$ ]]; then
  echo "ADMIN_API_ORIGIN must be a single-line HTTP(S) URL." >&2
  exit 2
fi

if [[ ! "$public_base_url" =~ ^https?://[^[:space:]]+$ ]]; then
  echo "PUBLIC_MODEL_API_BASE_URL must be a single-line HTTP(S) URL." >&2
  exit 2
fi

if [[ ! "$model_alias" =~ ^[A-Za-z0-9._:/-]+$ ]]; then
  echo "MODEL_ALIAS contains unsupported characters." >&2
  exit 2
fi

for command_name in curl node; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "$command_name is required." >&2
    exit 1
  fi
done

read -r -p "Admin username: " admin_username
read -r -s -p "Admin password: " admin_password
echo

cookie_file=$(mktemp)
response_file=$(mktemp)
cleanup() {
  rm -f "$cookie_file" "$response_file"
  unset admin_password
}
trap cleanup EXIT
chmod 600 "$cookie_file" "$response_file"

login_payload=$(
  printf '%s\0%s' "$admin_username" "$admin_password" |
    node -e '
      const chunks = [];
      process.stdin.on("data", chunk => chunks.push(chunk));
      process.stdin.on("end", () => {
        const parts = Buffer.concat(chunks).toString("utf8").split("\0");
        process.stdout.write(JSON.stringify({ username: parts[0] ?? "", password: parts[1] ?? "" }));
      });
    '
)
unset admin_password

printf '%s' "$login_payload" | curl --fail --silent --show-error \
  --cookie-jar "$cookie_file" \
  --header 'Content-Type: application/json' \
  --data-binary @- \
  "$admin_origin/admin/login" >/dev/null
unset login_payload

create_payload=$(
  KEY_NAME="$key_name" MONTHLY_LIMIT="$monthly_limit" node -e '
    const payload = { name: process.env.KEY_NAME };
    if (process.env.MONTHLY_LIMIT) payload.monthlyLimit = Number(process.env.MONTHLY_LIMIT);
    process.stdout.write(JSON.stringify(payload));
  '
)

printf '%s' "$create_payload" | curl --fail --silent --show-error \
  --cookie "$cookie_file" \
  --header 'Content-Type: application/json' \
  --data-binary @- \
  "$admin_origin/admin/api-keys" >"$response_file"
unset create_payload

agent_key=$(
  node -e '
    const fs = require("node:fs");
    const parsed = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    if (typeof parsed.key !== "string" || !parsed.key.startsWith("gw_")) process.exit(1);
    process.stdout.write(parsed.key);
  ' "$response_file"
)

if [[ "$agent_key" == *$'\n'* || "$public_base_url" == *$'\n'* || "$model_alias" == *$'\n'* ]]; then
  echo "Refusing to write multiline environment values." >&2
  exit 1
fi

mkdir -p "$(dirname "$output_file")"
temporary_output=$(mktemp "${output_file}.tmp.XXXXXX")
cat >"$temporary_output" <<ENVFILE
OPENAI_API_KEY=$agent_key
OPENAI_BASE_URL=$public_base_url
MODEL_API_KEY=$agent_key
MODEL_API_BASE_URL=$public_base_url
MODEL_API_MODEL=$model_alias
ENVFILE
chmod 600 "$temporary_output"
mv "$temporary_output" "$output_file"

echo "Created dedicated key '$key_name' and wrote $output_file with mode 600."
