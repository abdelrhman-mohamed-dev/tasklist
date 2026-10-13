# Tasklist

A calm task manager for Windows, Android and the web, with AI planning (text completion, suggestions, roadmaps, mind maps) and private Wi-Fi sync between your phone and PC.

## Repository layout

```
packages/core/    The Tasklist app itself: plain HTML, CSS and JavaScript, no build step.
                  Every platform ships this same code.
apps/desktop/     Windows app (Electron): tray, global quick add, phone-sync hub, AI proxy.
apps/mobile/      Android app (Capacitor): native networking, QR scanner, release signing.
apps/website/     Landing site with screenshots, a live quick-add demo and downloads.
scripts/          Dev server, icon generator, screenshot capture, website build.
releases/         Built Tasklist-Setup.exe and Tasklist.apk (not committed).
```

Each app keeps its own `node_modules`. `apps/desktop` and `apps/mobile` copy `packages/core` into themselves (`web/` and `www/`) before they run or build, so edit the app only in `packages/core`.

## Commands

Run these from the repository root.

| Command | What it does |
|---|---|
| `npm run setup` | Install dependencies for the desktop and Android apps |
| `npm run web` | Serve the web version at http://localhost:5173 |
| `npm run desktop` | Run the Windows app from source |
| `npm run desktop:dist` | Build the installer into `releases/Tasklist-Setup.exe` |
| `npm run android:apk` | Build the signed APK into `releases/Tasklist.apk` |
| `npm run website` | Build and serve the landing site at http://localhost:5175 |
| `npm run release` | Build the installer, the APK and the website |
| `npm run icons` | Regenerate every icon (desktop, web, Android, website) |
| `npm run screenshots` | Re-capture the website screenshots from the real app |

Requirements: Node.js 20+. The Android build also needs Android Studio (its SDK and bundled Java are found automatically).

## Website

`apps/website` is a static site: `index.html`, `styles.css`, `site.js` and `assets/`. `npm run website:build` adds two generated folders:

- `app/`: a copy of `packages/core`, so the site hosts the web version at `/app/` and the quick-add demo runs the app's real parser.
- `downloads/`: the installer and APK from `releases/`. A download button shows as unavailable until its file is built.

To publish it, run `npm run release` and upload the whole `apps/website` folder to any static host.

The screenshots in `assets/shots/` are real captures of the app (light and dark) made by `npm run screenshots`, which runs the desktop app with sample data in a throwaway profile.

## Desktop app (apps/desktop)

- `Ctrl+Alt+A` opens a quick-add pop-up from anywhere; `Ctrl+Alt+T` shows the main window.
- Closing the window keeps the app in the system tray, whose menu has **Start at login** and **Quit**.
- The phone-sync hub (`electron/hub.js`) serves the app and a sync API on port 5180 of your local network. Only paired devices can read or change tasks.
- AI requests go through the main process (`ai:request`), because provider APIs reject cross-origin calls from the `file://` window.
- Windows run with context isolation and the sandbox on. Pages reach the main process only through `electron/preload.js`.

## Android app (apps/mobile)

See [apps/mobile/README.md](apps/mobile/README.md). Keep `android/tasklist-release.jks` and `android/keystore.properties` private and backed up: Android only installs updates signed with the same key. Both are excluded from git.

## Phone sync

Every task and project carries an `updatedAt` time and deletions are kept as tombstones (`packages/core/sync.js`). Devices merge by last write wins, so the PC and any number of phones converge on the same tasks. Phones pair by scanning the QR code in the PC's **Connect** window, or by entering its address and a 6-digit code that works for 10 minutes.

## AI assistant

Settings (gear in the sidebar) → **AI assistant**: pick a provider, enter the API key, and change the API address or model if needed. Each provider remembers its own address, key and model. Settings stay on the device and never sync.

| Provider | API format | Default address | Default model |
|---|---|---|---|
| Anthropic (Claude) | Messages API | `https://api.anthropic.com` | `claude-opus-5-5` |
| OpenAI | OpenAI chat | `https://api.openai.com/v1` | use **Load models** |
| GLM Coding Plan (Z.ai) | OpenAI chat | `https://api.z.ai/api/coding/paas/v4` | `glm-5.2` |
| GLM Coding Plan (China) | OpenAI chat | `https://open.bigmodel.cn/api/coding/paas/v4` | `glm-5.2` |
| Google Gemini | OpenAI chat | `https://generativelanguage.googleapis.com/v1beta/openai` | use **Load models** |
| OpenRouter | OpenAI chat | `https://openrouter.ai/api/v1` | use **Load models** |
| Ollama (local) | OpenAI chat | `http://localhost:11434/v1` | use **Load models** |
| Custom | OpenAI chat | any | any |

- **Text completion**: a faded continuation appears as you type a task. Press Tab or → on a PC, or tap it on a phone.
- **Suggest**: proposes up to 5 next tasks for the current view or project.
- **Plan a roadmap**: turns a goal and timeframe into a project of phased, dated tasks.
- **Brainstorm a mind map**: turns a topic into a project (branches become tasks, ideas become sub-tasks).
- **Roadmap and Mind map views**: any project can switch between List, Roadmap and Mind map. In the mind map, **+** on a node asks AI for more ideas under it.

With Anthropic's API on Claude Opus 5.5, Opus 5, Fable 5.1 or Sonnet 5.5, requests opt into server-side refusal fallback (`fallbacks: "default"`), so a declined request is retried on another model.

## App features

- Inbox, Today (with Overdue), Upcoming (next 14 days, drag a task to another date), Completed
- Projects with colours, labels, sub-tasks, repeating tasks, priorities and roadmap phases
- Natural-language quick add: `Pay rent tomorrow p1 #Home @bills every month`
  - Dates: `today`, `tomorrow`, `friday`, `next week`, `in 3 days`, `25 oct`, `oct 25`
  - `p1` to `p4` priority, `#project` (created if missing), `@label`, `every day|week|month`
- Undo, search, drag to reorder, light and dark themes, phone layout
- Keyboard: `Q` quick add, `/` search, `G` Today, `I` Inbox, `U` Upcoming, arrows to select, `Enter` open, `E` complete, `Esc` close

## core files (packages/core)

| File | Purpose |
|---|---|
| `index.html`, `styles.css`, `ai.css` | Markup and styles |
| `app.js` | State, views, sync client, AI features |
| `parser.js` | Natural-language quick-add parser (browser and Node) |
| `sync.js` | Change tracking and merge, shared with the desktop hub |
| `ai.js` | AI providers and prompts |
| `mindmap.js` | SVG mind map |
| `icons.js` | Inline SVG icon set |
| `manifest.webmanifest`, `sw.js`, `icons/` | Installable web app and offline cache |
