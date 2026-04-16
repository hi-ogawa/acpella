import fs from "node:fs";
import path from "node:path";

const INCLUDE_LINE_RE = /^[^\S\r\n]*@(\S+)[^\S\r\n]*$/gm;

export interface MessageMetadata {
  receivedAt: string;
  timezone: string;
  sessionName: string;
}

export function buildFirstPrompt(options: { promptFile: string; text: string }): string {
  let output = "";
  const customPrompt = readOptionalPromptFile(options.promptFile);
  if (customPrompt) {
    output += `\
Use these additional instructions for this session:

<custom_instructions>
${customPrompt.trim()}
</custom_instructions>

`;
  }
  output += options.text;
  return output;
}

export function buildMessagePrompt(options: {
  text: string;
  messageMetadata: MessageMetadata | undefined;
}): string {
  if (!options.messageMetadata) {
    return options.text;
  }
  return `\
<message_metadata>
received_at: ${options.messageMetadata.receivedAt}
timezone: ${options.messageMetadata.timezone}
session_name: ${options.messageMetadata.sessionName}
</message_metadata>

${options.text}`;
}

export function readOptionalPromptFile(file: string): string | undefined {
  try {
    return readPromptFileWithIncludes(file, new Set());
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT" && error.path === file) {
      return;
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
