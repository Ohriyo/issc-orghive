import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

// Loaded on demand by HeroBackground (its own chunk), so none of this ships in the main bundle.

const VERTEX = `
attribute vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }
`;

/**
 * Slow, domain-warped value noise drawn as soft green ribbons. Strongest at the lower
 * left (echoing the prototype's swoosh), fading out under the honeycomb on the right.
 * Alpha stays at or below 0.32 so ink text over it keeps AA contrast.
 */
const FRAGMENT = `
precision mediump float;
uniform vec2 u_res;
uniform float u_time;
uniform vec3 u_sage;
uniform vec3 u_olive;
uniform vec3 u_leaf;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 5; i++) {
    v += a * noise(p);
    p = p * 2.02 + vec2(1.7, 9.2);
    a *= 0.5;
  }
  return v;
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  vec2 p = uv * vec2(u_res.x / u_res.y, 1.0) * 1.4;
  float t = u_time * 0.035;

  vec2 q = vec2(fbm(p + vec2(0.0, t)), fbm(p + vec2(5.2, 1.3) - t));
  float n = fbm(p + 2.2 * q + vec2(0.5 * t, -0.3 * t));

  vec3 col = mix(u_sage, u_olive, smoothstep(0.3, 0.8, q.x));
  col = mix(col, u_leaf, smoothstep(0.6, 0.9, n) * 0.5);

  float ribbon = smoothstep(0.42, 0.78, n);
  float mask = (1.0 - smoothstep(0.3, 0.8, uv.x)) * (0.45 + 0.55 * (1.0 - uv.y));
  float alpha = ribbon * mask * 0.32;
  gl_FragColor = vec4(col * alpha, alpha);
}
`;

/** Reads a theme color token (a hex value on :root) as normalized RGB. */
function tokenRgb(name: string): [number, number, number] {
  const hex = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const n = Number.parseInt(hex.replace('#', ''), 16);
  if (Number.isNaN(n)) return [0.56, 0.67, 0.62];
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function compile(gl: WebGLRenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

/** About 30 fps is plenty for motion this slow, and halves GPU work. */
const FRAME_MS = 1000 / 30;
const MAX_DPR = 1.5;

export interface HeroShaderProps {
  className?: string;
}

/**
 * WebGL hero background. Renders nothing if WebGL is unavailable (the static gradient
 * underneath stays), pauses while off-screen or in a hidden tab, and fades in once the
 * first frame is drawn.
 */
export default function HeroShader({ className }: HeroShaderProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    const gl = canvas?.getContext('webgl', { premultipliedAlpha: true, antialias: false });
    if (!canvas || !gl) {
      setFailed(true);
      return;
    }

    const vs = compile(gl, gl.VERTEX_SHADER, VERTEX);
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT);
    const program = gl.createProgram();
    if (!vs || !fs || !program) {
      setFailed(true);
      return;
    }
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      setFailed(true);
      return;
    }
    gl.useProgram(program);

    // One triangle that covers the viewport.
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(program, 'a_pos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    const uRes = gl.getUniformLocation(program, 'u_res');
    const uTime = gl.getUniformLocation(program, 'u_time');
    gl.uniform3fv(gl.getUniformLocation(program, 'u_sage'), tokenRgb('--color-sage'));
    gl.uniform3fv(gl.getUniformLocation(program, 'u_olive'), tokenRgb('--color-olive'));
    gl.uniform3fv(gl.getUniformLocation(program, 'u_leaf'), tokenRgb('--color-leaf'));

    function resize() {
      if (!canvas || !gl) return;
      const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
      const width = Math.max(1, Math.round(canvas.clientWidth * dpr));
      const height = Math.max(1, Math.round(canvas.clientHeight * dpr));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
        gl.viewport(0, 0, width, height);
        gl.uniform2f(uRes, width, height);
      }
    }

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(canvas);
    resize();

    let visible = true;
    const intersection = new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting ?? true;
      if (visible) schedule();
    });
    intersection.observe(canvas);

    let raf = 0;
    let last = 0;
    let first = true;
    // Start partway in, so the first frame already has developed ribbons.
    const start = performance.now() - 20_000;

    function frame(now: number) {
      raf = 0;
      if (!visible || document.hidden || !gl) return;
      if (now - last >= FRAME_MS) {
        last = now;
        gl.uniform1f(uTime, (now - start) / 1000);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        if (first) {
          first = false;
          setReady(true);
        }
      }
      schedule();
    }

    function schedule() {
      if (!raf) raf = requestAnimationFrame(frame);
    }

    const onVisibility = () => {
      if (!document.hidden) schedule();
    };
    document.addEventListener('visibilitychange', onVisibility);
    schedule();

    return () => {
      cancelAnimationFrame(raf);
      resizeObserver.disconnect();
      intersection.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      // No loseContext(): StrictMode re-runs this effect on the same canvas, and
      // getContext() would then hand back the lost context.
    };
  }, []);

  if (failed) return null;

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className={cn(
        'ease-cinematic size-full opacity-0 transition-opacity duration-500',
        ready && 'opacity-100',
        className,
      )}
    />
  );
}
