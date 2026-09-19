// Server-only: reads MONGODB_URI (never available in the browser) and opens a Mongo
// connection. `server-only` makes any import of this module from a client component
// (directly or via a shared file) a BUILD error naming the import chain, instead of a
// runtime "Missing MONGODB_URI" throw in the browser.
import "server-only";
import mongoose from "mongoose";

const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  throw new Error("Missing MONGODB_URI environment variable. Copy .env.example to .env and set it.");
}

type MongooseCache = {
  conn: typeof mongoose | null;
  promise: Promise<typeof mongoose> | null;
};

declare global {
  // eslint-disable-next-line no-var
  var _mongooseCache: MongooseCache | undefined;
}

const cache: MongooseCache = global._mongooseCache ?? { conn: null, promise: null };
global._mongooseCache = cache;

export async function connectToDatabase(): Promise<typeof mongoose> {
  if (cache.conn) return cache.conn;
  if (!cache.promise) {
    cache.promise = mongoose.connect(MONGODB_URI as string).then((m) => m);
  }
  cache.conn = await cache.promise;
  return cache.conn;
}
