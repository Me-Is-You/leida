import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Grid, OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { CLOUD_KINDS, type CloudKind } from "@/lib/core/cloud.ts";
import { mulberry32 } from "@/lib/core/math.ts";
import { AP, ROOM, WALL_X } from "@/lib/engine";
import { cloud, effectiveSonar, grid, useRadar } from "@/lib/radar-store";
import { cn } from "@/lib/utils";
import type { ViewPreset } from "@/lib/types";

const OFFSET: Record<ViewPreset, [number, number, number]> = {
  iso: [9.5, 10.5, 14.5],
  top: [0.2, 22, 0.2],
  follow: [-2.2, 4.8, 9.2],
};

const COLOR: Record<CloudKind, string> = {
  person: "#8fb4b8",
  object: "#c7bda3",
  wall: "#8a909c",
  free: "#739e85",
  traj: "#c4a673",
  sonar: "#b8c7d6",
};
const SIZE: Record<CloudKind, number> = { person: 0.07, object: 0.07, wall: 0.06, free: 0.05, traj: 0.06, sonar: 0.11 };

export function RadarCanvas({ className }: { className?: string }) {
  const [ready, setReady] = useState(false);
  const demo = useRadar((s) => s.dataMode === "demo");
  useEffect(() => setReady(true), []);
  if (!ready) return <div className={cn("h-full min-h-[280px] bg-bg", className)} />;
  return (
    <div className={cn("relative h-full min-h-[280px] bg-bg", className)}>
      <Canvas
        dpr={[1, 1.6]}
        camera={{ position: OFFSET.iso, fov: 40, near: 0.1, far: 220 }}
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
        <Follow>
          <RangeRings />
        </Follow>
        {demo ? (
          <>
            <Walls />
            <ObjectMarks />
            <AccessPoint />
          </>
        ) : null}
        <PeopleClouds />
        {CLOUD_KINDS.map((k) => (
          <KindCloud key={k} kind={k} />
        ))}
        <OccupancyMesh />
        <Trajectory />
        <SonarRay />
        <Observer />
        <Rig />
      </Canvas>
    </div>
  );
}

/** Moves children with the observer pose (range rings stay centred on the user). */
function Follow({ children }: { children: React.ReactNode }) {
  const ref = useRef<THREE.Group>(null);
  useFrame(() => {
    const p = useRadar.getState().pose;
    ref.current?.position.set(p.x, 0, p.z);
  });
  return <group ref={ref}>{children}</group>;
}

function Rig() {
  const preset = useRadar((s) => s.settings.viewPreset);
  const controls = useRef<OrbitControlsImpl>(null);
  const { camera } = useThree();
  const target = useRef(new THREE.Vector3(0, 0.4, 0));

  useEffect(() => {
    const st = useRadar.getState();
    const c = st.dataMode === "demo" && preset !== "follow" ? new THREE.Vector3(0, 0.4, 0) : new THREE.Vector3(st.pose.x, 0.4, st.pose.z);
    target.current.copy(c);
    const o = OFFSET[preset];
    camera.position.set(c.x + o[0], o[1], c.z + o[2]);
    camera.lookAt(c);
    controls.current?.target.copy(c);
    controls.current?.update();
  }, [preset, camera]);

  useFrame(() => {
    const ctl = controls.current;
    if (!ctl) return;
    const st = useRadar.getState();
    const want =
      st.dataMode === "demo" && st.settings.viewPreset !== "follow"
        ? new THREE.Vector3(0, 0.4, 0)
        : new THREE.Vector3(st.pose.x, 0.4, st.pose.z);
    const delta = want.clone().sub(ctl.target).multiplyScalar(0.08);
    if (delta.lengthSq() > 1e-8) {
      ctl.target.add(delta);
      camera.position.add(delta); // keep the user's orbit offset
    }
  });

  return (
    <OrbitControls
      ref={controls}
      enableDamping
      dampingFactor={0.08}
      maxPolarAngle={Math.PI / 2.05}
      minDistance={2.5}
      maxDistance={45}
    />
  );
}

