import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Grid, OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { AP, ROOM, WALL_X } from "@/lib/engine";
import { useRadar } from "@/lib/radar-store";
import { cn } from "@/lib/utils";
import type { ViewPreset } from "@/lib/types";

const PRESET: Record<ViewPreset, [number, number, number]> = {
  iso: [9.5, 10.5, 14.5],
  top: [0.2, 22, 0.2],
  follow: [-2.2, 4.8, 9.2],
};

export function RadarCanvas({ className }: { className?: string }) {
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  if (!ready) return <div className={cn("h-full min-h-[280px] bg-bg", className)} />;
  return (
    <div className={cn("relative h-full min-h-[280px] bg-bg", className)}>
      <Canvas
        dpr={[1, 1.6]}
        camera={{ position: PRESET.iso, fov: 40, near: 0.1, far: 220 }}
        gl={{ antialias: true, alpha: false, powerPreference: "high-performance" }}
      >
        <color attach="background" args={["#08090b"]} />
        <fog attach="fog" args={["#08090b", 22, 52]} />
        <ambientLight intensity={0.45} />
        <directionalLight position={[8, 16, 10]} intensity={0.85} color="#e8ece8" />
        <hemisphereLight args={["#8fb4b8", "#1a1510", 0.25]} />
        <Grid
          args={[40, 40]}
          cellSize={1}
          cellThickness={0.6}
          cellColor="#1c2228"
          sectionSize={5}
          sectionThickness={1}
          sectionColor="#2c343c"
          fadeDistance={42}
          fadeStrength={1.4}
          infiniteGrid
          position={[0, 0.001, 0]}
        />
        <RangeRings />
        <Walls />
        <Sweep />
        <PeopleClouds />
        <ObjectMarks />
        <MapCloud />
        <OccupancyMesh />
        <Trajectory />
        <SonarRay />
        <Observer />
        <AccessPoint />
        <CameraRig />
        <OrbitControls enableDamping dampingFactor={0.08} maxPolarAngle={Math.PI / 2.05} minDistance={5} maxDistance={40} />
      </Canvas>
    </div>
  );
}

function CameraRig() {
  const preset = useRadar((s) => s.viewPreset);
  const { camera } = useThree();
  useEffect(() => {
    const p = PRESET[preset];
    camera.position.set(p[0], p[1], p[2]);
    camera.lookAt(0, 0.4, 0);
  }, [preset, camera]);
  return null;
}

function RangeRings() {
  return (
    <group rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
      {[3, 6, 9, 12].map((r) => (
        <mesh key={r}>
          <ringGeometry args={[r - 0.015, r + 0.015, 72]} />
          <meshBasicMaterial color="#8fb4b8" transparent opacity={0.16} />
        </mesh>
      ))}
    </group>
  );
}

function Walls() {
  return (
    <group>
      <mesh position={[WALL_X, ROOM.h / 2, 0]}>
        <boxGeometry args={[0.08, ROOM.h, ROOM.d]} />
        <meshStandardMaterial color="#2a3038" transparent opacity={0.28} />
      </mesh>
      {[
        [-ROOM.w / 2, 0],
        [ROOM.w / 2, 0],
      ].map(([x], i) => (
        <mesh key={i} position={[x, ROOM.h / 2, 0]}>
          <boxGeometry args={[0.06, ROOM.h, ROOM.d]} />
          <meshStandardMaterial color="#1a1e24" transparent opacity={0.22} />
        </mesh>
      ))}
    </group>
  );
}

function Sweep() {
  const ref = useRef<THREE.Mesh>(null);
  useFrame((_, delta) => {
    if (ref.current) ref.current.rotation.y += delta * 0.55;
  });
  return (
    <mesh ref={ref} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]}>
      <circleGeometry args={[12, 48, 0, 0.42]} />
      <meshBasicMaterial color="#8fb4b8" transparent opacity={0.07} side={THREE.DoubleSide} />
    </mesh>
  );
}

