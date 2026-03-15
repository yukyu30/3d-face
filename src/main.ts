import * as THREE from "three";
import { calculateFaceAngles, Point3D } from "./faceAngle";
import { calculateFaceTransform } from "./faceTransform";
import { RegisteredPerson, findMatchingPerson, FaceDescriptor } from "./faceRegistry";

// MediaPipe Face Mesh ランドマークインデックス
const NOSE_TIP = 1;
const FOREHEAD = 10;
const CHIN = 152;
const LEFT_EYE = 33;
const RIGHT_EYE = 263;

// Electron API 型定義
declare global {
  interface Window {
    electronAPI?: {
      getAllPersons: () => Promise<RegisteredPerson[]>;
      addPerson: (name: string, modelUrl: string, descriptors: FaceDescriptor[]) => Promise<RegisteredPerson>;
      deletePerson: (id: string) => Promise<void>;
      addDescriptor: (personId: string, descriptor: FaceDescriptor) => Promise<void>;
      saveFile: (defaultName: string, dataUrl: string) => Promise<string | null>;
    };
    FaceMesh: any;
  }
}

// 人物ごとの3Dオブジェクトの色を生成
function personColor(id: string): THREE.Color {
  const hash = id.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
  const hue = (hash * 137) % 360;
  return new THREE.Color(`hsl(${hue}, 70%, 50%)`);
}

function createMask(color: number | THREE.Color = 0x4488ff): THREE.Mesh {
  const geometry = new THREE.BoxGeometry(1, 1.2, 0.8);
  const material = new THREE.MeshPhongMaterial({
    color,
    opacity: 0.85,
    transparent: true,
  });
  return new THREE.Mesh(geometry, material);
}

// ランドマークから簡易的な特徴量を生成
function landmarksToDescriptor(
  landmarks: { x: number; y: number; z: number }[]
): FaceDescriptor {
  const keyIndices = [1, 10, 33, 61, 133, 152, 199, 263, 291, 362];
  const embedding: number[] = [];

  for (let i = 0; i < keyIndices.length; i++) {
    for (let j = i + 1; j < keyIndices.length; j++) {
      const a = landmarks[keyIndices[i]];
      const b = landmarks[keyIndices[j]];
      const dx = a.x - b.x;
      const dy = a.y - b.y;
      embedding.push(Math.sqrt(dx * dx + dy * dy));
    }
  }

  const norm = Math.sqrt(embedding.reduce((s, v) => s + v * v, 0));
  if (norm > 0) {
    for (let i = 0; i < embedding.length; i++) {
      embedding[i] /= norm;
    }
  }

  return { embedding };
}

