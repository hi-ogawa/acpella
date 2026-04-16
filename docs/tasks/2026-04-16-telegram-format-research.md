# Telegram Format Research

## Problem context and approach

`src/lib/telegram-format.ts` currently converts a conservative Markdown subset into Telegram MarkdownV2, then `src/cli.ts` sends it with `parse_mode: "MarkdownV2"` and falls back to raw plain text if Telegram rejects the formatted payload.

Before polishing that formatter, we inspected the local reference projects under `refs` for how Telegram bots commonly handle outbound Markdown-like agent text. The useful references fall into two main strategies:

- Convert Markdown into Telegram message entities and send `entities` instead of a parse-mode string.
- Convert Markdown into Telegram-supported HTML and send `parse_mode: "HTML"` with a plain-text fallback.

## Reference files/patterns to follow

- Official Telegram Bot API: `https://core.telegram.org/bots/api#formatting-options`
  - Primary upstream source for Telegram message formatting.
  - Documents that bot messages can be formatted by direct text entities, Markdown-style parse modes, or HTML-style parse mode.
  - Documents `MarkdownV2`, `HTML`, and legacy `Markdown` as distinct parse modes.
  - `MarkdownV2` supports the richest Telegram formatting surface, but requires context-specific escaping:
    - in normal text, ``_ * [ ] ( ) ~ ` > # + - = | { } . !`` must be escaped
    - inside `pre` and `code`, backticks and backslashes must be escaped
    - inside inline-link destinations, `)` and backslash must be escaped
  - `HTML` supports only Telegram-listed tags and requires raw `<`, `>`, and `&` text to be HTML-escaped.
  - Legacy `Markdown` is retained for backward compatibility, does not allow nested entities, and cannot represent underline, strikethrough, spoiler, blockquote, custom emoji, or date-time entities.

- Official Telegram Bot API: `https://core.telegram.org/bots/api#sendmessage`
  - `sendMessage.text` is limited to 1-4096 characters after entity parsing.
  - `sendMessage.entities` can be supplied instead of `parse_mode`, which is the upstream basis for the entity-based reference approach.

- Official Telegram Bot API: `https://core.telegram.org/bots/api#messageentity`
  - Defines supported entity types and confirms entity offsets and lengths are measured in UTF-16 code units.
  - This matters for entity-based chunking and for avoiding split points that invalidate entity offsets.

- `refs/telegram-acp-bot/src/telegram_acp_bot/telegram/bridge.py`
  - Uses `telegramify_markdown.convert(text)` to convert Markdown into rendered text plus entity offsets.
  - Uses `split_entities(..., max_utf16_len=TELEGRAM_MAX_UTF16_MESSAGE_LENGTH)` before sending.
  - Sends with `entities=...` when entities exist, omitting `parse_mode`.
  - Falls back to plain text if conversion fails or if Telegram rejects entity-based delivery.
  - Editing uses the same rendered chunk flow and refuses markdown edits when content spans more than one Telegram chunk.

- `refs/telegram-acp-bot/tests/telegram/test_messages.py`
  - Covers entity-based sends, no-entity sends, converter failures, Telegram entity send failures, and plain-text fallbacks.
  - Keeps assertions explicit that `parse_mode` is absent in entity-mode sends.

- `refs/openclaw/extensions/telegram/src/format.ts`
  - Parses Markdown through shared `markdownToIR`, then renders Telegram-safe HTML.
  - Maps Markdown styles to Telegram HTML tags: `<b>`, `<i>`, `<s>`, `<code>`, `<pre><code>`, `<tg-spoiler>`, and `<blockquote>`.
  - Escapes raw HTML text and attribute values.
  - Suppresses spurious auto-link previews for file-like references by wrapping supported file paths in `<code>`.
  - Provides HTML chunking that avoids splitting inside HTML entities and keeps open tags balanced across chunks.

- `refs/openclaw/extensions/telegram/src/send.ts`
  - Sends formatted text with `parse_mode: "HTML"`.
  - Detects Telegram HTML parse errors and retries the same logical message as plain text.
  - Keeps send parameters, thread params, silent mode, and link-preview settings across the formatted send and plain-text retry.
  - If HTML chunk planning fails, or if plain-text fallback would require more chunks than formatted HTML, it sends plain text directly.

- `refs/openclaw/extensions/telegram/src/format.test.ts`
  - Covers core Markdown conversions, raw HTML escaping, links, lists, headings flattened to text, fenced code blocks, nested links and bold, spoiler tags, blockquotes, and chunking edge cases.

