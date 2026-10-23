# Project notes

## Browser testing

Use OpenCode's built-in browser tools for all manual and visual testing. Do not use the Chrome DevTools MCP or external browser automation.

- Serve the project with `python3 -m http.server 5199` from the project root.
- Open `http://localhost:5199/index.html` in a built-in browser tab.
- Focus the tab before taking a screenshot.
- `window.__snake` exposes `{ scene, camera, renderer, sendGift, reset, state }` for driving and inspecting the game.
- Port 5199 is reserved for this project; port 5173 may be taken by another app's service worker.
