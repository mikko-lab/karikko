import * as SQLite from 'expo-sqlite';

let db: SQLite.SQLiteDatabase | null = null;

export async function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!db) {
    db = await SQLite.openDatabaseAsync('karikko.db');
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS hazards (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        latitude REAL NOT NULL,
        longitude REAL NOT NULL,
        depth_cm INTEGER,
        note TEXT,
        created_at INTEGER NOT NULL
      );
    `);
  }
  return db;
}

export interface Hazard {
  id?: number;
  latitude: number;
  longitude: number;
  depth_cm?: number;
  note?: string;
  created_at: number;
}

export async function insertHazard(hazard: Omit<Hazard, 'id' | 'created_at'>): Promise<void> {
  const database = await getDb();
  await database.runAsync(
    'INSERT INTO hazards (latitude, longitude, depth_cm, note, created_at) VALUES (?, ?, ?, ?, ?)',
    [hazard.latitude, hazard.longitude, hazard.depth_cm ?? null, hazard.note ?? null, Date.now()]
  );
}

export async function getNearbyHazards(lat: number, lon: number, radiusDeg = 0.1): Promise<Hazard[]> {
  const database = await getDb();
  return await database.getAllAsync<Hazard>(
    'SELECT * FROM hazards WHERE latitude BETWEEN ? AND ? AND longitude BETWEEN ? AND ?',
    [lat - radiusDeg, lat + radiusDeg, lon - radiusDeg, lon + radiusDeg]
  );
}
