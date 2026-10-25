# Project notes

## Model roles

- **Planning**: Done by Argon (`google/antigravity-gemini-4-argon-medium`). Argon NEVER executes tasks, edits code, or runs builds directly; Argon only plans and delegates all building/execution to subagents.
- **Building / Implementation**: All tasks and edits are delegated to subagents running on DeepSeek 4.1 Flash (`opencode-go/deepseek-v4.1-flash`).

## Browser testing

Use OpenCode's built-in browser tools for all manual and visual testing. Do not use the Chrome DevTools MCP or external browser automation.

- Serve the project with `python3 -m http.server 5199` from the project root.
- Open `http://localhost:5199/index.html` in a built-in browser tab.
- Focus the tab before taking a screenshot.
- `window.__snake` exposes `{ scene, camera, renderer, sendGift, reset, state }` for driving and inspecting the game.
- Port 5199 is reserved for this project; port 5173 may be taken by another app's service worker.
