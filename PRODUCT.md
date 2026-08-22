# Cadara Product Context

Assumptions inferred from the existing app and the user's redesign request.

Cadara is a desktop text-to-CAD workbench for creating mechanical parts from natural-language prompts, optional reference images, and model/provider presets. Its user is iterating on physical geometry and needs a quiet, direct operating surface: prompt, model choice, agent progress, preview, export, and local previous designs.

The product truth to preserve:
- The AI agent routes a prompt through reference reading, spec, planning, build, and review.
- The main artifact is a validated STEP-first CAD part with GLB/STL exports.
- Gemini and Groq are primary providers; OpenAI and Claude keys are optional.
- Previous designs are local history and must not contaminate a fresh new-chat session.
- The visual target is a minimal dark CAD console inspired by the supplied screenshots: black rail, sparse controls, bottom prompt composer, and large canvas.
