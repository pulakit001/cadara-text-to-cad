# Cadara Design System

Cadara uses a dark CAD instrument cockpit visual world.

## Core World

- Absolute black workspace with a narrow icon rail and a graphite command pane.
- One primary surface: the CAD canvas. Everything else behaves like instrumentation around it.
- Hairline dividers, low-elevation graphite popovers, compact controls, and measured type.
- The main signal color is green for active/successful agent work; red is reserved for failure.
- The UI avoids broad purple gradients, stacked card dashboards, heavy top bars, and chat-app chrome.

## Layout

- Desktop: 58px icon rail, left command pane, right full-height CAD viewer.
- Mobile/narrow: viewer first, command pane below, same rail on the left.
- Prompt composer floats at the bottom of the command pane and contains reference upload, provider, packet, model, cancel/retry, and submit.
- Previous designs live in a rail-triggered popover, not as permanent workspace content.

## Components

- Rail buttons are icon-only, square, and quiet until hover/focus.
- Settings is a centered graphite modal with provider key cards in a two-column grid.
- Agent pipeline is an instrument readout: compact header, six thin progress bars, and dense step rows.
- Empty canvas uses a single centered icon block with short, direct copy.

## Interaction

- New design clears the canvas/session and keeps prior work isolated in local history.
- History opens as a local popover and closes after selecting a previous design.
- Model packets are provider-specific and auto-select the best available model while keeping manual model override visible.
- Reference-image upload is disabled for models that do not support image input.

## Verification Notes

- Browser preview loaded `cadara/renderer/index.html` with no renderer errors.
- Desktop and mobile screenshots were saved under `.impeccable/review/`.
- Electron launch still aborts with `SIGABRT` in the current sandbox before app code runs.
