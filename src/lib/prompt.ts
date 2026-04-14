import fs from "node:fs";
import path from "node:path";

const INCLUDE_LINE_RE = /^[^\S\r\n]*@(\S+)[^\S\r\n]*$/gm;

export function readOptionalPromptFile(file: string): string | undefined {
  const resolved = path.resolve(file);
  try {
    return readPromptFileWithIncludes(resolved, new Set());
  } catch (error) {
    if (
      isNodeError(error) &&
      error.code === "ENOENT" &&
      path.resolve(String(error.path)) === resolved
    ) {
      return undefined;
    }
    throw error;
  }
}

function readPromptFileWithIncludes(file: string, seen: Set<string>): string {
  const resolved = path.resolve(file);
  if (seen.has(resolved)) {
    throw new Error(`Circular prompt include: ${resolved}`);
  }

  seen.add(resolved);
  try {
    const text = fs.readFileSync(resolved, "utf8");
    return text.replace(INCLUDE_LINE_RE, (_line, includePath: string) => {
      const target = path.isAbsolute(includePath)
        ? includePath
        : path.resolve(path.dirname(resolved), includePath);
      return readPromptFileWithIncludes(target, seen).trimEnd();
    });
  } finally {
    seen.delete(resolved);
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