function PeopleClouds() {
  const geos = useMemo(() => {
    return Array.from({ length: 8 }, () => {
      const n = 180;
      const pos = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        const h = Math.random();
        const t = Math.random() * Math.PI * 2;
        const r = 0.28 * (0.55 + 0.45 * Math.sin(h * Math.PI));
        const head = i > n - 40;
        if (head) {
          const p = Math.random() * Math.PI;
          pos[i * 3] = Math.sin(p) * Math.cos(t) * 0.18;
          pos[i * 3 + 1] = 1.52 + Math.cos(p) * 0.18;
          pos[i * 3 + 2] = Math.sin(p) * Math.sin(t) * 0.18;
        } else {
          pos[i * 3] = Math.cos(t) * r;
          pos[i * 3 + 1] = h * 1.55;
          pos[i * 3 + 2] = Math.sin(t) * r;
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      return g;
    });
  }, []);
  const groups = useRef<(THREE.Points | null)[]>([]);

  useFrame((state) => {
    const people = useRadar.getState().people;
    groups.current.forEach((pts, i) => {
      if (!pts) return;
      const p = people[i];
      pts.visible = !!p;
      if (!p) return;
      const breathe = 1 + 0.028 * Math.sin(state.clock.elapsedTime * (p.bpm / 60) * Math.PI * 2);
      pts.position.set(p.pos.x, p.pos.y, p.pos.z);
      pts.scale.set(breathe, 1, breathe);
      const mat = pts.material as THREE.PointsMaterial;
      mat.opacity = p.behindWall ? 0.32 : p.source === "device" ? 0.95 : 0.82;
      mat.color.set(p.source === "device" ? "#7dba9a" : p.behindWall ? "#c4a574" : "#8fb4b8");
    });
  });

  return (
    <group>
      {geos.map((geo, i) => (
        <points
          key={i}
          ref={(el) => {
            groups.current[i] = el;
          }}
          geometry={geo}
        >
          <pointsMaterial
            size={0.07}
            color="#8fb4b8"
            transparent
            opacity={0.88}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
            sizeAttenuation
          />
        </points>
      ))}
    </group>
  );
}

function ObjectMarks() {
  const objects = useRadar((s) => s.objects);
  const selected = useRadar((s) => s.selectedId);
  return (
    <group>
      {objects.map((o) => (
        <mesh
          key={o.id}
          position={[o.pos.x, o.size.y / 2, o.pos.z]}
          onClick={(e) => {
            e.stopPropagation();
            useRadar.getState().select(o.id);
          }}
        >
          <boxGeometry args={[o.size.x, o.size.y, o.size.z]} />
          <meshStandardMaterial
            color={selected === o.id ? "#ece8e0" : o.metal ? "#9aa3a8" : "#3a3f46"}
            transparent
            opacity={selected === o.id ? 0.7 : 0.45}
            metalness={o.metal ? 0.7 : 0.05}
            roughness={o.metal ? 0.3 : 0.85}
          />
        </mesh>
      ))}
    </group>
  );
}

function MapCloud() {
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(3), 3));
    g.setAttribute("color", new THREE.BufferAttribute(new Float32Array(3), 3));
    return g;
  }, []);
  const last = useRef(0);

  useFrame(() => {
    const st = useRadar.getState();
    const raw = st.mapPoints;
    const pts = raw.filter((p) => st.kindFilter[p.kind]);
    if (pts.length === last.current && !st.mapping) return;
    last.current = pts.length;
    const pos = new Float32Array(Math.max(pts.length, 1) * 3);
    const col = new Float32Array(Math.max(pts.length, 1) * 3);
    const palette: Record<string, [number, number, number]> = {
      person: [0.56, 0.71, 0.72],
      object: [0.78, 0.74, 0.64],
      wall: [0.4, 0.42, 0.46],
      free: [0.45, 0.62, 0.52],
      traj: [0.77, 0.65, 0.45],
      sonar: [0.72, 0.78, 0.84],
    };
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      if (!p) continue;
      pos[i * 3] = p.x;
      pos[i * 3 + 1] = p.y;
      pos[i * 3 + 2] = p.z;
      const c = palette[p.kind] ?? [0.6, 0.6, 0.6];
      col[i * 3] = c[0];
      col[i * 3 + 1] = c[1];
      col[i * 3 + 2] = c[2];
    }
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    geo.computeBoundingSphere();
  });

  return (
    <points geometry={geo}>
      <pointsMaterial size={0.09} vertexColors transparent opacity={0.85} depthWrite={false} sizeAttenuation />
    </points>
  );
}

function OccupancyMesh() {
  const cells = useRadar((s) => s.occupancy);
  const meshOn = useRadar((s) => s.meshOn);
  if (!meshOn || !cells.length) return null;
  return (
    <group>
      {cells.slice(0, 400).map((c, i) => (
        <mesh key={`${c.x}-${c.z}-${i}`} position={[c.x, 0.08, c.z]}>
          <boxGeometry args={[0.3, 0.12 + Math.min(0.6, c.n * 0.04), 0.3]} />
          <meshStandardMaterial color="#3d4a46" transparent opacity={0.35} />
        </mesh>
      ))}
    </group>
  );
}

function Trajectory() {
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(6), 3));
    return g;
  }, []);
  const last = useRef(0);
  useFrame(() => {
    const tr = useRadar.getState().trajectory;
    if (tr.length === last.current || tr.length < 2) return;
    last.current = tr.length;
    const pos = new Float32Array(tr.length * 3);
    for (let i = 0; i < tr.length; i++) {
      const p = tr[i];
      if (!p) continue;
      pos[i * 3] = p.x;
      pos[i * 3 + 1] = 0.06;
      pos[i * 3 + 2] = p.z;
    }
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  });
  return (
    <line geometry={geo}>
      <lineBasicMaterial color="#c4a574" transparent opacity={0.7} />
    </line>
  );
}

function SonarRay() {
  const ref = useRef<THREE.Mesh>(null);
  useFrame(() => {
    const st = useRadar.getState();
    const d = st.sonar?.distM ?? 2;
    if (!ref.current) return;
    ref.current.scale.set(1, 1, d);
    const hd = (st.heading * Math.PI) / 180;
    ref.current.position.set(-4.2 + Math.sin(hd) * (d / 2), 1.15, 3.6 - Math.cos(hd) * (d / 2));
    ref.current.rotation.set(0, hd, 0);
  });
  return (
    <mesh ref={ref}>
      <boxGeometry args={[0.03, 0.03, 1]} />
      <meshBasicMaterial color="#8fb4b8" transparent opacity={0.35} />
    </mesh>
  );
}

function Observer() {
  return (
    <mesh position={[-4.2, 1.35, 3.6]}>
      <sphereGeometry args={[0.12, 16, 16]} />
      <meshStandardMaterial color="#ece8e0" emissive="#8fb4b8" emissiveIntensity={0.6} />
    </mesh>
  );
}

function AccessPoint() {
  return (
    <mesh position={[AP.x, AP.y, AP.z]}>
      <boxGeometry args={[0.22, 0.06, 0.16]} />
      <meshStandardMaterial color="#7dba9a" emissive="#7dba9a" emissiveIntensity={0.4} />
    </mesh>
  );
}
