import * as THREE from "three";
import { calculateFaceAngles, Point3D } from "./faceAngle";
import { calculateFaceTransform, FaceTransform } from "./faceTransform";
import {
  RegisteredPerson,
  FaceDescriptor,
  findMatchingPerson,
} from "./faceRegistry";

// MediaPipe Face Meshのランドマークインデックス
const NOSE_TIP = 1;
const FOREHEAD = 10;
const CHIN = 152;
const LEFT_EYE = 33;
const RIGHT_EYE = 263;

// 人物レジストリ（LocalStorageで永続化）
const REGISTRY_KEY = "face3d_registry";

function loadRegistry(): RegisteredPerson[] {
  const data = localStorage.getItem(REGISTRY_KEY);
  return data ? JSON.parse(data) : [];
}

function saveRegistry(registry: RegisteredPerson[]): void {
  localStorage.setItem(REGISTRY_KEY, JSON.stringify(registry));
}

// デフォルト3Dモデル（立方体）を作成
function createDefaultMask(): THREE.Mesh {
  const geometry = new THREE.BoxGeometry(1, 1.2, 0.8);
  const material = new THREE.MeshPhongMaterial({
    color: 0x4488ff,
    opacity: 0.85,
    transparent: true,
  });
  return new THREE.Mesh(geometry, material);
}

// 人物ごとの3Dオブジェクトを生成（色違い）
function createPersonMask(person: RegisteredPerson): THREE.Mesh {
  const colors: Record<string, number> = {};
  const hash = person.id.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
  const hue = (hash * 137) % 360;
  const color = new THREE.Color(`hsl(${hue}, 70%, 50%)`);

  const geometry = new THREE.BoxGeometry(1, 1.2, 0.8);
  const material = new THREE.MeshPhongMaterial({
    color,
    opacity: 0.85,
    transparent: true,
  });
  void colors; // suppress unused
  return new THREE.Mesh(geometry, material);
}

interface AppState {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.OrthographicCamera;
  masks: Map<number, THREE.Mesh>;
  registry: RegisteredPerson[];
  currentFileName: string;
  canvas2d: HTMLCanvasElement;
  ctx2d: CanvasRenderingContext2D;
}

function setupThreeJS(width: number, height: number) {
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
  renderer.setSize(width, height);
  renderer.setClearColor(0x000000, 0);

  const camera = new THREE.OrthographicCamera(
    0,
    width,
    0,
    height,
    0.1,
    1000
  );
  camera.position.z = 500;

  const scene = new THREE.Scene();

  const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
  scene.add(ambientLight);

  const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
  directionalLight.position.set(0, 0, 500);
  scene.add(directionalLight);

  return { renderer, scene, camera };
}

function processLandmarks(
  landmarks: { x: number; y: number; z: number }[],
  faceIndex: number,
  state: AppState
): FaceTransform {
  const noseTip: Point3D = landmarks[NOSE_TIP];
  const forehead: Point3D = landmarks[FOREHEAD];
  const chin: Point3D = landmarks[CHIN];
  const leftEye: Point3D = landmarks[LEFT_EYE];
  const rightEye: Point3D = landmarks[RIGHT_EYE];

  const angles = calculateFaceAngles(noseTip, forehead, chin, leftEye, rightEye);

  const allPoints: Point3D[] = landmarks.map((l) => ({
    x: l.x,
    y: l.y,
    z: l.z,
  }));

  const transform = calculateFaceTransform(
    allPoints,
    state.canvas2d.width,
    state.canvas2d.height,
    angles
  );

  return transform;
}

function updateMask(
  transform: FaceTransform,
  faceIndex: number,
  state: AppState,
  person: RegisteredPerson | null
): void {
  let mask = state.masks.get(faceIndex);
  if (!mask) {
    mask = person ? createPersonMask(person) : createDefaultMask();
    state.scene.add(mask);
    state.masks.set(faceIndex, mask);
  }

  const scale = transform.scale * 0.8;
  mask.scale.set(scale, scale, scale);
  mask.position.set(
    transform.position.x,
    transform.position.y,
    0
  );
  mask.rotation.set(
    transform.angles.pitch,
    -transform.angles.yaw,
    -transform.angles.roll
  );
}

