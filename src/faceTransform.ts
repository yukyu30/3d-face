import { Point3D, FaceAngles } from "./faceAngle";

export interface FaceTransform {
  position: { x: number; y: number };
  scale: number;
  angles: FaceAngles;
}

export function calculateFaceTransform(
  landmarks: Point3D[],
  imageWidth: number,
  imageHeight: number,
  angles: FaceAngles
): FaceTransform {
  // ランドマークのバウンディングボックスを計算
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;

  for (const lm of landmarks) {
    if (lm.x < minX) minX = lm.x;
    if (lm.y < minY) minY = lm.y;
    if (lm.x > maxX) maxX = lm.x;
    if (lm.y > maxY) maxY = lm.y;
  }

  // 中心位置をピクセル座標に変換
  const centerX = ((minX + maxX) / 2) * imageWidth;
  const centerY = ((minY + maxY) / 2) * imageHeight;

  // バウンディングボックスの対角線長をスケールとする
  const width = (maxX - minX) * imageWidth;
  const height = (maxY - minY) * imageHeight;
  const scale = Math.sqrt(width * width + height * height);

  return {
    position: { x: centerX, y: centerY },
    scale,
    angles,
  };
}
