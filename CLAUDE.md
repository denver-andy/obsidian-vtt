# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

An Obsidian community plugin (TypeScript → bundled CJS `main.js`). The plugin runs inside Obsidian's renderer process. Release artifacts are `main.js`, `manifest.json`, `styles.css`, and the `assets/` folder.

## Commands

```bash
npm install          # install deps
npm run dev          # watch mode (esbuild, inline sourcemaps)
npm run build        # type-check + production bundle (minified, no sourcemaps)
npm run lint         # eslint ./src/
```

There are no automated tests — testing is manual (see below).

## Explicit Prohibitions

- **NEVER run `git commit` or `git push`** under any circumstances.
- **ALWAYS wait for explicit user approval** before executing any irreversible terminal commands.

## Avoid Premature Optimization

Write clear, correct code first. Optim ize only when you have evidence of a performance problem. Code that works correctly but slowly is better than fast code that's wrong or unmaintainable. In addition, readability matters -- optimized code is often harder to understand and maintain.

## Architecture

```
src/
  main.ts       # Plugin entry point — lifecycle only (onload/onunload, addCommand calls)
  settings.ts   # Settings interface, defaults, and SettingTab
```

`main.ts` is intentionally minimal. All feature logic must live in separate modules. When a file exceeds ~200–300 lines, split it.

esbuild bundles everything from `src/main.ts` → `main.js` at the repo root. `obsidian`, `electron`, and all `@codemirror/*`/`@lezer/*` packages are marked external (provided by Obsidian at runtime). Node built-ins are also external, so avoid them if you want mobile compatibility.

## Key conventions

**Plugin lifecycle** — use `this.register*` helpers for all cleanup:
```ts
this.registerEvent(this.app.workspace.on("file-open", f => { ... }));
this.registerDomEvent(window, "resize", () => { ... });
this.registerInterval(window.setInterval(() => { ... }, 1000));
```

**Settings** — persist via `this.loadData()` / `this.saveData()`. Always merge with defaults:
```ts
this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
```

**Commands** — use stable IDs; never rename after release:
```ts
this.addCommand({ id: "your-command-id", name: "Do the thing", callback: () => ... });
```

**Manifest** — `id` is permanent (matches vault folder name). Bump `version` (SemVer, no `v` prefix) and update `versions.json` together. Keep `minAppVersion` accurate.

## Testing manually

Copy `main.js`, `manifest.json`, `styles.css` to `<Vault>/.obsidian/plugins/<plugin-id>/`, then reload Obsidian and enable the plugin under **Settings → Community plugins**.

The working vault is the parent of this plugin folder: `/Users/andy/Development/dev-vault`.

## Releases

1. Run `npm version` (updates `manifest.json` and `versions.json` via `version-bump.mjs`).
2. Run `npm run build`.
3. Create a GitHub release tagged exactly as `manifest.json` version (no `v`).
4. Attach `main.js`, `manifest.json`, `styles.css`, and the entire `assets/` folder as release assets. The `assets/` folder contains built-in backgrounds, objects, prefabs, and tokens that the plugin references by path at runtime — omitting it will break the content browser.

## Security & privacy rules

- Default to offline/local. Network requests require explicit user opt-in and README disclosure.
- No telemetry, no remote code execution, no auto-updates outside normal releases.
- Read/write only within the vault. Do not access files outside it.
- No storing or transmitting vault contents without explicit user consent.
