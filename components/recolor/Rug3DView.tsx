"use client";

/**
 * Rug3DView — shows the recoloured rug as a real 3D object: the rendered rug
 * image (recolour + wool texture) mapped onto a thin slab the size of an
 * 8' × 10' rug (the short side is matched to 8'), orbitable with the mouse.
 *
 * The top face is an UNLIT material (MeshBasicMaterial, toneMapped off) so the
 * texture shows its exact colours — lighting only drives the soft contact
 * shadow, never the rug's colour. Takes a texture data URL that the studio
 * regenerates whenever the colourway changes.
 */

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

type Props = {
  /** Data URL (PNG/JPEG) of the recoloured + textured rug. Null until first render. */
  textureUrl: string | null;
  /** Design aspect ratio = width / height (in pixels). */
  aspect: number;
};

export default function Rug3DView({ textureUrl, aspect }: Props) {
  const mountRef = useRef<HTMLDivElement>(null);
  // Three.js objects kept across renders
  const stateRef = useRef<{
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    controls: OrbitControls;
    topMat: THREE.MeshBasicMaterial;
    raf: number;
    loader: THREE.TextureLoader;
    maxAniso: number;
  } | null>(null);

  // ── Set up the scene once ──────────────────────────────────────────────────
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const w = mount.clientWidth || 800;
    const h = mount.clientHeight || 600;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xefe9dd);

    const camera = new THREE.PerspectiveCamera(38, w / h, 0.05, 300);

    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "low-power" });
    renderer.setSize(w, h);
    // Cap pixel ratio — the framebuffer memory grows with its square, and on a
    // dpr-3 phone a full 3× buffer plus shadow map is enough to OOM the tab.
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.shadowMap.autoUpdate = false; // render shadow once; slab doesn't move
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NoToneMapping; // exact texture colours
    mount.appendChild(renderer.domElement);
    renderer.domElement.style.display = "block";
    renderer.domElement.style.touchAction = "none";

    // Recover from a lost context instead of letting the tab die.
    const onLost = (e: Event) => { e.preventDefault(); };
    renderer.domElement.addEventListener("webglcontextlost", onLost, false);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 0, 0);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.maxPolarAngle = Math.PI / 2 - 0.015; // stay above the floor

    // ── Slab dimensions: short side = 8', long side scaled by the design aspect.
    // Top face of a BoxGeometry maps U→X (texture width) and V→Z (texture height).
    let X: number, Z: number;
    if (aspect <= 1) { X = 8; Z = 8 / aspect; }          // portrait: width is short
    else { Z = 8; X = 8 * aspect; }                       // landscape: height is short
    const THICK = 0.0197; // 6 mm in feet
    const long = Math.max(X, Z);

    camera.position.set(X * 0.42, long * 0.56, long * 0.95);
    controls.minDistance = long * 0.25;
    controls.maxDistance = long * 4;

    const maxAniso = renderer.capabilities.getMaxAnisotropy();

    // Rug slab
    const topMat = new THREE.MeshBasicMaterial({ color: 0xd9d2c4, toneMapped: false });
    const edgeMat = new THREE.MeshBasicMaterial({ color: 0x9c9281, toneMapped: false });
    const bottomMat = new THREE.MeshBasicMaterial({ color: 0x8f8573, toneMapped: false });
    const geo = new THREE.BoxGeometry(X, THICK, Z);
    // faces: [+X, -X, +Y top, -Y bottom, +Z, -Z]
    const rug = new THREE.Mesh(geo, [edgeMat, edgeMat, topMat, bottomMat, edgeMat, edgeMat]);
    rug.position.y = THICK / 2;
    rug.castShadow = true;
    rug.receiveShadow = true;
    scene.add(rug);

    // Invisible shadow catcher (shows only the soft contact shadow, no floor plane)
    const catcher = new THREE.Mesh(
      new THREE.PlaneGeometry(long * 6, long * 6).rotateX(-Math.PI / 2),
      new THREE.ShadowMaterial({ opacity: 0.2 })
    );
    catcher.position.y = 0;
    catcher.receiveShadow = true;
    scene.add(catcher);

    // Lighting — only to produce the shadow (rug colour is unlit)
    const sun = new THREE.DirectionalLight(0xffffff, 1.0);
    sun.position.set(long * 0.7, long * 1.4, long * 0.5);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    sc.near = 0.1; sc.far = long * 5;
    sc.left = -long; sc.right = long; sc.top = long; sc.bottom = -long;
    sun.shadow.bias = -0.0008;
    scene.add(sun);

    const loader = new THREE.TextureLoader();

    // Render the shadow map once (slab and light never move), then freeze it.
    renderer.shadowMap.needsUpdate = true;

    let raf = 0;
    const animate = () => {
      raf = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    stateRef.current = { renderer, scene, camera, controls, topMat, raf, loader, maxAniso };

    // Resize with the container
    const ro = new ResizeObserver(() => {
      const nw = mount.clientWidth, nh = mount.clientHeight;
      if (nw === 0 || nh === 0) return;
      camera.aspect = nw / nh;
      camera.updateProjectionMatrix();
      renderer.setSize(nw, nh);
    });
    ro.observe(mount);

    return () => {
      ro.disconnect();
      cancelAnimationFrame(raf);
      renderer.domElement.removeEventListener("webglcontextlost", onLost);
      controls.dispose();
      geo.dispose();
      topMat.map?.dispose();
      topMat.dispose(); edgeMat.dispose(); bottomMat.dispose();
      renderer.dispose();
      renderer.forceContextLoss(); // free the GPU context promptly on unmount
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement);
      stateRef.current = null;
    };
    // Rebuild only if the aspect changes (new design)
  }, [aspect]);

  // ── Apply / update the rug texture when it changes ─────────────────────────
  useEffect(() => {
    const st = stateRef.current;
    if (!st || !textureUrl) return;
    st.loader.load(textureUrl, (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = st.maxAniso;
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      tex.magFilter = THREE.LinearFilter;
      const old = st.topMat.map;
      st.topMat.map = tex;
      st.topMat.color.set(0xffffff); // let the texture show at full colour
      st.topMat.needsUpdate = true;
      if (old) old.dispose();
    });
  }, [textureUrl]);

  return <div ref={mountRef} className="w-full h-full" style={{ touchAction: "none" }} />;
}
