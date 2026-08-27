import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

export function createViewer(container) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#0b0e14");

  const camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.01, 5000);
  camera.position.set(2.4, 2.0, 2.8);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 0.05;
  controls.maxDistance = 200;
  controls.target.set(0, 0.3, 0);
  controls.update();

  const hemi = new THREE.HemisphereLight(0xffffff, 0x223044, 1.15);
  scene.add(hemi);
  const key = new THREE.DirectionalLight(0xffffff, 2.4);
  key.position.set(3, 6, 2);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x7aa7ff, 0.9);
  rim.position.set(-4, 1, -3);
  scene.add(rim);

  const grid = new THREE.GridHelper(10, 30, 0x2b3554, 0x1d2438);
  grid.position.y = -0.001;
  scene.add(grid);

  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(4, 48),
    new THREE.MeshStandardMaterial({ color: 0x131a27, roughness: 0.95, metalness: 0.05 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.002;
  scene.add(floor);

  const loader = new GLTFLoader();
  let current = null;
  let loadVersion = 0;

  // --- texture state ---
  let texturedMeshes = [];
  let ownedMaterials = [];
  let ownedTextures = [];

  const TEXTURE_PATTERNS = new Set([
    "none", "knurl", "dots", "grid", "checker", "wood", "brushed", "leather", "carbon", "waves", "hammered",
  ]);

  function clamp01(v, fallback) {
    const n = Number(v);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(1, Math.max(0, n));
  }

  function safeColor(value, fallback) {
    if (typeof value !== "string") return fallback;
    const m = value.match(/^#?([0-9a-f]{6})$/i);
    return m ? "#" + m[1] : fallback;
  }

  // Grayscale canvas: #808080 is flat, lighter reads as raised, darker as recessed.
  function patternCanvas(pattern) {
    const size = 512;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#808080";
    ctx.fillRect(0, 0, size, size);
    const step = size / 24;

    if (pattern === "knurl") {
      ctx.lineWidth = step * 0.38;
      for (let i = -size; i < size * 2; i += step) {
        ctx.strokeStyle = "#3c3c3c";
        ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i + size, size); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(i, size); ctx.lineTo(i + size, 0); ctx.stroke();
        ctx.strokeStyle = "#c8c8c8";
        ctx.beginPath(); ctx.moveTo(i + step * 0.22, 0); ctx.lineTo(i + size + step * 0.22, size); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(i + step * 0.22, size); ctx.lineTo(i + size + step * 0.22, 0); ctx.stroke();
      }
    } else if (pattern === "dots") {
      ctx.fillStyle = "#464646";
      for (let y = 0; y < size; y += step) {
        for (let x = 0; x < size; x += step) {
          ctx.beginPath();
          ctx.arc(x + step / 2, y + step / 2, step * 0.3, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    } else if (pattern === "grid") {
      ctx.strokeStyle = "#404040";
      ctx.lineWidth = step * 0.16;
      for (let i = 0; i <= size; i += step) {
        ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, size); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(size, i); ctx.stroke();
      }
    } else if (pattern === "checker") {
      const cell = size / 12;
      for (let y = 0; y < 12; y++) {
        for (let x = 0; x < 12; x++) {
          if ((x + y) % 2 === 0) continue;
          ctx.fillStyle = "#b4b4b4";
          ctx.fillRect(x * cell, y * cell, cell, cell);
        }
      }
    } else if (pattern === "wood") {
      for (let x = 0; x < size; x++) {
        const t = x / size * Math.PI * 8;
        const v = 0.5 + 0.28 * Math.sin(t + 1.6 * Math.sin(t * 0.37)) + (Math.random() - 0.5) * 0.05;
        const c = Math.round(v * 255);
        ctx.fillStyle = `rgb(${c},${c},${c})`;
        ctx.fillRect(x, 0, 1, size);
      }
    } else if (pattern === "brushed") {
      for (let y = 0; y < size; y++) {
        const v = 0.5 + (Math.random() - 0.5) * 0.34;
        const c = Math.round(v * 255);
        ctx.fillStyle = `rgb(${c},${c},${c})`;
        ctx.fillRect(0, y, size, 1);
      }
    } else if (pattern === "leather") {
      for (let i = 0; i < 2600; i++) {
        const r = step * (0.24 + Math.random() * 0.3);
        const x = Math.random() * size;
        const y = Math.random() * size;
        const shade = Math.random() < 0.5 ? "#5a5a5a" : "#a8a8a8";
        ctx.fillStyle = shade;
        ctx.beginPath();
        ctx.ellipse(x, y, r, r * (0.75 + Math.random() * 0.4), Math.random() * Math.PI, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (pattern === "carbon") {
      const cell = size / 12;
      for (let y = 0; y < 12; y++) {
        for (let x = 0; x < 12; x++) {
          const horizontal = (x + y) % 2 === 0;
          const g = ctx.createLinearGradient(x * cell, y * cell, horizontal ? (x + 1) * cell : x * cell, horizontal ? y * cell : (y + 1) * cell);
          g.addColorStop(0, "#3a3a3a");
          g.addColorStop(0.5, "#c2c2c2");
          g.addColorStop(1, "#3a3a3a");
          ctx.fillStyle = g;
          ctx.fillRect(x * cell, y * cell, cell, cell);
        }
      }
    } else if (pattern === "waves") {
      for (let x = 0; x < size; x++) {
        const v = 0.5 + 0.34 * Math.sin((x / size) * Math.PI * 10);
        const c = Math.round(v * 255);
        ctx.fillStyle = `rgb(${c},${c},${c})`;
        ctx.fillRect(x, 0, 1, size);
      }
    } else if (pattern === "hammered") {
      for (let i = 0; i < 900; i++) {
        const r = step * (0.35 + Math.random() * 0.45);
        const x = Math.random() * size;
        const y = Math.random() * size;
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, "#c0c0c0");
        g.addColorStop(0.75, "#8a8a8a");
        g.addColorStop(1, "#505050");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    return canvas;
  }

  function disposeTextureAssets() {
    for (const material of ownedMaterials) material.dispose?.();
    for (const texture of ownedTextures) texture.dispose?.();
    texturedMeshes = [];
    ownedMaterials = [];
    ownedTextures = [];
  }

  function clearTexture() {
    for (const mesh of texturedMeshes) {
      if (mesh.userData.baseMaterial) mesh.material = mesh.userData.baseMaterial;
      delete mesh.userData.baseMaterial;
    }
    disposeTextureAssets();
    renderer.render(scene, camera);
  }

  function applyTexture(spec = {}) {
    if (!current) return { ok: false, error: "No part is loaded to texture." };
    const meshes = [];
    current.traverse((node) => {
      if (node.isMesh) meshes.push(node);
    });
    if (!meshes.length) return { ok: false, error: "The loaded part has no surfaces to texture." };

    clearTexture();

    const pattern = TEXTURE_PATTERNS.has(spec.pattern) ? spec.pattern : "none";
    const finish = ["matte", "satin", "glossy"].includes(spec.finish) ? spec.finish : "satin";
    let roughness = clamp01(spec.roughness, 0.55);
    if (finish === "matte") roughness = Math.min(1, roughness + 0.15);
    if (finish === "glossy") roughness = Math.max(0.05, roughness - 0.18);
    const metalness = clamp01(spec.metalness, 0.1);
    const bumpStrength = clamp01(spec.bumpStrength, 0.6);
    const patternScale = Math.min(4, Math.max(0.1, Number(spec.patternScale) || 1));
    const baseColor = safeColor(spec.baseColor, "#b7bcc4");

    let bumpMap = null;
    if (pattern !== "none" && bumpStrength > 0.01) {
      bumpMap = new THREE.CanvasTexture(patternCanvas(pattern));
      bumpMap.wrapS = THREE.RepeatWrapping;
      bumpMap.wrapT = THREE.RepeatWrapping;
      const repeat = Math.max(1, Math.round(6 * patternScale));
      bumpMap.repeat.set(repeat, repeat);
      ownedTextures.push(bumpMap);
    }

    for (const mesh of meshes) {
      mesh.userData.baseMaterial = mesh.material;
      const material = new THREE.MeshStandardMaterial({
        color: new THREE.Color(baseColor),
        metalness,
        roughness,
      });
      if (bumpMap) {
        material.bumpMap = bumpMap;
        material.bumpScale = 0.028 * (0.4 + bumpStrength);
      }
      mesh.material = material;
      ownedMaterials.push(material);
      texturedMeshes.push(mesh);
    }

    renderer.render(scene, camera);
    return { ok: true, pattern, finish };
  }

  function render() {
    requestAnimationFrame(render);
    controls.update();
    renderer.render(scene, camera);
  }
  render();

  function resize() {
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (w === 0 || h === 0) return;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  }
  window.addEventListener("resize", resize);

  function clear() {
    loadVersion++;
    texturedMeshes = [];
    ownedMaterials = [];
    ownedTextures = [];
    if (current) {
      scene.remove(current);
      current.traverse((node) => {
        if (node.geometry) node.geometry.dispose();
        const materials = Array.isArray(node.material) ? node.material : [node.material];
        materials.forEach((material) => {
          if (!material) return;
          for (const value of Object.values(material)) {
            if (value && typeof value.dispose === "function" && value.isTexture) value.dispose();
          }
          material.dispose?.();
        });
      });
      current = null;
    }
    renderer.render(scene, camera);
  }

  function load(url) {
    return new Promise((resolve, reject) => {
      clear();
      const version = loadVersion;
      loader.load(
        url,
        (gltf) => {
          if (version !== loadVersion) {
            const stale = gltf.scene || gltf.scenes[0];
            stale?.traverse((node) => {
              if (node.geometry) node.geometry.dispose();
              const materials = Array.isArray(node.material) ? node.material : [node.material];
              materials.forEach((material) => material?.dispose?.());
            });
            return;
          }
          current = gltf.scene || gltf.scenes[0];
          
          // Fix orientation: CAD models are typically Z-up, but Three.js is Y-up.
          current.rotation.x = -Math.PI / 2;
          
          scene.add(current);

          const box0 = new THREE.Box3().setFromObject(current);
          const size0 = box0.getSize(new THREE.Vector3());
          const target = Math.max(size0.x, size0.y, size0.z, 1e-6);
          current.scale.setScalar(1 / target);

          const box = new THREE.Box3().setFromObject(current);
          const size = box.getSize(new THREE.Vector3());
          const center = box.getCenter(new THREE.Vector3());
          current.position.x -= center.x;
          current.position.z -= center.z;
          current.position.y -= box.min.y;

          fit(box, size);
          resolve({ size, sourceSizeMm: size0.multiplyScalar(1000) });
        },
        undefined,
        (err) => reject(err)
      );
    });
  }

  function fit(box, size) {
    const radius = Math.max(size.length() * 0.6, 0.1);
    const dist = (radius / Math.tan((camera.fov * Math.PI) / 360)) * 1.3;
    camera.position.set(dist * 0.75, dist * 0.6, dist * 0.85);
    controls.target.set(0, size.y / 2, 0);
    controls.update();
  }

  function reset() {
    if (current) {
      const box = new THREE.Box3().setFromObject(current);
      fit(box, box.getSize(new THREE.Vector3()));
    } else {
      camera.position.set(2.4, 2.0, 2.8);
      controls.target.set(0, 0.3, 0);
      controls.update();
    }
  }

  // Renders one frame at an elevated resolution and returns a PNG data URL
  // of exactly what the user sees (camera, materials, textures included).
  // The live canvas is restored afterwards; nothing visual changes.
  async function captureHighRes({ width = 2560 } = {}) {
    if (!current) throw new Error("Nothing is loaded in the viewer yet.");
    const aspect = camera.aspect || 4 / 3;
    const w = Math.max(1, Math.min(Math.round(width), 3200));
    const h = Math.max(1, Math.round(w / aspect));
    const oldSize = new THREE.Vector2();
    renderer.getSize(oldSize);
    const oldPixelRatio = renderer.getPixelRatio();
    const oldAspect = camera.aspect;
    try {
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setPixelRatio(1);
      renderer.setSize(w, h, false);
      renderer.render(scene, camera);
      return renderer.domElement.toDataURL("image/png");
    } finally {
      renderer.setPixelRatio(oldPixelRatio);
      renderer.setSize(oldSize.x, oldSize.y, false);
      camera.aspect = oldAspect;
      camera.updateProjectionMatrix();
      renderer.render(scene, camera);
    }
  }

  return { load, clear, reset, resize, applyTexture, clearTexture, captureHighRes };
}
