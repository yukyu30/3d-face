import Database from "better-sqlite3";
import { RegisteredPerson, FaceDescriptor } from "./faceRegistry";
import { randomUUID } from "crypto";

export function createDb(dbPath: string): Database.Database {
  const db = new Database(dbPath);

  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS persons (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      model_url TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS descriptors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      person_id TEXT NOT NULL,
      embedding TEXT NOT NULL,
      FOREIGN KEY (person_id) REFERENCES persons(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS models (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      original_name TEXT NOT NULL,
      stored_path TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'model3d',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // マイグレーション: 既存modelsテーブルにtype列がない場合追加
  const cols = db.pragma("table_info(models)") as { name: string }[];
  if (cols.length > 0 && !cols.some((c) => c.name === "type")) {
    db.exec("ALTER TABLE models ADD COLUMN type TEXT NOT NULL DEFAULT 'model3d'");
  }

  return db;
}

export function getAllPersons(db: Database.Database): RegisteredPerson[] {
  const persons = db.prepare("SELECT * FROM persons").all() as {
    id: string;
    name: string;
    model_url: string;
  }[];

  return persons.map((p) => {
    const descriptors = db
      .prepare("SELECT embedding FROM descriptors WHERE person_id = ?")
      .all(p.id) as { embedding: string }[];

    return {
      id: p.id,
      name: p.name,
      modelUrl: p.model_url,
      descriptors: descriptors.map((d) => ({
        embedding: JSON.parse(d.embedding) as number[],
      })),
    };
  });
}

export function addPerson(
  db: Database.Database,
  name: string,
  modelUrl: string,
  descriptors: FaceDescriptor[]
): RegisteredPerson {
  const id = randomUUID();

  const insertPerson = db.prepare(
    "INSERT INTO persons (id, name, model_url) VALUES (?, ?, ?)"
  );
  const insertDescriptor = db.prepare(
    "INSERT INTO descriptors (person_id, embedding) VALUES (?, ?)"
  );

  const transaction = db.transaction(() => {
    insertPerson.run(id, name, modelUrl);
    for (const desc of descriptors) {
      insertDescriptor.run(id, JSON.stringify(desc.embedding));
    }
  });

  transaction();

  return {
    id,
    name,
    modelUrl,
    descriptors,
  };
}

export function deletePerson(db: Database.Database, id: string): void {
  db.prepare("DELETE FROM persons WHERE id = ?").run(id);
}

export function addDescriptorToPerson(
  db: Database.Database,
  personId: string,
  descriptor: FaceDescriptor
): void {
  db.prepare(
    "INSERT INTO descriptors (person_id, embedding) VALUES (?, ?)"
  ).run(personId, JSON.stringify(descriptor.embedding));
}

// --- 3Dモデル管理 ---

export type ModelType = "model3d" | "image";

export interface StoredModel {
  id: string;
  name: string;
  originalName: string;
  storedPath: string;
  type: ModelType;
  createdAt: string;
}

export function addModel(
  db: Database.Database,
  name: string,
  originalName: string,
  storedPath: string,
  type: ModelType = "model3d"
): StoredModel {
  const id = randomUUID();
  db.prepare(
    "INSERT INTO models (id, name, original_name, stored_path, type) VALUES (?, ?, ?, ?, ?)"
  ).run(id, name, originalName, storedPath, type);

  return { id, name, originalName, storedPath, type, createdAt: new Date().toISOString() };
}

export function getAllModels(db: Database.Database): StoredModel[] {
  const rows = db.prepare("SELECT * FROM models ORDER BY created_at DESC").all() as {
    id: string;
    name: string;
    original_name: string;
    stored_path: string;
    type: ModelType;
    created_at: string;
  }[];

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    originalName: r.original_name,
    storedPath: r.stored_path,
    type: r.type,
    createdAt: r.created_at,
  }));
}

export function getModel(db: Database.Database, id: string): StoredModel | null {
  const row = db.prepare("SELECT * FROM models WHERE id = ?").get(id) as {
    id: string;
    name: string;
    original_name: string;
    stored_path: string;
    type: ModelType;
    created_at: string;
  } | undefined;

  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    originalName: row.original_name,
    storedPath: row.stored_path,
    type: row.type,
    createdAt: row.created_at,
  };
}

export function deleteModel(db: Database.Database, id: string): void {
  db.prepare("DELETE FROM models WHERE id = ?").run(id);
}
