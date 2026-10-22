export type UserImageTableColumn = {
  id: string;
  label: string;
  source: string;
  scope: "all" | "face" | "normal";
};

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_.]*/;
const NUMBER = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/;
const FUNCTIONS: Record<string, (values: number[]) => number> = {
  abs: ([value]) => Math.abs(value),
  log2: ([value]) => Math.log2(value),
  min: (values) => Math.min(...values),
  max: (values) => Math.max(...values),
};

export function readUserImageColumns(key: string): UserImageTableColumn[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? "[]");
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is UserImageTableColumn =>
      Boolean(item) && typeof item.id === "string" && typeof item.label === "string"
      && typeof item.source === "string" && ["all", "face", "normal"].includes(item.scope));
  } catch {
    return [];
  }
}

function tokenize(source: string): string[] {
  if (source.length > 256) throw new Error("formula too long");
  const tokens: string[] = [];
  let offset = 0;
  while (offset < source.length) {
    if (/\s/.test(source[offset])) { offset += 1; continue; }
    const rest = source.slice(offset);
    const token = rest.match(NUMBER)?.[0] ?? rest.match(IDENTIFIER)?.[0]
      ?? ("+-*/(),".includes(rest[0]) ? rest[0] : null);
    if (!token || tokens.length >= 64) throw new Error("invalid formula");
    tokens.push(token);
    offset += token.length;
  }
  return tokens;
}

export function imageColumnSourceKeys(source: string): string[] {
  const trimmed = source.trim();
  if (!trimmed) return [];
  if (!trimmed.startsWith("=")) return [trimmed];
  try {
    const tokens = tokenize(trimmed.slice(1));
    return [...new Set(tokens.filter((token, index) => IDENTIFIER.test(token)
      && !NUMBER.test(token) && tokens[index + 1] !== "("))];
  } catch {
    return [];
  }
}

export function customImageColumnText(source: string, lookup: (key: string) => string): string {
  const trimmed = source.trim();
  if (!trimmed) return "-";
  if (!trimmed.startsWith("=")) return lookup(trimmed);
  try {
    const tokens = tokenize(trimmed.slice(1));
    let position = 0;
    const take = (value: string) => {
      if (tokens[position] !== value) return false;
      position += 1;
      return true;
    };
    const expression = (): number => {
      let result = product();
      while (tokens[position] === "+" || tokens[position] === "-") {
        const operator = tokens[position++];
        const right = product();
        result = operator === "+" ? result + right : result - right;
      }
      return result;
    };
    const product = (): number => {
      let result = primary();
      while (tokens[position] === "*" || tokens[position] === "/") {
        const operator = tokens[position++];
        const right = primary();
        result = operator === "*" ? result * right : result / right;
      }
      return result;
    };
    const primary = (): number => {
      if (take("+")) return primary();
      if (take("-")) return -primary();
      if (take("(")) {
        const value = expression();
        if (!take(")")) throw new Error("missing closing parenthesis");
        return value;
      }
      const token = tokens[position++];
      if (!token) throw new Error("missing value");
      if (NUMBER.test(token)) return Number(token);
      if (!IDENTIFIER.test(token)) throw new Error("invalid value");
      if (take("(")) {
        const args: number[] = [];
        if (tokens[position] !== ")") {
          do { args.push(expression()); } while (take(","));
        }
        if (!take(")") || !FUNCTIONS[token.toLowerCase()] || args.length === 0)
          throw new Error("invalid function");
        return FUNCTIONS[token.toLowerCase()](args);
      }
      const value = Number(lookup(token));
      if (!Number.isFinite(value)) throw new Error("missing field");
      return value;
    };
    const result = expression();
    return position === tokens.length && Number.isFinite(result)
      ? String(Number(result.toFixed(6))) : "-";
  } catch {
    return "-";
  }
}