function clearUnusedMasks(activeFaces: number, state: AppState): void {
  for (const [index, mask] of state.masks) {
    if (index >= activeFaces) {
      state.scene.remove(mask);
      state.masks.delete(index);
    }
  }
}

// MediaPipe Face Meshの初期化
async function initFaceMesh(
  state: AppState,
  onResults: (results: any) => void
) {
  // @ts-ignore - MediaPipe CDNから読み込み
  const FaceMesh = window.FaceMesh;
  const faceMesh = new FaceMesh({
    locateFile: (file: string) =>
      `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`,
  });

  faceMesh.setOptions({
    maxNumFaces: 10,
    refineLandmarks: true,
    minDetectionConfidence: 0.5,
    minTrackingConfidence: 0.5,
  });

  faceMesh.onResults(onResults);
  return faceMesh;
}

// 画像を処理
async function processImage(
  imageElement: HTMLImageElement,
  state: AppState
): Promise<string> {
  return new Promise(async (resolve) => {
    const faceMesh = await initFaceMesh(state, (results: any) => {
      // 2Dキャンバスに元画像を描画
      state.canvas2d.width = imageElement.naturalWidth;
      state.canvas2d.height = imageElement.naturalHeight;
      state.ctx2d.drawImage(imageElement, 0, 0);

      // Three.jsのサイズを合わせる
      state.renderer.setSize(imageElement.naturalWidth, imageElement.naturalHeight);
      state.camera.right = imageElement.naturalWidth;
      state.camera.bottom = imageElement.naturalHeight;
      state.camera.updateProjectionMatrix();

      if (results.multiFaceLandmarks) {
        for (let i = 0; i < results.multiFaceLandmarks.length; i++) {
          const landmarks = results.multiFaceLandmarks[i];
          const transform = processLandmarks(landmarks, i, state);

          // 顔の特徴量からマッチング（簡易実装: ランドマークの比率を特徴量として使用）
          const descriptor = landmarksToDescriptor(landmarks);
          const person = findMatchingPerson(descriptor, state.registry);

          updateMask(transform, i, state, person);
        }
        clearUnusedMasks(results.multiFaceLandmarks.length, state);
      }

      // Three.jsをレンダリング
      state.renderer.render(state.scene, state.camera);

      // 2Dキャンバスに3Dレンダリング結果を合成
      state.ctx2d.drawImage(state.renderer.domElement, 0, 0);

      // 結果画像を返す
      resolve(state.canvas2d.toDataURL("image/png"));
    });

    await faceMesh.send({ image: imageElement });
  });
}

// ランドマークから簡易的な特徴量を生成
function landmarksToDescriptor(
  landmarks: { x: number; y: number; z: number }[]
): FaceDescriptor {
  // 顔の幾何学的特徴を使った簡易的な特徴量
  const keyIndices = [1, 10, 33, 61, 133, 152, 199, 263, 291, 362];
  const embedding: number[] = [];

  for (let i = 0; i < keyIndices.length; i++) {
    for (let j = i + 1; j < keyIndices.length; j++) {
      const a = landmarks[keyIndices[i]];
      const b = landmarks[keyIndices[j]];
      const dx = a.x - b.x;
      const dy = a.y - b.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      embedding.push(dist);
    }
  }

  // 正規化
  const norm = Math.sqrt(embedding.reduce((s, v) => s + v * v, 0));
  if (norm > 0) {
    for (let i = 0; i < embedding.length; i++) {
      embedding[i] /= norm;
    }
  }

  return { embedding };
}

// ファイル保存
function downloadImage(dataUrl: string, fileName: string): void {
  const link = document.createElement("a");
  link.download = fileName;
  link.href = dataUrl;
  link.click();
}

