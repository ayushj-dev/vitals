import { VitalsEngine } from "@vitalsjs/core";
import { createVitalsRouter, vitalsMiddleware } from "@vitalsjs/express";
import express from "express";

const engine = new VitalsEngine().start();
const app = express();

// The dashboard is mounted ahead of the middleware so its own long-lived SSE connection is
// not measured: it would otherwise sit in the in-flight count and the route table forever.
app.use("/vitals", createVitalsRouter({ engine }));
app.use(vitalsMiddleware(engine));

app.get("/api/users", (_req, res) => res.json([{ id: 1, name: "Alice" }]));
app.get("/api/users/:id", (_req, res) => res.json({ id: 1, name: "Alice" }));
app.get("/api/slow", (_req, res) => setTimeout(() => res.send("slow"), 120));
app.get("/api/heavy", (_req, res) => {
	const until = Date.now() + 50;
	while (Date.now() < until) {
		// Block the event loop so the delay and utilization charts have something to show.
	}
	res.send("done");
});
app.get("/api/boom", (_req, res) => res.status(500).send("boom"));

app.listen(3000, () => {
	console.log("server   http://localhost:3000");
	console.log("dashboard http://localhost:3000/vitals");

	// Synthetic traffic so the dashboard is not empty.
	const paths = ["/api/users", "/api/users/7", "/api/slow", "/api/heavy", "/api/boom"];
	setInterval(() => {
		const count = 5 + Math.floor(Math.random() * 20);
		for (let i = 0; i < count; i++) {
			const path = paths[Math.floor(Math.random() * paths.length)];
			fetch(`http://localhost:3000${path}`).catch(() => {});
		}
	}, 1000).unref();
});
