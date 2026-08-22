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

## About Us

Cadara is built for makers, engineers, students, and product teams who want to move from an idea to inspectable CAD without losing control of the design process. The application keeps the workflow local: you describe the geometry, the agent generates build123d code, and the CAD runtime produces a model you can review and export.

The project is experimental and open source. It is intended for learning, prototyping, and early design exploration. Always review dimensions, tolerances, materials, and manufacturability before using generated geometry in a real product.

![Cadara application screenshot](./CADARA%20SCC.png)

## Recommended Workflow

1. **Start with a constrained prompt.** Include units, overall dimensions, feature locations, hole sizes, symmetry, and the desired output. Specific constraints produce more useful first-pass geometry.
2. **Build in small steps.** Begin with the main envelope, then add holes, pockets, fillets, mounting features, or other details in follow-up prompts. Smaller iterations make errors easier to diagnose.
3. **Inspect before exporting.** Use the 3D preview to check proportions and orientation. Treat the generated model as a design proposal until you have verified the important measurements yourself.
4. **Use manufacturing language carefully.** Mention clearance, wall thickness, fit, and material when they matter. For production work, confirm the result against your supplier's tolerances and process requirements.
5. **Keep prompts reusable.** Save successful prompts with the project so you can regenerate a variant consistently after changing a dimension or feature.

### Prompt Examples

```text
Create a 100 mm x 60 mm x 20 mm aluminum mounting block. Add four
through-holes of 5.5 mm diameter, centered 10 mm from each edge, and
apply a 2 mm chamfer to all outside vertical edges. Use millimeters and
keep the part centered on the origin.
```

```text
Add a 12 mm wide, 6 mm deep pocket centered on the top face. Keep at
least 4 mm of material around the pocket and preserve the existing
mounting holes.
```

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

## 💡 Example Prompts

Prompts that are meaty enough to exercise the full pipeline (spec → plan → build → review) without being so complex the agent drowns. Each names concrete dimensions and features — that's what makes CAD generation reliable.

| Part | Prompt |
|---|---|
| **Small DC motor** | `A small DC hobby motor model: 35 mm diameter cylinder body, 50 mm long, with a 3 mm shaft extending 15 mm from one end on axis, two M3 mounting tabs 5 mm thick sticking out opposite sides of the body, and 4 ventilation slots (2 x 8 mm) evenly spaced around the mid-body.` |
| **L-bracket** | `An aluminum L-shaped mounting bracket: both legs 80 mm long, 40 mm wide, 6 mm thick, with a 3 mm fillet on the inside corner, five 5 mm holes evenly spaced along each leg, and a 20 x 10 mm cable slot at the end of the vertical leg.` |
| **Shaft coupling** | `A stepped shaft coupling hub: 60 mm total length with three diameters — 25 mm for 25 mm, 20 mm for 20 mm, 15 mm for 15 mm — a 6 mm through-hole along the axis, an M4 set-screw hole radially through the largest step, and 2 mm chamfers on every exposed edge.` |
| **Electronics enclosure** | `A raspberry-pill sized project enclosure: 95 x 65 x 30 mm exterior, 3 mm wall thickness, a detachable-looking lid lip 2 mm deep, six M2.5 boss cylinders inside the corners, a 12 x 8 mm power connector cutout on one short side, and 15 round 3 mm vent holes in a grid on the back.` |
| **Spacer / standoff** | `A hexagonal aluminum standoff: 8 mm across flats, 25 mm tall, with an M4 threaded-look through-hole, 1 mm chamfer on both hex faces, and a knurled-look grip band simulated by 12 shallow v-grooves around the middle.` |
| **Gear (cosmetic teeth)** | `A spur gear blank: 60 mm outer diameter, 8 mm thick, 20 mm central bore, 24 cosmetic trapezoidal teeth around the rim, a 5 mm lightening hole pattern of 6 holes on a 40 mm bolt circle, and a 3 mm hub step 30 mm diameter on one face.` |
| **Bearing pillow block** | `A pillow block bearing mount: 70 x 40 mm base plate 8 mm thick with four 6 mm mounting holes, a central raised boss 45 mm tall with a 22 mm bearing bore through it, a 10 mm wide grease notch on top of the boss, and 4 mm fillets where the boss meets the base.` |
| **Hand crank** | `A hand crank knob assembly as one part: 12 mm diameter handle section 40 mm long with 8 decorative finger flutes, merging into a 90 mm arm 12 mm wide and 8 mm thick, ending in a 20 mm diameter hub with an 8 mm D-shaped shaft hole.` |

Tips for your own prompts: give overall dimensions, name the features (holes, slots, fillets, chamfers) with sizes, and say where each feature goes ("on the top face", "radially through the hub"). One part per prompt works best; iterate with follow-ups like "increase the wall thickness to 4 mm".

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
