import { PageShell } from "@/components/page-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, Table, Td, Th } from "@/components/ui/table";
import { PUBLIC_API_URL } from "@/lib/api";

const endpoints = [
  {
    method: "GET",
    path: "/health",
    purpose: "Service status, base URL and prompt logging state.",
  },
  {
    method: "GET",
    path: "/v1/models",
    purpose: "OpenAI-compatible model list with your configured aliases.",
  },
  {
    method: "GET",
    path: "/v1/models/:model",
    purpose: "Details for a single model alias.",
  },
  {
    method: "POST",
    path: "/v1/chat/completions",
    purpose: "OpenAI-compatible chat endpoint. Supports streaming with SSE.",
  },
  {
    method: "POST",
    path: "/v1/responses",
    purpose:
      "Responses API for Codex-style clients. Supports streaming and stored responses.",
  },
  {
    method: "GET",
    path: "/v1/responses/:response_id",
    purpose: "Retrieves a stored response by ID.",
  },
  {
    method: "DELETE",
    path: "/v1/responses/:response_id",
    purpose: "Deletes a stored response.",
  },
  {
    method: "POST",
    path: "/v1/responses/:response_id/cancel",
    purpose: "Cancels an in-progress response.",
  },
  {
    method: "GET",
    path: "/v1/responses/:response_id/input_items",
    purpose: "Lists the input items of a stored response.",
  },
  {
    method: "GET",
    path: "/admin/stats",
    purpose: "Dashboard metrics for requests, latency, errors and cost.",
  },
  {
    method: "GET",
    path: "/admin/providers",
    purpose: "Configured providers, type, base URL and enabled state.",
  },
  {
    method: "POST",
    path: "/admin/providers",
    purpose: "Creates a new provider.",
  },
  {
    method: "POST",
    path: "/admin/providers/test",
    purpose: "Checks whether a provider endpoint is reachable.",
  },
  {
    method: "PATCH",
    path: "/admin/providers/:id",
    purpose: "Updates a provider's name, type, base URL or enabled state.",
  },
  {
    method: "DELETE",
    path: "/admin/providers/:id",
    purpose: "Deletes a provider.",
  },
  {
    method: "GET",
    path: "/admin/models",
    purpose:
      "Model aliases, provider routes, fallbacks and basic route metrics.",
  },
  {
    method: "POST",
    path: "/admin/models",
    purpose: "Creates a new model alias route.",
  },
  {
    method: "PATCH",
    path: "/admin/models/:id",
    purpose: "Updates a model alias route.",
  },
  {
    method: "DELETE",
    path: "/admin/models/:id",
    purpose: "Deletes a model alias route.",
  },
  {
    method: "POST",
    path: "/admin/models/test",
    purpose:
      "Tests a model alias by sending a minimal request through its route.",
  },
  {
    method: "GET",
    path: "/admin/api-keys",
    purpose:
      "Lists locally generated service keys without exposing secret values.",
  },
  {
    method: "POST",
    path: "/admin/api-keys",
    purpose: "Creates a service key and reveals it once.",
  },
  {
    method: "PATCH",
    path: "/admin/api-keys/:id",
    purpose: "Enables or disables a service key.",
  },
  {
    method: "DELETE",
    path: "/admin/api-keys/:id",
    purpose: "Deletes a service key.",
  },
  {
    method: "GET",
    path: "/admin/logs",
    purpose:
      "Metadata-only request logs. Prompts and responses are not stored.",
  },
  {
    method: "GET",
    path: "/admin/settings",
    purpose: "Runtime settings shown in the dashboard.",
  },
  {
    method: "GET",
    path: "/admin/quota",
    purpose: "Z.ai quota policy summary plus local quota/rate-limit events.",
  },
  {
    method: "GET",
    path: "/admin/quota-settings",
    purpose: "Per-provider and per-model quota configuration.",
  },
  {
    method: "PATCH",
    path: "/admin/quota-settings",
    purpose: "Updates quota limits, windows and enabled state.",
  },
];

