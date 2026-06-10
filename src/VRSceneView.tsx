import React, { useEffect, useRef } from "react";
import * as THREE from "three";

type VRSceneViewProps = {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  title: string;
  onExit: () => void;
  lookRef?: React.MutableRefObject<{ yaw: number; pitch: number } | null>;
};

export default function VRSceneView({ onExit, lookRef }: VRSceneViewProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const xrButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    // ── Renderer — renders behind the player at z-index: -1 ──────────────────
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.setClearColor(0x05050a, 1);
    renderer.xr.enabled = true;
    renderer.domElement.style.position = "absolute";
    renderer.domElement.style.inset = "0";
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    mount.appendChild(renderer.domElement);

    // Sync canvas buffer to actual CSS display size each frame
    function syncSize() {
      const canvas = renderer.domElement;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (w < 2 || h < 2) return;
      const pr = renderer.getPixelRatio();
      if (canvas.width !== Math.round(w * pr) || canvas.height !== Math.round(h * pr)) {
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
      }
    }

    // ── Scene / Camera ────────────────────────────────────────────────────────
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x05050a);

    const camera = new THREE.PerspectiveCamera(75, 1, 0.1, 1000);
    camera.position.set(0, 0, 0);

    // ── Stars ─────────────────────────────────────────────────────────────────
    const starCount = 600;
    const starPositions = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const r = 60 + Math.random() * 30;
      starPositions[i * 3]     = r * Math.sin(phi) * Math.cos(theta);
      starPositions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      starPositions[i * 3 + 2] = r * Math.cos(phi);
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute("position", new THREE.BufferAttribute(starPositions, 3));
    const starMat = new THREE.PointsMaterial({
      color: 0xffffff,
      size: 0.28,
      sizeAttenuation: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    scene.add(new THREE.Points(starGeo, starMat));

    // ── Ambient glow (cinema atmosphere) ─────────────────────────────────────
    const glowCanvas = document.createElement("canvas");
    glowCanvas.width = 256;
    glowCanvas.height = 256;
    const glowCtx = glowCanvas.getContext("2d")!;
    const grad = glowCtx.createRadialGradient(128, 128, 0, 128, 128, 128);
    grad.addColorStop(0, "rgba(127,198,255,0.28)");
    grad.addColorStop(0.5, "rgba(127,198,255,0.08)");
    grad.addColorStop(1, "rgba(0,0,0,0)");
    glowCtx.fillStyle = grad;
    glowCtx.fillRect(0, 0, 256, 256);
    const glowTex = new THREE.CanvasTexture(glowCanvas);
    const glowMat = new THREE.MeshBasicMaterial({
      map: glowTex,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const glowMesh = new THREE.Mesh(new THREE.PlaneGeometry(30, 18), glowMat);
    glowMesh.position.set(0, 0, -25);
    scene.add(glowMesh);

    // ── Subtle floor grid ─────────────────────────────────────────────────────
    const grid = new THREE.GridHelper(40, 20, 0x0d1a2e, 0x0d1a2e);
    (grid.material as THREE.Material).opacity = 0.6;
    (grid.material as THREE.Material).transparent = true;
    grid.position.y = -8;
    scene.add(grid);

    // ── Look controls ─────────────────────────────────────────────────────────
    const look = { yaw: 0, pitch: 0, targetYaw: 0, targetPitch: 0 };
    let pointerDown = false;
    let lastPointerX = 0;
    let lastPointerY = 0;

    // Drag on the mount div (the background layer) for desktop look-around
    function onPointerDown(e: PointerEvent) {
      pointerDown = true;
      lastPointerX = e.clientX;
      lastPointerY = e.clientY;
    }
    function onPointerMove(e: PointerEvent) {
      if (!pointerDown) return;
      look.targetYaw   -= (e.clientX - lastPointerX) * 0.003;
      look.targetPitch -= (e.clientY - lastPointerY) * 0.003;
      look.targetPitch = Math.max(-1.0, Math.min(1.0, look.targetPitch));
      lastPointerX = e.clientX;
      lastPointerY = e.clientY;
    }
    function onPointerUp() { pointerDown = false; }
    mount.addEventListener("pointerdown", onPointerDown);
    mount.addEventListener("pointermove", onPointerMove);
    mount.addEventListener("pointerup",   onPointerUp);
    mount.addEventListener("pointercancel", onPointerUp);

    // DeviceOrientation — phone gyro for standalone look-around.
    // Stereo mode passes lookRef so the parent owns the one permissioned listener.
    let deviceOrientationActive = false;
    function onDeviceOrientation(e: DeviceOrientationEvent) {
      if (e.beta == null || e.gamma == null) return;
      deviceOrientationActive = true;
      look.targetYaw   = ((e.alpha ?? 0) * Math.PI) / 180;
      look.targetPitch = Math.max(-1.0, Math.min(1.0, ((e.beta - 90) * Math.PI) / 180));
    }
    async function requestOrientationPermission() {
      try {
        type DOE = typeof DeviceOrientationEvent & { requestPermission?: () => Promise<string> };
        const req = (DeviceOrientationEvent as DOE).requestPermission;
        if (typeof req === "function") {
          const perm = await req();
          if (perm === "granted") window.addEventListener("deviceorientation", onDeviceOrientation);
        } else {
          window.addEventListener("deviceorientation", onDeviceOrientation);
        }
      } catch { /* silently ignore */ }
    }
    if (!lookRef) void requestOrientationPermission();

    // Escape key
    function onKeyDown(e: KeyboardEvent) { if (e.key === "Escape") onExit(); }
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", syncSize);

    // ── WebXR ─────────────────────────────────────────────────────────────────
    let xrSession: XRSession | null = null;
    async function checkXRSupport() {
      if (!navigator.xr) return;
      try {
        const ok = await navigator.xr.isSessionSupported("immersive-vr");
        if (ok && xrButtonRef.current) xrButtonRef.current.style.display = "flex";
      } catch { /* not available */ }
    }
    void checkXRSupport();

    async function enterXR() {
      if (!navigator.xr) return;
      try {
        xrSession = await navigator.xr.requestSession("immersive-vr", {
          optionalFeatures: ["local-floor"],
        });
        await renderer.xr.setSession(xrSession);
        xrSession.addEventListener("end", () => { xrSession = null; });
      } catch { /* silent */ }
    }
    const xrBtn = xrButtonRef.current;
    if (xrBtn) xrBtn.addEventListener("click", enterXR);

    // ── Animation loop ────────────────────────────────────────────────────────
    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    renderer.setAnimationLoop(() => {
      syncSize();

      if (!prefersReducedMotion && !deviceOrientationActive && !pointerDown) {
        look.targetYaw += 0.00015; // very slow auto-drift
      }

      if (lookRef?.current) {
        look.targetYaw = lookRef.current.yaw;
        look.targetPitch = lookRef.current.pitch;
      }

      look.yaw   += (look.targetYaw   - look.yaw)   * 0.1;
      look.pitch += (look.targetPitch - look.pitch)  * 0.1;

      camera.rotation.order = "YXZ";
      camera.rotation.y = look.yaw;
      camera.rotation.x = look.pitch;

      renderer.render(scene, camera);
    });

    return () => {
      renderer.setAnimationLoop(null);
      if (xrSession) { xrSession.end().catch(() => {}); xrSession = null; }

      mount.removeEventListener("pointerdown", onPointerDown);
      mount.removeEventListener("pointermove", onPointerMove);
      mount.removeEventListener("pointerup",   onPointerUp);
      mount.removeEventListener("pointercancel", onPointerUp);
      window.removeEventListener("deviceorientation", onDeviceOrientation);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", syncSize);
      if (xrBtn) xrBtn.removeEventListener("click", enterXR);

      starGeo.dispose();
      starMat.dispose();
      glowTex.dispose();
      glowMat.dispose();
      (glowMesh.geometry as THREE.BufferGeometry).dispose();
      (grid.geometry as THREE.BufferGeometry).dispose();
      (grid.material as THREE.Material).dispose();
      renderer.dispose();
      if (mount.contains(renderer.domElement)) mount.removeChild(renderer.domElement);
    };
  }, [onExit]);

  return (
    <div className="vr-background" aria-hidden="true">
      <div ref={mountRef} className="vr-canvas-mount" />
      <button
        ref={xrButtonRef}
        className="vr-enter-headset"
        type="button"
        style={{ display: "none" }}
        aria-label="Enter headset mode"
      >
        Enter Headset
      </button>
    </div>
  );
}