- `refs/openclaw/extensions/telegram/src/format.wrap-md.test.ts`
  - Covers file-reference wrapping and avoiding double-wrapping inside `<code>`, `<pre>`, and `<a>`.
  - Includes chunking tests for rendered HTML length limits and word-boundary preservation.

- `refs/openclaw/extensions/telegram/src/outbound-adapter.ts`
  - Uses `markdownToTelegramHtmlChunks` as the outbound chunker and sends those chunks with `textMode: "html"`.
  - Keeps the Telegram text chunk limit at 4000, slightly below the Telegram 4096 message limit.

- `refs/grammy`
  - Provides Telegram API wrappers and types, but does not solve Markdown conversion itself in the local ref.
  - The relevant takeaway for `acpella` is that grammY accepts `parse_mode` or explicit `entities`; formatting correctness remains the application layer's responsibility.

## Findings

MarkdownV2 escaping is the most brittle option. Telegram MarkdownV2 has a large set of context-sensitive reserved characters, and a hand-rolled scanner must handle plain text, inline code, fenced code, links, nested/overlapping formatting, malformed markup, and message-length expansion after escaping. `acpella` already has a raw-text split budget of 3900, but MarkdownV2 escaping can expand a chunk beyond Telegram's 4096-character limit when the chunk contains many escapable characters.

The entity-based approach is robust because Telegram receives offsets instead of reparsing Markdown syntax. It avoids MarkdownV2 escaping pitfalls and handles UTF-16 limits explicitly through entity-aware chunking. The downside is dependency availability: the local Python reference uses `telegramify_markdown`, while `acpella` is TypeScript and currently has only `grammy` plus no Markdown parser dependency.

The HTML approach is the strongest TypeScript-shaped reference. OpenClaw does not emit Telegram MarkdownV2; it parses Markdown into an intermediate representation, renders the small Telegram HTML subset, chunks rendered HTML safely, and retries as plain text on Telegram parse failures. This is easier to reason about than MarkdownV2 because raw text escaping is ordinary HTML escaping, and style markers map to tags instead of punctuation with backslash rules.

The common reliability pattern across both strong references is not "make parsing perfect." It is:

- use a real Markdown parser or structured intermediate representation when possible
- keep formatting output limited to Telegram's supported subset
- chunk after rendering or with entity offsets, not only before rendering
- preserve a plain-text fallback path for parse/entity failures
- test malformed Markdown and Telegram-specific boundary cases explicitly

## Parser package comparison

The current preferred direction is a Markdown parser plus a minimal Telegram-compatible HTML renderer. The important distinction is that `acpella` should not parse Markdown into generic HTML and then try to sanitize arbitrary HTML. It should parse Markdown into structured tokens or an AST, then render only Telegram-supported tags itself.

### `mdast-util-from-markdown`

- Package: `mdast-util-from-markdown`
- Current npm version checked: `2.0.3`
- License: MIT
- Types: built in
- Shape: CommonMark Markdown to mdast syntax tree
- Main dependencies include `micromark` plus mdast/unist utilities

Pros:

- Best fit for an allowlist renderer because it returns a tree rather than generic HTML.
- Lets `acpella` implement "sanitize by construction": raw Markdown HTML can be escaped or dropped, while only locally generated Telegram tags are emitted.
- TypeScript-friendly with built-in types and `@types/mdast` support.
- Avoids bringing in the full unified processor if we only need parsing.
- Makes custom handling for headings, lists, blockquotes, code, and links straightforward.

Cons:

- More renderer code than a generic Markdown-to-HTML package because `acpella` owns every node rendering rule.
- CommonMark only by default; GFM features such as strikethrough, tables, task lists, and autolink literals require deliberate extensions later.
- The dependency tree is larger than a tiny regex formatter, because it pulls in micromark internals.

Recommendation:

- Best first choice.
- Add `mdast-util-from-markdown` and `@types/mdast`.
- Render a small Telegram HTML subset from mdast:
  - `text` -> escaped text
  - `strong` -> `<b>`
  - `emphasis` -> `<i>`
  - `inlineCode` -> `<code>`
  - `code` -> `<pre><code>`
  - `link` -> `<a href="...">` only for safe URL schemes, otherwise plain label
  - `heading` -> plain text or bold text, not `<h1>`
  - `list` -> plain bullet/numbered text, not `<ul>`/`<ol>`/`<li>`
  - `blockquote` -> `<blockquote>` if clean, otherwise plain `> ` text
  - `html` -> escaped literal text or dropped
  - unknown nodes -> render children or flatten to text

