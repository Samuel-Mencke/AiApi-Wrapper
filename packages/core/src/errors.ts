export class GatewayError extends Error {
  public readonly code: string;
  public readonly statusCode: number;
  public readonly retryable: boolean;

  constructor(message: string, options: { code: string; statusCode?: number; retryable?: boolean }) {
    super(message);
    this.name = "GatewayError";
    this.code = options.code;
    this.statusCode = options.statusCode ?? 500;
    this.retryable = options.retryable ?? false;
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
