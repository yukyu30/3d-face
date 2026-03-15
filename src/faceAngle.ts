export interface Point3D {
  x: number;
  y: number;
  z: number;
}

export interface FaceAngles {
  yaw: number;
  pitch: number;
  roll: number;
}

export function calculateFaceAngles(
  noseTip: Point3D,
  foreheadCenter: Point3D,
  chin: Point3D,
  leftEye: Point3D,
  rightEye: Point3D
): FaceAngles {
  // Yaw: 鼻先と両目中心のX座標差 + Z座標の差から推定
  const eyeCenterX = (leftEye.x + rightEye.x) / 2;
  const noseOffsetX = noseTip.x - eyeCenterX;
  const eyeZDiff = rightEye.z - leftEye.z;
  const yaw = Math.atan2(noseOffsetX * 3 - eyeZDiff * 2, 1);

  // Pitch: 額と顎の中心に対する鼻先のY座標差とZ座標から推定
  const faceCenterY = (foreheadCenter.y + chin.y) / 2;
  const noseOffsetY = noseTip.y - faceCenterY;
  const verticalZDiff = chin.z - foreheadCenter.z;
  const pitch = Math.atan2(-verticalZDiff + noseOffsetY * 0.5, 1);

  // Roll: 両目のY座標差から回転角度を計算
  const eyeDeltaY = rightEye.y - leftEye.y;
  const eyeDeltaX = rightEye.x - leftEye.x;
  const roll = Math.atan2(eyeDeltaY, eyeDeltaX);

  return { yaw, pitch, roll };
}