// UI初期化
export function initApp(): void {
  const canvas2d = document.createElement("canvas");
  const ctx2d = canvas2d.getContext("2d")!;

  const { renderer, scene, camera } = setupThreeJS(640, 480);

  const state: AppState = {
    renderer,
    scene,
    camera,
    masks: new Map(),
    registry: loadRegistry(),
    currentFileName: "",
    canvas2d,
    ctx2d,
  };

  // ファイル入力
  const fileInput = document.getElementById("fileInput") as HTMLInputElement;
  const preview = document.getElementById("preview") as HTMLImageElement;
  const resultCanvas = document.getElementById("result") as HTMLCanvasElement;
  const processBtn = document.getElementById("processBtn") as HTMLButtonElement;
  const saveBtn = document.getElementById("saveBtn") as HTMLButtonElement;
  const registerBtn = document.getElementById(
    "registerBtn"
  ) as HTMLButtonElement;
  const registryList = document.getElementById(
    "registryList"
  ) as HTMLDivElement;

  // プレビュー用キャンバスコンテキスト
  const resultCtx = resultCanvas.getContext("2d")!;
  state.canvas2d = resultCanvas;
  state.ctx2d = resultCtx;

  // レジストリ表示の更新
  function updateRegistryDisplay(): void {
    registryList.innerHTML = "";
    for (const person of state.registry) {
      const item = document.createElement("div");
      item.className = "registry-item";
      item.innerHTML = `
        <span><strong>${person.name}</strong> - ${person.modelUrl || "デフォルトモデル"}</span>
        <button class="delete-btn" data-id="${person.id}">削除</button>
      `;
      registryList.appendChild(item);
    }

    // 削除ボタンのイベント
    registryList.querySelectorAll(".delete-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        const id = (e.target as HTMLElement).dataset.id;
        state.registry = state.registry.filter((p) => p.id !== id);
        saveRegistry(state.registry);
        updateRegistryDisplay();
      });
    });
  }

  // ファイル選択
  fileInput.addEventListener("change", (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;

    state.currentFileName = file.name;
    const reader = new FileReader();
    reader.onload = (ev) => {
      preview.src = ev.target!.result as string;
      preview.style.display = "block";
      processBtn.disabled = false;
    };
    reader.readAsDataURL(file);
  });

  // 処理実行
  processBtn.addEventListener("click", async () => {
    processBtn.disabled = true;
    processBtn.textContent = "処理中...";

    // マスクをクリア
    state.masks.forEach((mask) => state.scene.remove(mask));
    state.masks.clear();

    try {
      const resultDataUrl = await processImage(preview, state);
      saveBtn.disabled = false;
      // resultDataUrl is already drawn to the canvas
      void resultDataUrl;
    } catch (err) {
      console.error("処理エラー:", err);
      alert("顔検出に失敗しました。別の画像を試してください。");
    } finally {
      processBtn.disabled = false;
      processBtn.textContent = "顔を隠す";
    }
  });

  // 保存（元のファイル名で）
  saveBtn.addEventListener("click", () => {
    const dataUrl = resultCanvas.toDataURL("image/png");
    // 元のファイル名から拡張子を取り、pngに変更
    const baseName = state.currentFileName.replace(/\.[^.]+$/, "");
    downloadImage(dataUrl, `${baseName}.png`);
  });

  // 人物登録
  registerBtn.addEventListener("click", async () => {
    const nameInput = document.getElementById(
      "personName"
    ) as HTMLInputElement;
    const modelInput = document.getElementById(
      "modelUrl"
    ) as HTMLInputElement;

    const name = nameInput.value.trim();
    if (!name) {
      alert("名前を入力してください");
      return;
    }

    if (!preview.src || preview.style.display === "none") {
      alert("まず画像を読み込んでください");
      return;
    }

    // 画像から顔の特徴量を取得して登録
    registerBtn.textContent = "登録中...";
    registerBtn.disabled = true;

    try {
      const faceMesh = await initFaceMesh(state, (results: any) => {
        if (
          results.multiFaceLandmarks &&
          results.multiFaceLandmarks.length > 0
        ) {
          const descriptor = landmarksToDescriptor(
            results.multiFaceLandmarks[0]
          );

          const person: RegisteredPerson = {
            id: crypto.randomUUID(),
            name,
            modelUrl: modelInput.value.trim() || "",
            descriptors: [descriptor],
          };

          state.registry.push(person);
          saveRegistry(state.registry);
          updateRegistryDisplay();
          nameInput.value = "";
          modelInput.value = "";
        } else {
          alert("顔が検出されませんでした");
        }
      });

      await faceMesh.send({ image: preview });
    } catch (err) {
      console.error("登録エラー:", err);
      alert("顔の登録に失敗しました");
    } finally {
      registerBtn.textContent = "この顔を登録";
      registerBtn.disabled = false;
    }
  });

  updateRegistryDisplay();
}
