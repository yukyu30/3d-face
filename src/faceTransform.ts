import { Point3D, FaceAngles } from "./faceAngle";

export interface FaceTransform {
  position: { x: number; y: number };
  scale: number;
  faceWidth: number;
  faceHeight: number;
  angles: FaceAngles;
}

export function calculateFaceTransform(
  landmarks: Point3D[],
  imageWidth: number,
  imageHeight: number,
  angles: FaceAngles
): FaceTransform {
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

  const centerX = ((minX + maxX) / 2) * imageWidth;
  const centerY = ((minY + maxY) / 2) * imageHeight;
  const faceWidth = (maxX - minX) * imageWidth;
  const faceHeight = (maxY - minY) * imageHeight;
  const scale = Math.max(faceWidth, faceHeight);

  return {
    position: { x: centerX, y: centerY },
    scale,
    faceWidth,
    faceHeight,
    angles,
  };
}
