import type { FieldEntry } from "@/types/cpp_parser";

const CPP_NUMBER = /^[-+]?(?:0[xX][\da-fA-F]+|0[bB][01]+|\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?[uUlLfF]*$/;
const CPP_TOKENS = /\/\/[^\n]*|\/\*[\s\S]*?\*\/|"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|(?<![\w.])[-+]?(?:0[xX][\da-fA-F]+|0[bB][01]+|\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?[uUlLfF]*(?![\w.])/g;

interface SourceToken { value: string; start: number; end: number }
interface SourceLine { text: string; offset: number; tokens: SourceToken[]; structure: string }
const sourceLineCache = new Map<string, SourceLine[]>();

export function isParaCheckNumber(value: string): boolean {
  if (!CPP_NUMBER.test(value)) return false;
  const literal = value.replace(/[uUlL]+$/, "");
  return /^[-+]?0[xX][\da-fA-F]+$/.test(literal)
    || /^[-+]?0[bB][01]+$/.test(literal)
    || Number.isFinite(Number(literal.replace(/[fF]$/, "")));
}

function sourceLines(text: string): SourceLine[] {
  const cached = sourceLineCache.get(text);
  if (cached) return cached;
  let offset = 0;
  const lines = text.split("\n").map((line): SourceLine => {
    const result = { text: line, offset, tokens: [], structure: "" };
    offset += line.length + 1;
    return result;
  });
  let lineIndex = 0;
  for (const match of text.matchAll(CPP_TOKENS)) {
    if (!CPP_NUMBER.test(match[0])) continue;
    while (lineIndex + 1 < lines.length && lines[lineIndex + 1].offset <= match.index!) lineIndex++;
    const start = match.index! - lines[lineIndex].offset;
    lines[lineIndex].tokens.push({ value: match[0], start, end: start + match[0].length });
  }
  for (const line of lines) {
    let position = 0;
    line.structure = line.tokens.map((token) => {
      const prefix = line.text.slice(position, token.start);
      position = token.end;
      return `${prefix}\u0000`;
    }).join("") + line.text.slice(position);
  }
  if (sourceLineCache.size >= 3) sourceLineCache.delete(sourceLineCache.keys().next().value!);
  sourceLineCache.set(text, lines);
  return lines;
}

/** Match the parser's byte range first; then follow that token through numeric edits. */
export function locateParaCheckField(snapshot: string, current: string, field: FieldEntry) {
  const original = sourceLines(snapshot)[field.line - 1];
  const line = sourceLines(current)[field.line - 1];
  if (!original || !line || original.structure !== line.structure) return null;
  const encoder = new TextEncoder();
  const ordinal = original.tokens.findIndex((token) =>
    encoder.encode(original.text.slice(0, token.start)).length === field.column_start
    && encoder.encode(original.text.slice(0, token.end)).length === field.column_end,
  );
  const token = line.tokens[ordinal];
  if (!token) return null;
  return {
    value: token.value,
    start: line.offset + token.start,
    end: line.offset + token.end,
    selection: {
      line: field.line,
      value: token.value,
      ordinal,
      columnStart: encoder.encode(line.text.slice(0, token.start)).length,
      columnEnd: encoder.encode(line.text.slice(0, token.end)).length,
    },
  };
}

export function replaceParaCheckField(snapshot: string, current: string, field: FieldEntry, value: string): string | null {
  if (!isParaCheckNumber(value)) return null;
  const target = locateParaCheckField(snapshot, current, field);
  return target ? current.slice(0, target.start) + value + current.slice(target.end) : null;
}
