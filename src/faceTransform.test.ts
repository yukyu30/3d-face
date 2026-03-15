import { describe, it, expect } from "vitest";
import { calculateFaceTransform } from "./faceTransform";
import { Point3D, FaceAngles } from "./faceAngle";

describe("calculateFaceTransform", () => {
  const defaultAngles: FaceAngles = { yaw: 0, pitch: 0, roll: 0 };

  it("顔の中心位置をピクセル座標で返す", () => {
    // 画像中心にある顔のランドマーク（正規化座標）
    const landmarks: Point3D[] = [
      { x: 0.4, y: 0.3, z: 0 }, // 左上付近
      { x: 0.6, y: 0.3, z: 0 }, // 右上付近
      { x: 0.4, y: 0.7, z: 0 }, // 左下付近
      { x: 0.6, y: 0.7, z: 0 }, // 右下付近
      { x: 0.5, y: 0.5, z: 0 }, // 中心（鼻）
    ];
    const imageWidth = 640;
    const imageHeight = 480;

    const transform = calculateFaceTransform(
      landmarks,
      imageWidth,
      imageHeight,
      defaultAngles
    );

    // 中心位置がピクセル座標で返される
    expect(transform.position.x).toBeCloseTo(320, 0);
    expect(transform.position.y).toBeCloseTo(240, 0);
  });

  it("顔のサイズに基づいたスケールを返す", () => {
    const landmarks: Point3D[] = [
      { x: 0.3, y: 0.2, z: 0 },
      { x: 0.7, y: 0.2, z: 0 },
      { x: 0.3, y: 0.8, z: 0 },
      { x: 0.7, y: 0.8, z: 0 },
      { x: 0.5, y: 0.5, z: 0 },
    ];
    const imageWidth = 640;
    const imageHeight = 480;

    const transform = calculateFaceTransform(
      landmarks,
      imageWidth,
      imageHeight,
      defaultAngles
    );

    // スケールは正の値
    expect(transform.scale).toBeGreaterThan(0);
  });

  it("大きい顔ほどスケールが大きくなる", () => {
    const smallFace: Point3D[] = [
      { x: 0.45, y: 0.45, z: 0 },
      { x: 0.55, y: 0.45, z: 0 },
      { x: 0.45, y: 0.55, z: 0 },
      { x: 0.55, y: 0.55, z: 0 },
      { x: 0.5, y: 0.5, z: 0 },
    ];
    const largeFace: Point3D[] = [
      { x: 0.2, y: 0.2, z: 0 },
      { x: 0.8, y: 0.2, z: 0 },
      { x: 0.2, y: 0.8, z: 0 },
      { x: 0.8, y: 0.8, z: 0 },
      { x: 0.5, y: 0.5, z: 0 },
    ];
    const imageWidth = 640;
    const imageHeight = 480;

    const smallTransform = calculateFaceTransform(
      smallFace,
      imageWidth,
      imageHeight,
      defaultAngles
    );
    const largeTransform = calculateFaceTransform(
      largeFace,
      imageWidth,
      imageHeight,
      defaultAngles
    );

    expect(largeTransform.scale).toBeGreaterThan(smallTransform.scale);
  });

  it("anglesをそのまま保持する", () => {
    const landmarks: Point3D[] = [
      { x: 0.5, y: 0.5, z: 0 },
    ];
    const angles: FaceAngles = { yaw: 0.5, pitch: -0.3, roll: 0.1 };

    const transform = calculateFaceTransform(landmarks, 640, 480, angles);

    expect(transform.angles).toEqual(angles);
  });
});