function RangeRings() {
  return (
    <group rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
      {[1, 2, 3, 5].map((r) => (
        <mesh key={r}>
          <ringGeometry args={[r - 0.012, r + 0.012, 72]} />
          <meshBasicMaterial color="#8fb4b8" transparent opacity={r === 5 ? 0.22 : 0.12} />
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
      {[-ROOM.w / 2, ROOM.w / 2].map((x) => (
        <mesh key={x} position={[x, ROOM.h / 2, 0]}>
          <boxGeometry args={[0.06, ROOM.h, ROOM.d]} />
          <meshStandardMaterial color="#1a1e24" transparent opacity={0.22} />
        </mesh>
      ))}
    </group>
  );
}

function PeopleClouds() {
  const geos = useMemo(() => {
    const rnd = mulberry32(42);
    return Array.from({ length: 8 }, () => {
      const n = 180;
      const pos = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        const h = rnd();
        const t = rnd() * Math.PI * 2;
        const r = 0.28 * (0.55 + 0.45 * Math.sin(h * Math.PI));
        if (i > n - 40) {
          const p = rnd() * Math.PI;
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
  const refs = useRef<(THREE.Points | null)[]>([]);

  useFrame((state) => {
    const people = useRadar.getState().people;
    refs.current.forEach((pts, i) => {
      if (!pts) return;
      const p = people[i];
      pts.visible = !!p;
      if (!p) return;
      const breathe = p.bpm ? 1 + 0.028 * Math.sin(state.clock.elapsedTime * (p.bpm / 60) * Math.PI * 2) : 1;
      pts.position.set(p.pos.x, p.pos.y, p.pos.z);
      pts.scale.set(breathe, 1, breathe);
      const mat = pts.material as THREE.PointsMaterial;
      mat.opacity = p.behindWall ? 0.32 : p.source === "device" ? 0.95 : 0.7;
      mat.color.set(p.source === "device" ? "#7dba9a" : p.behindWall ? "#c4a574" : "#8fb4b8");
    });
  });

  return (
    <group>
      {geos.map((geo, i) => (
        <points
          key={i}
          ref={(el) => {
            refs.current[i] = el as unknown as THREE.Points | null;
          }}
          geometry={geo}
          frustumCulled={false}
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

/**
 * One <points> per kind that reads the ring buffer's Float32Array directly (zero copy).
 * Geometry is only touched when the ring's version changes.
 */
function KindCloud({ kind }: { kind: CloudKind }) {
  const ring = cloud.rings[kind];
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(ring.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setDrawRange(0, 0);
    return g;
  }, [ring]);
  const lastV = useRef(-1);
  const lastOn = useRef(true);
  const ref = useRef<THREE.Points>(null);

  useFrame(() => {
    const on = useRadar.getState().settings.kindFilter[kind];
    if (ref.current) ref.current.visible = on;
    if (!on) {
      lastOn.current = false;
      return;
    }
    if (ring.version === lastV.current && lastOn.current) return;
    lastV.current = ring.version;
    lastOn.current = true;
    geo.setDrawRange(0, ring.size);
    (geo.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
    geo.computeBoundingSphere();
  });

  return (
    <points ref={ref} geometry={geo} frustumCulled={false}>
      <pointsMaterial size={SIZE[kind]} color={COLOR[kind]} transparent opacity={0.9} depthWrite={false} sizeAttenuation />
    </points>
  );
}

const MAX_CELLS = 3000;

function OccupancyMesh() {
  const ref = useRef<THREE.InstancedMesh>(null);
  const lastV = useRef(-1);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  useFrame(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const st = useRadar.getState();
    mesh.visible = st.meshOn;
    if (!st.meshOn || grid.version === lastV.current) return;
    lastV.current = grid.version;
    const cells = grid.occupiedCells(0.65).slice(0, MAX_CELLS);
    mesh.count = cells.length;
    const c = grid.cell;
    cells.forEach((cell, i) => {
      const h = 0.1 + (cell.p - 0.65) * 1.2;
      dummy.position.set(cell.x, h / 2, cell.z);
      dummy.scale.set(c * 0.92, h, c * 0.92);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
  });
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, MAX_CELLS]} frustumCulled={false}>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial color="#4d6b60" transparent opacity={0.5} />
    </instancedMesh>
  );
}

function Trajectory() {
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(3000 * 3), 3));
    g.setDrawRange(0, 0);
    return g;
  }, []);
  const obj = useMemo(() => {
    const l = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: "#c4a574", transparent: true, opacity: 0.8 }));
    l.frustumCulled = false;
    return l;
  }, [geo]);
  const last = useRef(-1);
  useFrame(() => {
    const tr = useRadar.getState().trajectory;
    if (tr.length === last.current) return;
    last.current = tr.length;
    const attr = geo.getAttribute("position") as THREE.BufferAttribute;
    const n = Math.min(tr.length, 3000);
    for (let i = 0; i < n; i++) {
      const p = tr[i] as { x: number; z: number };
      attr.setXYZ(i, p.x, 0.06, p.z);
    }
    attr.needsUpdate = true;
    geo.setDrawRange(0, n);
    geo.computeBoundingSphere();
  });
  return (
    <primitive object={obj} />
  );
}

function SonarRay() {
  const ref = useRef<THREE.Mesh>(null);
  useFrame(() => {
    const m = ref.current;
    if (!m) return;
    const st = useRadar.getState();
    const s = effectiveSonar(st);
    const d = s?.distM ?? null;
    m.visible = d !== null;
    if (d === null) return;
    const h = (st.pose.headingDeg * Math.PI) / 180;
    m.scale.set(1, 1, d);
    m.position.set(st.pose.x + Math.sin(h) * (d / 2), st.pose.heightM - 0.2, st.pose.z + Math.cos(h) * (d / 2));
    m.rotation.set(0, h, 0);
    (m.material as THREE.MeshBasicMaterial).color.set(s?.source === "device" ? "#7dba9a" : "#8fb4b8");
  });
  return (
    <mesh ref={ref} visible={false}>
      <boxGeometry args={[0.03, 0.03, 1]} />
      <meshBasicMaterial color="#8fb4b8" transparent opacity={0.5} />
    </mesh>
  );
}

function Observer() {
  const body = useRef<THREE.Mesh>(null);
  const wedge = useRef<THREE.Group>(null);
  useFrame(() => {
    const p = useRadar.getState().pose;
    body.current?.position.set(p.x, p.heightM, p.z);
    if (wedge.current) {
      wedge.current.position.set(p.x, 0.05, p.z);
      wedge.current.rotation.y = (p.headingDeg * Math.PI) / 180;
    }
  });
  return (
    <>
      <mesh ref={body}>
        <sphereGeometry args={[0.12, 16, 16]} />
        <meshStandardMaterial color="#ece8e0" emissive="#8fb4b8" emissiveIntensity={0.6} />
      </mesh>
      {/* heading wedge on the floor: apex points along the camera heading */}
      <group ref={wedge}>
        <mesh position={[0, 0, 0.55]} rotation={[Math.PI / 2, 0, 0]}>
          <coneGeometry args={[0.4, 1.1, 3]} />
          <meshBasicMaterial color="#8fb4b8" transparent opacity={0.28} />
        </mesh>
      </group>
    </>
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
