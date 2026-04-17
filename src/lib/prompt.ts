import fs from "node:fs";
import path from "node:path";
import { Temporal } from "temporal-polyfill";

const INCLUDE_LINE_RE = /^[^\S\r\n]*@(\S+)[^\S\r\n]*$/gm;
const ACP_DIRECTIVE_LINE_RE = /^[^\S\r\n]*::acpella\s+(\S+)(?:\s+(.+?))?[^\S\r\n]*$/gm;

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

export interface MessageMetadata {
  timestamp: number;
  timezone: string;
  sessionName: string;
}

export function buildMessagePrompt(options: { text: string; metadata: MessageMetadata }): string {
  const receivedAt = Temporal.Instant.fromEpochMilliseconds(options.metadata.timestamp)
    .toZonedDateTimeISO(options.metadata.timezone)
    .toString({
      calendarName: "never",
      fractionalSecondDigits: 0,
      smallestUnit: "second",
      timeZoneName: "never",
    });
  return `\
<message_metadata>
received_at: ${receivedAt}
timezone: ${options.metadata.timezone}
session_name: ${options.metadata.sessionName}
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
    let text = fs.readFileSync(file, "utf8");
    text = text.replace(INCLUDE_LINE_RE, (line, includePath: string) => {
      const target = path.isAbsolute(includePath)
        ? includePath
        : path.resolve(path.dirname(file), includePath);
      try {
        return readPromptFileWithIncludes(target, seen).trimEnd();
      } catch {
        return line;
      }
    });
    text = text.replace(ACP_DIRECTIVE_LINE_RE, (line, command: string, args?: string) => {
      try {
        return expandAcpellaDirective({ line, command, args, file });
      } catch {
        return line;
      }
    });
    return text;
  } finally {
    seen.delete(file);
  }
}

function expandAcpellaDirective(options: {
  line: string;
  command: string;
  args: string | undefined;
  file: string;
}): string {
  if (options.command !== "skills" || !options.args) {
    return options.line;
  }

  const skillsDir = path.resolve(path.dirname(options.file), options.args);
  return buildSkillsCatalog(skillsDir);
}

function buildSkillsCatalog(skillsDir: string): string {
  const skillsDirStat = fs.statSync(skillsDir);
  if (!skillsDirStat.isDirectory()) {
    throw new Error(`Skills path is not a directory: ${skillsDir}`);
  }

  const files = fs.globSync("*/SKILL.md", { cwd: skillsDir });
  files.sort();

  // Keep this catalog close to Codex's skill listing: metadata and file path only.
  let output = "";
  for (const file of files) {
    const filePath = path.resolve(skillsDir, file);
    let content: string;
    try {
      content = fs.readFileSync(filePath, "utf8");
    } catch {
      continue;
    }
    output += `
- Skill directory: ${path.basename(path.dirname(filePath))}
  File: ${filePath}
  Frontmatter:
${addIndent(readFrontmatter(content) ?? "(none)", "    ")}
`;
  }
  return output.trim() + "\n";
}

const FRONTMATTER_RE = /^---(?:\r?\n[\s\S]*?\r?\n)---(?=\r?\n|$)/;

function readFrontmatter(content: string) {
  return content.match(FRONTMATTER_RE)?.[0];
}

function addIndent(text: string, indent: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => `${indent}${line}`)
    .join("\n");
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
