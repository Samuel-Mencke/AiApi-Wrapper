#!/usr/bin/env bash
set -euo pipefail

base_url=${MODEL_API_BASE_URL:-${OPENAI_BASE_URL:-}}
api_key=${MODEL_API_KEY:-${OPENAI_API_KEY:-}}
model_alias=${MODEL_API_MODEL:-coding}

if [[ -z "$base_url" || -z "$api_key" ]]; then
  cat >&2 <<'USAGE'
Set MODEL_API_BASE_URL and MODEL_API_KEY, or OPENAI_BASE_URL and OPENAI_API_KEY.
The base URL may be either https://api.example.com or https://api.example.com/v1.
Optional: MODEL_API_MODEL=coding
USAGE
  exit 2
fi

for command_name in curl node; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "$command_name is required." >&2
    exit 1
  fi
done

if [[ "$api_key" == *$'\n'* || "$api_key" == *$'\r'* ]]; then
  echo "API key must be single-line." >&2
  exit 2
fi

if [[ ! "$base_url" =~ ^https?://[^[:space:]]+$ ]]; then
  echo "API base URL must be a single-line HTTP(S) URL." >&2
  exit 2
fi

if [[ ! "$model_alias" =~ ^[A-Za-z0-9._:/-]+$ ]]; then
  echo "MODEL_API_MODEL contains unsupported characters." >&2
  exit 2
fi

base_url=${base_url%/}
if [[ "$base_url" == */v1 ]]; then
  api_base=$base_url
  api_origin=${base_url%/v1}
else
  api_origin=$base_url
  api_base=$base_url/v1
fi

temporary_directory=$(mktemp -d)
cleanup() {
  rm -rf "$temporary_directory"
}
trap cleanup EXIT
chmod 700 "$temporary_directory"
printf 'Authorization: Bearer %s\n' "$api_key" >"$temporary_directory/auth-header.txt"
chmod 600 "$temporary_directory/auth-header.txt"
unset api_key

curl --fail --silent --show-error "$api_origin/health" >"$temporary_directory/health.json"
curl --fail --silent --show-error \
  --header "@$temporary_directory/auth-header.txt" \
  "$api_base/models" >"$temporary_directory/models.json"

MODEL_ALIAS="$model_alias" node -e '
  const fs = require("node:fs");
  const payload = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  const ids = Array.isArray(payload.data) ? payload.data.map(item => item?.id).filter(Boolean) : [];
  if (!ids.includes(process.env.MODEL_ALIAS)) {
    console.error(`Model alias ${process.env.MODEL_ALIAS} was not advertised. Available: ${ids.join(", ")}`);
    process.exit(1);
  }
' "$temporary_directory/models.json"

request_payload=$(
  MODEL_ALIAS="$model_alias" node -e '
    process.stdout.write(JSON.stringify({
      model: process.env.MODEL_ALIAS,
      messages: [{ role: "user", content: "Reply with exactly: model-api-ok" }],
      stream: false,
      temperature: 0
    }));
  '
)

curl --fail --silent --show-error \
  --header "@$temporary_directory/auth-header.txt" \
  --header 'Content-Type: application/json' \
  --data "$request_payload" \
  "$api_base/chat/completions" >"$temporary_directory/completion.json"

node -e '
  const fs = require("node:fs");
  const payload = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || content.trim().length === 0) {
    console.error("Chat completion returned no assistant content.");
    process.exit(1);
  }
  console.log(`Inference returned: ${content.trim().slice(0, 200)}`);
' "$temporary_directory/completion.json"

echo "Agent API verification passed for $api_base using model $model_alias."
