# Prompt And Skills

Use this reference for acpella's prompt-composition features and how `.acpella/AGENTS.md` participates in prompt assembly.

## First prompt assembly

When a new ACP session is created, acpella reads the conventional prompt file and, if it exists, wraps it as:

```text
Use these additional instructions for this session:

<custom_instructions>
...
</custom_instructions>
```

Primary source:

- `src/lib/prompt.ts`

The conventional file path comes from `src/config.ts`:

- `.acpella/AGENTS.md`

## Include lines

acpella supports whole-line include expansion with:

```text
@relative/or/absolute/path
```

Semantics from `src/lib/prompt.ts` and `src/lib/prompt.test.ts`:

- only whole lines are expanded
- inline `@...` text stays literal
- relative paths resolve from the including file
- includes recurse
- circular include expansion fails for that line and leaves the original line literal
- missing top-level prompt file returns no custom instructions at all

## `::acpella` directives

acpella also supports whole-line directives:

```text
::acpella <command> [args...]
```

Current built-in behavior:

- `::acpella skills <dir>`

Current semantics:

- only whole lines are expanded
- unknown directives stay literal
- directive expansion failures stay literal

Primary anchors:

- `src/lib/prompt.ts`
- `src/lib/prompt.test.ts`

## Skills catalog directive

`::acpella skills <dir>` scans `*/SKILL.md` under the target directory and emits a shallow catalog:

- skill directory name
- absolute file path
- frontmatter block

The intent is to stay close to Codex's skill-listing style: metadata and path only, not full skill bodies.

## Message metadata

Message metadata is a separate prompt feature from custom instructions. When available, acpella prepends:

```text
<message_metadata>
sender_timestamp: ...
timezone: ...
session_name: ...
</message_metadata>
```

Primary source:

- `src/lib/prompt.ts`

## Authoring guidance

Use these prompt features to keep always-loaded instructions lean:

- keep durable top-level guidance in `.acpella/AGENTS.md`
- use `@...` lines for reusable prompt fragments
- use `::acpella skills <dir>` when a skills catalog should be generated from actual files instead of hand-maintained text
- keep detailed workflow content in skill files and their references, not duplicated into the top-level prompt
