"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";

const SERIF = 'var(--font-serif, "Playfair Display"), Didot, "Bodoni Moda", Georgia, serif';
const COLOR = 0x2f7cff; // 蓝：粒子与句点

/**
 * BusinessTalking 标题（杂志题头风）：
 * —— 平滑高对比衬线大字（Playfair Display），像 "Clauday" 那类 masthead；
 * —— 背景环绕一层平滑发光的蓝色粒子，缓慢漂浮 + 鼠标推开；
 * 尊重 prefers-reduced-motion。
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

    // 柔和圆形粒子贴图（光晕）
    const makeSprite = () => {
      const s = 64;
      const cv = document.createElement("canvas");
      cv.width = cv.height = s;
      const c = cv.getContext("2d")!;
      const g = c.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      g.addColorStop(0, "rgba(255,255,255,1)");
      g.addColorStop(0.3, "rgba(255,255,255,0.85)");
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
    let pos: Float32Array = new Float32Array(0);
    let phases: Float32Array = new Float32Array(0);
    let speeds: Float32Array = new Float32Array(0);
    let count = 0;
    let W = 0;
    let H = 0;
    const pointer = { x: 0, y: 0, active: false };

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

      // 环绕的漂浮光点（不拼字，只是氛围）
      count = Math.max(60, Math.round(W / 3.2));
      pos = new Float32Array(count * 3);
      phases = new Float32Array(count);
      speeds = new Float32Array(count);
      for (let i = 0; i < count; i++) {
        const i3 = i * 3;
        pos[i3] = (Math.random() - 0.5) * W;
        pos[i3 + 1] = (Math.random() - 0.5) * H;
        pos[i3 + 2] = (Math.random() - 0.5) * 6;
        phases[i] = Math.random() * Math.PI * 2;
        speeds[i] = 0.5 + Math.random() * 0.9;
      }

      if (geom) geom.dispose();
      if (mat) mat.dispose();
      geom = new THREE.BufferGeometry();
      geom.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      sprite = sprite || makeSprite();
      mat = new THREE.PointsMaterial({
        size: 5,
        map: sprite,
        color: COLOR,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        sizeAttenuation: false,
        opacity: 0.55,
      });
      scene.add(new THREE.Points(geom, mat));
    };

    const resize = () => {
      const rect = wrap!.getBoundingClientRect();
      const w = Math.max(1, rect.width);
      const h = Math.max(1, rect.height);
      if (Math.abs(w - W) > 1 || Math.abs(h - H) > 1) init(w, h);
    };

    const paint = () => {
      if (!geom || !camera || !renderer || !scene || disposed) return;
      const t = clock.getElapsedTime();
      const arr = geom.getAttribute("position").array as Float32Array;
      const radius = 48;
      for (let i = 0; i < count; i++) {
        const i3 = i * 3;
        const sp = speeds[i] ?? 0.7;
        const ph = phases[i] ?? 0;
        let x = pos[i3] + Math.sin(t * sp + ph) * 3;
        let y = pos[i3 + 1] + Math.cos(t * sp * 0.9 + ph * 1.6) * 3.5;
        const z = pos[i3 + 2] + Math.sin(t * 0.6 + ph) * 1.2;
        // 鼠标推开
        if (!reduced && pointer.active) {
          const dx = x - pointer.x;
          const dy = y - pointer.y;
          const distance = Math.sqrt(dx * dx + dy * dy);
          if (distance < radius && distance > 0.01) {
            const force = ((radius - distance) / radius) ** 2 * 26;
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
      const rect = wrap!.getBoundingClientRect();
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
    raf = requestAnimationFrame(paint);
    wrap.addEventListener("pointermove", onPointerMove);
    wrap.addEventListener("pointerleave", onPointerLeave);
    document.addEventListener("visibilitychange", onVis);

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      observer.disconnect();
      wrap.removeEventListener("pointermove", onPointerMove);
      wrap.removeEventListener("pointerleave", onPointerLeave);
      document.removeEventListener("visibilitychange", onVis);
      if (geom) geom.dispose();
      if (mat) mat.dispose();
      if (sprite) sprite.dispose();
      if (renderer) renderer.dispose();
    };
  }, []);

  return (
    <div ref={wrapRef} className="relative mx-auto flex h-[110px] w-[620px] max-w-[94vw] items-center justify-center">
      <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden="true" />
      <span
        className="relative z-10 text-[clamp(44px,10vw,72px)] leading-none tracking-[-0.02em] text-ink"
        style={{ fontFamily: SERIF, fontWeight: 600 }}
      >
        BusinessTalking
        <span className="text-primary">.</span>
      </span>
    </div>
  );
}
