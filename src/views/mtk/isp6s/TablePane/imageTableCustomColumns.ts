export type UserImageTableColumn = {
  id: string;
  label: string;
  source: string;
  scope: "all" | "face" | "normal";
};

export type ImageTableColumnOverride = { label?: string; source?: string };
export type ImageTableColumnOverrides = Record<string, ImageTableColumnOverride>;

export function readImageTableColumnOverrides(key: string): ImageTableColumnOverrides {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? "{}");
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, ImageTableColumnOverride] => {
      const edit = entry[1] as ImageTableColumnOverride | null;
      if (!edit || typeof edit !== "object") return false;
      return (edit.label === undefined || typeof edit.label === "string")
        && (edit.source === undefined || typeof edit.source === "string");
    }));
  } catch {
    return {};
  }
}

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_.]*/;
const NUMBER = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/;
const FUNCTIONS: Record<string, (values: number[]) => number> = {
  abs: ([value]) => Math.abs(value),
  log2: ([value]) => Math.log2(value),
  min: (values) => Math.min(...values),
  max: (values) => Math.max(...values),
};

type CompositePart = { key: string } | { literal: string } | CompositeSource;
type CompositeSource = { kind: "join" | "list"; parts: CompositePart[] };

function stringLiteral(token: string): string | null {
  if (token.startsWith('"')) return JSON.parse(token) as string;
  if (token.startsWith("“")) return token.slice(1, -1);
  return null;
}

function parseCompositeSource(source: string): CompositeSource | null {
  const trimmed = source.trim();
  if (!trimmed.startsWith("=")) return null;
  const tokens = tokenize(trimmed.slice(1));
  let position = 0;
  const parseFunction = (): CompositeSource => {
    const functionName = tokens[position++]?.toLowerCase();
    if (functionName !== "join" && functionName !== "list" || tokens[position++] !== "(")
      throw new Error("expected join or list function");
    const parts: CompositePart[] = [];
    while (position < tokens.length && tokens[position] !== ")") {
      const token = tokens[position++];
      const literal = stringLiteral(token);
      if (literal !== null && functionName === "join") parts.push({ literal });
      else if (token && IDENTIFIER.test(token) && !NUMBER.test(token)) {
        if (tokens[position] === "(") {
          position -= 1;
          parts.push(parseFunction());
        } else parts.push({ key: token });
      } else throw new Error(`${functionName} accepts TOML fields${functionName === "join" ? ", quoted text" : ""}, and nested join/list functions`);
      if (tokens[position] === ",") {
        position += 1;
        if (tokens[position] === ")") throw new Error(`${functionName} does not allow a trailing comma`);
      } else if (tokens[position] !== ")") throw new Error(`${functionName} arguments must be comma-separated`);
    }
    if (tokens[position++] !== ")" || !parts.some((part) => "key" in part || "parts" in part))
      throw new Error(`${functionName} requires one or more TOML fields`);
    return { kind: functionName, parts };
  };
  if (!(["join", "list"].includes(tokens[0]?.toLowerCase())) || tokens[1] !== "(") return null;
  const result = parseFunction();
  if (position !== tokens.length) throw new Error("unexpected content after function");
  return result;
}

function compositeKeys(source: CompositeSource): string[] {
  return source.parts.flatMap((part) => "key" in part ? [part.key] : "parts" in part ? compositeKeys(part) : []);
}

function compositeText(source: CompositeSource, lookup: (key: string) => string): string {
  const values = source.parts.map((part) => "key" in part ? lookup(part.key)
    : "parts" in part ? compositeText(part, lookup) : part.literal);
  if (source.kind === "list") return `[${values.join(", ")}]`;
  return source.parts.some((part) => "literal" in part) ? values.join("") : values.join(", ");
}

export const AE_GAIN_PAIR_SOURCE = "=FLinkTar_old / BackTar_old(FLinkTar_new / BackTar_new)";

