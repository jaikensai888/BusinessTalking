"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";

const FONT = '"Playfair Display", Didot, "Bodoni Moda", Georgia, serif';
const WORDMARK = "BusinessTalking";
const COLOR = 0x1f6bff; // 蓝

/**
 * BusinessTalking 标题：粒子拼字 + 分散重组。
 * 把 "BusinessTalking" 采样成粒子——先散开，再聚合成字；随后周期性打散→重组，
 * 并轻微漂浮 + 鼠标推开。衬线字形、蓝色、普通混合（浅色背景可见）。尊重 reduced-motion。
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

    // 柔和圆形粒子贴图
    const makeSprite = () => {
      const s = 64;
      const cv = document.createElement("canvas");
      cv.width = cv.height = s;
      const c = cv.getContext("2d")!;
      const g = c.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      g.addColorStop(0, "rgba(255,255,255,1)");
      g.addColorStop(0.4, "rgba(255,255,255,0.82)");
      g.addColorStop(1, "rgba(255,255,255,0)");
      c.fillStyle = g;
      c.fillRect(0, 0, s, s);
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

      // 把文字采样成点（世界坐标 = 像素中心）
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
      const step = Math.max(2, Math.round(fs / 22));
      const pts: number[] = [];
      for (let y = 0; y < H; y += step) {
        for (let x = 0; x < W; x += step) {
          if (px[(y * W + x) * 4 + 3] > 128) pts.push(x - W / 2, H / 2 - y, 0);
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
        size: step * 0.85,
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
            W = 0; // 强制 re-init，用 Playfair 重新采样
            resize();
          })
          .catch(() => undefined);
      }
    };

    const easeOut = (p: number) => 1 - Math.pow(1 - p, 3);

    const paint = () => {
      if (!geom || !camera || !renderer || !scene || disposed) return;
      const t = clock.getElapsedTime();
      const assemble = easeOut(Math.min(1, t / 2)); // 初始散开→聚合
      const arr = geom.getAttribute("position").array as Float32Array;
      const radius = 40;
      for (let i = 0; i < count; i++) {
        const i3 = i * 3;
        const ph = phases[i] ?? 0;
        const sp = speeds[i] ?? 0.7;
        // 周期性打散→重组（带逐粒相位形成波纹）
        const wave = (Math.sin(t * 0.8 + ph * 0.25) + 1) / 2;
        const g = reduced ? 1 : assemble * (0.6 + 0.4 * wave);
        let x = scatter[i3] + (target[i3] - scatter[i3]) * g;
        let y = scatter[i3 + 1] + (target[i3 + 1] - scatter[i3 + 1]) * g;
        let z = scatter[i3 + 2] + (target[i3 + 2] - scatter[i3 + 2]) * g;
        // 漂浮
        x += Math.sin(t * sp + ph) * 0.8;
        y += Math.cos(t * sp * 0.9 + ph * 1.6) * 0.9;
        // 鼠标推开
        if (!reduced && pointer.active) {
          const dx = x - pointer.x;
          const dy = y - pointer.y;
          const distance = Math.sqrt(dx * dx + dy * dy);
          if (distance < radius && distance > 0.01) {
            const force = ((radius - distance) / radius) ** 2 * 18;
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
