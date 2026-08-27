# Cadara Test Environment

Headless build harness for recording demo videos and validating the CAD
pipeline without launching the Electron UI or calling any LLM provider.

It reuses the app's real Python CAD runtime (`cad-runtime/scripts/step` +
`scripts/inspect`) and writes results into the app's real `models/` store, so
everything produced here shows up in Cadara's design history exactly like an
in-app generation.

## Layout

```
test-env/
├── build.mjs   # generatePart() replica of agent/tools.mjs (same CLIs, same result shape)
├── run.mjs     # CLI: builds one or all demo parts, prints app-style events + facts
└── parts/      # build123d sources (gen_step() contract), written by the model
    ├── v12-engine.py
    ├── dc-motor.py
    ├── studio-speaker.py
    ├── sports-car.py
    └── wrist-watch.py
```

## Usage

```bash
cd cadara/test-env

node run.mjs              # build every part in parts/
node run.mjs v12-engine   # build a single part
```

Requires `CAD_PYTHON` (set in `cadara/.env`) pointing at a Python 3.11+
environment with `build123d` installed.

Each run:

1. Copies the source to `models/<slug>/part.py` (auto-versioning `-v2`, `-v3`
   … on name clashes, same as the app).
2. Builds `part.step` + `part.glb` + `part.stl` via the runtime step CLI.
3. Extracts geometry facts via the runtime inspect CLI — the same facts the
   app's Reviewer stage checks and displays.

## Modifying a part in place (like app follow-up edits)

Overwrite `models/<slug>/part.py` and rebuild without creating a new version
dir — this mirrors the app's modify flow:

```bash
cp parts/sports-car.py ../models/sports-car/part.py
cd ../models/sports-car
"$CAD_PYTHON" ../../cad-runtime/scripts/step part.py --force --glb part.glb --stl part.stl
"$CAD_PYTHON" ../../cad-runtime/scripts/inspect refs part.step --facts
```

## Rendering check snapshots

```bash
"$CAD_PYTHON" cad-runtime/scripts/snapshot \
  --input models/v12-engine/part.step --output /tmp/engine.png --camera 135:18
```

## Current demo models

| Model | Size (mm) | Highlights |
|---|---|---|
| `v12-engine` | 492 × 209 × 282 | 64° V banks, 12 jugs + heads, ITB stacks, pulley drive, flywheel |
| `dc-motor` | 326 × 124 × 162 | 14 cooling fins, flange with bolt holes, keyed shaft, cowl vents |
| `studio-speaker` | 230 × 294 × 372 | Recessed baffle, 8" woofer + waveguide tweeter, rear port & fins |
| `sports-car` | 498 × 210 × 85 | Silhouette extrusion, arches, 5-spoke wheels, wing, splitter |
| `wrist-watch` | 49 × 200 × 17 | 42 mm case, applied markers, 10:09:31 hands, knurled crown, bracelet |
