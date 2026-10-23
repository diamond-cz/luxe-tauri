export function isDebugParserExecutable(path: string): boolean {
  return /\.exe$/i.test(path);
}
