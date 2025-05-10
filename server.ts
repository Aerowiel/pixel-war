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

const pub = new Redis(redisUrl, { family: dev ? 4 : 6 });
const sub = new Redis(redisUrl, { family: dev ? 4 : 6 });

const users = new Map<
  string,
  {
    pseudonym?: string;
    pixelCount: number;
    rate: { count: number; lastTimestamp: number };
    connectedAt: number; // timestamp in ms
  }
>();
const blacklist = new Set<string>(); // IPs banned for spamming

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

    if (!users.has(ip)) {
      users.set(ip, {
        pixelCount: 0,
        rate: { count: 0, lastTimestamp: Date.now() },
        connectedAt: Date.now(),
      });
    }
    io.emit("user-count", users.size);

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
        if (blacklist.has(ip)) {
          console.warn(`⛔ Blocked blacklisted IP: ${ip}`);
          return;
        }

        // === Rate limiting check ===
        const user = users.get(ip);
        if (!user) return;

        const now = Date.now();

        if (now - user.rate.lastTimestamp > 1000) {
          user.rate.count = 1;
          user.rate.lastTimestamp = now;
        } else {
          user.rate.count += 1;
          if (user.rate.count > 100) {
            console.warn(`🚨 Blacklisting IP ${ip} for spamming`);
            io.emit(
              "chat-message",
              `[SERVER] Blacklisting ${ip} for spamming pixels.`
            );
            blacklist.add(ip);
            socket.disconnect(true); // Kick user
            return;
          }
        }

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
          return;
        }

        // === Color validation ===
        const colorIndex = COLOR_PALETTE.indexOf(color);
        if (colorIndex === -1) {
          return;
        }

        // === Cooldown check ===
        const currentCooldown = parseInt(
          (await pub.get(REDIS_COOLDOWN_KEY)) || "5000",
          10
        );

        if (currentCooldown !== 0) {
          const cooldownKey = `cooldown:${ip}`;
          const onCooldown = await pub.get(cooldownKey);
          const ttl = await pub.pttl(cooldownKey); // in ms

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

        user.pixelCount += 1;
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
        users.delete(ip);
        io.emit("user-count", users.size);
      }
    });

    socket.on("set-pseudonym", (pseudo: string) => {
      if (typeof pseudo === "string" && pseudo.length <= 15) {
        const user = users.get(ip);
        if (user) {
          user.pseudonym = pseudo.trim();
          console.log(`👤 IP ${ip} is now known as "${user.pseudonym}"`);
        }
      }
    });

    socket.on("chat-message", (msg: string) => {
      if (typeof msg === "string" && msg.length < 200) {
        io.emit("chat-message", msg);
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
