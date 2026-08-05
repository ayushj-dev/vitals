<!-- Banner -->
<div align="center">
  <img src="./resources/svgs/vitals_banner_dark.svg" alt="Vitals Banner">
</div>

---

<p align="center">
  <strong>Lightweight, zero-dependency, real-time monitoring for Node.js servers.</strong>
</p>

> [!IMPORTANT]
> **Framework support is currently limited to Express.**
> Vitals currently ships with an official Express adapter. Support for additional Node.js frameworks is planned.

<p align="center">
  <a href="https://www.npmjs.com/package/@vitals/express">
    <img src="https://img.shields.io/npm/v/@vitals/express.svg" alt="npm">
  </a>
  <a href="https://nodejs.org">
    <img src="https://img.shields.io/badge/node-%3E%3D20-brightgreen" alt="Node.js">
  </a>
  <a href="./LICENSE">
    <img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT">
  </a>
  <a href="https://www.typescriptlang.org/">
    <img src="https://img.shields.io/badge/TypeScript-ready-blue" alt="TypeScript">
  </a>
</p>

<div align="center">
  <img src="./resources/screenshots/vitals_screenshot_light.png" alt="Vitals Dashboard Light">
  <img src="./resources/screenshots/vitals_screenshot_dark.png" alt="Vitals Dashboard Dark">
</div>

---

Vitals provides a lightweight live dashboard for inspecting what your Node.js process is doing **right now**.

It collects runtime health, memory, CPU, event loop, GC, and HTTP metrics, then streams them to a self-contained dashboard using Server-Sent Events.

> [!NOTE]
> Vitals is designed for live inspection and debugging — not long-term metrics storage or alerting.

---

## ✨ Features

- 📡 CPU, memory, event loop, GC and HTTP metrics
- 📊 Real-time dashboard with live charts
- 🔁 Server-Sent Events streaming (no polling)
- 🕰️ Short rolling history with reconnect backfill
- ⚡ Zero runtime dependencies
- 🟦 TypeScript-first with ESM support
- 🔒 Safe defaults with local-only dashboard access
- 🛣️ Express middleware with request latency tracking

---

## 📦 Packages

| Package | Description |
| --- | --- |
| [`@vitals/core`](./packages/core) | Metrics engine, collectors and SSE broadcaster |
| [`@vitals/ui`](./packages/ui) | Self-contained dashboard UI |
| [`@vitals/express`](./packages/adaptors/express) | Express middleware and dashboard router |

For Express applications, install `@vitals/express`.

---

## 📥 Installation

```bash
npm install @vitals/express
```

or:

```bash
pnpm add @vitals/express
```

or:

```bash
yarn add @vitals/express
```

Requirements:

- Node.js 18+
- Express 4 or 5

---

## 🚀 Quick start

### 🌐 Express

```ts
import express from "express";
import { VitalsEngine } from "@vitals/core";
import { createVitalsRouter, vitalsMiddleware } from "@vitals/express";

const engine = new VitalsEngine().start();

const app = express();

app.use("/vitals", createVitalsRouter({ engine }));
app.use(vitalsMiddleware(engine));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.listen(3000, () => {
  console.log("Vitals dashboard: http://localhost:3000/vitals");
});
```

Open:

```
http://localhost:3000/vitals
```

By default, the dashboard is accessible only from the local machine.

---

## 📊 Dashboard

The dashboard provides:

- Runtime information
  - CPU usage
  - Memory usage
  - Event loop delay
  - GC activity

- HTTP insights
  - Requests per second
  - Latency
  - Status codes
  - Active requests
  - Top routes

- Live charts
  - CPU
  - Memory
  - Event loop
  - HTTP traffic
  - Garbage collection

---

## 🔐 Security

The dashboard exposes process information, so avoid publicly exposing it without authorization.

```ts
app.use(
  "/vitals",
  createVitalsRouter({
    engine,
    authorize: (req) =>
      req.headers.authorization === `Bearer ${process.env.VITALS_TOKEN}`,
  }),
);
```

---

## ⚙️ Configuration

```ts
const engine = new VitalsEngine({
  sampleIntervalMs: 1000,
  historySize: 60,
  enableGcTracking: true,
}).start();
```

Available options include:

- Sampling interval
- History size
- GC tracking
- HTTP route limits
- SSE client limits

---

## 🧩 Framework support

| Framework | Status |
| --- | --- |
| Express | ✅ Supported |
| Node HTTP | ✅ Supported through core |
| Fastify | Planned |
| Koa | Planned |
| Hono | Planned |
| NestJS | Planned |

---

## ❓ FAQ

### Is Vitals a Prometheus/Grafana replacement?

No.

Vitals is for **live process inspection**. Use Prometheus, Grafana, or another metrics stack for long-term storage and alerting.

### Does Vitals add overhead?

Vitals uses fixed interval sampling and lightweight collectors (inbuilt node modules) designed to keep runtime overhead minimal.

### Can I use Vitals without Express?

Yes. Use `@vitals/core` and `@vitals/ui` directly for custom HTTP servers.

---

## 🗂️ Project structure

```text
packages/
  core/                 # @vitals/core
  ui/                   # @vitals/ui
  adaptors/
    express/            # @vitals/express

examples/
```

---

## 🤝 Contributing

```bash
pnpm install
pnpm build
pnpm test
pnpm lint
pnpm typecheck
```

Issues and pull requests are welcome.

---

## 📄 License

MIT © 2026 Ayush Jain
