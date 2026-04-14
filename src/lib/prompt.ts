import fs from "node:fs";
import path from "node:path";

const INCLUDE_LINE_RE = /^[^\S\r\n]*@(\S+)[^\S\r\n]*$/gm;

export function readOptionalPromptFile(file: string): string | undefined {
  try {
    return readPromptFileWithIncludes(file, new Set());
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT" && error.path === file) {
      return undefined;
    }
    throw error;
  }
}

function readPromptFileWithIncludes(file: string, seen: Set<string>): string {
  if (seen.has(file)) {
    throw new Error(`Circular prompt include: ${file}`);
  }

  seen.add(file);
  try {
    const text = fs.readFileSync(file, "utf8");
    return text.replace(INCLUDE_LINE_RE, (line, includePath: string) => {
      const target = path.isAbsolute(includePath)
        ? includePath
        : path.resolve(path.dirname(file), includePath);
      try {
        return readPromptFileWithIncludes(target, seen).trimEnd();
      } catch {
        return line;
      }
    });
  } finally {
    seen.delete(file);
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
