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
  `);

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
