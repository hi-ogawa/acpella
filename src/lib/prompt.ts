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
    .flatMap((entry) =>
      readSkillCatalogEntry({
        directory: entry.name,
        file: path.join(skillsDir, entry.name, "SKILL.md"),
      }),
    );

  skills.sort((a, b) => a.directory.localeCompare(b.directory));

  // Keep this catalog close to Codex's skill listing: metadata and file path only.
  let output = "";
  for (const skill of skills) {
    output += `${output ? "\n\n" : ""}- Skill directory: ${skill.directory}
  File: ${skill.file}
  Frontmatter:
${indentBlock(skill.frontmatter ?? "(none)", "    ")}`;
  }
  return output ? `${output}\n` : "";
}

function readSkillCatalogEntry(options: {
  directory: string;
  file: string;
}): { directory: string; file: string; frontmatter?: string }[] {
  let text: string;
  try {
    text = fs.readFileSync(options.file, "utf8");
  } catch {
    return [];
  }

  return [
    {
      directory: options.directory,
      file: options.file,
      frontmatter: readFrontmatter(text),
    },
  ];
}

function readFrontmatter(text: string): string | undefined {
  const match = /^---(?:\r?\n[\s\S]*?\r?\n)---(?=\r?\n|$)/.exec(text);
  if (!match) {
    return;
  }
  return match[0];
}

function indentBlock(text: string, indent: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => `${indent}${line}`)
    .join("\n");
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