const nonStreamingCurl = `curl ${PUBLIC_API_URL}/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "glm5.1",
    "messages": [
      { "role": "user", "content": "Write a small TypeScript function." }
    ],
    "temperature": 0.2
  }'`;

const streamingCurl = `curl -N ${PUBLIC_API_URL}/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "glm5-turbo",
    "messages": [
      { "role": "user", "content": "Stream a short coding answer." }
    ],
    "stream": true,
    "stream_options": { "include_usage": true }
  }'`;

const responsesCurl = `curl ${PUBLIC_API_URL}/v1/responses \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "glm5-turbo",
    "instructions": "You are a coding assistant.",
    "input": "Inspect this error and suggest a fix.",
    "stream": false
  }'`;

const openAiStyle = `baseURL: "${PUBLIC_API_URL}/v1"
model: "glm5.1"
apiKey: "any-local-value-or-your-generated-key"`;

function CodeBlock({ children }: { children: string }) {
  return (
    <pre className="overflow-x-auto rounded-xl border border-white/[0.06] bg-[var(--bg-base)] p-4 text-xs leading-6 text-[var(--text-secondary)]">
      <code>{children}</code>
    </pre>
  );
}

export default function DocsPage() {
  return (
    <PageShell>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold text-[var(--text-primary)]">Docs</h1>
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            Short reference for your local OpenAI-compatible model API.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          <Card>
            <CardHeader>
              <CardTitle>Base URL</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="font-mono text-sm text-[var(--text-primary)]">
                {PUBLIC_API_URL}
              </div>
              <div className="mt-2 text-sm text-[var(--text-muted)]">
                Use this for direct model API calls.
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>OpenAI-style URL</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="font-mono text-sm text-[var(--text-primary)]">
                {PUBLIC_API_URL}/v1
              </div>
              <div className="mt-2 text-sm text-[var(--text-muted)]">
                Use this as SDK base URL.
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Auth</CardTitle>
            </CardHeader>
            <CardContent>
              <Badge>Personal mode</Badge>
              <div className="mt-2 text-sm text-[var(--text-muted)]">
                Bearer keys are optional locally.
              </div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Endpoints</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <thead>
                <tr>
                  <Th>Method</Th>
                  <Th>Path</Th>
                  <Th>Explanation</Th>
                </tr>
              </thead>
              <tbody>
                {endpoints.map((endpoint) => (
                  <tr key={`${endpoint.method}-${endpoint.path}`}>
                    <Td>
                      <Badge>{endpoint.method}</Badge>
                    </Td>
                    <Td className="font-mono">{endpoint.path}</Td>
                    <Td>{endpoint.purpose}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Chat completion</CardTitle>
            </CardHeader>
            <CardContent>
              <CodeBlock>{nonStreamingCurl}</CodeBlock>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Streaming</CardTitle>
            </CardHeader>
            <CardContent>
              <CodeBlock>{streamingCurl}</CodeBlock>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Responses API</CardTitle>
          </CardHeader>
          <CardContent>
            <CodeBlock>{responsesCurl}</CodeBlock>
            <p className="mt-3 text-sm text-[var(--text-muted)]">
              For Codex-style clients. Stored responses can be retrieved by ID
              unless <code className="text-[var(--text-secondary)]">store</code> is set to{" "}
              <code className="text-[var(--text-secondary)]">false</code>.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Use it like a normal OpenAI-compatible API</CardTitle>
          </CardHeader>
          <CardContent>
            <CodeBlock>{openAiStyle}</CodeBlock>
            <p className="mt-3 text-sm text-[var(--text-muted)]">
              Provider keys stay on the server. Client tools only need the
              local base URL and a model alias.
            </p>
          </CardContent>
        </Card>
      </div>
    </PageShell>
  );
}
