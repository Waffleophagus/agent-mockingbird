import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { getUsageDashboardSnapshot } from "../../db/repository";
import { resolveAppDistDir } from "../../paths";

type UsageWindow = "all" | "24h" | "7d" | "30d";

function parseWindow(value: string | null): UsageWindow {
  if (value === "24h" || value === "7d" || value === "30d") return value;
  return "all";
}

function getOpenCodeStylesheetLinks() {
  const appDistDir = resolveAppDistDir();
  if (!appDistDir) return "";
  const indexPath = path.join(appDistDir, "index.html");
  if (!existsSync(indexPath)) return "";
  const html = readFileSync(indexPath, "utf8");
  const hrefs = [...html.matchAll(/<link\s+rel="stylesheet"[^>]*href="([^"]+)"/g)].map(match => match[1]);
  return hrefs.map(href => `<link rel="stylesheet" crossorigin href="${href}">`).join("\n    ");
}

function usagePageHtml() {
  const stylesheetLinks = getOpenCodeStylesheetLinks();
  return `<!doctype html>
<html lang="en" style="background-color: var(--background-base)">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Usage</title>
    <link rel="icon" type="image/png" href="/favicon-96x96-v3.png" sizes="96x96" />
    <link rel="icon" type="image/svg+xml" href="/favicon-v3.svg" />
    <link rel="shortcut icon" href="/favicon-v3.ico" />
    <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon-v3.png" />
    <meta name="theme-color" content="#F8F7F7" />
    <meta name="theme-color" content="#131010" media="(prefers-color-scheme: dark)" />
    <script id="oc-theme-preload-script" src="/oc-theme-preload.js"></script>
    ${stylesheetLinks}
    <style>
      :root {
        color-scheme: light dark;
      }

      body {
        margin: 0;
        background: var(--background-base);
        color: var(--text-base);
      }

      .usage-shell {
        min-height: 100dvh;
        background:
          linear-gradient(180deg, color-mix(in srgb, var(--background-base) 82%, transparent), var(--background-base)),
          radial-gradient(circle at top left, color-mix(in srgb, var(--surface-interactive-base) 70%, transparent), transparent 32rem);
      }

      .usage-window-list {
        display: flex;
        gap: 0.4rem;
        flex-wrap: wrap;
      }

      .usage-window-button {
        border: 1px solid transparent;
        border-radius: 0.625rem;
        background: transparent;
        color: var(--text-base);
        text-align: center;
        padding: 0.75rem 0.85rem;
        cursor: pointer;
        transition: background-color 120ms ease, border-color 120ms ease, color 120ms ease;
      }

      .usage-window-button:hover {
        background: var(--surface-raised-base-hover);
        border-color: var(--border-weak-base);
        color: var(--text-strong);
      }

      .usage-window-button[data-active="true"] {
        background: var(--surface-base-active);
        border-color: var(--border-weak-selected);
        color: var(--text-strong);
      }

      .usage-main {
        min-width: 0;
        padding: 1rem;
      }

      .usage-content {
        max-width: 1200px;
        margin: 0 auto;
        display: flex;
        flex-direction: column;
        gap: 1rem;
      }

      .usage-card {
        border: 1px solid var(--border-weak-base);
        border-radius: 0.875rem;
        background: var(--surface-raised-base);
        box-shadow: var(--shadow-xs);
      }

      .usage-header {
        display: flex;
        align-items: center;
        gap: 1rem;
        padding: 1rem 1.1rem;
      }

      .usage-toolbar {
        padding-top: 0.1rem;
      }

      .usage-metrics {
        display: grid;
        grid-template-columns: repeat(5, minmax(0, 1fr));
        gap: 0.8rem;
      }

      .usage-metric {
        padding: 1rem 1.1rem;
      }

      .usage-metric-value {
        margin-top: 0.35rem;
        color: var(--text-strong);
        font-size: 1.4rem;
        letter-spacing: -0.03em;
      }

      .usage-panel {
        padding: 1rem 1.1rem;
      }

      .usage-table {
        width: 100%;
        border-collapse: collapse;
        table-layout: fixed;
      }

      .usage-table th,
      .usage-table td {
        padding: 0.7rem 0.75rem;
        border-bottom: 1px solid var(--border-weak-base);
        text-align: left;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .usage-table th:last-child,
      .usage-table td:last-child {
        text-align: right;
      }

      .usage-table th:first-child,
      .usage-table td:first-child {
        width: 40%;
      }

      .usage-table--model th:first-child,
      .usage-table--model td:first-child {
        width: 50%;
      }

      .usage-table tbody tr:hover {
        background: var(--surface-raised-base-hover);
      }

      .usage-recent {
        display: flex;
        flex-direction: column;
      }

      .usage-recent-item {
        display: grid;
        grid-template-columns: minmax(0, 2fr) repeat(5, minmax(0, 1fr));
        gap: 0.75rem;
        padding: 0.8rem 0;
        border-bottom: 1px solid var(--border-weak-base);
        align-items: center;
      }

      .usage-empty {
        padding: 0.75rem 0 0.25rem;
        color: var(--text-weak);
      }

      @media (max-width: 1080px) {
        .usage-metrics {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }
      }

      @media (max-width: 720px) {
        .usage-main {
          padding: 0.75rem;
        }

        .usage-header {
          flex-direction: column;
          align-items: flex-start;
        }

        .usage-metrics {
          grid-template-columns: 1fr;
        }

        .usage-recent-item {
          grid-template-columns: 1fr;
          gap: 0.35rem;
        }
      }
    </style>
  </head>
  <body class="antialiased overscroll-none text-12-regular bg-background-base text-text-base">
    <div class="usage-shell">
      <main class="usage-main">
        <div class="usage-content">
          <section class="usage-card usage-header">
            <div class="flex flex-col gap-1.5 min-w-0">
              <div class="text-16-medium text-text-strong">Runtime Usage Dashboard</div>
            </div>
          </section>

          <section class="usage-toolbar">
            <div class="usage-window-list" role="tablist" aria-label="Usage period">
              <button class="usage-window-button text-13-regular" data-window="all" data-active="true">All time</button>
              <button class="usage-window-button text-13-regular" data-window="24h">Last 24 hours</button>
              <button class="usage-window-button text-13-regular" data-window="7d">Last 7 days</button>
              <button class="usage-window-button text-13-regular" data-window="30d">Last 30 days</button>
            </div>
          </section>

          <section class="usage-metrics" id="metrics"></section>

          <section class="usage-card usage-panel">
            <div class="flex items-center justify-between gap-3 mb-3">
              <div>
                <div class="text-14-medium text-text-strong">By Provider</div>
                <div class="text-12-regular text-text-weak">Requests, input, output, total tokens, and estimated cost.</div>
              </div>
            </div>
            <div id="providers"></div>
          </section>

          <section class="usage-card usage-panel">
            <div class="flex items-center justify-between gap-3 mb-3">
              <div>
                <div class="text-14-medium text-text-strong">By Model</div>
                <div class="text-12-regular text-text-weak">Qualified model references tracked per event when available.</div>
              </div>
            </div>
            <div id="models"></div>
          </section>

          <section class="usage-card usage-panel">
            <div class="flex items-center justify-between gap-3 mb-3">
              <div>
                <div class="text-14-medium text-text-strong">Recent Activity</div>
                <div class="text-12-regular text-text-weak">The 50 latest usage deltas for the selected window.</div>
              </div>
            </div>
            <div id="recent"></div>
          </section>
        </div>
      </main>
    </div>

    <script type="module">
      const metricsEl = document.getElementById("metrics");
      const providersEl = document.getElementById("providers");
      const modelsEl = document.getElementById("models");
      const recentEl = document.getElementById("recent");
      const buttons = Array.from(document.querySelectorAll("[data-window]"));
      let currentWindow = "all";

      function formatNumber(value) {
        return new Intl.NumberFormat("en-US").format(Number(value || 0));
      }

      function formatUsd(value) {
        return new Intl.NumberFormat("en-US", {
          style: "currency",
          currency: "USD",
          minimumFractionDigits: 4,
          maximumFractionDigits: 4,
        }).format(Number(value || 0));
      }

      function setButtons() {
        for (const button of buttons) {
          button.dataset.active = button.dataset.window === currentWindow ? "true" : "false";
        }
      }

      function renderMetrics(payload) {
        const metrics = [
          ["Requests", formatNumber(payload.totals.requestCount)],
          ["Input Tokens", formatNumber(payload.totals.inputTokens)],
          ["Output Tokens", formatNumber(payload.totals.outputTokens)],
          ["Total Tokens", formatNumber(payload.totals.totalTokens)],
          ["Estimated Cost", formatUsd(payload.totals.estimatedCostUsd)],
        ];
        metricsEl.innerHTML = metrics.map(([label, value]) => \`
          <article class="usage-card usage-metric">
            <div class="text-12-medium text-text-weak">\${label}</div>
            <div class="usage-metric-value text-20-medium">\${value}</div>
          </article>
        \`).join("");
      }

      function renderTable(target, rows, columns, className = "") {
        if (!rows.length) {
          target.innerHTML = '<div class="usage-empty text-13-regular">No usage recorded for this period.</div>';
          return;
        }
        const head = columns.map(column => \`<th class="text-12-medium text-text-weak">\${column.label}</th>\`).join("");
        const body = rows.map(row => \`<tr>\${columns.map(column => \`<td class="text-13-regular \${column.className || ""}">\${column.render(row)}</td>\`).join("")}</tr>\`).join("");
        target.innerHTML = \`<table class="usage-table \${className}"><thead><tr>\${head}</tr></thead><tbody>\${body}</tbody></table>\`;
      }

      function renderRecent(rows) {
        if (!rows.length) {
          recentEl.innerHTML = '<div class="usage-empty text-13-regular">No recent activity in this period.</div>';
          return;
        }
        recentEl.innerHTML = \`<div class="usage-recent">\${rows.map(row => \`
          <article class="usage-recent-item">
            <div class="min-w-0">
              <div class="text-13-regular text-text-strong truncate">\${row.sessionTitle || row.sessionId || "Unbound usage event"}</div>
              <div class="text-12-regular text-text-weak font-mono truncate">\${row.providerId || "unknown"}/\${row.modelId || "unknown"}</div>
              <div class="text-12-regular text-text-weak">\${new Date(row.createdAt).toLocaleString()}</div>
            </div>
            <div class="text-13-regular text-text-base">\${formatNumber(row.requestCount)}</div>
            <div class="text-13-regular text-text-base">\${formatNumber(row.inputTokens)}</div>
            <div class="text-13-regular text-text-base">\${formatNumber(row.outputTokens)}</div>
            <div class="text-13-regular text-text-base">\${formatNumber(row.totalTokens)}</div>
            <div class="text-13-regular text-text-strong">\${formatUsd(row.estimatedCostUsd)}</div>
          </article>
        \`).join("")}</div>\`;
      }

      async function loadUsage() {
        const response = await fetch(\`/api/usage/dashboard?window=\${encodeURIComponent(currentWindow)}\`);
        const payload = await response.json();
        renderMetrics(payload);
        renderTable(providersEl, payload.providers, [
          { label: 'Provider', render: row => row.providerId, className: 'font-mono text-text-strong' },
          { label: 'Req', render: row => formatNumber(row.requestCount) },
          { label: 'In', render: row => formatNumber(row.inputTokens) },
          { label: 'Out', render: row => formatNumber(row.outputTokens) },
          { label: 'Total', render: row => formatNumber(row.totalTokens) },
          { label: 'Cost', render: row => formatUsd(row.estimatedCostUsd), className: 'text-text-strong' },
        ]);
        renderTable(modelsEl, payload.models, [
          { label: 'Model', render: row => \`\${row.providerId}/\${row.modelId}\`, className: 'font-mono text-text-strong' },
          { label: 'Req', render: row => formatNumber(row.requestCount) },
          { label: 'In', render: row => formatNumber(row.inputTokens) },
          { label: 'Out', render: row => formatNumber(row.outputTokens) },
          { label: 'Total', render: row => formatNumber(row.totalTokens) },
          { label: 'Cost', render: row => formatUsd(row.estimatedCostUsd), className: 'text-text-strong' },
        ], "usage-table--model");
        renderRecent(payload.recent);
      }

      for (const button of buttons) {
        button.addEventListener("click", () => {
          currentWindow = button.dataset.window || "all";
          setButtons();
          void loadUsage();
        });
      }

      setButtons();
      void loadUsage();
      window.setInterval(() => { void loadUsage(); }, 15000);
    </script>
  </body>
</html>`;
}

export function createUsageRoutes() {
  return {
    "/api/usage/dashboard": {
      GET: (req: Request) => {
        const url = new URL(req.url);
        const window = parseWindow(url.searchParams.get("window"));
        return Response.json(getUsageDashboardSnapshot(window));
      },
    },

    "/usage": {
      GET: () =>
        new Response(usagePageHtml(), {
          headers: {
            "content-type": "text/html; charset=utf-8",
          },
        }),
    },
  };
}
