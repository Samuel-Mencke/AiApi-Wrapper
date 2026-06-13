export class GatewayError extends Error {
  public readonly code: string;
  public readonly statusCode: number;
  public readonly retryable: boolean;
  public readonly param: string | null;
  public readonly retryAfter: number | null;

  constructor(
    message: string,
    options: { code: string; statusCode?: number; retryable?: boolean; param?: string | null; retryAfter?: number | null },
  ) {
    super(message);
    this.name = "GatewayError";
    this.code = options.code;
    this.statusCode = options.statusCode ?? 500;
    this.retryable = options.retryable ?? false;
    this.param = options.param ?? null;
    this.retryAfter = options.retryAfter ?? null;
  }
}

export function isRetryableStatus(statusCode: number): boolean {
  return [408, 429, 500, 502, 503].includes(statusCode);
}

export function toGatewayError(error: unknown): GatewayError {
  if (error instanceof GatewayError) {
    return error;
  }

  if (error instanceof Error) {
    return new GatewayError(error.message, {
      code: "provider_error",
      statusCode: 500,
      retryable: true
    });
  }

  return new GatewayError("Unknown gateway error", {
    code: "unknown_error",
    statusCode: 500,
    retryable: true
  });
}
