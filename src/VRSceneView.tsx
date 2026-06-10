import React, { useEffect, useRef } from "react";
import * as THREE from "three";

type VRSceneViewProps = {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  title: string;
  onExit: () => void;
};

export default function VRSceneView({ videoRef, title, onExit }: VRSceneViewProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const xrButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const mount = mountRef.current;
    const video = videoRef.current;
    if (!mount || !video) return;

    // Resume video if paused (user gesture already happened via VR button click)
    if (video.paused) video.play().catch(() => {});
    // Ensure the first frame is decoded so VideoTexture has data immediately
    if (video.readyState < 2) {
      video.load();
    }

    // ── Renderer ──────────────────────────────────────────────────────────────
    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    // Don't override canvas CSS size — let CSS position it, resize-on-render keeps it sharp.
    renderer.setSize(mount.clientWidth || 640, mount.clientHeight || 360, false);
    renderer.xr.enabled = true;
    renderer.domElement.style.position = "absolute";
    renderer.domElement.style.inset = "0";
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    mount.appendChild(renderer.domElement);

    // ── Scene / Camera ────────────────────────────────────────────────────────
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x05050a);

    const camera = new THREE.PerspectiveCamera(75, mount.clientWidth / mount.clientHeight, 0.1, 1000);
    camera.position.set(0, 1.6, 0);

    // ── Video texture (samples the existing <video> element) ──────────────────
    const videoTexture = new THREE.VideoTexture(video);
    videoTexture.colorSpace = THREE.SRGBColorSpace;
    videoTexture.minFilter = THREE.LinearFilter;
    videoTexture.magFilter = THREE.LinearFilter;

    // ── Curved theater screen ─────────────────────────────────────────────────
    const videoAspect = video.videoWidth > 0 ? video.videoWidth / video.videoHeight : 16 / 9;
    const screenRadius = 4.2;
    const thetaLength = 1.4; // radians — roughly 80° arc
    // Three.js CylinderGeometry uses sin(θ)→X, cos(θ)→Z.
    // θ=PI maps to -Z which is directly in front of the default camera.
    const thetaStart = Math.PI - thetaLength / 2;
    const screenHeight = (screenRadius * thetaLength) / videoAspect;

    const screenGeo = new THREE.CylinderGeometry(
      screenRadius, screenRadius,
      screenHeight,
      40, 1,
      true,
      thetaStart, thetaLength,
    );
    // Flip the UVs horizontally so the image reads correctly from inside
    const uvAttr = screenGeo.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < uvAttr.count; i++) {
      uvAttr.setX(i, 1 - uvAttr.getX(i));
    }

    const screenMat = new THREE.MeshBasicMaterial({
      map: videoTexture,
      side: THREE.BackSide,
      toneMapped: false,
    });
    const screenMesh = new THREE.Mesh(screenGeo, screenMat);
    screenMesh.position.set(0, 1.6, 0); // centered at eye height
    scene.add(screenMesh);

    // ── Glow behind screen ────────────────────────────────────────────────────
    const glowCanvas = document.createElement("canvas");
    glowCanvas.width = 256;
    glowCanvas.height = 256;
    const glowCtx = glowCanvas.getContext("2d")!;
    const grad = glowCtx.createRadialGradient(128, 128, 0, 128, 128, 128);
    grad.addColorStop(0, "rgba(127,198,255,0.38)");
    grad.addColorStop(0.5, "rgba(127,198,255,0.12)");
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
    const glowMesh = new THREE.Mesh(new THREE.PlaneGeometry(9, 6), glowMat);
    glowMesh.position.set(0, 1.6, -screenRadius + 0.05);
    scene.add(glowMesh);

    // ── Stars ─────────────────────────────────────────────────────────────────
    const starCount = 400;
    const starPositions = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const r = 80 + Math.random() * 20;
      starPositions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
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

    // ── Floor grid ────────────────────────────────────────────────────────────
    const grid = new THREE.GridHelper(20, 20, 0x1a1a2e, 0x1a1a2e);
    (grid.material as THREE.Material).opacity = 0.5;
    (grid.material as THREE.Material).transparent = true;
    scene.add(grid);

    // ── Look controls (hand-rolled pointer drag + deviceorientation) ──────────
    const look = { yaw: 0, pitch: 0, targetYaw: 0, targetPitch: 0 };
    let pointerDown = false;
    let lastPointerX = 0;
    let lastPointerY = 0;

    function onPointerDown(e: PointerEvent) {
      pointerDown = true;
      lastPointerX = e.clientX;
      lastPointerY = e.clientY;
      mount!.setPointerCapture(e.pointerId);
    }
    function onPointerMove(e: PointerEvent) {
      if (!pointerDown) return;
      const dx = e.clientX - lastPointerX;
      const dy = e.clientY - lastPointerY;
      lastPointerX = e.clientX;
      lastPointerY = e.clientY;
      look.targetYaw -= dx * 0.003;
      look.targetPitch -= dy * 0.003;
      look.targetPitch = Math.max(-1.2, Math.min(1.2, look.targetPitch));
    }
    function onPointerUp() { pointerDown = false; }

    mount.addEventListener("pointerdown", onPointerDown);
    mount.addEventListener("pointermove", onPointerMove);
    mount.addEventListener("pointerup", onPointerUp);
    mount.addEventListener("pointercancel", onPointerUp);

    // DeviceOrientation for mobile magic-window
    let deviceOrientationActive = false;
    function onDeviceOrientation(e: DeviceOrientationEvent) {
      if (e.beta == null || e.gamma == null) return;
      deviceOrientationActive = true;
      look.targetYaw = ((e.alpha ?? 0) * Math.PI) / 180;
      look.targetPitch = Math.max(-1.2, Math.min(1.2, ((e.beta - 90) * Math.PI) / 180));
    }
    // Request device orientation permission immediately (user gesture was the VR button click).
    // iOS 13+ requires requestPermission(); on Android/desktop the event fires directly.
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
      } catch {
        // silently ignore — not available or denied
      }
    }
    void requestOrientationPermission();

    // Escape key
    function onKeyDown(e: KeyboardEvent) { if (e.key === "Escape") onExit(); }
    window.addEventListener("keydown", onKeyDown);

    // Resize
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
    function onResize() { syncSize(); }
    window.addEventListener("resize", onResize);

    // ── WebXR ─────────────────────────────────────────────────────────────────
    let xrSession: XRSession | null = null;

    async function checkXRSupport() {
      if (!navigator.xr) return;
      try {
        const supported = await navigator.xr.isSessionSupported("immersive-vr");
        if (supported && xrButtonRef.current) {
          xrButtonRef.current.style.display = "flex";
        }
      } catch {
        // XR not available
      }
    }
    void checkXRSupport();

    async function enterXR() {
      if (!navigator.xr) return;
      try {
        xrSession = await navigator.xr.requestSession("immersive-vr", {
          optionalFeatures: ["local-floor"],
        });
        await renderer.xr.setSession(xrSession);
        xrSession.addEventListener("end", () => {
          xrSession = null;
        });
      } catch {
        // XR entry failed silently
      }
    }

    const xrBtn = xrButtonRef.current;
    if (xrBtn) xrBtn.addEventListener("click", enterXR);

    // ── Animation loop ────────────────────────────────────────────────────────
    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    renderer.setAnimationLoop(() => {
      syncSize();

      if (!prefersReducedMotion && !deviceOrientationActive) {
        // Gentle star drift only when user isn't dragging
        if (!pointerDown) {
          look.targetYaw += 0.0002;
        }
      }

      // Damped look interpolation
      look.yaw += (look.targetYaw - look.yaw) * 0.12;
      look.pitch += (look.targetPitch - look.pitch) * 0.12;

      camera.rotation.order = "YXZ";
      camera.rotation.y = look.yaw;
      camera.rotation.x = look.pitch;

      // Push the latest video frame to the texture every frame
      if (video.readyState >= 2) videoTexture.needsUpdate = true;

      renderer.render(scene, camera);
    });

    return () => {
      renderer.setAnimationLoop(null);

      // End active XR session if any
      if (xrSession) {
        xrSession.end().catch(() => {});
        xrSession = null;
      }

      // Event listeners
      mount.removeEventListener("pointerdown", onPointerDown);
      mount.removeEventListener("pointermove", onPointerMove);
      mount.removeEventListener("pointerup", onPointerUp);
      mount.removeEventListener("pointercancel", onPointerUp);
      window.removeEventListener("deviceorientation", onDeviceOrientation);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", onResize);
      if (xrBtn) xrBtn.removeEventListener("click", enterXR);

      // Dispose Three.js resources
      videoTexture.dispose();
      screenGeo.dispose();
      screenMat.dispose();
      glowTex.dispose();
      glowMat.dispose();
      (glowMesh.geometry as THREE.BufferGeometry).dispose();
      starGeo.dispose();
      starMat.dispose();
      (grid.geometry as THREE.BufferGeometry).dispose();
      (grid.material as THREE.Material).dispose();
      renderer.dispose();

      // Remove canvas from DOM
      if (mount.contains(renderer.domElement)) {
        mount.removeChild(renderer.domElement);
      }

      // Do NOT pause video — leave playback state as-is
    };
  }, [videoRef, onExit]);

  return (
    <div className="vr-overlay">
      <div ref={mountRef} className="vr-canvas-mount" />
      <button
        className="vr-exit"
        type="button"
        onClick={onExit}
        aria-label={`Exit VR view — ${title}`}
      >
        Exit VR
      </button>
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
