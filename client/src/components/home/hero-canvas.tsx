"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Environment, Lightformer } from "@react-three/drei";
import { useMemo, useRef } from "react";
import * as THREE from "three";

/**
 * The hero's 3D scene: a bolt of maroon silk with travelling waves, a ripple that follows the pointer, and a gold
 * ring set with a ruby that turns toward it. It is decorative (the page is complete without it), so the canvas is
 * hidden from assistive technology and takes no pointer events.
 *
 * Kept light on purpose: one custom-shader mesh, one small torus, no textures, no network assets (the lighting
 * environment is built from a few in-scene panels), a capped pixel ratio, and a frame loop that stops whenever the
 * hero is off screen, the tab is hidden, or the visitor pauses it.
 */

const SILK_VERTEX = /* glsl */ `
  uniform float uTime;
  uniform vec2 uPointer;
  uniform float uPointerForce;
  varying vec2 vUv;
  varying vec3 vNormalW;
  varying vec3 vPos;

  // The cloth's height at (x, y). Two slow swells, a diagonal ripple, and a ring that spreads from the pointer.
  float height(vec2 p, float t) {
    float h = sin(p.x * 0.75 + t * 0.55) * 0.34
            + sin(p.y * 1.15 - t * 0.42 + p.x * 0.35) * 0.24
            + sin((p.x + p.y) * 0.55 + t * 0.30) * 0.18;
    float d = distance(p, uPointer);
    h += exp(-d * d * 0.35) * sin(d * 5.0 - t * 3.0) * 0.20 * uPointerForce;
    return h;
  }

  void main() {
    vUv = uv;
    vec3 p = position;
    float e = 0.06;
    float h  = height(p.xy, uTime);
    float hx = height(p.xy + vec2(e, 0.0), uTime);
    float hy = height(p.xy + vec2(0.0, e), uTime);
    p.z += h;
    // Normal from finite differences of the height field.
    vNormalW = normalize(normalMatrix * normalize(vec3(-(hx - h) / e, -(hy - h) / e, 1.0)));
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    vPos = mv.xyz;
    gl_Position = projectionMatrix * mv;
  }
`;

