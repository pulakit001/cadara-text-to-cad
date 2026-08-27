# Cadara — How It Works

Flowcharts describing exactly what the code does (`main.js`, `agent/*`,
`cad-runtime/`, `renderer/`). View this file on GitHub (or any Mermaid-enabled
viewer) to render the diagrams.

## 1. Big picture

```mermaid
flowchart LR
    U["You describe a part"] --> UI["Electron Renderer<br/>chat UI + Three.js 3D viewer"]
    UI <-->|"IPC"| ORCH["Node.js Agent Orchestrator<br/>(main.js + agent/)"]
    ORCH --- HIST["Durable history store<br/>(all past designs, searchable)"]
    ORCH <-->|"LLM API calls —<br/>the ONLY traffic leaving your machine"| LLM["Gemini / Z.AI / Qwen /<br/>OpenAI / Claude / OpenRouter"]
    ORCH -->|"generated Python"| PY["Python CAD Runtime<br/>build123d + OpenCascade"]
    PY -->|"STEP + tessellated sidecars<br/>+ measured geometry facts"| ORCH
    ORCH -->|"progress + finished model"| UI
```

## 2. Six-stage agent pipeline (one request)

```mermaid
flowchart TD
    A["Your prompt (+ optional reference image)"] --> B{"1. Router:<br/>fresh design or modify existing?"}
    B -- "image attached?" --> C["2. Reference:<br/>vision model reads the image"]
    B -- "no image" --> D
    C --> D["3. Spec:<br/>vague words → measurable requirements"]
    D --> E["4. Planner:<br/>decompose into ordered build steps"]
    E --> F["5. Builder:<br/>writes real build123d Python code"]
    F --> G["Python runtime builds the geometry"]
    G -- "build fails" --> H["Read traceback,<br/>apply targeted fix hints"]
    H -- "retry (bounded)" --> F
    G -- "build succeeds" --> I{"6. Reviewer:<br/>geometry facts match request?"}
    I -- "modify run: size drift >~5%" --> J["Flag silent redesign<br/>in final summary"]
    I -- "ok" --> K["Part shown in viewer,<br/>exports ready (STEP/STL/GLB/…)"]
    J --> K
```

## 3. Modify continuity (follow-up edits)

```mermaid
flowchart LR
    A["Modify request<br/>('add a pocket', 'height to 30mm')"] --> B["Router classifies as modify"]
    B --> C["Same part directory kept"]
    C --> D["Current part.py backed up<br/>to part.prev.py"]
    D --> E["Builder gets source + continuity rules:<br/>keep variable names/dims,<br/>apply only the requested edit"]
    E --> F["Rebuild + fact-delta check:<br/>old vs new size compared"]
    F --> G["Drift flagged to Reviewer<br/>instead of passing silently"]
```

## Notes

- **Self-healing loop**: the builder retries failed builds by reading each
  traceback and applying fix hints — bounded iterations (default 8, capped at
  4 in fast mode, raised to at least 12 in thorough mode).
- **Rate limits** retry the same conversation turn without burning a build
  iteration; every pipeline stage reports progress events to the UI.
- **Fallbacks everywhere**: unparseable spec/planner output falls back to
  deterministic defaults so a run never dead-ends mid-pipeline.
- **Cancellation**: long stages honor `AbortSignal`, so stopping a run kills
  in-flight LLM calls and the Python subprocess.
- **Texture pass**: after geometry, an optional stage turns a finish
  description ("brushed aluminium") into a material spec for the viewer.
