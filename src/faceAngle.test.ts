import { describe, it, expect } from "vitest";
import { calculateFaceAngles, Point3D } from "./faceAngle";

describe("calculateFaceAngles", () => {
  it("正面を向いた顔の場合、yaw/pitch/rollがほぼ0になる", () => {
    // 正面向きの顔ランドマーク（正規化座標 0-1）
    const noseTip: Point3D = { x: 0.5, y: 0.5, z: 0.0 };
    const foreheadCenter: Point3D = { x: 0.5, y: 0.3, z: 0.0 };
    const chin: Point3D = { x: 0.5, y: 0.7, z: 0.0 };
    const leftEye: Point3D = { x: 0.4, y: 0.4, z: 0.0 };
    const rightEye: Point3D = { x: 0.6, y: 0.4, z: 0.0 };

    const angles = calculateFaceAngles(
      noseTip,
      foreheadCenter,
      chin,
      leftEye,
      rightEye
    );

    expect(Math.abs(angles.yaw)).toBeLessThan(0.1);
    expect(Math.abs(angles.pitch)).toBeLessThan(0.1);
    expect(Math.abs(angles.roll)).toBeLessThan(0.1);
  });

  it("右を向いた顔の場合、yawが正の値になる", () => {
    // 右を向いた顔（鼻が右にずれ、右目と左目のz差がある）
    const noseTip: Point3D = { x: 0.6, y: 0.5, z: -0.05 };
    const foreheadCenter: Point3D = { x: 0.55, y: 0.3, z: 0.0 };
    const chin: Point3D = { x: 0.55, y: 0.7, z: 0.0 };
    const leftEye: Point3D = { x: 0.45, y: 0.4, z: 0.02 };
    const rightEye: Point3D = { x: 0.65, y: 0.4, z: -0.02 };

    const angles = calculateFaceAngles(
      noseTip,
      foreheadCenter,
      chin,
      leftEye,
      rightEye
    );

    expect(angles.yaw).toBeGreaterThan(0.1);
  });

  it("顔が傾いている場合、rollが非ゼロになる", () => {
    // 右に傾いた顔（右目が下がっている）
    const noseTip: Point3D = { x: 0.5, y: 0.5, z: 0.0 };
    const foreheadCenter: Point3D = { x: 0.5, y: 0.3, z: 0.0 };
    const chin: Point3D = { x: 0.5, y: 0.7, z: 0.0 };
    const leftEye: Point3D = { x: 0.4, y: 0.35, z: 0.0 };
    const rightEye: Point3D = { x: 0.6, y: 0.45, z: 0.0 };

    const angles = calculateFaceAngles(
      noseTip,
      foreheadCenter,
      chin,
      leftEye,
      rightEye
    );

    expect(Math.abs(angles.roll)).toBeGreaterThan(0.1);
  });

  it("上を向いた顔の場合、pitchが負の値になる", () => {
    // 上を向いた顔（鼻先が上にずれ、顎が奥にある）
    const noseTip: Point3D = { x: 0.5, y: 0.45, z: -0.05 };
    const foreheadCenter: Point3D = { x: 0.5, y: 0.25, z: 0.0 };
    const chin: Point3D = { x: 0.5, y: 0.7, z: 0.05 };
    const leftEye: Point3D = { x: 0.4, y: 0.38, z: 0.0 };
    const rightEye: Point3D = { x: 0.6, y: 0.38, z: 0.0 };

    const angles = calculateFaceAngles(
      noseTip,
      foreheadCenter,
      chin,
      leftEye,
      rightEye
    );

    expect(angles.pitch).toBeLessThan(-0.05);
  });
});
