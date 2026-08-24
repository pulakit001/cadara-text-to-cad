<div align="center">
  <img src="Cadara logo.png" alt="Cadara" width="360" />
  <p><strong>Design in words.</strong> Generate precision 3D CAD models using natural language and AI agents.</p>

  [![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](https://opensource.org/licenses/MIT)
  [![Electron](https://img.shields.io/badge/Electron-43-47848F.svg?logo=electron&logoColor=white)](https://www.electronjs.org/)
  [![Python](https://img.shields.io/badge/Python-3.12+-3776AB.svg?logo=python&logoColor=white)](https://www.python.org/)
  [![Node.js](https://img.shields.io/badge/Node.js-22+-339933.svg?logo=node.js&logoColor=white)](https://nodejs.org/)
  [![Download](https://img.shields.io/badge/Download-Latest_Release-2ea44f?logo=github&logoColor=white)](https://github.com/pulakit001/cadara-text-to-cad/releases/latest)

  **[⬇️ Download for Windows & macOS](https://github.com/pulakit001/cadara-text-to-cad/releases/latest)**
</div>

---

> **Describe a part → AI writes the geometry → Preview, iterate, export.**

Cadara is an open-source desktop text-to-CAD workbench. Describe a mechanical part in plain language and a six-stage agent pipeline writes real `build123d` code, builds it with the OpenCascade kernel, verifies the geometry facts, and hands you a manufacturable model — STEP, STL, GLB, and more.

## Why Cadara

Most text-to-CAD tools are cloud APIs — you send prompts to someone else's geometry service and pay per part. Cadara runs **on your machine**:

| | Cloud text-to-CAD APIs | Cadara |
|---|---|---|
| Geometry engine | Vendor's cloud GPU | Local OpenCascade (`build123d`) |
| Model choice | Whatever the vendor routes to | Gemini, Z.AI, Qwen, OpenAI, Claude, OpenRouter — your pick per task |
| Your prompts & designs | Leave your machine | Stay local; only LLM calls go out |
| Cost model | Per-part API fees | Free app + your own provider keys (Gemini free tier works great) |
| Code output | Vendor formats | Real parametric Python you can read, version, and edit |

It's built for makers, engineers, students, and product teams who want idea → inspectable CAD without giving up control. The project is experimental: always verify dimensions, tolerances, and manufacturability before production use.

![Cadara application screenshot](./CADARA%20SCC.png)

## 📥 Download & Install

### Option 1 — One-line terminal install (easiest)

**macOS** (Terminal):

```bash
curl -fsSL https://raw.githubusercontent.com/pulakit001/cadara-text-to-cad/main/install.sh | bash
```

**Windows** (PowerShell):

```powershell
irm https://raw.githubusercontent.com/pulakit001/cadara-text-to-cad/main/install.ps1 | iex
```

The script detects your platform, downloads the latest release, and installs it (macOS → `/Applications`, Windows → silent NSIS install).

### Option 2 — Manual installers

Grab a one-click installer from the [**Releases page**](https://github.com/pulakit001/cadara-text-to-cad/releases/latest). Every tagged release ships:

| Platform | Download | Format |
|---|---|---|
| Windows 10/11 | GitHub Releases | `.exe` NSIS installer |
| macOS Intel | GitHub Releases | `.dmg` disk image |
| macOS Apple Silicon | GitHub Releases | `.dmg` disk image |

Installers bundle the Electron app and the Python CAD runtime. On first launch, add an API key ([Gemini's free tier](https://aistudio.google.com/apikey) works immediately).

> Unsigned builds may show OS security warnings (right-click → Open on macOS). Maintainers configure `CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, and `APPLE_TEAM_ID` secrets before public releases. See [LEGAL.md](./LEGAL.md) for the compliance checklist.

### Option 3 — Clone & Run (developers)

```bash
# 1. Clone
git clone https://github.com/pulakit001/cadara-text-to-cad.git
cd cadara-text-to-cad/cadara

# 2. Install JS dependencies
npm install

# 3. Setup the Python CAD runtime
cd cad-runtime
python3 -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cd ..

# 4. Add your API key
cp .env.example .env
# Open .env and paste at least one provider key (Gemini is free!)

# 5. Launch
npm start
```

### Releasing a new version

Update the version in `cadara/package.json`, then push a tag — GitHub Actions builds and publishes all installers automatically:

```bash
cd cadara
npm version patch
git push origin main --follow-tags
```

## ✨ Features

| Feature | Description |
|---|---|
| 🗣️ **Natural Language to CAD** | Describe the part and Cadara writes the geometry code |
| 🤖 **Six-Stage Agent Pipeline** | Router → Reference → Spec → Planner → Builder → Reviewer |
| 🔄 **Self-Healing Builds** | Reads tracebacks, applies targeted fix hints, retries up to 12 iterations |
| ✏️ **Continuity-Aware Editing** | Follow-ups modify *your* design in place — same part, preserved dimensions, previous source backed up, size drift checked automatically |
| 🗂️ **Durable Design History** | Every past design saved locally, always visible, full-text searchable |
| 🔑 **Multi-Provider** | Gemini, Z.AI, Qwen, OpenAI, Claude, OpenRouter with encrypted local key storage |
| 📦 **Universal Exports** | `.STEP`, `.STL`, `.GLB`, `.3MF`, `.OBJ`, `.PLY`, `.IGES`, `.DXF`, `.SVG` |
| 🎨 **Texture Pass** | Describe a surface finish and the AI generates a material spec |
| 🎯 **Custom Skills** | Teach the agent reusable rules that apply across every design |

## 🧠 How It Works

```
┌──────────────────────────────────────────────────────────┐
│  Electron App                                            │
│                                                          │
│   ┌──────────┐   ┌────────────────────────────────────┐  │
│   │ Renderer │◄─►│ Node.js Agent Orchestrator          │ │
│   │ chat+3D  │   │                                     │ │
│   └──────────┘   │ 1. Router    fresh vs continue      │ │
│                  │ 2. Reference reads attached images  │ │
│   ┌──────────┐   │ 3. Spec      vague → measurable     │ │
│   │ Durable  │   │ 4. Planner   decompose into steps   │ │
│   │ history  │   │ 5. Builder   write build123d code   │ │
│   │ (search) │   │              ↳ build → fix → retry  │ │
│   └──────────┘   │ 6. Reviewer  verify facts, summarize│ │
│                  └──────────────┬──────────────────────┘  │
│                                 ▼                         │
│              ┌─────────────────────────────────┐         │
│              │ Python CAD Runtime               │        │
│              │ build123d + OpenCascade          │        │
│              │ → STEP → STL / GLB / …           │        │
│              └─────────────────────────────────┘         │
└──────────────────────────────────────────────────────────┘
                     │
                     ▼  LLM API (only calls leave your machine)
```

- **Electron frontend** — dark-mode GUI in vanilla JS/HTML/CSS with a Three.js viewer
- **Node orchestrator** (`agent/`) — pipeline stages, rate-limit backoff/recovery, cancellation via AbortSignal, durable session + history stores
- **Python runtime** (`cad-runtime/`) — executes generated `build123d` code in a subprocess, exports STEP plus tessellated sidecars, and returns measured geometry facts the Reviewer checks against your request

### Follow-up edits that stay consistent

Modify requests ("add a pocket", "increase height to 30 mm") don't regenerate a stranger's part:

1. The **Router** classifies the request as fresh or modify.
2. Modify runs keep the **same part directory**, overwrite `part.py` in place, and archive the previous source as `part.prev.py`.
3. The Builder receives the current source plus explicit **continuity rules**: preserve variable names/values, apply only requested edits, keep the bounding box within ~5% unless dimensions changed.
4. After rebuild, a **fact-delta check** compares old vs new size and flags silent redesigns to the Reviewer.

## 💡 Example Prompts

Prompts meaty enough to exercise the full pipeline (spec → plan → build → review) without drowning it. Concrete dimensions and named features are what make generation reliable.

| Part | Prompt |
|---|---|
| **Small DC motor** | `A small DC hobby motor model: 35 mm diameter cylinder body, 50 mm long, with a 3 mm shaft extending 15 mm from one end on axis, two M3 mounting tabs 5 mm thick sticking out opposite sides of the body, and 4 ventilation slots (2 x 8 mm) evenly spaced around the mid-body.` |
| **L-bracket** | `An aluminum L-shaped mounting bracket: both legs 80 mm long, 40 mm wide, 6 mm thick, with a 3 mm fillet on the inside corner, five 5 mm holes evenly spaced along each leg, and a 20 x 10 mm cable slot at the end of the vertical leg.` |
| **Shaft coupling** | `A stepped shaft coupling hub: 60 mm total length with three diameters — 25 mm for 25 mm, 20 mm for 20 mm, 15 mm for 15 mm — a 6 mm through-hole along the axis, an M4 set-screw hole radially through the largest step, and 2 mm chamfers on every exposed edge.` |
| **Electronics enclosure** | `A raspberry-pill sized project enclosure: 95 x 65 x 30 mm exterior, 3 mm wall thickness, a detachable-looking lid lip 2 mm deep, six M2.5 boss cylinders inside the corners, a 12 x 8 mm power connector cutout on one short side, and 15 round 3 mm vent holes in a grid on the back.` |
| **Spacer / standoff** | `A hexagonal aluminum standoff: 8 mm across flats, 25 mm tall, with an M4 threaded-look through-hole, 1 mm chamfer on both hex faces, and a knurled-look grip band simulated by 12 shallow v-grooves around the middle.` |
| **Bearing pillow block** | `A pillow block bearing mount: 70 x 40 mm base plate 8 mm thick with four 6 mm mounting holes, a central raised boss 45 mm tall with a 22 mm bearing bore through it, a 10 mm wide grease notch on top of the boss, and 4 mm fillets where the boss meets the base.` |

Tips: give overall dimensions, name features (holes, slots, fillets) with sizes, and say where each goes ("on the top face", "radially through the hub"). One part per prompt works best; iterate with follow-ups like "increase the wall thickness to 4 mm".

## 🔑 API Keys

At least one provider key is required. The free tier gets you started instantly:

| Provider | Free Tier | Get a Key |
|---|---|---|
| **Google Gemini** ⭐ | Yes — generous quota | [aistudio.google.com/apikey](https://aistudio.google.com/apikey) |
| **Z.AI** (GLM) | Free tier for Flash models | [z.ai](https://z.ai) |
| **Qwen** (DashScope) | New-user credits | [Alibaba Cloud Model Studio](https://bailian.console.alibabacloud.com) |
| **OpenAI** | Pay-as-you-go | [platform.openai.com/api-keys](https://platform.openai.com/api-keys) |
| **Anthropic Claude** | Pay-as-you-go | [console.anthropic.com](https://console.anthropic.com/settings/keys) |
| **OpenRouter** | Varies by model | [openrouter.ai/keys](https://openrouter.ai/keys) |

Every catalog is filtered to models that actually support tool calling — the one capability the agent pipeline requires — so what you see is what works.

Add keys two ways:
1. **Settings UI** — the ⚙️ gear inside the app (encrypted with OS keychain storage)
2. **`.env` file** — see [`.env.example`](./cadara/.env.example)

## 🧪 Testing

```bash
cd cadara
npm run agent:test          # headless end-to-end agent run (needs an API key)
node agent/test-retry.mjs   # unit tests: retry/backoff/cancellation logic
```

## 📁 Project Structure

```
cadara/
├── main.js              # Electron main process, IPC, secure key storage
├── preload.js           # Context-isolated IPC bridge
├── history-store.js     # Durable previous-designs store (JSON, atomic writes)
├── renderer/            # Frontend UI
│   ├── index.html
│   ├── style.css
│   ├── app.js
│   └── assets/viewer.js # Three.js viewer + texture engine
├── agent/               # LLM agent pipeline
│   ├── agent.mjs        # Six-stage loop, self-healing, modify continuity
│   ├── llm.mjs          # Multi-provider client, backoff, vision routing
│   ├── prompts.mjs      # Stage system prompts
│   ├── session.mjs      # Persistent current-design context
│   └── tools.mjs        # generate_cad tool → Python runtime
├── cad-runtime/         # Python CAD engine (build123d + cadpy)
│   └── scripts/         # STEP/inspect/snapshot CLIs
├── .env.example         # Template for API keys
└── package.json
```

## 🤝 Contributing

Contributions welcome — new providers, prompt architecture, UI polish, CAD runtime improvements. See [CONTRIBUTING.md](./CONTRIBUTING.md).

## 📄 License

MIT — see [LICENSE](./LICENSE).

---

<div align="center">
  <sub>Built with ❤️ by the <strong>Snippetz Labs</strong> team</sub><br/>
  <sub><a href="https://github.com/pulakit001/cadara-text-to-cad/issues">Report an issue</a> · <a href="https://github.com/pulakit001/cadara-text-to-cad/releases/latest">Download latest</a></sub>
</div>
