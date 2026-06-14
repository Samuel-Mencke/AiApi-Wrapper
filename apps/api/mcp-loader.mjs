export async function resolve(specifier, context, nextResolve) {
  const fromResponsesRoute = context.parentURL?.endsWith("/dist/routes/responses.js");
  if (fromResponsesRoute && specifier === "../responses/compat.js") {
    return nextResolve("../responses/compat-mcp.js", context);
  }
  if (fromResponsesRoute && specifier === "../responses/stream.js") {
    return nextResolve("../responses/stream-mcp.js", context);
  }
  return nextResolve(specifier, context);
}