export function isAeGainPairSource(source: string): boolean {
  return /^=?\s*FLinkTar_old\s*\/\s*BackTar_old\s*\(\s*FLinkTar_new\s*\/\s*BackTar_new\s*\)$/i.test(source.trim());
}

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
    const token = rest.match(/^"(?:\\.|[^"\\])*"/)?.[0] ?? rest.match(/^“[^”]*”/)?.[0]
      ?? rest.match(NUMBER)?.[0] ?? rest.match(IDENTIFIER)?.[0]
      ?? ("+-*/(),".includes(rest[0]) ? rest[0] : null);
    if (!token || tokens.length >= 64) throw new Error("invalid formula");
    tokens.push(token);
    offset += token.length;
  }
  return tokens;
}

export type ColumnSourceRecognition = { recognized: true; source: string; kind: "keyword" | "formula"; unverifiedKeys: string[] }
  | { recognized: false; reason: string };

export function recognizeImageColumnSource(source: string, knownKeys: ReadonlySet<string>, columnId?: string): ColumnSourceRecognition {
  const trimmed = source.trim();
  if (!trimmed) return { recognized: false, reason: "请输入关键字或公式" };
  if (columnId === "aeGain" && isAeGainPairSource(trimmed))
    return { recognized: true, source: AE_GAIN_PAIR_SOURCE, kind: "formula", unverifiedKeys: [] };
  const formula = trimmed.startsWith("=") ? trimmed : /[()+*/\s-]/.test(trimmed) ? `=${trimmed}` : null;
  if (!formula) return /^[A-Za-z_][A-Za-z0-9_.]*$/.test(trimmed)
    ? { recognized: true, source: trimmed, kind: "keyword", unverifiedKeys: knownKeys.has(trimmed) ? [] : [trimmed] }
    : { recognized: false, reason: "关键字只能包含字母、数字、下划线和点，且不能以数字开头" };
  try {
    const composite = parseCompositeSource(formula);
    if (composite) {
      return { recognized: true, source: formula, kind: "formula", unverifiedKeys: [...new Set(compositeKeys(composite).filter((key) => !knownKeys.has(key)))] };
    }
    const tokens = tokenize(formula.slice(1));
    const unverified = new Set<string>();
    let position = 0;
    const take = (token: string) => tokens[position] === token ? (position += 1, true) : false;
    const expression = (): void => {
      product();
      while (take("+") || take("-")) product();
    };
    const product = (): void => {
      primary();
      while (take("*") || take("/")) primary();
    };
    const primary = (): void => {
      if (take("+") || take("-")) return primary();
      if (take("(")) {
        expression();
        if (!take(")")) throw new Error("括号未闭合");
        return;
      }
      const token = tokens[position++];
      if (!token) throw new Error("公式缺少操作数");
      if (NUMBER.test(token)) return;
      if (!IDENTIFIER.test(token)) throw new Error(`无效的公式符号 ${token}`);
      if (take("(")) {
        if (!FUNCTIONS[token.toLowerCase()]) throw new Error(`不支持函数 ${token}`);
        let count = 0;
        do { expression(); count += 1; } while (take(","));
        if (!take(")")) throw new Error("函数括号未闭合");
        if (count !== 1 && token.toLowerCase() !== "min" && token.toLowerCase() !== "max")
          throw new Error(`${token} 只接受一个参数`);
        return;
      }
      if (!knownKeys.has(token)) unverified.add(token);
    };
    expression();
    if (position !== tokens.length) throw new Error(`公式末尾存在无效内容 ${tokens[position]}`);
    return { recognized: true, source: formula, kind: "formula", unverifiedKeys: [...unverified] };
  } catch (error) {
    return { recognized: false, reason: error instanceof Error ? error.message : "无法识别公式" };
  }
}

export function imageColumnSourceKeys(source: string): string[] {
  const trimmed = source.trim();
  if (!trimmed) return [];
  if (isAeGainPairSource(trimmed)) return ["FLinkTar_old", "BackTar_old", "FLinkTar_new", "BackTar_new"];
  if (!trimmed.startsWith("=")) return [trimmed];
  try {
    const composite = parseCompositeSource(trimmed);
    if (composite) return [...new Set(compositeKeys(composite))];
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
    const composite = parseCompositeSource(trimmed);
    if (composite) return compositeText(composite, lookup);
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
