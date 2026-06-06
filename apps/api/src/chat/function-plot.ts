type Token =
  | { type: "number"; value: number }
  | { type: "identifier"; value: string }
  | { type: "operator"; value: "+" | "-" | "*" | "/" | "^" | "," }
  | { type: "paren"; value: "(" | ")" };

const functions: Record<string, (...values: number[]) => number> = {
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  sqrt: Math.sqrt,
  abs: Math.abs,
  log: Math.log,
  exp: Math.exp,
  pow: Math.pow,
  min: Math.min,
  max: Math.max
};

function tokenize(expression: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  while (index < expression.length) {
    const char = expression[index]!;
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }
    if (/[0-9.]/.test(char)) {
      const match = /^[0-9]*\.?[0-9]+/.exec(expression.slice(index));
      if (!match) throw new Error("Invalid number");
      tokens.push({ type: "number", value: Number(match[0]) });
      index += match[0].length;
      continue;
    }
    if (/[a-zA-Z_]/.test(char)) {
      const match = /^[a-zA-Z_][a-zA-Z0-9_]*/.exec(expression.slice(index));
      if (!match) throw new Error("Invalid identifier");
      tokens.push({ type: "identifier", value: match[0] });
      index += match[0].length;
      continue;
    }
    if ("+-*/^,".includes(char)) {
      tokens.push({ type: "operator", value: char as "+" | "-" | "*" | "/" | "^" | "," });
      index += 1;
      continue;
    }
    if (char === "(" || char === ")") {
      tokens.push({ type: "paren", value: char });
      index += 1;
      continue;
    }
    throw new Error("Unsupported character");
  }
  return tokens;
}

class Parser {
  private index = 0;
  constructor(private readonly tokens: Token[], private readonly x: number) {}

  parse(): number {
    const value = this.expression();
    if (this.index < this.tokens.length) throw new Error("Unexpected token");
    return value;
  }

  private current(): Token | undefined {
    return this.tokens[this.index];
  }

  private consume(): Token {
    const token = this.tokens[this.index];
    if (!token) throw new Error("Unexpected end");
    this.index += 1;
    return token;
  }

  private expression(): number {
    let value = this.term();
    while (this.current()?.type === "operator" && (this.current() as any).value && ["+", "-"].includes((this.current() as any).value)) {
      const op = (this.consume() as { type: "operator"; value: string }).value;
      const right = this.term();
      value = op === "+" ? value + right : value - right;
    }
    return value;
  }

  private term(): number {
    let value = this.power();
    while (this.current()?.type === "operator" && ["*", "/"].includes((this.current() as any).value)) {
      const op = (this.consume() as { type: "operator"; value: string }).value;
      const right = this.power();
      value = op === "*" ? value * right : value / right;
    }
    return value;
  }

  private power(): number {
    let value = this.unary();
    if (this.current()?.type === "operator" && (this.current() as any).value === "^") {
      this.consume();
      value = Math.pow(value, this.power());
    }
    return value;
  }

  private unary(): number {
    if (this.current()?.type === "operator" && (this.current() as any).value === "-") {
      this.consume();
      return -this.unary();
    }
    return this.primary();
  }

  private primary(): number {
    const token = this.consume();
    if (token.type === "number") return token.value;
    if (token.type === "identifier") {
      if (token.value === "x") return this.x;
      const fn = functions[token.value];
      if (!fn) throw new Error(`Function '${token.value}' is not allowed`);
      const next = this.consume();
      if (next.type !== "paren" || next.value !== "(") throw new Error("Function call expected");
      const args: number[] = [];
      if (!(this.current()?.type === "paren" && (this.current() as any).value === ")")) {
        args.push(this.expression());
        while (this.current()?.type === "operator" && (this.current() as any).value === ",") {
          this.consume();
          args.push(this.expression());
        }
      }
      const close = this.consume();
      if (close.type !== "paren" || close.value !== ")") throw new Error("Closing parenthesis expected");
      return fn(...args);
    }
    if (token.type === "paren" && token.value === "(") {
      const value = this.expression();
      const close = this.consume();
      if (close.type !== "paren" || close.value !== ")") throw new Error("Closing parenthesis expected");
      return value;
    }
    throw new Error("Expression expected");
  }
}

export function generateFunctionPlotPoints(expression: string, xMin: number, xMax: number, sampleCount: number) {
  if (!Number.isFinite(xMin) || !Number.isFinite(xMax) || xMax <= xMin) {
    throw new Error("Invalid plot domain");
  }
  const count = Math.max(20, Math.min(500, Math.floor(sampleCount)));
  const tokens = tokenize(expression);
  return Array.from({ length: count }, (_, index) => {
    const x = xMin + ((xMax - xMin) * index) / Math.max(1, count - 1);
    const y = new Parser(tokens, x).parse();
    if (!Number.isFinite(y)) throw new Error("Expression produced a non-finite value");
    return { x, y };
  });
}
