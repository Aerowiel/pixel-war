import { NextRequest } from "next/server";
import Redis from "ioredis";
import { REDIS_COOLDOWN_KEY } from "../../../../../lib/constants";

const dev = process.env.NODE_ENV !== "production";
const redisUrl = process.env.REDIS_URL || "redis://redis:6379";
const redis = new Redis(redisUrl, { family: dev ? 4 : 6 });

const ADMIN_SECRET = process.env.ADMIN_SECRET_KEY || "changeme";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);

  const secret = searchParams.get("secret");
  const ms = searchParams.get("ms");

  if (secret !== ADMIN_SECRET) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
    });
  }

  const value = parseInt(ms || "", 10);
  if (isNaN(value) || value < 0 || value > 60000) {
    return new Response(JSON.stringify({ error: "Invalid cooldown value" }), {
      status: 400,
    });
  }

  await redis.set(REDIS_COOLDOWN_KEY, value.toString());
  await redis.publish("cooldown:update", value.toString());

  return new Response(
    JSON.stringify({
      success: true,
      newCooldown: value,
    }),
    { status: 200 }
  );
}
