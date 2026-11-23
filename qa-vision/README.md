# QA Vision (dashboard + engine)

The QA Vision application: a Next.js dashboard plus the Playwright comparison engine. It serves http://localhost:3001.

**Full documentation is in the [repository README](../README.md).**

```bash
npm install            # also installs Playwright Chromium
npm run start:real     # dashboard + Socket.IO live updates  →  http://localhost:3001
npm test               # unit + end-to-end tests (starts the sample apps itself)
npm run build:engine   # REQUIRED after editing lib/playwright.ts (regenerates playwright.js)
```

The engine lives in `lib/playwright.ts`. `server.js` loads the compiled copy `playwright.js`.
