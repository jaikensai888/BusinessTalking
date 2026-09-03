"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";

const WORDMARK = "BusinessTalking";
const MAX_DEVICE_PIXEL_RATIO = 2;
const SAMPLE_STEP = 2; // 点阵网格单元（每个方块像素边长，越小越细、越清晰）

/**
 * BusinessTalking 标题的三维粒子字标（three.js）：
 * 把 "BusinessTalking" 采样成粒子——初始散射，再汇聚成字，随后轻微浮动 + 呼吸，
 * 鼠标靠近时粒子被推开；蓝色、加色混合发光。尊重 prefers-reduced-motion。
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

    // 正方形粒子贴图（点阵/像素屏风格，带轻微柔边）
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
    let targetPos: Float32Array = new Float32Array(0);
    let startPos: Float32Array = new Float32Array(0);
    let curPos: Float32Array = new Float32Array(0);
    let phases: Float32Array = new Float32Array(0);
    let count = 0;
    let W = 0;
    let H = 0;
    let assembledAt = 0; // 汇聚结束时间（秒）
    const pointer = { x: 0, y: 0, active: false };

    const init = (w: number, h: number) => {
      W = Math.max(1, Math.floor(w));
      H = Math.max(1, Math.floor(h));
      const dpr = Math.min(window.devicePixelRatio || 1, MAX_DEVICE_PIXEL_RATIO);
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
      const off = document.createElement("canvas");
      off.width = W;
      off.height = H;
      const c = off.getContext("2d", { willReadFrequently: true })!;
      c.clearRect(0, 0, W, H);
      c.fillStyle = "#fff";
      const fontSize = Math.min(72, Math.max(44, W * 0.105)); // 题头级：填满容器宽度
      c.font = `600 ${fontSize}px system-ui, -apple-system, "Segoe UI", sans-serif`;
      c.textAlign = "center";
      c.textBaseline = "middle";
      c.fillText(WORDMARK, W / 2, H / 2 + 1);
      const img = c.getImageData(0, 0, W, H);
      const px = img.data;
      // 点阵采样：整个网格单元覆盖就放一个方块点（做成像素/点阵字体）
      const pts: number[] = [];
      for (let gy = 0; gy < H; gy += SAMPLE_STEP) {
        for (let gx = 0; gx < W; gx += SAMPLE_STEP) {
          let hit = false;
          for (let sy = 0; sy < SAMPLE_STEP && !hit; sy++) {
            for (let sx = 0; sx < SAMPLE_STEP && !hit; sx++) {
              const x = gx + sx;
              const y = gy + sy;
              if (x < W && y < H && px[(y * W + x) * 4 + 3] > 150) hit = true;
            }
          }
          if (hit) pts.push(gx + SAMPLE_STEP / 2 - W / 2, H / 2 - (gy + SAMPLE_STEP / 2), 0);
        }
      }
      count = pts.length / 3;
      targetPos = new Float32Array(pts);
      startPos = new Float32Array(count * 3);
      curPos = new Float32Array(count * 3);
      phases = new Float32Array(count);
      const rand = Math.max(W, H) * 1.15;
      for (let i = 0; i < count; i++) {
        const i3 = i * 3;
        startPos[i3] = (Math.random() - 0.5) * rand;
        startPos[i3 + 1] = (Math.random() - 0.5) * rand;
        startPos[i3 + 2] = (Math.random() - 0.5) * 6;
        curPos[i3] = startPos[i3];
        curPos[i3 + 1] = startPos[i3 + 1];
        curPos[i3 + 2] = startPos[i3 + 2];
        phases[i] = Math.random() * Math.PI * 2;
      }
      assembledAt = clock.getElapsedTime() + (reduced ? 0.001 : 1.4);

      if (geom) geom.dispose();
      if (mat) mat.dispose();
      geom = new THREE.BufferGeometry();
      geom.setAttribute("position", new THREE.BufferAttribute(curPos, 3));
      sprite = sprite || makeSprite();
      mat = new THREE.PointsMaterial({
        size: SAMPLE_STEP * 0.8, // 方块占网格的约 80%，留出点阵间隙
        map: sprite,
        color: 0x1476ff,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        sizeAttenuation: false,
        opacity: 0.96,
      });
      const points = new THREE.Points(geom, mat);
      scene.add(points);
    };

    const resize = () => {
      const rect = wrap!.getBoundingClientRect();
      const w = Math.max(1, rect.width);
      const h = Math.max(1, rect.height);
      if (Math.abs(w - W) > 1 || Math.abs(h - H) > 1) init(w, h);
    };

    const easeOut = (p: number) => 1 - Math.pow(1 - p, 3);

    const paint = () => {
      if (!geom || !camera || !renderer || !scene || disposed) return;
      const t = clock.getElapsedTime();
      // 汇聚进度：从散射插值到目标
      const span = reduced ? 0.001 : 1.4;
      const assemble = easeOut(Math.min(1, Math.max(0, (t - (assembledAt - span)) / span)));
      const a = assemble;
      const arr = geom.getAttribute("position").array as Float32Array;
      const radius = 30;
      for (let i = 0; i < count; i++) {
        const i3 = i * 3;
        const ph = phases[i];
        // 目标 = 文字对应点 + 轻微漂浮
        let tx = targetPos[i3];
        let ty = targetPos[i3 + 1];
        if (!reduced) {
          tx += Math.sin(t * 0.7 + ph) * 0.5;
          ty += Math.cos(t * 0.9 + ph * 1.6) * 0.6;
        }
        const tz = Math.sin(t * 0.55 + ph) * 0.5;

        // 鼠标推开
        if (!reduced && pointer.active) {
          const dx = curPos[i3] - pointer.x;
          const dy = curPos[i3 + 1] - pointer.y;
          const distance = Math.sqrt(dx * dx + dy * dy);
          if (distance < radius && distance > 0.01) {
            const force = ((radius - distance) / radius) ** 2 * 12;
            tx += (dx / distance) * force;
            ty += (dy / distance) * force;
          }
        }

        if (a >= 1) {
          const lerp = reduced ? 1 : 0.18;
          curPos[i3] += (tx - curPos[i3]) * lerp;
          curPos[i3 + 1] += (ty - curPos[i3 + 1]) * lerp;
          curPos[i3 + 2] += (tz - curPos[i3 + 2]) * lerp;
        } else {
          curPos[i3] = startPos[i3] + (tx - startPos[i3]) * a;
          curPos[i3 + 1] = startPos[i3 + 1] + (ty - startPos[i3 + 1]) * a;
          curPos[i3 + 2] = startPos[i3 + 2] + (tz - startPos[i3 + 2]) * a;
        }
        arr[i3] = curPos[i3];
        arr[i3 + 1] = curPos[i3 + 1];
        arr[i3 + 2] = curPos[i3 + 2];
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
    <div ref={wrapRef} className="relative mx-auto h-[110px] w-[620px] max-w-[94vw]" role="img" aria-label={WORDMARK}>
      <canvas ref={canvasRef} className="h-full w-full" aria-hidden="true" />
      <span className="sr-only">{WORDMARK}</span>
    </div>
  );
}
