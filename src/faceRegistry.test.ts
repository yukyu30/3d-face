import { describe, it, expect } from "vitest";
import {
  cosineSimilarity,
  findMatchingPerson,
  FaceDescriptor,
  RegisteredPerson,
} from "./faceRegistry";

describe("cosineSimilarity", () => {
  it("同一ベクトルの類似度は1になる", () => {
    const a = [1, 0, 0, 0];
    expect(cosineSimilarity(a, a)).toBeCloseTo(1, 5);
  });

  it("直交ベクトルの類似度は0になる", () => {
    const a = [1, 0, 0, 0];
    const b = [0, 1, 0, 0];
    expect(cosineSimilarity(a, b)).toBeCloseTo(0, 5);
  });

  it("反対方向のベクトルの類似度は-1になる", () => {
    const a = [1, 0, 0, 0];
    const b = [-1, 0, 0, 0];
    expect(cosineSimilarity(a, b)).toBeCloseTo(-1, 5);
  });
});

describe("findMatchingPerson", () => {
  const alice: RegisteredPerson = {
    id: "1",
    name: "Alice",
    modelUrl: "/models/alice.glb",
    descriptors: [{ embedding: [1, 0, 0, 0] }],
  };
  const bob: RegisteredPerson = {
    id: "2",
    name: "Bob",
    modelUrl: "/models/bob.glb",
    descriptors: [{ embedding: [0, 1, 0, 0] }],
  };
  const registry = [alice, bob];

  it("登録済みの人物と一致する顔を識別できる", () => {
    const descriptor: FaceDescriptor = { embedding: [0.98, 0.1, 0.05, 0.02] };
    const match = findMatchingPerson(descriptor, registry);
    expect(match).not.toBeNull();
    expect(match!.name).toBe("Alice");
  });

  it("別の登録済み人物と一致する顔も識別できる", () => {
    const descriptor: FaceDescriptor = { embedding: [0.05, 0.95, 0.1, 0.02] };
    const match = findMatchingPerson(descriptor, registry);
    expect(match).not.toBeNull();
    expect(match!.name).toBe("Bob");
  });

  it("未登録の顔の場合nullを返す", () => {
    const descriptor: FaceDescriptor = { embedding: [0, 0, 0, 1] };
    const match = findMatchingPerson(descriptor, registry);
    expect(match).toBeNull();
  });

  it("閾値を指定できる", () => {
    const descriptor: FaceDescriptor = { embedding: [0.7, 0.7, 0, 0] };
    // 高い閾値では一致しない
    const strictMatch = findMatchingPerson(descriptor, registry, 0.95);
    expect(strictMatch).toBeNull();
    // 低い閾値では一致する
    const looseMatch = findMatchingPerson(descriptor, registry, 0.5);
    expect(looseMatch).not.toBeNull();
  });
});
