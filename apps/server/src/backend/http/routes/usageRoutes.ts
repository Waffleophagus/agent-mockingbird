import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { getUsageDashboardSnapshot } from "../../db/repository";
import { resolveAppDistDir } from "../../paths";

interface UsageDashboardRangeQuery {
  startAt: number | null;
  endAtExclusive: number | null;
}

function parseOptionalMillis(value: string | null): number | null {
  if (value === null || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < 0) return null;
  return parsed;
}

function parseRangeQuery(url: URL): UsageDashboardRangeQuery | Response {
  const startAt = parseOptionalMillis(url.searchParams.get("startAt"));
  const endAtExclusive = parseOptionalMillis(url.searchParams.get("endAtExclusive"));

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
        justify-content: space-between;
        gap: 1rem;
        padding: 1rem 1.1rem;
      }

      .usage-header-copy {
        min-width: 0;
      }

      .usage-back-link {
        display: inline-flex;
        align-items: center;
        gap: 0.45rem;
        text-decoration: none;
        color: var(--text-weak);
        border: 1px solid transparent;
        border-radius: 999px;
        padding: 0.45rem 0.7rem;
        transition: color 120ms ease, background-color 120ms ease, border-color 120ms ease;
      }

      .usage-back-link:hover {
        color: var(--text-strong);
        background: var(--surface-raised-base-hover);
        border-color: var(--border-weak-base);
      }

      .usage-toolbar-card {
        padding: 1rem 1.1rem;
        display: flex;
        flex-direction: column;
        gap: 0.9rem;
      }

      .usage-filter-form {
        display: flex;
        align-items: end;
        justify-content: space-between;
        gap: 1rem;
        flex-wrap: wrap;
      }

      .usage-filter-fields {
        display: flex;
        gap: 0.75rem;
        flex-wrap: wrap;
      }

      .usage-filter-field {
        display: flex;
        flex-direction: column;
        gap: 0.4rem;
        min-width: min(100%, 13rem);
      }

      .usage-date-input {
        appearance: none;
        min-height: 2.75rem;
        border: 1px solid var(--border-weak-base);
        border-radius: 0.75rem;
        background: var(--surface-base);
        color: var(--text-strong);
        padding: 0.7rem 0.8rem;
      }

      .usage-date-input:focus {
        outline: 2px solid color-mix(in srgb, var(--border-weak-selected) 45%, transparent);
        outline-offset: 1px;
        border-color: var(--border-weak-selected);
      }

      .usage-filter-actions {
        display: flex;
        gap: 0.55rem;
        flex-wrap: wrap;
        align-items: center;
      }

      .usage-filter-button {
        border: 1px solid var(--border-weak-base);
        border-radius: 999px;
        background: var(--surface-base);
        color: var(--text-base);
        padding: 0.7rem 0.95rem;
        cursor: pointer;
        transition: background-color 120ms ease, border-color 120ms ease, color 120ms ease;
      }

      .usage-filter-button:hover {
        background: var(--surface-raised-base-hover);
        border-color: var(--border-weak-selected);
        color: var(--text-strong);
      }

      .usage-filter-button--primary {
        background: var(--surface-base-active);
        border-color: var(--border-weak-selected);
        color: var(--text-strong);
      }

      .usage-filter-summary {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 0.75rem;
        flex-wrap: wrap;
      }

      .usage-filter-status {
        min-height: 1rem;
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

      .usage-table-wrap {
        overflow-x: auto;
      }

      .usage-table {
        width: 100%;
        min-width: 42rem;
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

      .usage-table--recent {
        min-width: 70rem;
      }

      .usage-table--recent th:first-child,
      .usage-table--recent td:first-child {
        width: 24%;
      }

      .usage-table--recent th:nth-child(2),
      .usage-table--recent td:nth-child(2) {
        width: 20%;
      }

      .usage-table tbody tr:hover {
        background: var(--surface-raised-base-hover);
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

        .usage-filter-form {
          align-items: stretch;
        }

        .usage-filter-fields,
        .usage-filter-field,
        .usage-filter-actions {
          width: 100%;
        }

        .usage-filter-button {
          flex: 1 1 10rem;
          justify-content: center;
        }

        .usage-metrics {
          grid-template-columns: 1fr;
        }
      }
    </style>
  </head>
  <body class="antialiased overscroll-none text-12-regular bg-background-base text-text-base">
    <div class="usage-shell">
      <main class="usage-main">
        <div class="usage-content">
          <section class="usage-card usage-header">
            <div class="usage-header-copy flex flex-col gap-1.5">
              <div class="text-16-medium text-text-strong">Runtime Usage Dashboard</div>
              <div class="text-12-regular text-text-weak">Calendar-based usage slices, grouped totals, and the latest deltas in the selected range.</div>
            </div>
            <a class="usage-back-link text-12-medium" href="/" data-action="usage-back-link" aria-label="Back to app">
              <span aria-hidden="true">←</span>
              <span>Back to app</span>
            </a>
          </section>

          <section class="usage-card usage-toolbar-card">
            <form class="usage-filter-form" id="usage-filter-form">
              <div class="usage-filter-fields">
                <label class="usage-filter-field">
                  <span class="text-12-medium text-text-weak">Start date</span>
                  <input class="usage-date-input text-13-regular" id="usage-start-date" type="date" />
                </label>
                <label class="usage-filter-field">
                  <span class="text-12-medium text-text-weak">End date</span>
                  <input class="usage-date-input text-13-regular" id="usage-end-date" type="date" />
                </label>
              </div>

              <div class="usage-filter-actions">
                <button class="usage-filter-button usage-filter-button--primary text-13-medium" type="submit">Apply range</button>
                <button class="usage-filter-button text-13-medium" type="button" id="usage-month-to-date">Month to date</button>
                <button class="usage-filter-button text-13-medium" type="button" id="usage-all-time">All time</button>
              </div>
            </form>

            <div class="usage-filter-summary">
              <div>
                <div class="text-12-medium text-text-weak">Selection</div>
                <div class="text-13-regular text-text-strong" id="usage-range-summary"></div>
              </div>
              <div class="usage-filter-status text-12-regular text-text-danger" id="usage-filter-status" role="status" aria-live="polite"></div>
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
                <div class="text-12-regular text-text-weak">The 50 latest usage deltas for the selected date range.</div>
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
      const backLink = document.querySelector("[data-action='usage-back-link']");
      const filterForm = document.getElementById("usage-filter-form");
      const startDateInput = document.getElementById("usage-start-date");
      const endDateInput = document.getElementById("usage-end-date");
      const monthToDateButton = document.getElementById("usage-month-to-date");
      const allTimeButton = document.getElementById("usage-all-time");
      const rangeSummaryEl = document.getElementById("usage-range-summary");
      const filterStatusEl = document.getElementById("usage-filter-status");

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

      function escapeHtml(value) {
        return String(value ?? "")
          .replaceAll("&", "&amp;")
          .replaceAll("<", "&lt;")
          .replaceAll(">", "&gt;")
          .replaceAll('"', "&quot;")
          .replaceAll("'", "&#39;");
      }

      function formatDateInput(date) {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, "0");
        const day = String(date.getDate()).padStart(2, "0");
        return year + "-" + month + "-" + day;
      }

      function parseDateValue(value) {
        if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(value || "")) return null;
        const [year, month, day] = value.split("-").map(Number);
        const start = new Date(year, month - 1, day);
        if (
          start.getFullYear() !== year ||
          start.getMonth() !== month - 1 ||
          start.getDate() !== day
        ) {
          return null;
        }

        return {
          startAt: start.getTime(),
          endAtExclusive: new Date(year, month - 1, day + 1).getTime(),
        };
      }

      function getMonthToDateSelection() {
        const now = new Date();
        return {
          startDate: formatDateInput(new Date(now.getFullYear(), now.getMonth(), 1)),
          endDate: formatDateInput(now),
        };
      }

      function readSelectionFromUrl() {
        const url = new URL(window.location.href);
        const startDate = url.searchParams.get("start");
        const endDate = url.searchParams.get("end");

        if (!startDate && !endDate) return getMonthToDateSelection();
        if (!startDate || !endDate) return getMonthToDateSelection();
        if (!parseDateValue(startDate) || !parseDateValue(endDate) || startDate > endDate) {
          return getMonthToDateSelection();
        }

        return { startDate, endDate };
      }

      let currentSelection = readSelectionFromUrl();

      function syncInputsFromSelection() {
        startDateInput.value = currentSelection.startDate || "";
        endDateInput.value = currentSelection.endDate || "";
      }

      function syncUrlFromSelection() {
        const url = new URL(window.location.href);
        if (currentSelection.startDate && currentSelection.endDate) {
          url.searchParams.set("start", currentSelection.startDate);
          url.searchParams.set("end", currentSelection.endDate);
        } else {
          url.searchParams.delete("start");
          url.searchParams.delete("end");
        }
        window.history.replaceState({}, "", url);
      }

      function formatHumanDate(value) {
        const parsed = parseDateValue(value);
        if (!parsed) return value;
        return new Date(parsed.startAt).toLocaleDateString(undefined, {
          year: "numeric",
          month: "short",
          day: "numeric",
        });
      }

      function renderSelectionSummary() {
        if (!currentSelection.startDate || !currentSelection.endDate) {
          rangeSummaryEl.textContent = "All recorded usage";
          return;
        }

        if (currentSelection.startDate === currentSelection.endDate) {
          rangeSummaryEl.textContent = formatHumanDate(currentSelection.startDate);
          return;
        }

        rangeSummaryEl.textContent = formatHumanDate(currentSelection.startDate) + " to " + formatHumanDate(currentSelection.endDate);
      }

      function setFilterStatus(message) {
        filterStatusEl.textContent = message || "";
      }

      function buildRequestUrl() {
        const url = new URL("/api/usage/dashboard", window.location.origin);
        if (currentSelection.startDate && currentSelection.endDate) {
          const start = parseDateValue(currentSelection.startDate);
          const end = parseDateValue(currentSelection.endDate);
          if (start && end) {
            url.searchParams.set("startAt", String(start.startAt));
            url.searchParams.set("endAtExclusive", String(end.endAtExclusive));
          }
        }
        return url.toString();
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
            <div class="text-12-medium text-text-weak">\${escapeHtml(label)}</div>
            <div class="usage-metric-value text-20-medium">\${escapeHtml(value)}</div>
          </article>
        \`).join("");
      }

      function renderTable(target, rows, columns, className = "") {
        if (!rows.length) {
          target.innerHTML = '<div class="usage-empty text-13-regular">No usage recorded for this range.</div>';
          return;
        }

        const head = columns
          .map(column => \`<th class="text-12-medium text-text-weak">\${escapeHtml(column.label)}</th>\`)
          .join("");
        const body = rows
          .map(row => \`<tr>\${columns.map(column => \`<td class="text-13-regular \${escapeHtml(column.className || "")}">\${escapeHtml(column.render(row))}</td>\`).join("")}</tr>\`)
          .join("");

        target.innerHTML = \`<div class="usage-table-wrap"><table class="usage-table \${escapeHtml(className)}"><thead><tr>\${head}</tr></thead><tbody>\${body}</tbody></table></div>\`;
      }

      function renderRecent(rows) {
        renderTable(
          recentEl,
          rows,
          [
            {
              label: "Session",
              render: row => row.sessionTitle || row.sessionId || "Unbound usage event",
              className: "text-text-strong",
            },
            {
              label: "Model",
              render: row => (row.providerId || "unknown") + "/" + (row.modelId || "unknown"),
              className: "font-mono text-text-weak",
            },
            {
              label: "When",
              render: row => new Date(row.createdAt).toLocaleString(),
              className: "text-text-weak",
            },
            { label: "Req", render: row => formatNumber(row.requestCount) },
            { label: "In", render: row => formatNumber(row.inputTokens) },
            { label: "Out", render: row => formatNumber(row.outputTokens) },
            { label: "Total", render: row => formatNumber(row.totalTokens) },
            {
              label: "Cost",
              render: row => formatUsd(row.estimatedCostUsd),
              className: "text-text-strong",
            },
          ],
          "usage-table--recent",
        );
      }

      async function loadUsage() {
        const response = await fetch(buildRequestUrl());
        if (!response.ok) {
          const payload = await response.json().catch(() => null);
          throw new Error(payload?.error || "Failed to load usage.");
        }

        const payload = await response.json();
        renderMetrics(payload);
        renderTable(providersEl, payload.providers, [
          { label: "Provider", render: row => row.providerId, className: "font-mono text-text-strong" },
          { label: "Req", render: row => formatNumber(row.requestCount) },
          { label: "In", render: row => formatNumber(row.inputTokens) },
          { label: "Out", render: row => formatNumber(row.outputTokens) },
          { label: "Total", render: row => formatNumber(row.totalTokens) },
          { label: "Cost", render: row => formatUsd(row.estimatedCostUsd), className: "text-text-strong" },
        ]);
        renderTable(modelsEl, payload.models, [
          { label: "Model", render: row => row.providerId + "/" + row.modelId, className: "font-mono text-text-strong" },
          { label: "Req", render: row => formatNumber(row.requestCount) },
          { label: "In", render: row => formatNumber(row.inputTokens) },
          { label: "Out", render: row => formatNumber(row.outputTokens) },
          { label: "Total", render: row => formatNumber(row.totalTokens) },
          { label: "Cost", render: row => formatUsd(row.estimatedCostUsd), className: "text-text-strong" },
        ], "usage-table--model");
        renderRecent(payload.recent);
      }

      async function refreshUsage() {
        setFilterStatus("");
        renderSelectionSummary();
        syncUrlFromSelection();

        try {
          await loadUsage();
        } catch (error) {
          setFilterStatus(error instanceof Error ? error.message : "Failed to load usage.");
        }
      }

      filterForm?.addEventListener("submit", event => {
        event.preventDefault();
        const startDate = startDateInput.value;
        const endDate = endDateInput.value;

        if (!startDate || !endDate) {
          setFilterStatus("Choose both a start date and an end date.");
          return;
        }

        if (!parseDateValue(startDate) || !parseDateValue(endDate)) {
          setFilterStatus("Enter valid calendar dates.");
          return;
        }

        if (startDate > endDate) {
          setFilterStatus("Start date must be on or before the end date.");
          return;
        }

        currentSelection = { startDate, endDate };
        void refreshUsage();
      });

      monthToDateButton?.addEventListener("click", () => {
        currentSelection = getMonthToDateSelection();
        syncInputsFromSelection();
        void refreshUsage();
      });

      allTimeButton?.addEventListener("click", () => {
        currentSelection = { startDate: null, endDate: null };
        syncInputsFromSelection();
        void refreshUsage();
      });

      backLink?.addEventListener("click", event => {
        const referrer = document.referrer ? new URL(document.referrer) : null;
        const sameOriginReferrer = referrer && referrer.origin === window.location.origin;
        if (sameOriginReferrer && window.history.length > 1) {
          event.preventDefault();
          window.history.back();
        }
      });

      syncInputsFromSelection();
      void refreshUsage();
      window.setInterval(() => { void loadUsage().catch(error => setFilterStatus(error instanceof Error ? error.message : "Failed to load usage.")); }, 15000);
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
