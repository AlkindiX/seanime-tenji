@AGENTS.md

## Claude Code notes

- Prefer `Grep`/`Glob` with the paths in the "Find it fast" table over broad searches;
  `src/api/generated/*` is huge, grep it by name rather than reading it.
- For webOS checks in the browser pane, build, then `preview_start` a `.claude/launch.json`
  entry running `node webos/serve.mjs 8090` (local only; create it if missing).
- Long builds (`npm run build:webos`) can run in the background.
