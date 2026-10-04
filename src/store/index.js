import { MongoClient } from "mongodb";
import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync } from "node:fs";
import { dirname } from "node:path";

// Tiny document store with two backends behind one API:
//   - MongoDB (MONGODB_URI) for production
//   - a JSON file for local development and tests
// Filters are equality matches; an array field matches when it contains the value.
// incIf() is the only write that needs atomicity (credit debits) and is atomic in both.

const matches = (doc, filter) =>
  Object.entries(filter).every(([k, v]) => (Array.isArray(doc[k]) ? doc[k].includes(v) : doc[k] === v));

class FileStore {
  constructor(file) {
    this.file = file;
    this.data = { agencies: [], productions: [], ledger: [] };
    if (existsSync(file)) {
      try { this.data = { ...this.data, ...JSON.parse(readFileSync(file, "utf8")) }; } catch { /* start fresh */ }
    }
    this.timer = null;
  }
  async init() { mkdirSync(dirname(this.file), { recursive: true }); }
  persist() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 100);
  }
  flush() {
    clearTimeout(this.timer);
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.data));
    renameSync(tmp, this.file);
  }
  col(name) { return (this.data[name] ??= []); }
  async insert(name, doc) { this.col(name).push(structuredClone(doc)); this.persist(); return doc; }
  async findOne(name, filter) { const d = this.col(name).find((x) => matches(x, filter)); return d ? structuredClone(d) : null; }
  async find(name, filter, { sort, limit } = {}) {
    let out = this.col(name).filter((x) => matches(x, filter));
    if (sort) { const [k, dir] = Object.entries(sort)[0]; out = out.sort((a, b) => (a[k] > b[k] ? 1 : a[k] < b[k] ? -1 : 0) * dir); }
    return structuredClone(limit ? out.slice(0, limit) : out);
  }
  async update(name, id, set) {
    const d = this.col(name).find((x) => x.id === id);
    if (!d) return null;
    Object.assign(d, set);
    this.persist();
    return structuredClone(d);
  }
  // Atomically add `delta` to `field` only if the result stays >= min.
  async incIf(name, id, field, delta, min = 0) {
    const d = this.col(name).find((x) => x.id === id);
    if (!d || (d[field] ?? 0) + delta < min) return null;
    d[field] = (d[field] ?? 0) + delta;
    this.persist();
    return structuredClone(d);
  }
  async push(name, id, field, item, cap = 500) {
    const d = this.col(name).find((x) => x.id === id);
    if (!d) return;
    d[field] = [...(d[field] ?? []), item].slice(-cap);
    this.persist();
  }
  async close() { this.flush(); }
}

class MongoStore {
  constructor(uri, dbName) { this.client = new MongoClient(uri); this.dbName = dbName; }
  async init() {
    await this.client.connect();
    this.db = this.client.db(this.dbName);
    await Promise.all([
      this.db.collection("agencies").createIndex({ id: 1 }, { unique: true }),
      this.db.collection("agencies").createIndex({ okxAgentId: 1 }, { unique: true }),
      this.db.collection("agencies").createIndex({ ceoTokenId: 1 }, { unique: true, sparse: true }),
      this.db.collection("agencies").createIndex({ ownerWallets: 1 }),
      this.db.collection("productions").createIndex({ id: 1 }, { unique: true }),
      this.db.collection("productions").createIndex({ agencyId: 1, createdAt: -1 }),
      this.db.collection("ledger").createIndex({ agencyId: 1, at: -1 })
    ]);
  }
  c(name) { return this.db.collection(name); }
  async insert(name, doc) { await this.c(name).insertOne({ ...doc }); return doc; }
  async findOne(name, filter) { return this.c(name).findOne(filter, { projection: { _id: 0 } }); }
  async find(name, filter, { sort, limit } = {}) {
    let cur = this.c(name).find(filter, { projection: { _id: 0 } });
    if (sort) cur = cur.sort(sort);
    if (limit) cur = cur.limit(limit);
    return cur.toArray();
  }
  async update(name, id, set) {
    return this.c(name).findOneAndUpdate({ id }, { $set: set }, { returnDocument: "after", projection: { _id: 0 } });
  }
  async incIf(name, id, field, delta, min = 0) {
    const filter = delta < 0 ? { id, [field]: { $gte: min - delta } } : { id };
    return this.c(name).findOneAndUpdate(filter, { $inc: { [field]: delta } }, { returnDocument: "after", projection: { _id: 0 } });
  }
  async push(name, id, field, item, cap = 500) {
    await this.c(name).updateOne({ id }, { $push: { [field]: { $each: [item], $slice: -cap } } });
  }
  async close() { await this.client.close(); }
}

export async function createStore({ mongoUri, mongoDb, dataFile }) {
  const store = mongoUri ? new MongoStore(mongoUri, mongoDb) : new FileStore(dataFile);
  await store.init();
  store.kind = mongoUri ? "mongodb" : "file";
  return store;
}