const SILK_FRAGMENT = /* glsl */ `
  uniform vec3 uDeep;
  uniform vec3 uMid;
  uniform vec3 uGold;
  varying vec2 vUv;
  varying vec3 vNormalW;
  varying vec3 vPos;

  void main() {
    vec3 n = normalize(vNormalW);
    vec3 v = normalize(-vPos);
    vec3 l = normalize(vec3(-0.35, 0.55, 0.85));

    float diff = clamp(dot(n, l) * 0.5 + 0.5, 0.0, 1.0);
    // Silk has a tight, directional sheen: a sharp highlight plus a broad grazing glow.
    vec3 h = normalize(l + v);
    float spec = pow(max(dot(n, h), 0.0), 38.0);
    float sheen = pow(1.0 - max(dot(n, v), 0.0), 3.0);

    vec3 base = mix(uDeep, uMid, diff);

    // Woven grain, and fine zari stripes with a wider gold border band near the edge.
    float weave = sin(vUv.x * 900.0) * sin(vUv.y * 900.0) * 0.012;
    float stripe = smoothstep(0.975, 1.0, abs(sin(vUv.x * 26.0))) * 0.16;
    float border = smoothstep(0.0, 0.01, vUv.y) * (1.0 - smoothstep(0.045, 0.06, vUv.y));
    float zari = stripe + border * 0.35;

    vec3 color = base + weave;
    color = mix(color, uGold, zari * (0.4 + diff * 0.6));
    color += uGold * spec * 0.4;
    color += vec3(0.78, 0.35, 0.45) * sheen * 0.22;

    gl_FragColor = vec4(color, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

function Silk({ active }: { active: boolean }) {
  const material = useRef<THREE.ShaderMaterial>(null);
  const { viewport, pointer } = useThree();

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uPointer: { value: new THREE.Vector2(99, 99) },
      uPointerForce: { value: 0 },
      // THREE converts a hex colour to its linear working space itself; converting again would darken the silk.
      uDeep: { value: new THREE.Color("#260913") },
      uMid: { value: new THREE.Color("#661d33") },
      uGold: { value: new THREE.Color("#d9bb78") },
    }),
    [],
  );

  useFrame((_state, delta) => {
    const u = material.current?.uniforms;
    if (!u) return;
    u.uTime.value += delta;
    // Pointer in the cloth's own coordinates, eased so the ripple glides rather than snaps.
    const tx = (pointer.x * viewport.width) / 2;
    const ty = (pointer.y * viewport.height) / 2;
    (u.uPointer.value as THREE.Vector2).lerp(new THREE.Vector2(tx, ty), 1 - Math.pow(0.0015, delta));
    u.uPointerForce.value = THREE.MathUtils.lerp(u.uPointerForce.value, active ? 1 : 0, 1 - Math.pow(0.02, delta));
  });

  // Larger than the view, so the edges of the cloth are never visible.
  const w = viewport.width * 1.25;
  const h = viewport.height * 1.25;
  return (
    <mesh rotation={[-0.38, 0.12, 0]} position={[0, 0, -1.2]}>
      <planeGeometry args={[w, h, 200, 110]} />
      <shaderMaterial ref={material} uniforms={uniforms} vertexShader={SILK_VERTEX} fragmentShader={SILK_FRAGMENT} />
    </mesh>
  );
}

function Ring() {
  const group = useRef<THREE.Group>(null);
  const { viewport, pointer } = useThree();

  useFrame((state, delta) => {
    const g = group.current;
    if (!g) return;
    const t = state.clock.elapsedTime;
    const ease = 1 - Math.pow(0.02, delta);
    // Drifts gently, and leans toward the pointer.
    g.rotation.y = THREE.MathUtils.lerp(g.rotation.y, 0.5 + pointer.x * 0.5 + Math.sin(t * 0.4) * 0.15, ease);
    g.rotation.x = THREE.MathUtils.lerp(g.rotation.x, -0.25 - pointer.y * 0.35 + Math.cos(t * 0.35) * 0.1, ease);
    g.position.y = Math.sin(t * 0.7) * 0.1 - 0.1;
  });

  // On the right-hand side, clear of the headline, scaled to the viewport.
  const scale = Math.min(viewport.width, viewport.height * 1.7) * 0.155;
  return (
    <group ref={group} position={[viewport.width * 0.25, -0.1, 0.6]} scale={scale}>
      <mesh>
        <torusGeometry args={[1, 0.17, 48, 160]} />
        <meshStandardMaterial color="#ecc772" metalness={0.9} roughness={0.25} envMapIntensity={1.6} emissive="#4a3208" emissiveIntensity={0.6} />
      </mesh>
      <mesh position={[0, 1.12, 0]} rotation={[0, 0, 0]} scale={[0.34, 0.4, 0.34]}>
        <octahedronGeometry args={[1, 0]} />
        <meshPhysicalMaterial color="#a31d37" metalness={0.1} roughness={0.08} clearcoat={1} clearcoatRoughness={0.05} emissive="#7a1026" emissiveIntensity={0.9} />
      </mesh>
      {/* Little gold beads on a loose orbit */}
      {[0, 1, 2, 3, 4].map((i) => {
        const a = (i / 5) * Math.PI * 2 + 0.4;
        return (
          <mesh key={i} position={[Math.cos(a) * 1.7, Math.sin(a) * 1.35, Math.sin(a * 2) * 0.3]} scale={0.06 + (i % 3) * 0.02}>
            <sphereGeometry args={[1, 24, 24]} />
            <meshStandardMaterial color="#e0b866" metalness={0.9} roughness={0.3} envMapIntensity={1.5} emissive="#3a2406" emissiveIntensity={0.5} />
          </mesh>
        );
      })}
    </group>
  );
}

/** Tells the page the first frame has been drawn, so it can fade this canvas in over the static artwork. */
function Ready({ onReady }: { onReady: () => void }) {
  const done = useRef(false);
  useFrame(() => {
    if (done.current) return;
    done.current = true;
    onReady();
  });
  return null;
}

export interface HeroCanvasProps {
  /** The element whose pointer movement drives the scene (the whole hero, not just the canvas). */
  eventSource: HTMLElement;
  /** false stops rendering entirely (off screen, tab hidden, or paused by the visitor). */
  running: boolean;
  onReady: () => void;
  onFail: () => void;
}

export default function HeroCanvas({ eventSource, running, onReady, onFail }: HeroCanvasProps) {
  return (
    <Canvas
      aria-hidden="true"
      role="presentation"
      eventSource={eventSource}
      eventPrefix="client"
      frameloop={running ? "always" : "never"}
      dpr={[1, 1.5]}
      camera={{ position: [0, 0, 6], fov: 42 }}
      gl={{ antialias: false, powerPreference: "default", alpha: false, stencil: false }}
      onCreated={({ gl, scene }) => {
        scene.background = new THREE.Color("#260913");
        gl.domElement.addEventListener(
          "webglcontextlost",
          (e) => {
            e.preventDefault();
            onFail();
          },
          { once: true },
        );
      }}
    >
      <Silk active={running} />
      <Ring />
      {/* Studio lighting built from a few emissive panels: reflects in the gold, needs no HDR download. */}
      <Environment resolution={128} frames={1}>
        {/* A warm, dim room: polished metal needs something to reflect besides the three lights. */}
        <color attach="background" args={["#7a5a45"]} />
        <Lightformer form="rect" intensity={3.2} color="#ffe9c0" position={[-3, 3, 4]} scale={[6, 3, 1]} />
        <Lightformer form="rect" intensity={1.6} color="#ff9db0" position={[4, -1, 3]} scale={[3, 5, 1]} />
        <Lightformer form="ring" intensity={2.2} color="#ffffff" position={[0, 0, -4]} scale={4} />
      </Environment>
      <ambientLight intensity={0.25} />
      <Ready onReady={onReady} />
    </Canvas>
  );
}
