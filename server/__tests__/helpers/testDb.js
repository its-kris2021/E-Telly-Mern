import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";

let mongod;

export async function startTestDb() {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri(), { dbName: "chat-moderation-test" });
}

export async function stopTestDb() {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  if (mongod) await mongod.stop();
}

export async function clearTestDb() {
  // Uses the native driver's collection list, not mongoose.connection.collections
  // — the latter only tracks collections touched through a Mongoose model, so
  // raw mongoose.connection.db.collection("...") writes (e.g. emergency_reports,
  // inserted directly in several tests) would otherwise survive between tests.
  const collections = await mongoose.connection.db.collections();
  await Promise.all(collections.map((c) => c.deleteMany({})));
}
