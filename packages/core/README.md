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
  <a href="https://www.npmjs.com/package/@vitals/core">
    <img src="https://img.shields.io/npm/v/@vitals/core.svg" alt="npm">
  </a>
  <a href="https://nodejs.org">
    <img src="https://img.shields.io/badge/node-%3E%3D20-brightgreen" alt="Node.js">
  </a>
  <a href="../../LICENSE">
    <img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT">
  </a>
  <a href="https://www.typescriptlang.org/">
    <img src="https://img.shields.io/badge/TypeScript-ready-blue" alt="TypeScript">
  </a>
</p>

---

> **Vitals** collects process health and HTTP metrics, keeps a short rolling history, and provides the monitoring data pipeline used by Vitals integrations.

> [!NOTE]
> Vitals is designed for live inspection and debugging — not long-term metrics storage or alerting.

---

# 📦 @vitals/core

The framework-agnostic metrics engine powering Vitals.

It collects runtime metrics, records HTTP activity, maintains a rolling in-memory history, and streams snapshots through Server-Sent Events.

---

## 📥 Installation

```bash
npm install @vitals/core
```

or:

```bash
pnpm add @vitals/core
```

---

## 🚀 Quick start

```ts
import { VitalsEngine } from "@vitals/core";

const engine = new VitalsEngine({
  sampleIntervalMs: 1000,
}).start();

setInterval(() => {
  const snapshot = engine.getSnapshot();

  if (!snapshot) return;

  console.log({
    cpu: snapshot.cpu.cpuPercent,
    memory: snapshot.memory.heapUsedBytes,
    requests: snapshot.http.requestsPerSecond,
  });
}, 5000);
```

---

## ✨ Features

- 📡 **Runtime metrics** — CPU, memory, event loop and GC information
- 🌐 **HTTP metrics** — request throughput, latency and status codes
- 🕰️ **Rolling history** — short in-memory metric window
- 🔁 **SSE broadcasting** — stream live snapshots to connected clients
- 🟦 **TypeScript-first** — complete type definitions included
- ⚡ **Low overhead** — fixed-cost sampling with allocation-light collectors

---

## 🧩 API

### `VitalsEngine`

```ts
new VitalsEngine(options?).start();
```

Main methods:

| Method | Description |
| --- | --- |
| `start()` | Starts metric collection |
| `stop()` | Stops collection and closes active streams |
| `getSnapshot()` | Returns the latest metrics snapshot |
| `getHistory()` | Returns rolling metric history |
| `recordRequest()` | Records HTTP request metrics |

---

## 📊 Metrics collected

### 🖥️ Runtime

- CPU usage
- Memory usage
- Event loop delay
- Event loop utilization
- V8 garbage collection pauses

### 🌐 HTTP

- Request count
- Requests per second
- Latency statistics
- Status codes
- Route aggregation
- Active in-flight requests

---

## 🔌 Framework support

`@vitals/core` is framework-agnostic.

Use it directly with Node.js HTTP servers or through official adapters.

Currently supported:

- Express via `@vitals/express`

---

## 📄 License

MIT © 2026 Ayush Jain