### `markdown-it`

- Package: `markdown-it`
- Current npm version checked: `14.1.1`
- License: MIT
- Types: via `@types/markdown-it` (`14.1.2`)
- Shape: Markdown parser with token stream and configurable HTML renderer

Pros:

- Mature, popular, pragmatic parser.
- Configurable, including `html: false` to avoid raw HTML passthrough.
- Renderer rules can be overridden.
- Link validation is an established part of the package.
- Supports a practical Markdown feature set out of the box.

Cons:

- Natural output is generic HTML, which includes tags Telegram does not support such as paragraphs, lists, and headings.
- To stay Telegram-compatible, `acpella` would need to override renderer rules heavily or walk tokens directly.
- Less clean than mdast for "parse to structure, emit our own tiny target format."

Recommendation:

- Good fallback choice if we want the most common package and token-level rendering is acceptable.
- Do not use default HTML output directly.
- Configure `html: false` and render Telegram tags from tokens or custom renderer rules.

### `remark-parse` / `unified`

- Packages: `unified`, `remark-parse`
- Current npm versions checked: `unified@11.0.5`, `remark-parse@11.0.0`
- License: MIT
- Types: built in
- Shape: plugin-based Markdown processor producing mdast

Pros:

- Strong ecosystem if future processing grows: GFM, transforms, linting, plugins.
- Produces mdast, which fits the allowlist renderer direction.
- Standard choice for serious Markdown pipelines.

Cons:

- Heavier abstraction than needed for a small Telegram formatter.
- More moving pieces than direct `mdast-util-from-markdown`.
- Plugin pipeline is useful later, but likely unnecessary for this first change.

Recommendation:

- Defer unless we expect the formatter to become a broader Markdown processing pipeline.
- Prefer `mdast-util-from-markdown` now for the same AST shape with less framework.

### `marked`

- Package: `marked`
- Current npm version checked: `18.0.0`
- License: MIT
- Types: built in
- Shape: fast Markdown-to-HTML parser/renderer

Pros:

- Popular and fast.
- Built-in TypeScript types.
- Custom renderer hooks are available.

Cons:

- Its own documentation warns that it does not sanitize output HTML.
- Natural output is generic HTML, not Telegram-compatible HTML.
- If we replace most rendering with custom hooks for safety, it has less advantage over mdast or markdown-it.

Recommendation:

- Avoid for this task.
- It is a good generic Markdown-to-HTML tool, but the goal here is a constrained Telegram renderer with no raw HTML passthrough.

### `micromark`

- Package: `micromark`
- Current npm version checked: `4.0.2`
- License: MIT
- Types: built in
- Shape: low-level CommonMark parser/compiler used by unified/mdast tooling

Pros:

- High-quality CommonMark foundation.
- Built-in types.
- Lower-level control if we ever need it.

Cons:

- Direct use is lower-level than needed.
- Usually better consumed through `mdast-util-from-markdown` when an AST is desired.
- Would make the Telegram renderer more complex than necessary.

Recommendation:

- Do not use directly.
- Use it indirectly through `mdast-util-from-markdown`.

## Parser decision

Use `mdast-util-from-markdown` for the first implementation.

Rationale:

- It gives us structured Markdown without trusting generated HTML.
- It lets the Telegram renderer be a small allowlist.
- It avoids MarkdownV2 escaping and generic HTML sanitization.
- It is a cleaner fit than `markdown-it` or `marked` when the output target is Telegram's HTML subset.
- It keeps room to add GFM extensions later only if actual Telegram output needs them.

Initial package additions:

```sh
pnpm add mdast-util-from-markdown
pnpm add -D @types/mdast
```

Do not add a sanitizer package in the first pass. Safety should come from escaping all text/attributes and emitting only locally generated Telegram-supported tags. If raw Markdown HTML nodes are encountered, render them as escaped text or drop them.

## OpenClaw architecture note

OpenClaw's `refs/openclaw/extensions/telegram/src/format.ts` looks cleaner because the Telegram formatter is not responsible for most Markdown semantics. It renders a shared Markdown intermediate representation rather than walking a Markdown AST directly.

The shared IR is defined in `refs/openclaw/src/markdown/ir.ts` as:

- `text`: the plain rendered text
- `styles`: style spans over that text
- `links`: link spans over that text

That means Telegram-specific code can mostly configure marker pairs:

