import { PageShell } from "@/components/page-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, Table, Td, Th } from "@/components/ui/table";
import { API_BASE_URL } from "@/lib/api";

const endpoints = [
  { method: "GET", path: "/health", purpose: "Gateway status, base URL and prompt logging state." },
  { method: "GET", path: "/v1/models", purpose: "OpenAI-compatible model list with your configured aliases." },
  { method: "POST", path: "/v1/chat/completions", purpose: "OpenAI-compatible chat endpoint. Supports streaming with SSE." },
  { method: "GET", path: "/admin/stats", purpose: "Dashboard metrics for requests, latency, errors and cost." },
  { method: "GET", path: "/admin/providers", purpose: "Configured providers, type, base URL and enabled state." },
  { method: "POST", path: "/admin/providers/test", purpose: "Checks whether a provider endpoint is reachable." },
  { method: "GET", path: "/admin/models", purpose: "Model aliases, provider routes, fallbacks and basic route metrics." },
  { method: "POST", path: "/admin/models", purpose: "Creates a new model alias route." },
  { method: "PATCH", path: "/admin/models/:id", purpose: "Updates a model alias route." },
  { method: "DELETE", path: "/admin/models/:id", purpose: "Deletes a model alias route." },
  { method: "GET", path: "/admin/api-keys", purpose: "Lists locally generated gateway keys without exposing secret values." },
  { method: "POST", path: "/admin/api-keys", purpose: "Creates a gateway key and reveals it once." },
  { method: "PATCH", path: "/admin/api-keys/:id", purpose: "Enables or disables a gateway key." },
  { method: "DELETE", path: "/admin/api-keys/:id", purpose: "Deletes a gateway key." },
  { method: "GET", path: "/admin/logs", purpose: "Metadata-only request logs. Prompts and responses are not stored." },
  { method: "GET", path: "/admin/settings", purpose: "Runtime settings shown in the dashboard." }
];

const nonStreamingCurl = `curl ${API_BASE_URL}/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "glm5.1",
    "messages": [
      { "role": "user", "content": "Write a small TypeScript function." }
    ],
    "temperature": 0.2
  }'`;

const streamingCurl = `curl -N ${API_BASE_URL}/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "glm5-turbo",
    "messages": [
      { "role": "user", "content": "Stream a short coding answer." }
    ],
    "stream": true,
    "stream_options": { "include_usage": true }
  }'`;

const openAiStyle = `baseURL: "${API_BASE_URL}/v1"
model: "glm5.1"
apiKey: "any-local-value-or-your-generated-key"`;

function CodeBlock({ children }: { children: string }) {
  return (
    <pre className="overflow-x-auto rounded-xl border border-zinc-800 bg-zinc-950 p-4 text-xs leading-6 text-zinc-200">
      <code>{children}</code>
    </pre>
  );
}

export default function DocsPage() {
  return (
    <PageShell>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-100">Docs</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Short reference for your local OpenAI-compatible gateway.
          </p>
        </div>

        <div className="grid grid-cols-3 gap-4">
          <Card>
            <CardHeader><CardTitle>Base URL</CardTitle></CardHeader>
            <CardContent>
              <div className="font-mono text-sm text-zinc-100">{API_BASE_URL}</div>
              <div className="mt-2 text-sm text-zinc-500">Use this for direct gateway calls.</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>OpenAI-style URL</CardTitle></CardHeader>
            <CardContent>
              <div className="font-mono text-sm text-zinc-100">{API_BASE_URL}/v1</div>
              <div className="mt-2 text-sm text-zinc-500">Use this as SDK base URL.</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Auth</CardTitle></CardHeader>
            <CardContent>
              <Badge>Personal mode</Badge>
              <div className="mt-2 text-sm text-zinc-500">Bearer keys are optional locally.</div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader><CardTitle>Endpoints</CardTitle></CardHeader>
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
                    <Td><Badge>{endpoint.method}</Badge></Td>
                    <Td className="font-mono">{endpoint.path}</Td>
                    <Td>{endpoint.purpose}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </CardContent>
        </Card>

        <div className="grid grid-cols-2 gap-4">
          <Card>
            <CardHeader><CardTitle>Chat completion</CardTitle></CardHeader>
            <CardContent><CodeBlock>{nonStreamingCurl}</CodeBlock></CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Streaming</CardTitle></CardHeader>
            <CardContent><CodeBlock>{streamingCurl}</CodeBlock></CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader><CardTitle>Use it like a normal OpenAI-compatible API</CardTitle></CardHeader>
          <CardContent>
            <CodeBlock>{openAiStyle}</CodeBlock>
            <p className="mt-3 text-sm text-zinc-500">
              Provider keys stay in the gateway. Client tools only need the local base URL and a model alias.
            </p>
          </CardContent>
        </Card>
      </div>
    </PageShell>
  );
}
