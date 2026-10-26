import { getMongoDb } from "./mongo.server";

const COLLECTION = "rate_limits";
let indexReady: Promise<unknown> | undefined;

type Counter = { _id: string; count: number; expiresAt: Date };

/**
 * Fixed-window counter stored in MongoDB, so it holds across serverless
 * instances (an in-memory counter would reset per instance). Returns true
 * when the request is allowed.
 *
 * Fails OPEN: if MongoDB is unreachable the request is allowed and the error
 * logged — a limiter outage must never break the storefront.
 */
export async function allowRequest(key: string, limit: number, windowMs: number): Promise<boolean> {
  try {
    const db = await getMongoDb();
    const collection = db.collection<Counter>(COLLECTION);
    if (!indexReady) {
      // Mongo's TTL monitor removes expired windows automatically.
      indexReady = collection
        .createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 })
        .catch((error) => {
          indexReady = undefined;
          throw error;
        });
    }
    await indexReady;

    const windowStart = Math.floor(Date.now() / windowMs) * windowMs;
    const doc = await collection.findOneAndUpdate(
      { _id: `${key}:${windowStart}` },
      { $inc: { count: 1 }, $setOnInsert: { expiresAt: new Date(windowStart + windowMs * 2) } },
      { upsert: true, returnDocument: "after" },
    );
    return !doc || doc.count <= limit;
  } catch (error) {
    console.error("Rate limiter unavailable, allowing request", error);
    return true;
  }
}
