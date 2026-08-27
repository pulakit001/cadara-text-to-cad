# zen-chat — How It Works

Flowcharts describing exactly what the code does (`server.js` + `public/app.js`).

## 1. Main chat flow

```mermaid
flowchart TD
    A["You type a prompt<br/>+ pick provider/model"] --> B["Browser sends POST /api/chat"]
    B --> C{"Prompt empty?"}
    C -- "yes" --> X1["400: error shown on page"]
    C -- "no" --> D{"API key set in .env?"}
    D -- "no" --> X2["500: 'add key to .env' shown"]
    D -- "yes" --> E["Server calls Gemini or Groq<br/>chat/completions (60s timeout)"]
    E -- "timeout" --> X3["504: provider timed out"]
    E -- "network/API fail" --> X4["502: error shown on page"]
    E -- "success" --> F["Reply text sent back as JSON"]
    F --> G["Answer displayed on the page"]
```

## 2. Model catalog (on page load)

```mermaid
flowchart TD
    A["Page loads"] --> B["GET /api/models"]
    B --> C{"Which keys exist in .env?"}
    C -- "Gemini key" --> D["Fetch live Gemini models<br/>(15s timeout, cached)"]
    C -- "Groq key" --> E["Fetch live Groq models<br/>(15s timeout, cached)"]
    D --> F["Label with free-tier/paid + price,<br/>sort cheapest first"]
    E --> F
    D -- "fetch fails" --> G["Use built-in fallback list"]
    E -- "fetch fails" --> G
    F --> H["Provider + model dropdowns filled"]
    G --> H
```

## Notes

- API keys never leave the server: the browser only talks to `/api/models` and
  `/api/chat`; the backend attaches keys when forwarding requests.
- The model cache lives in memory per provider + key, so provider catalogs are
  fetched once per server session.
- Errors are always returned as `{ "error": "message" }` with an appropriate
  HTTP status code.
