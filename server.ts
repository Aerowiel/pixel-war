import { createServer } from "node:http";
import next from "next";
import { Server } from "socket.io";
import Redis from "ioredis";
import {
  COLOR_PALETTE,
  CANVAS_WIDTH,
  CANVAS_HEIGHT,
  REDIS_COOLDOWN_KEY,
} from "./lib/constants";

const dev = process.env.NODE_ENV !== "production";
const hostname = "0.0.0.0";
const port = parseInt(process.env.PORT || "3000", 10);
const app = next({ dev, hostname, port });
const handler = app.getRequestHandler();

const redisUrl = process.env.REDIS_URL || "redis://redis:6379";
console.log({ env: process.env.REDIS_URL });
const pub = new Redis(redisUrl, { family: dev ? 4 : 6 });
const sub = new Redis(redisUrl, { family: dev ? 4 : 6 });

const connectedIps = new Set<string>();

app.prepare().then(() => {
  const httpServer = createServer(handler);
  const io = new Server(httpServer, {
    cors: {
      origin: "*",
    },
  });

  io.on("connection", async (socket) => {
    const ip =
      (socket.handshake.headers["x-forwarded-for"] as string)?.split(",")[0] ||
      socket.handshake.address;

    connectedIps.add(ip);
    io.emit("user-count", connectedIps.size);

    console.log(`🧠 New client connected: ${socket.id} (IP: ${ip})`);

    // Send full canvas state on connect
    const raw = await pub.hgetall("canvas");
    const canvas: Record<string, string> = {};

    for (const [key, colorIndexStr] of Object.entries(raw)) {
      const [x, y] = key.split(":").map(Number);
      const color = COLOR_PALETTE[parseInt(colorIndexStr)];
      if (!isNaN(x) && !isNaN(y) && color) {
        canvas[`${x}:${y}`] = color;
      }
    }

    socket.emit("canvas-state", canvas);

    socket.on(
      "place-pixel",
      async (pixel: { x: number; y: number; color: string }) => {
        const { x, y, color } = pixel;

        // === Coordinate validation ===
        console.log("coordinate check");
        if (
          typeof x !== "number" ||
          typeof y !== "number" ||
          x < 0 ||
          y < 0 ||
          x >= CANVAS_WIDTH ||
          y >= CANVAS_HEIGHT
        ) {
          console.log("invalid coordinate");
          return;
        }
        console.log("valid coordinate");

        // === Color validation ===
        console.log("color check");
        const colorIndex = COLOR_PALETTE.indexOf(color);
        if (colorIndex === -1) {
          console.log("invalid color");
          return;
        }
        console.log("valid color");

        // === Cooldown check ===
        const currentCooldown = parseInt(
          (await pub.get(REDIS_COOLDOWN_KEY)) || "5000",
          10
        );

        if (currentCooldown !== 0) {
          console.log("cooldown check");
          const cooldownKey = `cooldown:${ip}`;
          const onCooldown = await pub.get(cooldownKey);
          const ttl = await pub.pttl(cooldownKey); // in ms
          console.log({ ttl });

          console.log({ onCooldown });
          if (onCooldown) {
            const ttl = await pub.pttl(cooldownKey);
            socket.emit("cooldown", { remaining: ttl, total: currentCooldown });
            return;
          }

          await pub.set(cooldownKey, "1", "PX", currentCooldown); // 0.5s cooldown
          socket.emit("cooldown", {
            remaining: currentCooldown,
            total: currentCooldown,
          });
        }

        const redisKey = `${x}:${y}`;

        await pub.hset("canvas", redisKey, colorIndex.toString());
        await pub.publish("pixel", JSON.stringify({ x, y, color }));
      }
    );

    socket.on("disconnect", () => {
      // Remove the IP only if no other sockets from this IP remain
      const stillConnected = Array.from(io.sockets.sockets.values()).some(
        (s) =>
          ((s.handshake.headers["x-forwarded-for"] as string)?.split(",")[0] ||
            s.handshake.address) === ip
      );

      if (!stillConnected) {
        connectedIps.delete(ip);
        io.emit("user-count", connectedIps.size);
      }
    });
  });

  // Broadcast pixel placements to all clients
  sub.subscribe("pixel");
  sub.on("message", (channel, message) => {
    const pixel = JSON.parse(message);
    io.emit("pixel-placed", pixel);
  });

  sub.subscribe("cooldown:update");
  sub.on("message", (channel, message) => {
    if (channel === "cooldown:update") {
      console.log("received cooldown update");
      const newCooldown = parseInt(message, 10);
      io.emit("cooldown-updated", { cooldown: newCooldown });
    }
  });

  httpServer.listen(port, () => {
    console.log(`🚀 Server ready on http://${hostname}:${port}`);
  });
});
