# Sample DEV and PROD Test Applications

Two separate Next.js applications are included as test fixtures with deliberate differences that QA Vision detects. The e2e and UI suites run against them (see the Tests table in README.md).

## Applications Created

### 1. Sample DEV (`sample-dev/`) - Port 3002
- **Banner**: Green "DEVELOPMENT ENVIRONMENT — Latest Features"
- **Login button**: Emerald colors
- **Active Users**: 1,250 (live counter that can be incremented)
- **Validation messages**: Modern, friendly ("Please enter a valid email address")
- **Extra features**: New interactive charts, experimental UI components
- **Modal**: "Welcome to DEV" with celebration emoji

### 2. Sample PROD (`sample-prod/`) - Port 3003
- **Banner**: Blue "PRODUCTION ENVIRONMENT — Stable Release v2026.08"
- **Login button**: Blue colors
- **Active Users**: 1,248 (static, different from DEV)
- **Validation messages**: Classic, stricter ("Invalid email")
- **UI**: More conservative, stable chart library
- **Modal**: "Production Access Confirmed" with safety emphasis
- **Add User button**: Disabled for safety

## Intentional Differences (what QA Vision will detect)

- **CSS/Layout**: Different brand colors (emerald vs blue), button widths, banner gradients
- **Content**: Different welcome text, modal copy, button labels
- **Data**: User count (1250 vs 1248), revenue formatting
- **Functionality**: DEV has live counter and new features; PROD has safety restrictions
- **Validation**: Different error message text
- **Visual**: Different icons, spacing, and component styling

## One-Button Start

Run this single command from the root (or from `qa-vision/`):

```powershell
npm run start:all
```

This starts **all three applications simultaneously**:
- **DEV** (green) → http://localhost:3002
- **PROD** (blue) → http://localhost:3003  
- **QA Vision** (cyan) → http://localhost:3001

The `start:all` script uses `concurrently` so one terminal window runs everything.

After the servers start, open http://localhost:3001, select a profile and click **Launch Environments**. Sample login: `test@acme.com` / `password123`.

The sample profile URLs point at ports 3002 and 3003.

When you perform actions in DEV (login, click buttons, increment counter), the Playwright backend replicates them in PROD and QA Vision detects and reports the mismatches. AI analysis is optional and needs an API key (see README.md, Configuration).

These apps are intentionally built to trigger the comparison types described in README.md: DOM, CSS/layout, accessibility, data, network, console and safety.
