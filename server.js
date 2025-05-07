const { createServer } = require("node:http");
const next = require("next");
const { Server } = require("socket.io");
const Redis = require("ioredis");

const dev = process.env.NODE_ENV !== "production";
const hostname = "0.0.0.0";
const port = process.env.PORT || 3000;
const app = next({ dev, hostname, port });
const handler = app.getRequestHandler();

const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";
const pub = new Redis(redisUrl, { family: dev ? 4 : 6 });
const sub = new Redis(redisUrl, { family: dev ? 4 : 6 });

app.prepare().then(() => {
  const httpServer = createServer(handler);
  const io = new Server(httpServer, {
    cors: {
      origin: "*",
    },
  });

  io.on("connection", (socket) => {
    console.log("🧠 New client:", socket.id);

    socket.on("place-pixel", (pixel) => {
      // Broadcast via Redis so all instances sync
      pub.publish("pixel", JSON.stringify(pixel));
    });
  });

  sub.subscribe("pixel");
  sub.on("message", (channel, message) => {
    const pixel = JSON.parse(message);
    io.emit("pixel-placed", pixel);
  });

  httpServer.listen(port, () => {
    console.log(`🚀 Server ready on http://${hostname}:${port}`);
  });
});
