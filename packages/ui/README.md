<!-- Banner -->
<div align="center">
  <img src="../../resources/svgs/vitals_banner_dark.svg" alt="Vitals Banner">
</div>

---

<p align="center">
  <strong>Lightweight, zero-dependency, real-time monitoring for Node.js servers.</strong>
</p>

> [!IMPORTANT]
> **Framework support is currently limited to Express.**
> Vitals currently ships with an official adapter for Express only. Support for additional Node.js frameworks is planned.

<p align="center">
  <a href="https://www.npmjs.com/package/@vitalsjs/ui">
    <img src="https://img.shields.io/npm/v/@vitalsjs/ui.svg" alt="npm">
  </a>
  <a href="https://nodejs.org">
    <img src="https://img.shields.io/badge/node-%3E%3D20-brightgreen" alt="Node.js">
  </a>
  <a href="../../LICENSE">
    <img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT">
  </a>
</p>

<div align="center">
  <img src="../../resources/screenshots/vitals_screenshot_light.png" alt="Vitals Dashboard Light">
  <img src="../../resources/screenshots/vitals_screenshot_dark.png" alt="Vitals Dashboard Dark">
</div>

---

> **Vitals** provides a self-contained dashboard UI for visualizing live process and HTTP metrics collected by the Vitals engine.

> [!NOTE]
> Vitals is designed for live inspection and debugging — not long-term metrics storage or alerting.

---

# 📊 @vitalsjs/ui

The standalone dashboard package for Vitals.

`@vitalsjs/ui` provides the complete browser interface used to display live metrics. The dashboard is shipped as a single self-contained HTML document with embedded styles and scripts.

---

## 📥 Installation

```bash
npm install @vitalsjs/ui
```

or:

```bash
pnpm add @vitalsjs/ui
```

---

## 🚀 Usage

```ts
import { dashboardHtml } from "@vitalsjs/ui";

response.setHeader("Content-Type", "text/html");
response.end(dashboardHtml);
```

`dashboardHtml` can be served from any Node.js HTTP server.

---

## ✨ Features

- 📄 **Single-file dashboard** — complete HTML output
- 🎨 **Built-in themes** — light and dark mode support
- 📈 **Live charts** — runtime and HTTP metric visualization
- 🖥️ **Runtime overview** — CPU, memory, event loop and GC information
- 🌐 **Traffic monitoring** — requests, latency, routes and status codes
- 🚫 **No runtime assets** — no external frontend dependencies

---

## 📦 Export

### `dashboardHtml`

```ts
dashboardHtml: string
```

Contains the complete dashboard HTML document.

Example:

```ts
import { dashboardHtml } from "@vitalsjs/ui";

serverResponse.end(dashboardHtml);
```

---

## 🔌 Usage with Express

For Express applications, install:

```bash
npm install @vitalsjs/express
```

The Express adapter automatically serves the dashboard and connects it to the Vitals engine.

---

## 🏗️ Integration

`@vitalsjs/ui` is designed to work with:

- `@vitalsjs/core` — metrics collection engine
- `@vitalsjs/express` — Express integration

---

## 📄 License

MIT © 2026 Ayush Jain
