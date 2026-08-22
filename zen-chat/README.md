# Gemini / Groq Chat

A minimal full-stack web app: user types a prompt, the backend forwards it to
Gemini or Groq through OpenAI-compatible chat completions, and the response is
displayed on the page.

```
User input -> Node/Express backend -> Gemini or Groq API -> response -> shown to user
```

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Set at least one provider key in `.env`:

   ```bash
   cp .env.example .env
   # then edit .env:
   # GEMINI_API_KEY=AIza...
   # GROQ_API_KEY=gsk_...
   ```

   `.env` is gitignored. Never commit it or paste keys into frontend code.
   Keys only live on the server side.

3. Start the server:

   ```bash
   npm start
   # or npm run dev for auto-restart on changes
   ```

4. Open http://localhost:3000 in your browser.

## Configuration

| Variable | Default | Description |
| --- | --- | --- |
| `GEMINI_API_KEY` | optional | Google AI Studio Gemini API key |
| `GROQ_API_KEY` | optional | GroqCloud API key |
| `LLM_PROVIDER` | `gemini` | Default provider: `gemini` or `groq` |
| `LLM_MODEL` | first live model | Optional exact model id |
| `PORT` | `3000` | Port the server listens on |

## Models

The backend fetches live models from each provider key:

- Gemini: `https://generativelanguage.googleapis.com/v1beta/models`
- Groq: `https://api.groq.com/openai/v1/models`

The UI orders models from free-tier / cheapest options to paid or premium
models, with price notes in the dropdown. If a provider catalog is unreachable,
the app falls back to a small known-good list so the UI still loads.

## API

### `GET /api/models`

Returns available providers and model catalogs for keys present in `.env`.

### `POST /api/chat`

Request:

```json
{ "provider": "groq", "model": "openai/gpt-oss-20b", "prompt": "Hello" }
```

Response:

```json
{ "provider": "groq", "model": "openai/gpt-oss-20b", "response": "Hi there!" }
```

Errors are returned as `{ "error": "message" }` with an appropriate status code.
