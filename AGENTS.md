# Repository Guidelines

## Project Structure & Module Organization
Mark2 pairs a Vite-driven interface with a Rust/Tauri shell. Front-end entry points live under `src/`, with stateful UI components such as `MarkdownEditor.js` and `FileTree.js` in `src/components/`, shared utilities in `src/utils/`, and static styles in `styles/`. Native commands, menu wiring, and OS integrations are implemented in `src-tauri/src/`, while Tauri build metadata sits in `src-tauri/tauri.conf.json`. Generated bundles are written to `dist/`; keep this directory out of source control.

## Build, Test, and Development Commands
- `npm run dev`: Run the Vite dev server for quick front-end iteration in the browser.
- `npm run tauri:dev`: Launch the desktop shell with hot reload for both Rust and JavaScript.
- `npm run build`: Produce a production-ready web bundle under `dist/`.
- `npm run tauri:build`: Compile and package the desktop app; macOS bundles land in `src-tauri/target/release/bundle/`.
- `npm run tauri:run`: Open the most recent packaged macOS app to validate release builds.

## Coding Style & Naming Conventions
Use ES modules with four-space indentation and trailing semicolons for JavaScript files. Prefer PascalCase for React-style components, camelCase for functions and variables, and kebab-case for filesystem paths. For Rust modules, follow standard `rustfmt` defaults with `snake_case` identifiers. Avoid introducing new global singletons; expose features via small composable classes or functions.

## Testing Guidelines
There is no automated JavaScript test suite yet; add Vitest or Playwright coverage alongside features (`src/__tests__/` or `tests/`) and document new commands. For the Rust side, co-locate unit tests inside `#[cfg(test)]` modules, and run them with `cargo test` from `src-tauri`. Before opening a PR, exercise critical flows manually in `npm run tauri:dev`, focusing on file watching, Markdown rendering, and menu actions.

## Commit & Pull Request Guidelines
Recent commits use short, imperative summaries in Simplified Chinese (e.g., "优化文件路径处理..."). Mirror that format, referencing affected areas rather than ticket numbers. For PRs, include: a concise feature or fix overview, screenshots or screen recordings for UI changes, steps to reproduce and verify, and links to related issues. Flag platform-specific considerations (e.g., macOS-only dialogs) so reviewers can test appropriately.

## Security & Configuration Tips
Never commit user content directories or temporary bundles. Review `tauri.conf.json` before shipping to ensure filesystem scopes match the features you expose, and validate new capabilities against the Tauri allowlist. When adding native APIs, document required macOS entitlements in `src-tauri/tauri.conf.json` and call out any additional install steps in `PROGRESS.md`.