async function main() {
  // DOM要素
  const dropZone = document.getElementById("dropZone")!;
  const fileInput = document.getElementById("fileInput") as HTMLInputElement;
  const preview = document.getElementById("preview") as HTMLImageElement;
  const resultCanvas = document.getElementById("result") as HTMLCanvasElement;
  const processBtn = document.getElementById("processBtn") as HTMLButtonElement;
  const saveBtn = document.getElementById("saveBtn") as HTMLButtonElement;
  const registerBtn = document.getElementById("registerBtn") as HTMLButtonElement;
  const registryList = document.getElementById("registryList") as HTMLDivElement;
  const personNameInput = document.getElementById("personName") as HTMLInputElement;
  const modelUrlInput = document.getElementById("modelUrl") as HTMLInputElement;
  const fileNameDisplay = document.getElementById("fileName") as HTMLDivElement;
  const statusDisplay = document.getElementById("status") as HTMLDivElement;

  let currentFileName = "";
  let registry: RegisteredPerson[] = [];
  let lastLandmarks: { x: number; y: number; z: number }[][] = [];

  // DB or LocalStorage
  const useElectron = !!window.electronAPI;

  async function loadRegistry(): Promise<RegisteredPerson[]> {
    if (useElectron) {
      return window.electronAPI!.getAllPersons();
    }
    const data = localStorage.getItem("face3d_registry");
    return data ? JSON.parse(data) : [];
  }

  async function saveRegistryData(reg: RegisteredPerson[]): Promise<void> {
    if (!useElectron) {
      localStorage.setItem("face3d_registry", JSON.stringify(reg));
    }
  }

  registry = await loadRegistry();

  // Three.js セットアップ
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(0, 640, 0, 480, 0.1, 1000);
  camera.position.z = 500;

  scene.add(new THREE.AmbientLight(0xffffff, 0.6));
  const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
  dirLight.position.set(0, 0, 500);
  scene.add(dirLight);

  const masks = new Map<number, THREE.Mesh>();
  const resultCtx = resultCanvas.getContext("2d")!;

  // レジストリ表示
  function updateRegistryDisplay(): void {
    registryList.innerHTML = "";
    for (const person of registry) {
      const item = document.createElement("div");
      item.className = "registry-item";
      item.innerHTML = `
        <span>${person.name}</span>
        <button class="delete-btn" data-id="${person.id}">削除</button>
      `;
      registryList.appendChild(item);
    }
    registryList.querySelectorAll(".delete-btn").forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        const id = (e.target as HTMLElement).dataset.id!;
        if (useElectron) {
          await window.electronAPI!.deletePerson(id);
        }
        registry = registry.filter((p) => p.id !== id);
        await saveRegistryData(registry);
        updateRegistryDisplay();
      });
    });
  }
  updateRegistryDisplay();

  // ドラッグ＆ドロップ
  dropZone.addEventListener("click", () => fileInput.click());
  dropZone.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropZone.classList.add("dragover");
  });
  dropZone.addEventListener("dragleave", () => {
    dropZone.classList.remove("dragover");
  });
  dropZone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropZone.classList.remove("dragover");
    const file = (e as DragEvent).dataTransfer?.files[0];
    if (file) handleFile(file);
  });

  fileInput.addEventListener("change", () => {
    const file = fileInput.files?.[0];
    if (file) handleFile(file);
  });

  function handleFile(file: File): void {
    currentFileName = file.name;
    fileNameDisplay.textContent = currentFileName;
    const reader = new FileReader();
    reader.onload = (ev) => {
      preview.src = ev.target!.result as string;
      preview.style.display = "block";
      resultCanvas.style.display = "none";
      dropZone.style.display = "none";
      processBtn.disabled = false;
      saveBtn.disabled = true;
      statusDisplay.textContent = "";
    };
    reader.readAsDataURL(file);
  }

  // FaceMeshの初期化と画像処理
  async function processImage(): Promise<void> {
    return new Promise((resolve, reject) => {
      const FaceMesh = window.FaceMesh;
      if (!FaceMesh) {
        reject(new Error("MediaPipe Face Mesh が読み込まれていません"));
        return;
      }

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

      faceMesh.onResults((results: any) => {
        const w = preview.naturalWidth;
        const h = preview.naturalHeight;

        // キャンバスサイズ設定
        resultCanvas.width = w;
        resultCanvas.height = h;
        renderer.setSize(w, h);
        camera.right = w;
        camera.bottom = h;
        camera.updateProjectionMatrix();

        // 元画像を描画
        resultCtx.drawImage(preview, 0, 0, w, h);

        // 前のマスクをクリア
        masks.forEach((mask) => scene.remove(mask));
        masks.clear();
        lastLandmarks = [];

        if (results.multiFaceLandmarks && results.multiFaceLandmarks.length > 0) {
          statusDisplay.textContent = `${results.multiFaceLandmarks.length}人の顔を検出しました`;

          for (let i = 0; i < results.multiFaceLandmarks.length; i++) {
            const landmarks = results.multiFaceLandmarks[i];
            lastLandmarks.push(landmarks);

            // 顔の角度計算
            const noseTip: Point3D = landmarks[NOSE_TIP];
            const forehead: Point3D = landmarks[FOREHEAD];
            const chin: Point3D = landmarks[CHIN];
            const leftEye: Point3D = landmarks[LEFT_EYE];
            const rightEye: Point3D = landmarks[RIGHT_EYE];

            const angles = calculateFaceAngles(noseTip, forehead, chin, leftEye, rightEye);

            // トランスフォーム計算
            const allPoints: Point3D[] = landmarks.map((l: any) => ({
              x: l.x,
              y: l.y,
              z: l.z,
            }));
            const transform = calculateFaceTransform(allPoints, w, h, angles);

            // 人物識別
            const descriptor = landmarksToDescriptor(landmarks);
            const person = findMatchingPerson(descriptor, registry);

            // マスク生成
            const color = person ? personColor(person.id) : 0x4488ff;
            const mask = createMask(color);
            const scale = transform.scale * 0.8;
            mask.scale.set(scale, scale, scale);
            mask.position.set(transform.position.x, transform.position.y, 0);
            mask.rotation.set(
              transform.angles.pitch,
              -transform.angles.yaw,
              -transform.angles.roll
            );
            scene.add(mask);
            masks.set(i, mask);
          }

          // Three.jsをレンダリングして合成
          renderer.render(scene, camera);
          resultCtx.drawImage(renderer.domElement, 0, 0);
        } else {
          statusDisplay.textContent = "顔が検出されませんでした";
        }

        preview.style.display = "none";
        resultCanvas.style.display = "block";
        resolve();
      });

      faceMesh.send({ image: preview }).catch(reject);
    });
  }

  // 処理ボタン
  processBtn.addEventListener("click", async () => {
    processBtn.disabled = true;
    processBtn.textContent = "処理中...";
    statusDisplay.textContent = "顔を検出しています...";

    try {
      await processImage();
      saveBtn.disabled = false;
    } catch (err) {
      console.error("処理エラー:", err);
      statusDisplay.textContent = "エラー: 顔検出に失敗しました";
    } finally {
      processBtn.disabled = false;
      processBtn.textContent = "顔を隠す";
    }
  });

  // 保存ボタン
  saveBtn.addEventListener("click", async () => {
    const dataUrl = resultCanvas.toDataURL("image/png");
    const baseName = currentFileName.replace(/\.[^.]+$/, "");
    const saveName = `${baseName}.png`;

    if (useElectron) {
      const savedPath = await window.electronAPI!.saveFile(saveName, dataUrl);
      if (savedPath) {
        statusDisplay.textContent = `保存しました: ${savedPath}`;
      }
    } else {
      // ブラウザフォールバック
      const link = document.createElement("a");
      link.download = saveName;
      link.href = dataUrl;
      link.click();
      statusDisplay.textContent = `${saveName} をダウンロードしました`;
    }
  });

  // 人物登録
  registerBtn.addEventListener("click", async () => {
    const name = personNameInput.value.trim();
    if (!name) {
      statusDisplay.textContent = "名前を入力してください";
      return;
    }

    if (lastLandmarks.length === 0) {
      statusDisplay.textContent = "まず画像を処理してください";
      return;
    }

    registerBtn.disabled = true;
    registerBtn.textContent = "登録中...";

    try {
      // 最初に検出された顔の特徴量で登録
      const descriptor = landmarksToDescriptor(lastLandmarks[0]);
      const modelUrl = modelUrlInput.value.trim();

      let newPerson: RegisteredPerson;
      if (useElectron) {
        newPerson = await window.electronAPI!.addPerson(name, modelUrl, [descriptor]);
      } else {
        newPerson = {
          id: crypto.randomUUID(),
          name,
          modelUrl,
          descriptors: [descriptor],
        };
        registry.push(newPerson);
        await saveRegistryData(registry);
      }

      if (useElectron) {
        registry = await loadRegistry();
      }

      updateRegistryDisplay();
      personNameInput.value = "";
      modelUrlInput.value = "";
      statusDisplay.textContent = `${name} を登録しました`;
    } catch (err) {
      console.error("登録エラー:", err);
      statusDisplay.textContent = "登録に失敗しました";
    } finally {
      registerBtn.disabled = false;
      registerBtn.textContent = "この顔を登録";
    }
  });
}

main();