- `bold` -> `<b>...</b>`
- `italic` -> `<i>...</i>`
- `strikethrough` -> `<s>...</s>`
- `code` -> `<code>...</code>`
- `code_block` -> `<pre><code>...</code></pre>`
- `spoiler` -> `<tg-spoiler>...</tg-spoiler>`
- `blockquote` -> `<blockquote>...</blockquote>`

The complexity is pushed into shared markdown modules:

- `refs/openclaw/src/markdown/ir.ts`
  - Parses with `markdown-it`.
  - Disables raw HTML.
  - Handles parser/token semantics for lists, headings, blockquotes, code, links, spoilers, and optional tables.
  - Produces normalized text plus style/link spans.
  - Clamps and merges spans after trimming.

- `refs/openclaw/src/markdown/render.ts`
  - Implements `renderMarkdownWithMarkers`.
  - Sorts style/link boundaries.
  - Opens and closes markers through a single stack, so nested links and styles render in valid order.
  - Escapes text slices through a caller-provided escape function.

- `refs/openclaw/src/markdown/render-aware-chunking.ts`
  - Chunks source IR.
  - Renders candidate chunks and measures rendered length.
  - Retries smaller source slices when escaping, links, or tag overhead cause rendered output to exceed a target limit.
  - Handles non-monotonic rendered lengths from escaping and file-reference rewriting.

OpenClaw's Telegram formatter still owns Telegram-specific policy:

- HTML escaping
- Telegram marker mapping
- link filtering and href escaping
- file-reference wrapping to avoid bogus Telegram previews
- already-rendered HTML chunk splitting

Implication for `acpella`: the new standalone `src/lib/telegram-format-html.ts` intentionally combines parse, flattening, and Telegram rendering in one small file for iteration. If it grows beyond a narrow Telegram-only utility, the OpenClaw-like split would be:

1. Markdown parser -> internal `{ text, styles, links }` representation
2. generic marker renderer -> Telegram HTML markers
3. render-aware chunker -> Telegram length-safe chunks

Do not adopt that architecture prematurely. It pays off when formatting is shared across channels or when chunking/nesting bugs become hard to reason about in the direct AST renderer.

## Implementation implications for `src/lib/telegram-format.ts`

If we keep the current MarkdownV2 path, polishing should stay conservative:

- Treat the formatter as "safe subset MarkdownV2", not a full Markdown renderer.
- Add tests for underscores in normal words, literal parentheses, unmatched backticks, nested bold/link syntax, links whose URLs contain `)`, escaped source Markdown, fenced code with backticks, and chunks that grow after escaping.
- Consider exposing a plain-text escape function separately from Markdown-subset rendering.
- Avoid adding broad Markdown features unless the parser becomes structured; regex and `indexOf` scanning will become fragile quickly.

If we are willing to change the outbound format, the local refs point toward Telegram HTML:

- Replace `toTelegramMarkdownV2` with a Markdown-to-Telegram-HTML renderer.
- Send via `parse_mode: "HTML"` in `src/cli.ts`.
- Escape text with HTML escaping and render only Telegram-supported tags.
- Keep the existing raw fallback, but make it a named plain-text fallback path.
- Add rendered-length-aware chunking before `ctx.reply`, or lower `MESSAGE_SPLIT_BUDGET` only as a temporary mitigation.

The entity-based approach is best if a suitable TypeScript Markdown-to-Telegram-entities library is adopted, but no local TypeScript reference in `refs` shows that dependency or implementation. Without that dependency, HTML is the more practical ref-backed direction.

Chosen direction after comparison: switch to Markdown parser -> Telegram-safe HTML, using `mdast-util-from-markdown`, while preserving raw plain-text fallback on Telegram parse failure.

## Implementation plan

1. Add `mdast-util-from-markdown` and `@types/mdast`.
2. Replace `toTelegramMarkdownV2` with a Telegram HTML formatter, likely `toTelegramHtml`.
3. Render only Telegram-supported tags and escape all text/attributes.
4. Treat raw Markdown HTML nodes as escaped text or drop them.
5. Update `src/cli.ts` to send with `parse_mode: "HTML"`.
6. Keep raw fallback on Telegram parse failure.
7. Add tests for:
   - plain text escaping for `&`, `<`, `>`
   - bold, italic, inline code, fenced code, links, headings, lists, blockquotes
   - unsafe links flattened to text
   - raw Markdown HTML escaped or dropped
   - malformed Markdown remains readable
   - rendered output growth and chunking boundaries
8. Move chunking to happen after rendering, or make reply delivery aware of rendered chunks.
