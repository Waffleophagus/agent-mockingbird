import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { getUsageDashboardSnapshot } from "../../db/repository";
import { resolveAppDistDir } from "../../paths";

interface UsageDashboardRangeQuery {
  startAt: number | null;
  endAtExclusive: number | null;
}

function parseRangeQuery(url: URL): UsageDashboardRangeQuery | Response {
  const rawStartAt = url.searchParams.get("startAt");
  const rawEndAtExclusive = url.searchParams.get("endAtExclusive");
  const trimmedStartAt = rawStartAt?.trim() ?? null;
  const trimmedEndAtExclusive = rawEndAtExclusive?.trim() ?? null;

  const startAt =
    trimmedStartAt === null || trimmedStartAt === ""
      ? null
      : Number(trimmedStartAt);
  if (startAt !== null && (!Number.isFinite(startAt) || !Number.isInteger(startAt) || startAt < 0)) {
    return Response.json(
      { error: "startAt must be a non-negative integer timestamp" },
      { status: 400 },
    );
  }

  const endAtExclusive =
    trimmedEndAtExclusive === null || trimmedEndAtExclusive === ""
      ? null
      : Number(trimmedEndAtExclusive);
  if (
    endAtExclusive !== null &&
    (!Number.isFinite(endAtExclusive) || !Number.isInteger(endAtExclusive) || endAtExclusive < 0)
  ) {
    return Response.json(
      { error: "endAtExclusive must be a non-negative integer timestamp" },
      { status: 400 },
    );
  }

  if (startAt !== null && endAtExclusive !== null && startAt >= endAtExclusive) {
    return Response.json(
      { error: "startAt must be earlier than endAtExclusive" },
      { status: 400 },
    );
  }

  return { startAt, endAtExclusive };
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
    <title>Usage Report</title>
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

      * {
        margin: 0;
        padding: 0;
        box-sizing: border-box;
      }

      body {
        font-family: var(--font-family-sans);
        background: var(--background-base);
        color: var(--text-base);
        line-height: var(--line-height-large);
        min-height: 100dvh;
      }

      .usage-shell {
        min-height: 100dvh;
        display: flex;
        flex-direction: column;
        max-width: 1200px;
        margin: 0 auto;
      }

      .usage-header {
        padding: 16px 16px 0;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
      }

      .usage-header-left {
        display: flex;
        align-items: center;
        gap: 12px;
        flex-wrap: wrap;
      }

      .usage-back {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px 14px;
        border-radius: var(--radius-md);
        color: var(--text-base);
        text-decoration: none;
        font-size: var(--font-size-small);
        font-weight: var(--font-weight-medium);
        border: 1px solid var(--border-weak-base);
        background: var(--surface-raised-base);
        transition: all 0.15s ease;
      }

      .usage-back:hover {
        background: var(--surface-raised-base-hover);
      }

      .usage-title {
        font-size: var(--font-size-x-large);
        font-weight: var(--font-weight-medium);
        color: var(--text-strong);
      }

      .usage-tabs {
        display: flex;
        gap: 4px;
        padding: 0 16px;
        border-bottom: 1px solid var(--border-weak-base);
        margin-top: 16px;
        overflow-x: auto;
        -webkit-overflow-scrolling: touch;
        scrollbar-width: none;
        -ms-overflow-style: none;
      }

      .usage-tabs::-webkit-scrollbar {
        display: none;
      }

      .usage-tab {
        padding: 12px 16px;
        font-family: var(--font-family-sans);
        font-size: var(--font-size-small);
        font-weight: var(--font-weight-medium);
        border: none;
        border-bottom: 2px solid transparent;
        background: transparent;
        color: var(--text-weak);
        cursor: pointer;
        transition: all 0.15s ease;
        margin-bottom: -1px;
        white-space: nowrap;
        flex-shrink: 0;
      }

      .usage-tab:hover {
        color: var(--text-base);
      }

      .usage-tab.active {
        color: var(--text-interactive-base);
        border-bottom-color: var(--text-interactive-base);
      }

      .usage-content {
        flex: 1;
        padding: 16px;
        overflow-y: auto;
      }

      .usage-tab-panel {
        display: none;
      }

      .usage-tab-panel.active {
        display: block;
      }

      .usage-controls {
        display: flex;
        gap: 12px;
        margin-bottom: 20px;
        padding: 12px;
        background: var(--surface-raised-base);
        border: 1px solid var(--border-weak-base);
        border-radius: var(--radius-lg);
        align-items: flex-end;
        flex-wrap: wrap;
      }

      .usage-date-group {
        display: flex;
        gap: 8px;
        flex: 1;
        min-width: 0;
      }

      .usage-date-field {
        flex: 1;
      }

      .usage-date-field label {
        display: block;
        font-size: var(--font-size-small);
        color: var(--text-weak);
        margin-bottom: 6px;
        font-weight: var(--font-weight-medium);
      }

      .usage-date-input {
        width: 100%;
        height: 36px;
        padding: 0 12px;
        font-family: var(--font-family-sans);
        font-size: var(--font-size-small);
        border: 1px solid var(--border-weak-base);
        border-radius: var(--radius-md);
        background: var(--input-base);
        color: var(--text-strong);
      }

      .usage-date-input:focus {
        outline: none;
        border-color: var(--border-selected);
        box-shadow: var(--shadow-xs-border-select);
      }

      .usage-quick-btns {
        display: flex;
        gap: 6px;
        flex-wrap: wrap;
      }

      .usage-quick-btn {
        padding: 8px 12px;
        font-family: var(--font-family-sans);
        font-size: var(--font-size-small);
        font-weight: var(--font-weight-medium);
        border: 1px solid var(--border-weak-base);
        border-radius: var(--radius-md);
        background: var(--surface-base);
        color: var(--text-base);
        cursor: pointer;
        transition: all 0.15s ease;
        white-space: nowrap;
        min-height: 36px;
      }

      .usage-quick-btn:hover {
        background: var(--surface-base-hover);
        border-color: var(--border-weak-selected);
      }

      .usage-quick-btn.active {
        background: var(--surface-interactive-base);
        border-color: var(--border-interactive-base);
        color: var(--text-interactive-base);
      }

      .usage-stats-row {
        display: grid;
        grid-template-columns: repeat(2, 1fr);
        gap: 12px;
        margin-bottom: 24px;
      }

      .usage-stat-card {
        padding: 16px;
        background: var(--surface-raised-base);
        border: 1px solid var(--border-weak-base);
        border-radius: var(--radius-lg);
        box-shadow: var(--shadow-xs);
      }

      .usage-stat-label {
        font-size: var(--font-size-small);
        color: var(--text-weak);
        margin-bottom: 6px;
        display: flex;
        align-items: center;
        gap: 6px;
      }

      .usage-stat-value {
        font-size: 24px;
        font-weight: var(--font-weight-medium);
        color: var(--text-strong);
        font-variant-numeric: tabular-nums;
      }

      .usage-detail-grid {
        display: grid;
        grid-template-columns: 1fr;
        gap: 12px;
      }

      .usage-detail-card {
        background: var(--surface-raised-base);
        border: 1px solid var(--border-weak-base);
        border-radius: var(--radius-lg);
        overflow: hidden;
      }

      .usage-detail-header {
        padding: 12px 16px;
        background: var(--background-weak);
        border-bottom: 1px solid var(--border-weak-base);
        font-weight: var(--font-weight-medium);
        color: var(--text-strong);
      }

      .usage-detail-list {
        padding: 8px 0;
      }

      .usage-detail-item {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 10px 16px;
        border-bottom: 1px solid var(--border-weaker-base);
      }

      .usage-detail-item:last-child {
        border-bottom: none;
      }

      .usage-detail-name {
        font-size: var(--font-size-small);
        color: var(--text-base);
      }

      .usage-detail-value {
        font-size: var(--font-size-small);
        font-weight: var(--font-weight-medium);
        color: var(--text-strong);
        font-variant-numeric: tabular-nums;
      }

      .usage-table-container {
        background: var(--surface-raised-base);
        border: 1px solid var(--border-weak-base);
        border-radius: var(--radius-lg);
        overflow-x: auto;
        -webkit-overflow-scrolling: touch;
      }

      .usage-table {
        width: 100%;
        min-width: 600px;
        border-collapse: collapse;
        font-size: var(--font-size-small);
      }

      .usage-table th {
        text-align: left;
        padding: 12px 16px;
        font-weight: var(--font-weight-medium);
        color: var(--text-weak);
        background: var(--background-weak);
        border-bottom: 1px solid var(--border-weak-base);
      }

      .usage-table th:last-child,
      .usage-table td:last-child {
        text-align: right;
      }

      .usage-table td {
        padding: 12px 16px;
        border-bottom: 1px solid var(--border-weaker-base);
      }

      .usage-table tr:last-child td {
        border-bottom: none;
      }

      .usage-table tr:hover td {
        background: var(--surface-raised-base-hover);
      }

      @media (min-width: 768px) {
        .usage-header {
          padding: 20px 24px 0;
        }
        .usage-tabs {
          padding: 0 24px;
        }
        .usage-content {
          padding: 24px;
        }
        .usage-stats-row {
          grid-template-columns: repeat(4, 1fr);
          gap: 16px;
        }
        .usage-detail-grid {
          grid-template-columns: repeat(2, 1fr);
          gap: 16px;
        }
        .usage-stat-card {
          padding: 20px;
        }
        .usage-stat-value {
          font-size: 28px;
        }
        .usage-controls {
          gap: 16px;
          padding: 16px;
        }
        .usage-date-group {
          min-width: 280px;
        }
        .usage-quick-btn {
          padding: 8px 16px;
        }
      }

      @media (max-width: 480px) {
        .usage-header-left {
          width: 100%;
          justify-content: space-between;
        }
        .usage-title {
          font-size: var(--font-size-large);
        }
        .usage-back {
          padding: 6px 10px;
          font-size: var(--font-size-xs);
        }
        .usage-stat-value {
          font-size: 20px;
        }
        .usage-stat-label {
          font-size: var(--font-size-xs);
        }
        .usage-detail-item {
          padding: 8px 12px;
        }
        .usage-detail-name,
        .usage-detail-value {
          font-size: var(--font-size-xs);
        }
        .usage-table th,
        .usage-table td {
          padding: 8px 12px;
        }
      }
    </style>
  </head>
  <body>
    <div class="usage-shell">
      <header class="usage-header">
        <div class="usage-header-left">
          <a href="/" class="usage-back">← Back</a>
          <h1 class="usage-title">Usage Report</h1>
        </div>
      </header>

      <nav class="usage-tabs">
        <button class="usage-tab active" data-tab="overview">Overview</button>
        <button class="usage-tab" data-tab="models">Models</button>
        <button class="usage-tab" data-tab="providers">Providers</button>
      </nav>

      <main class="usage-content">
        <div class="usage-tab-panel active" id="tab-overview">
          <div class="usage-controls">
            <div class="usage-date-group">
              <div class="usage-date-field">
                <label>From</label>
                <input type="date" class="usage-date-input" id="start-date" />
              </div>
              <div class="usage-date-field">
                <label>To</label>
                <input type="date" class="usage-date-input" id="end-date" />
              </div>
            </div>
            <div class="usage-quick-btns">
              <button class="usage-quick-btn active" data-range="month">Month</button>
              <button class="usage-quick-btn" data-range="week">Week</button>
              <button class="usage-quick-btn" data-range="day">Day</button>
              <button class="usage-quick-btn" data-range="all">All</button>
            </div>
          </div>

          <div class="usage-stats-row">
            <div class="usage-stat-card">
              <div class="usage-stat-label">Total Requests</div>
              <div class="usage-stat-value" id="stat-requests">0</div>
            </div>
            <div class="usage-stat-card">
              <div class="usage-stat-label">Input Tokens</div>
              <div class="usage-stat-value" id="stat-input">0</div>
            </div>
            <div class="usage-stat-card">
              <div class="usage-stat-label">Output Tokens</div>
              <div class="usage-stat-value" id="stat-output">0</div>
            </div>
            <div class="usage-stat-card">
              <div class="usage-stat-label">Total Cost</div>
              <div class="usage-stat-value" id="stat-cost">$0.00</div>
            </div>
          </div>

          <div class="usage-detail-grid">
            <div class="usage-detail-card">
              <div class="usage-detail-header">By Model</div>
              <div class="usage-detail-list" id="models-list"></div>
            </div>
            <div class="usage-detail-card">
              <div class="usage-detail-header">By Provider</div>
              <div class="usage-detail-list" id="providers-list"></div>
            </div>
          </div>
        </div>

        <div class="usage-tab-panel" id="tab-models">
          <div class="usage-table-container">
            <table class="usage-table">
              <thead>
                <tr>
                  <th>Model</th>
                  <th>Provider</th>
                  <th style="text-align: right">Requests</th>
                  <th style="text-align: right">Tokens In</th>
                  <th style="text-align: right">Tokens Out</th>
                  <th style="text-align: right">Total</th>
                  <th style="text-align: right">Cost</th>
                </tr>
              </thead>
              <tbody id="models-tbody"></tbody>
            </table>
          </div>
        </div>

        <div class="usage-tab-panel" id="tab-providers">
          <div class="usage-table-container">
            <table class="usage-table">
              <thead>
                <tr>
                  <th>Provider</th>
                  <th style="text-align: right">Requests</th>
                  <th style="text-align: right">Tokens In</th>
                  <th style="text-align: right">Tokens Out</th>
                  <th style="text-align: right">Total</th>
                  <th style="text-align: right">Cost</th>
                </tr>
              </thead>
              <tbody id="providers-tbody"></tbody>
            </table>
          </div>
        </div>
      </main>
    </div>

    <script type="module">
      const fmt = (n) => new Intl.NumberFormat("en-US").format(n);
      const fmtUsd = (n) => new Intl.NumberFormat("en-US", {
        style: "currency", currency: "USD", minimumFractionDigits: 2
      }).format(n);
      const safeText = (value) =>
        typeof value === "string" ? value : value == null ? "" : String(value);
      const toDateInputValue = (date) => {
        const year = String(date.getFullYear());
        const month = String(date.getMonth() + 1).padStart(2, "0");
        const day = String(date.getDate()).padStart(2, "0");
        return \`\${year}-\${month}-\${day}\`;
      };
      const parseDateInputValue = (value) => {
        if (!value) return null;
        const [yearText, monthText, dayText] = value.split("-");
        const year = Number(yearText);
        const monthIndex = Number(monthText) - 1;
        const day = Number(dayText);
        if (!Number.isInteger(year) || !Number.isInteger(monthIndex) || !Number.isInteger(day)) {
          return null;
        }
        const start = new Date(year, monthIndex, day);
        if (
          start.getFullYear() !== year ||
          start.getMonth() !== monthIndex ||
          start.getDate() !== day
        ) {
          return null;
        }
        return {
          start,
          endExclusive: new Date(year, monthIndex, day + 1),
        };
      };
      const shiftLocalDate = (date, days) =>
        new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);

      function createTextElement(tagName, className, text) {
        const element = document.createElement(tagName);
        if (className) {
          element.className = className;
        }
        element.textContent = text;
        return element;
      }

      function createCell(text, rightAlign = false) {
        const cell = document.createElement("td");
        cell.textContent = text;
        if (rightAlign) {
          cell.style.textAlign = "right";
        }
        return cell;
      }

      function replaceChildren(targetId, children) {
        const target = document.getElementById(targetId);
        target.replaceChildren(...children);
      }

      let currentStart = null;
      let currentEnd = null;

      const now = new Date();
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
      currentStart = toDateInputValue(startOfMonth);
      currentEnd = toDateInputValue(today);
      document.getElementById("start-date").value = currentStart;
      document.getElementById("end-date").value = currentEnd;

      async function loadData() {
        const url = new URL("/api/usage/dashboard", window.location.origin);
        const startRange = parseDateInputValue(currentStart);
        const endRange = parseDateInputValue(currentEnd);
        if (startRange) url.searchParams.set("startAt", String(startRange.start.getTime()));
        if (endRange) url.searchParams.set("endAtExclusive", String(endRange.endExclusive.getTime()));

        try {
          const res = await fetch(url);
          if (!res.ok) throw new Error("Failed");
          const data = await res.json();
          render(data);
        } catch (err) {
          console.error(err);
        }
      }

      function render(data) {
        document.getElementById("stat-requests").textContent = fmt(data.totals.requestCount);
        document.getElementById("stat-input").textContent = fmt(data.totals.inputTokens);
        document.getElementById("stat-output").textContent = fmt(data.totals.outputTokens);
        document.getElementById("stat-cost").textContent = fmtUsd(data.totals.estimatedCostUsd);

        replaceChildren(
          "models-list",
          data.models.slice(0, 5).map((model) => {
            const item = document.createElement("div");
            item.className = "usage-detail-item";
            item.append(
              createTextElement("span", "usage-detail-name", safeText(model.modelId)),
              createTextElement("span", "usage-detail-value", fmtUsd(model.estimatedCostUsd)),
            );
            return item;
          }),
        );

        replaceChildren(
          "providers-list",
          data.providers.slice(0, 5).map((provider) => {
            const item = document.createElement("div");
            item.className = "usage-detail-item";
            item.append(
              createTextElement("span", "usage-detail-name", safeText(provider.providerId)),
              createTextElement("span", "usage-detail-value", fmtUsd(provider.estimatedCostUsd)),
            );
            return item;
          }),
        );

        replaceChildren(
          "models-tbody",
          data.models.map((model) => {
            const row = document.createElement("tr");
            row.append(
              createCell(safeText(model.modelId)),
              createCell(safeText(model.providerId)),
              createCell(fmt(model.requestCount), true),
              createCell(fmt(model.inputTokens), true),
              createCell(fmt(model.outputTokens), true),
              createCell(fmt(model.totalTokens), true),
              createCell(fmtUsd(model.estimatedCostUsd), true),
            );
            return row;
          }),
        );

        replaceChildren(
          "providers-tbody",
          data.providers.map((provider) => {
            const row = document.createElement("tr");
            row.append(
              createCell(safeText(provider.providerId)),
              createCell(fmt(provider.requestCount), true),
              createCell(fmt(provider.inputTokens), true),
              createCell(fmt(provider.outputTokens), true),
              createCell(fmt(provider.totalTokens), true),
              createCell(fmtUsd(provider.estimatedCostUsd), true),
            );
            return row;
          }),
        );
      }

      document.querySelectorAll(".usage-tab").forEach(tab => {
        tab.addEventListener("click", () => {
          document.querySelectorAll(".usage-tab").forEach(t => t.classList.remove("active"));
          document.querySelectorAll(".usage-tab-panel").forEach(p => p.classList.remove("active"));
          tab.classList.add("active");
          document.getElementById(\`tab-\${tab.dataset.tab}\`).classList.add("active");
        });
      });

      document.querySelectorAll(".usage-quick-btn").forEach(btn => {
        btn.addEventListener("click", () => {
          document.querySelectorAll(".usage-quick-btn").forEach(b => b.classList.remove("active"));
          btn.classList.add("active");
          const range = btn.dataset.range;
          const end = new Date();
          const endLocal = new Date(end.getFullYear(), end.getMonth(), end.getDate());
          let startLocal = endLocal;
          if (range === "month") startLocal = new Date(endLocal.getFullYear(), endLocal.getMonth(), 1);
          else if (range === "week") startLocal = shiftLocalDate(endLocal, -7);
          else if (range === "day") startLocal = endLocal;
          currentStart = range === "all" ? null : toDateInputValue(startLocal);
          currentEnd = range === "all" ? null : toDateInputValue(endLocal);
          document.getElementById("start-date").value = currentStart ?? "";
          document.getElementById("end-date").value = currentEnd ?? "";
          loadData();
        });
      });

      document.getElementById("start-date").addEventListener("change", (e) => {
        currentStart = e.target.value || null;
        loadData();
      });

      document.getElementById("end-date").addEventListener("change", (e) => {
        currentEnd = e.target.value || null;
        loadData();
      });

      loadData();
      setInterval(loadData, 15000);
    </script>
  </body>
</html>`;
}

export function createUsageRoutes() {
  return {
    "/api/usage/dashboard": {
      GET: (req: Request) => {
        const url = new URL(req.url);
        const query = parseRangeQuery(url);
        if (query instanceof Response) return query;
        return Response.json(getUsageDashboardSnapshot(query));
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
