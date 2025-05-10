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

const getUserList = () =>
  Array.from(users.entries())
    .map(([ip, user]) => ({
      ip,
      pseudonym: user.pseudonym || "Anonymous",
      connectedAt: user.connectedAt,
      pixelCount: user.pixelCount,
    }))
    .sort((a, b) => b.pixelCount - a.pixelCount);

// In-memory cache to avoid Redis lookups every time
const blacklistCache = new Set<string>();

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

    const isBlacklisted =
      blacklistCache.has(ip) || (await pub.sismember("blacklist", ip));
    if (isBlacklisted) {
      console.warn(`⛔ Blocked blacklisted IP on connect: ${ip}`);
      blacklistCache.add(ip);
      socket.disconnect(true);
      return;
    }

    if (!users.has(ip)) {
      users.set(ip, {
        pixelCount: 0,
        rate: { count: 0, lastTimestamp: Date.now() },
        connectedAt: Date.now(),
      });
    }
    io.emit("user-list", getUserList());

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
        // === Blacklist check ===
        if (blacklistCache.has(ip) || (await pub.sismember("blacklist", ip))) {
          console.warn(`⛔ Blocked blacklisted IP during place-pixel: ${ip}`);
          blacklistCache.add(ip);
          return;
        }

        // === Rate limiting ===
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
            io.emit("chat-message", {
              author: "SERVER",
              message: `Blacklisting ${ip} for spamming pixels.`,
            });
            await pub.sadd("blacklist", ip);
            blacklistCache.add(ip);
            socket.disconnect(true);
            return;
          }
        }

        const { x, y, color } = pixel;

        // === Coordinate validation ===
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
            socket.emit("cooldown", { remaining: ttl, total: currentCooldown });
            return;
          }

          await pub.set(cooldownKey, "1", "PX", currentCooldown);
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
          io.emit("chat-message", {
            author: "SERVER",
            message: `${user.pseudonym} joined the chaos`,
          });
        }
      }
    });

    socket.on("chat-message", (msg: string) => {
      if (typeof msg === "string" && msg.length < 200) {
        const user = users.get(ip);
        const author = user?.pseudonym || "Anonymous";

        io.emit("chat-message", {
          author,
          message: msg.trim(),
        });
      }
    });

    socket.on("admin-command", (data) => {
      const { ip: targetIp, command, adminToken, ...commandArgs } = data;

      if (
        !adminToken || // falsy: undefined, null, ""
        !process.env.ADMIN_SECRET_KEY || // unset or empty
        adminToken !== process.env.ADMIN_SECRET_KEY
      ) {
        return;
      }

      console.log("received admin commands", data);

      if (typeof targetIp !== "string" || typeof command !== "string") return;

      // Find all sockets of the target IP
      for (const [id, s] of io.sockets.sockets.entries()) {
        const sIp =
          (s.handshake.headers["x-forwarded-for"] as string)?.split(",")[0] ||
          s.handshake.address;

        if (sIp === targetIp) {
          s.emit("admin-command", { command, ...commandArgs });
        }
      }
    });
  });

  setInterval(() => {
    io.emit("user-list", getUserList());
  }, 1000);

  // Broadcast pixel placements to all clients
  sub.subscribe("pixel");
  sub.on("message", (channel, message) => {
    const pixel = JSON.parse(message);
    io.emit("pixel-placed", pixel);
  });

  sub.subscribe("cooldown:update");
  sub.on("message", (channel, message) => {
    if (channel === "cooldown:update") {
      const newCooldown = parseInt(message, 10);
      io.emit("cooldown-updated", { cooldown: newCooldown });
    }
  });

  httpServer.listen(port, () => {
    console.log(`🚀 Server ready on http://${hostname}:${port}`);
  });
});
