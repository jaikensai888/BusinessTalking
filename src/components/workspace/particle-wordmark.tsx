"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";

const FONT = '"Playfair Display", Didot, "Bodoni Moda", Georgia, serif';
const WORDMARK = "BusinessTalking";
const COLOR = 0x1f6bff; // 蓝
const SAMPLE_STEP = 3; // 点阵网格单元（方块像素边长）

/**
 * BusinessTalking 标题：衬线字 + 方块点阵粒子。
 * 用 Playfair 衬线字形，把 "BusinessTalking" 采样成一个个方块点（点阵/像素屏风格）；
 * 粒子先聚合拼成字，再轻微漂浮，鼠标靠近推开。尊重 prefers-reduced-motion。
 */
export function ParticleWordmark() {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    let disposed = false;
    const clock = new THREE.Clock();

    // 正方形粒子贴图（点阵像素风，带轻微柔边）
    const makeSprite = () => {
      const s = 16;
      const cv = document.createElement("canvas");
      cv.width = cv.height = s;
      const c = cv.getContext("2d")!;
      c.fillStyle = "rgba(255,255,255,1)";
      c.fillRect(1, 1, s - 2, s - 2); // 白色方块，四周留 1px 柔边
      const tex = new THREE.CanvasTexture(cv);
      tex.needsUpdate = true;
      return tex;
    };

    let renderer: THREE.WebGLRenderer | null = null;
    let scene: THREE.Scene | null = null;
    let camera: THREE.OrthographicCamera | null = null;
    let geom: THREE.BufferGeometry | null = null;
    let mat: THREE.PointsMaterial | null = null;
    let sprite: THREE.CanvasTexture | null = null;
    let target: Float32Array = new Float32Array(0);
    let scatter: Float32Array = new Float32Array(0);
    let cur: Float32Array = new Float32Array(0);
    let phases: Float32Array = new Float32Array(0);
    let speeds: Float32Array = new Float32Array(0);
    let count = 0;
    let W = 0;
    let H = 0;
    const pointer = { x: 0, y: 0, active: false };

    const fontSize = (w: number) => Math.min(72, Math.max(44, w * 0.105));

    const init = (w: number, h: number) => {
      W = Math.max(1, Math.floor(w));
      H = Math.max(1, Math.floor(h));
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas!.width = W * dpr;
      canvas!.height = H * dpr;

      if (renderer) renderer.dispose();
      renderer = new THREE.WebGLRenderer({ canvas: canvas!, alpha: true, antialias: true });
      renderer.setSize(W, H, false);
      renderer.setPixelRatio(dpr);
      renderer.setClearColor(0x000000, 0);
      scene = new THREE.Scene();
      camera = new THREE.OrthographicCamera(-W / 2, W / 2, H / 2, -H / 2, -100, 100);

      // 用衬线字形采样成点阵方块（整格命中就放一个方块点）
      const fs = fontSize(W);
      const off = document.createElement("canvas");
      off.width = W;
      off.height = H;
      const c = off.getContext("2d", { willReadFrequently: true })!;
      c.clearRect(0, 0, W, H);
      c.fillStyle = "#fff";
      c.font = `700 ${fs}px ${FONT}`;
      c.textAlign = "center";
      c.textBaseline = "middle";
      c.fillText(WORDMARK, W / 2, H / 2);
      const img = c.getImageData(0, 0, W, H);
      const px = img.data;
      const pts: number[] = [];
      for (let gy = 0; gy < H; gy += SAMPLE_STEP) {
        for (let gx = 0; gx < W; gx += SAMPLE_STEP) {
          let hit = false;
          for (let sy = 0; sy < SAMPLE_STEP && !hit; sy++) {
            for (let sx = 0; sx < SAMPLE_STEP && !hit; sx++) {
              const x = gx + sx;
              const y = gy + sy;
              if (x < W && y < H && px[(y * W + x) * 4 + 3] > 128) hit = true;
            }
          }
          if (hit) pts.push(gx + SAMPLE_STEP / 2 - W / 2, H / 2 - (gy + SAMPLE_STEP / 2), 0);
        }
      }
      count = pts.length / 3;
      target = new Float32Array(pts);
      scatter = new Float32Array(count * 3);
      cur = new Float32Array(count * 3);
      phases = new Float32Array(count);
      speeds = new Float32Array(count);
      const rand = Math.max(W, H);
      for (let i = 0; i < count; i++) {
        const i3 = i * 3;
        scatter[i3] = (Math.random() - 0.5) * rand * 1.05;
        scatter[i3 + 1] = (Math.random() - 0.5) * rand * 1.05;
        scatter[i3 + 2] = (Math.random() - 0.5) * 9;
        cur[i3] = scatter[i3];
        cur[i3 + 1] = scatter[i3 + 1];
        cur[i3 + 2] = scatter[i3 + 2];
        phases[i] = Math.random() * Math.PI * 2;
        speeds[i] = 0.5 + Math.random() * 0.9;
      }

      if (geom) geom.dispose();
      if (mat) mat.dispose();
      geom = new THREE.BufferGeometry();
      geom.setAttribute("position", new THREE.BufferAttribute(cur, 3));
      sprite = sprite || makeSprite();
      mat = new THREE.PointsMaterial({
        size: SAMPLE_STEP * 0.82, // 方块占网格约 82%，留点阵间隙
        map: sprite,
        color: COLOR,
        transparent: true,
        depthWrite: false,
        blending: THREE.NormalBlending,
        sizeAttenuation: false,
        opacity: 0.95,
      });
      scene.add(new THREE.Points(geom, mat));
    };

    const resize = () => {
      const rect = wrap!.getBoundingClientRect();
      const w = Math.max(1, rect.width);
      const h = Math.max(1, rect.height);
      if (Math.abs(w - W) > 1 || Math.abs(h - H) > 1) init(w, h);
    };

    // 确保衬线字体加载后重新采样（否则用回退字体拼字）
    const ensureFonts = () => {
      if (document.fonts && typeof document.fonts.load === "function") {
        const fs = fontSize(W || 620);
        document.fonts
          .load(`700 ${fs}px "Playfair Display"`)
          .then(() => {
            W = 0;
            resize();
          })
          .catch(() => undefined);
      }
    };

    const easeOut = (p: number) => 1 - Math.pow(1 - p, 3);

    const paint = () => {
      if (!geom || !camera || !renderer || !scene || disposed) return;
      const t = clock.getElapsedTime();
      // 初始散开→聚合（拼接一次），随后漂浮
      const g = reduced ? 1 : easeOut(Math.min(1, t / 1.5));
      const arr = geom.getAttribute("position").array as Float32Array;
      const radius = 40;
      for (let i = 0; i < count; i++) {
        const i3 = i * 3;
        const ph = phases[i] ?? 0;
        const sp = speeds[i] ?? 0.7;
        let x = scatter[i3] + (target[i3] - scatter[i3]) * g + Math.sin(t * sp + ph) * 0.7;
        let y = scatter[i3 + 1] + (target[i3 + 1] - scatter[i3 + 1]) * g + Math.cos(t * sp * 0.9 + ph * 1.6) * 0.8;
        const z = scatter[i3 + 2] + (target[i3 + 2] - scatter[i3 + 2]) * g + Math.sin(t * 0.6 + ph) * 1.2;
        if (!reduced && pointer.active) {
          const dx = x - pointer.x;
          const dy = y - pointer.y;
          const distance = Math.sqrt(dx * dx + dy * dy);
          if (distance < radius && distance > 0.01) {
            const force = ((radius - distance) / radius) ** 2 * 16;
            x += (dx / distance) * force;
            y += (dy / distance) * force;
          }
        }
        arr[i3] = x;
        arr[i3 + 1] = y;
        arr[i3 + 2] = z;
      }
      geom.getAttribute("position").needsUpdate = true;
      renderer.render(scene, camera);
      if (!disposed) raf = requestAnimationFrame(paint);
    };

    const onPointerMove = (event: PointerEvent) => {
      const rect = canvas!.getBoundingClientRect();
      pointer.x = event.clientX - rect.left - W / 2;
      pointer.y = H / 2 - (event.clientY - rect.top);
      pointer.active = true;
    };
    const onPointerLeave = () => {
      pointer.active = false;
    };
    const onVis = () => {
      cancelAnimationFrame(raf);
      if (!document.hidden && !disposed) raf = requestAnimationFrame(paint);
    };

    const observer = new ResizeObserver(resize);
    observer.observe(wrap!);
    resize();
    ensureFonts();
    raf = requestAnimationFrame(paint);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerleave", onPointerLeave);
    document.addEventListener("visibilitychange", onVis);

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      observer.disconnect();
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerleave", onPointerLeave);
      document.removeEventListener("visibilitychange", onVis);
      if (geom) geom.dispose();
      if (mat) mat.dispose();
      if (sprite) sprite.dispose();
      if (renderer) renderer.dispose();
    };
  }, []);

  return (
    <div ref={wrapRef} className="relative mx-auto h-[120px] w-[620px] max-w-[94vw]" role="img" aria-label={WORDMARK}>
      <canvas ref={canvasRef} className="h-full w-full" aria-hidden="true" />
      <span className="sr-only">{WORDMARK}</span>
    </div>
  );
}
