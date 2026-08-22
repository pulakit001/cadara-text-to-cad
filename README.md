<div align="center">
  <img src="Cadara logo.png" alt="Cadara" width="360" />
  <p><strong>Design in words.</strong> Generate precision 3D CAD models using natural language and AI agents.</p>
  
  [![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](https://opensource.org/licenses/MIT)
  [![Electron](https://img.shields.io/badge/Electron-43-47848F.svg?logo=electron&logoColor=white)](https://www.electronjs.org/)
  [![Python](https://img.shields.io/badge/Python-3.10+-3776AB.svg?logo=python&logoColor=white)](https://www.python.org/)
  [![Node.js](https://img.shields.io/badge/Node.js-18+-339933.svg?logo=node.js&logoColor=white)](https://nodejs.org/)
</div>

---

Cadara is an intelligent, open-source desktop application that bridges the gap between natural language descriptions and precise, manufacturable CAD geometry. Powered by Large Language Models (LLMs) and the `build123d` OpenCascade engine, Cadara acts as your personal mechanical engineering assistant.

> **Describe a part → AI writes the geometry → Preview, iterate, export.**

## 📥 Download & Install

### Option 1 — Clone & Run (recommended)

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

### Option 2 — Download ZIP

Click **Code → Download ZIP** on the GitHub page, unzip, then follow steps 2–5 above.

<!-- ### Option 3 — Packaged Release (coming soon)
Pre-built .dmg (macOS), .exe (Windows), and .AppImage (Linux) releases are planned. Star the repo to get notified! -->

## ✨ Features

| Feature | Description |
|---|---|
| 🗣️ **Natural Language to CAD** | Describe the part you want and Cadara writes the geometry code |
| 🤖 **Agentic Pipeline** | Router → Spec → Planner → Builder → Reviewer — ensures manufacturable results |
| 🔄 **Self-Healing Code** | Auto-detects Python/CAD errors, reads tracebacks, and iterates to fix geometry |
| 🔑 **Multi-Provider** | Gemini, Claude, OpenAI, Groq, and OpenRouter with encrypted local key storage |
| 📦 **Universal Exports** | `.STEP`, `.STL`, `.GLB`, `.3MF`, `.OBJ`, `.IGES`, `.DXF`, `.SVG` |
| 🎯 **Custom Skills** | Define parametric functions the AI can use globally across designs |
| 🎨 **Texture Pass** | Describe a surface finish and the AI generates a material spec |

## 🔑 API Keys

Cadara needs at least one LLM provider key. The free tier works great for getting started:

| Provider | Free Tier | Get a Key |
|---|---|---|
| **Google Gemini** ⭐ | Yes — generous free quota | [aistudio.google.com/apikey](https://aistudio.google.com/apikey) |
| **Groq** | Yes — fast inference | [console.groq.com/keys](https://console.groq.com/keys) |
| **OpenAI** | No — pay-as-you-go | [platform.openai.com/api-keys](https://platform.openai.com/api-keys) |
| **Anthropic Claude** | No — pay-as-you-go | [console.anthropic.com](https://console.anthropic.com/settings/keys) |
| **OpenRouter** | Varies by model | [openrouter.ai/keys](https://openrouter.ai/keys) |

You can add keys in two ways:
1. **Settings UI** — click the ⚙️ gear icon inside the app (keys are encrypted locally)
2. **`.env` file** — paste keys directly (see [`.env.example`](./cadara/.env.example))

## 🧠 Architecture

Cadara operates entirely locally — API calls go only to the LLM provider you choose.

```
┌─────────────────────────────────────────────────┐
│  Electron App                                   │
│  ┌───────────┐  ┌────────────────────────────┐  │
│  │  Renderer  │  │  Node.js Agent Orchestrator │  │
│  │  (HTML/CSS │◄─►│  Router → Spec → Planner  │  │
│  │   /JS)     │  │  → Builder → Reviewer      │  │
│  └───────────┘  └──────────┬─────────────────┘  │
│                            │                     │
│                 ┌──────────▼─────────────────┐  │
│                 │  Python CAD Runtime         │  │
│                 │  build123d + OpenCascade    │  │
│                 │  → STEP / STL / GLB        │  │
│                 └────────────────────────────┘  │
└─────────────────────────────────────────────────┘
         │
         ▼  LLM API (Gemini / Claude / OpenAI / Groq)
```

- **Electron Frontend** — Fully responsive dark-mode GUI, Vanilla JS/HTML/CSS
- **Node.js Orchestrator** (`agent/`) — Manages the agentic pipeline, conversation history, and context windows
- **Python Backend** (`cad-runtime/`) — Executes LLM-generated `build123d` code in an isolated subprocess

## 📁 Project Structure

```
cadara/
├── main.js              # Electron main process
├── preload.js           # Secure IPC bridge
├── renderer/            # Frontend UI
│   ├── index.html
│   ├── style.css
│   └── app.js
├── agent/               # LLM agent pipeline
│   ├── agent.mjs        # Core agentic loop
│   ├── llm.mjs          # Multi-provider LLM client
│   ├── prompts.mjs      # System prompts
│   ├── session.mjs      # Conversation session
│   └── tools.mjs        # Agent tool definitions
├── cad-runtime/         # Python CAD engine
│   └── scripts/         # Geometry execution scripts
├── .env.example         # Template for API keys
└── package.json
```

## 🤝 Contributing

We welcome all contributions! Whether it's adding new AI providers, refining the prompt architecture, or tweaking the UI — check out our [Contributing Guidelines](./CONTRIBUTING.md) to get started.

## 📄 License

This project is licensed under the MIT License — see the [LICENSE](./LICENSE) file for details.

---

<div align="center">
  <sub>Built with ❤️ by the Cadara team</sub>
</div>
