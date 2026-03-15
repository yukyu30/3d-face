"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createDb = createDb;
exports.getAllPersons = getAllPersons;
exports.addPerson = addPerson;
exports.deletePerson = deletePerson;
exports.addDescriptorToPerson = addDescriptorToPerson;
const better_sqlite3_1 = __importDefault(require("better-sqlite3"));
const crypto_1 = require("crypto");
function createDb(dbPath) {
    const db = new better_sqlite3_1.default(dbPath);
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
function getAllPersons(db) {
    const persons = db.prepare("SELECT * FROM persons").all();
    return persons.map((p) => {
        const descriptors = db
            .prepare("SELECT embedding FROM descriptors WHERE person_id = ?")
            .all(p.id);
        return {
            id: p.id,
            name: p.name,
            modelUrl: p.model_url,
            descriptors: descriptors.map((d) => ({
                embedding: JSON.parse(d.embedding),
            })),
        };
    });
}
function addPerson(db, name, modelUrl, descriptors) {
    const id = (0, crypto_1.randomUUID)();
    const insertPerson = db.prepare("INSERT INTO persons (id, name, model_url) VALUES (?, ?, ?)");
    const insertDescriptor = db.prepare("INSERT INTO descriptors (person_id, embedding) VALUES (?, ?)");
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
function deletePerson(db, id) {
    db.prepare("DELETE FROM persons WHERE id = ?").run(id);
}
function addDescriptorToPerson(db, personId, descriptor) {
    db.prepare("INSERT INTO descriptors (person_id, embedding) VALUES (?, ?)").run(personId, JSON.stringify(descriptor.embedding));
}
//# sourceMappingURL=db.js.map