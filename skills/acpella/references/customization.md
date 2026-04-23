# Customization

Use this reference for changing how acpella behaves for a particular home or deployment.

## `.acpella/AGENTS.md`

If `ACPELLA_HOME/.acpella/AGENTS.md` exists, acpella sends its contents as custom instructions when creating a new session.

What this is good for:

- defining assistant identity or role for that home
- adding local workflow rules
- listing local skills or private context files
- layering deployment-specific guidance without changing repo files

## When changes take effect

Prompt changes apply to new sessions, not old ones. If you update `.acpella/AGENTS.md`, start a fresh session with:

```bash
/session new
```

## Include lines

Whole-line include syntax is supported:

```text
@relative/or/absolute/path
```

Use includes to keep the top-level prompt small and split reusable prompt fragments into separate files.

## `::acpella` directives

Whole-line directives are also supported:

```text
::acpella <command> [args...]
```

The current built-in directive is:

```text
::acpella skills <dir>
```

This expands to a shallow catalog of skill directories, file paths, and frontmatter. It is useful when you want the prompt to expose available skills without copying their full contents into the always-loaded prompt.

## Good customization pattern

Keep the top-level prompt lean:

- keep durable high-level guidance in `.acpella/AGENTS.md`
- use `@...` includes for reusable prompt fragments
- use `::acpella skills <dir>` for generated skill catalogs
- keep deeper workflow content inside skill files rather than duplicating it in the top-level prompt

## When to read deeper docs

- For first-time local setup, continue with `bootstrap.md`.
- For session reset after prompt changes, continue with `sessions-and-agents.md`.
- If prompt expansion or directives are not behaving as expected, continue with `troubleshooting.md`.
