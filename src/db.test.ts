import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  createDb,
  getAllPersons,
  addPerson,
  deletePerson,
  addDescriptorToPerson,
  addModel,
  getAllModels,
  deleteModel,
  getModel,
} from "./db";
import Database from "better-sqlite3";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

describe("db", () => {
  let db: Database.Database;
  let dbPath: string;

  beforeEach(() => {
    dbPath = path.join(os.tmpdir(), `face3d_test_${Date.now()}.db`);
    db = createDb(dbPath);
  });

  afterEach(() => {
    db.close();
    if (fs.existsSync(dbPath)) {
      fs.unlinkSync(dbPath);
    }
  });

  it("DBを作成し、テーブルが初期化される", () => {
    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
      )
      .all() as { name: string }[];
    const tableNames = tables.map((t) => t.name);
    expect(tableNames).toContain("persons");
    expect(tableNames).toContain("descriptors");
  });

  it("人物を登録できる", () => {
    const person = addPerson(db, "Alice", "/models/alice.glb", [
      { embedding: [1, 0, 0] },
    ]);

    expect(person.name).toBe("Alice");
    expect(person.modelUrl).toBe("/models/alice.glb");
    expect(person.id).toBeTruthy();
    expect(person.descriptors).toHaveLength(1);
  });

  it("全人物を取得できる", () => {
    addPerson(db, "Alice", "/models/alice.glb", [
      { embedding: [1, 0, 0] },
    ]);
    addPerson(db, "Bob", "/models/bob.glb", [
      { embedding: [0, 1, 0] },
    ]);

    const persons = getAllPersons(db);
    expect(persons).toHaveLength(2);
    expect(persons.map((p) => p.name).sort()).toEqual(["Alice", "Bob"]);
  });

  it("人物を削除できる", () => {
    const person = addPerson(db, "Alice", "", [
      { embedding: [1, 0, 0] },
    ]);
    deletePerson(db, person.id);

    const persons = getAllPersons(db);
    expect(persons).toHaveLength(0);
  });

  it("人物に追加の特徴量を登録できる", () => {
    const person = addPerson(db, "Alice", "", [
      { embedding: [1, 0, 0] },
    ]);
    addDescriptorToPerson(db, person.id, { embedding: [0.9, 0.1, 0] });

    const persons = getAllPersons(db);
    expect(persons[0].descriptors).toHaveLength(2);
  });

  it("人物削除時に関連する特徴量も削除される", () => {
    const person = addPerson(db, "Alice", "", [
      { embedding: [1, 0, 0] },
    ]);
    addDescriptorToPerson(db, person.id, { embedding: [0.9, 0.1, 0] });
    deletePerson(db, person.id);

    const count = db
      .prepare("SELECT COUNT(*) as cnt FROM descriptors")
      .get() as { cnt: number };
    expect(count.cnt).toBe(0);
  });
});

describe("3Dモデル管理", () => {
  let db: Database.Database;
  let dbPath: string;

  beforeEach(() => {
    dbPath = path.join(os.tmpdir(), `face3d_model_test_${Date.now()}.db`);
    db = createDb(dbPath);
  });

  afterEach(() => {
    db.close();
    if (fs.existsSync(dbPath)) {
      fs.unlinkSync(dbPath);
    }
  });

  it("modelsテーブルが存在する", () => {
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all() as { name: string }[];
    expect(tables.map((t) => t.name)).toContain("models");
  });

  it("3Dモデルを登録できる", () => {
    const model = addModel(db, "キューブ", "cube.glb", "/stored/path/cube.glb");
    expect(model.id).toBeTruthy();
    expect(model.name).toBe("キューブ");
    expect(model.originalName).toBe("cube.glb");
    expect(model.storedPath).toBe("/stored/path/cube.glb");
  });

  it("全モデルを取得できる", () => {
    addModel(db, "キューブ", "cube.glb", "/path/cube.glb");
    addModel(db, "球体", "sphere.glb", "/path/sphere.glb");

    const models = getAllModels(db);
    expect(models).toHaveLength(2);
    expect(models.map((m) => m.name).sort()).toEqual(["キューブ", "球体"]);
  });

  it("IDでモデルを取得できる", () => {
    const model = addModel(db, "キューブ", "cube.glb", "/path/cube.glb");
    const found = getModel(db, model.id);
    expect(found).not.toBeNull();
    expect(found!.name).toBe("キューブ");
  });

  it("モデルを削除できる", () => {
    const model = addModel(db, "キューブ", "cube.glb", "/path/cube.glb");
    deleteModel(db, model.id);
    const models = getAllModels(db);
    expect(models).toHaveLength(0);
  });

  it("存在しないIDのモデル取得はnullを返す", () => {
    const found = getModel(db, "nonexistent");
    expect(found).toBeNull();
  });
});
