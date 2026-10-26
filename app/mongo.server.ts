import { MongoClient, type Db } from "mongodb";

// The same database the session storage uses (see shopify.server.ts), so no
// extra Atlas permissions or databases are needed for the app's own data.
export const MONGO_DB_NAME = "jewelry_engraving_sessions";

declare global {
  // eslint-disable-next-line no-var
  var mongoClientPromise: Promise<MongoClient> | undefined;
}

// One client per process (and one across dev-server hot reloads).
export function getMongoDb(): Promise<Db> {
  if (!global.mongoClientPromise) {
    const uri = process.env.MONGODB_URI;
    if (!uri) {
      return Promise.reject(new Error("MONGODB_URI environment variable is not set."));
    }
    global.mongoClientPromise = new MongoClient(uri).connect().catch((error) => {
      global.mongoClientPromise = undefined; // allow a retry on the next call
      throw error;
    });
  }
  return global.mongoClientPromise.then((client) => client.db(MONGO_DB_NAME));
}
