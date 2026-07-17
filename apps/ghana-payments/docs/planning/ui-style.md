# UI Style Guide — Ghana Payments portals

Requested direction (2026-07-11): similar feel to Vocovo's cloud-sandbox app, **but orange-primary**. Applies to all three portals (payment `/pay`, merchant `/admin`, soundbox `/soundbox`) and the spike page.

## Tokens

```css
:root {
  /* Surfaces — dark, layered */
  --surface: #0D0D12;          /* page background */
  --surface-raised: #16161E;   /* cards, panels */
  --surface-overlay: #1E1E2A;  /* modals, dropdowns */
  --border: rgba(255,255,255,0.08);
  --border-hover: rgba(255,255,255,0.14);

  /* Text scale */
  --text: #E8E8EC;
  --text-muted: #8E8E9A;
  --text-dim: #5E5E6E;

  /* Accent — ORANGE primary (the "more orange" ask) */
  --accent: #F97316;           /* primary actions, highlights */
  --accent-hover: #FB8C3C;
  --accent-soft: rgba(249,115,22,0.15); /* tinted backgrounds */
  --coral: #F97C62;            /* secondary accent */
  --blue: #496BFB;             /* links, info */

  /* Semantic status (Tailwind emerald/amber/blue scale) */
  --success: #34d399;
  --warning: #fbbf24;
  --info: #60a5fa;
  --danger: #f87171;

  --font-sans: 'Poppins', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
}
```

## Feel

- Dark UI throughout; cards on `--surface-raised` with 1px `--border`, radius ~10–12px.
- Poppins (300/400/500/600) — self-host via `@fontsource/poppins` when bundling; system-sans fallback is fine for the spike.
- Primary buttons: solid `--accent`, dark text `#0D0D12`, radius 8px; hover `--accent-hover`.
- Status chips: tinted background (`--accent-soft` pattern) + solid dot; payment states map SUCCESS→`--success`, PENDING→`--warning`, FAILED/EXPIRED→`--danger`.
- Monospace terminal-style log panels for event/debug views (near-black `#08080C`).
- Mobile-first for `/pay` — single column, big amount input, thumb-sized Pay button in `--accent`.
