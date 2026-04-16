import fs from "node:fs";
import path from "node:path";

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
    const included = text.replace(INCLUDE_LINE_RE, (line, includePath: string) => {
      const target = path.isAbsolute(includePath)
        ? includePath
        : path.resolve(path.dirname(file), includePath);
      try {
        return readPromptFileWithIncludes(target, seen).trimEnd();
      } catch {
        return line;
      }
    });
    return included.replace(ACP_DIRECTIVE_LINE_RE, (line, command: string, args?: string) => {
      return expandAcpellaDirective({ line, command, args, file });
    });
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

  const skillsDir = path.isAbsolute(options.args)
    ? options.args
    : path.resolve(path.dirname(options.file), options.args);
  try {
    return buildSkillsCatalog(skillsDir);
  } catch {
    return options.line;
  }
}

function buildSkillsCatalog(skillsDir: string): string {
  const skills = fs
    .readdirSync(skillsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => readSkillMetadata(path.join(skillsDir, entry.name, "SKILL.md")));

  skills.sort((a, b) => a.name.localeCompare(b.name));

  let output = `\
### Available Skills

When a task matches one of these skills, read the listed SKILL.md before acting.`;
  for (const skill of skills) {
    output += `

- ${skill.name}
  Description: ${skill.description}
  File: ${skill.file}`;
  }
  return `${output}\n`;
}

function readSkillMetadata(file: string): { name: string; description: string; file: string }[] {
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return [];
  }

  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
  if (!frontmatter) {
    return [];
  }
  const metadata = parseFrontmatter(frontmatter[1]);
  if (!metadata.name || !metadata.description) {
    return [];
  }
  return [{ name: metadata.name, description: metadata.description, file }];
}

function parseFrontmatter(text: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const separator = trimmed.indexOf(":");
    if (separator === -1) {
      continue;
    }
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim();
    result[key] = unquoteYamlScalar(value);
  }
  return result;
}

function unquoteYamlScalar(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
