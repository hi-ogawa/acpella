import fs from "node:fs";
import path from "node:path";
import { addIndent, formatTime } from "../utils/index.ts";

const INCLUDE_LINE_RE = /^[^\S\r\n]*@(\S+)[^\S\r\n]*$/gm;
const ACP_DIRECTIVE_LINE_RE = /^[^\S\r\n]*::acpella\s+(\S+)(?:\s+(.+?))?[^\S\r\n]*$/gm;

export function buildFirstPrompt(file: string): string {
  let output = "";
  const customPrompt = readOptionalPromptFile(file);
  if (customPrompt) {
    output += `\
Use these additional instructions for this session:

<custom_instructions>
${customPrompt.trim()}
</custom_instructions>
`;
  }
  return output;
}

export interface MessageMetadata {
  timestamp: number;
  [key: string]: unknown;
}

export function buildMessageMetadataPrompt(
  metadata: MessageMetadata,
  context: { timezone: string; sessionName: string },
): string {
  const { timestamp, ...rest } = metadata;
  const extra = Object.entries(rest)
    .map((kv) => kv.join(": "))
    .join("\n");
  return `\
<message_metadata>
sender_timestamp: ${formatTime(timestamp, context.timezone)}
timezone: ${context.timezone}
session_name: ${context.sessionName}
${extra}
</message_metadata>
`;
}

function readOptionalPromptFile(file: string): string | undefined {
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
    const frontmatter = addIndent({
      indent: "    ",
      text: readFrontmatter(content) ?? "(none)",
    });
    output += `
- Skill directory: ${path.basename(path.dirname(filePath))}
  File: ${filePath}
  Frontmatter:
${frontmatter}
`;
  }
  return output.trim() + "\n";
}

const FRONTMATTER_RE = /^---(?:\r?\n[\s\S]*?\r?\n)---(?=\r?\n|$)/;

function readFrontmatter(content: string) {
  return content.match(FRONTMATTER_RE)?.[0];
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
