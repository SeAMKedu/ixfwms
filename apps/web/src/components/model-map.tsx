import { codeFromObjectName } from '@ixfwms/domain';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { CSS2DObject, CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { usePlaces } from '../api/queries';
import { ErrorBox } from './ui';

const HIT = new THREE.Color('#1d5ea8');
const CLICK_TOLERANCE_PX = 5;

/** The place code an object stands for: its own name, or the nearest named ancestor's. */
function codeOf(object: THREE.Object3D | null): { code: string; object: THREE.Object3D } | null {
  for (let o = object; o; o = o.parent) {
    const name = typeof o.userData.name === 'string' ? o.userData.name : o.name;
    const code = codeFromObjectName(name);
    if (code) return { code, object: o };
  }
  return null;
}

/** Tints every mesh under `root` (on its own copy of the material, so other objects keep theirs). */
function tint(root: THREE.Object3D, strength: number) {
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    const materials = (Array.isArray(o.material) ? o.material : [o.material]) as THREE.Material[];
    const tinted = materials.map((m) => {
      const copy = m.clone();
      if ('emissive' in copy && copy.emissive instanceof THREE.Color) {
        copy.emissive = HIT.clone();
        (copy as THREE.MeshStandardMaterial).emissiveIntensity = strength;
      } else if ('color' in copy && copy.color instanceof THREE.Color) {
        copy.color.lerp(HIT, strength);
      }
      return copy;
    });
    o.material = Array.isArray(o.material) ? tinted : tinted[0]!;
  });
}

function label(text: string, target: boolean): CSS2DObject {
  const el = document.createElement('div');
  el.textContent = text;
  el.className = `ixf-3d-label${target ? ' ixf-3d-target' : ''}`;
  return new CSS2DObject(el);
}

/** Frames the camera on a bounding box, keeping the current viewing direction. */
function frame(
  camera: THREE.PerspectiveCamera,
  controls: OrbitControls,
  box: THREE.Box3,
  margin: number,
) {
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3()).length() || 1;
  const distance = (size * margin) / (2 * Math.tan((camera.fov * Math.PI) / 360));
  const direction = camera.position.clone().sub(controls.target).normalize();
  if (direction.lengthSq() === 0) direction.set(1, 0.8, 1).normalize();
  camera.position.copy(center).addScaledVector(direction, distance);
  camera.near = distance / 100;
  camera.far = distance * 100;
  camera.updateProjectionMatrix();
  controls.target.copy(center);
  controls.update();
}

/**
 * A 3D model of a place (glTF from Blender). Objects named "loc-<code>" are places: the path in
 * `highlight` is tinted and labelled, the camera turns to the last of them, and clicking opens a place.
 */
export default function ModelMap({
  href,
  highlight,
  title,
}: {
  href: string;
  highlight: string[];
  title: string;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const box = useRef<HTMLDivElement>(null);
  const places = usePlaces();
  const [error, setError] = useState<string | null>(null);
  // Labels need place names, so the scene is built once the place list has loaded.
  const names = useMemo(
    () => (places.data ? new Map(places.data.map((p) => [p.code, p.name])) : null),
    [places.data],
  );
  const highlightKey = highlight.join(',');

  useEffect(() => {
    const container = box.current;
    if (!container || !names) return;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const width = () => container.clientWidth || 600;
    const height = () => Math.min(480, Math.max(280, Math.round(width() * 0.6)));

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width(), height());
    renderer.setClearColor('#f6f8f8');
    renderer.domElement.setAttribute('role', 'img');
    renderer.domElement.setAttribute('aria-label', title);
    container.appendChild(renderer.domElement);
    const labels = new CSS2DRenderer();
    labels.setSize(width(), height());
    labels.domElement.className = 'ixf-3d-labels';
    container.appendChild(labels.domElement);

    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight('#ffffff', '#8a96a0', 2.2));
    const sun = new THREE.DirectionalLight('#ffffff', 1.6);
    sun.position.set(5, 10, 7);
    scene.add(sun);
    const camera = new THREE.PerspectiveCamera(45, width() / height(), 0.01, 1000);
    camera.position.set(8, 6, 8);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.autoRotateSpeed = 0.6;
    controls.addEventListener('start', () => (controls.autoRotate = false));

    let pickable: THREE.Object3D[] = [];
    let disposed = false;
    new GLTFLoader().load(
      href,
      (gltf) => {
        if (disposed) return;
        scene.add(gltf.scene);
        const linked = new Map<string, THREE.Object3D>();
        gltf.scene.traverse((o) => {
          const found = codeOf(o);
          if (found && found.object === o && !linked.has(found.code)) linked.set(found.code, o);
        });
        pickable = [...linked.values()];
        const present = highlight.filter((c) => linked.has(c));
        const target = present[present.length - 1];
        for (const code of present) {
          const object = linked.get(code)!;
          tint(object, code === target ? 0.8 : 0.35);
          const bounds = new THREE.Box3().setFromObject(object);
          const tag = label(names.get(code) ?? code, code === target);
          tag.position.set(
            (bounds.min.x + bounds.max.x) / 2,
            bounds.max.y,
            (bounds.min.z + bounds.max.z) / 2,
          );
          scene.add(tag);
        }
        frame(camera, controls, new THREE.Box3().setFromObject(gltf.scene), 1.1);
        if (target) frame(camera, controls, new THREE.Box3().setFromObject(linked.get(target)!), 3);
        else controls.autoRotate = !reducedMotion;
      },
      undefined,
      (err) => setError(err instanceof Error ? err.message : String(err)),
    );

    // Clicks (not drags) on a linked object open that place; hovering shows a pointer.
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const pick = (event: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.set(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObjects(pickable, true)[0];
      return hit ? codeOf(hit.object) : null;
    };
    let downAt: { x: number; y: number } | null = null;
    const onDown = (e: PointerEvent) => (downAt = { x: e.clientX, y: e.clientY });
    const onUp = (e: PointerEvent) => {
      if (downAt && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) < CLICK_TOLERANCE_PX) {
        const found = pick(e);
        if (found) void navigate(`/l/${found.code}`);
      }
      downAt = null;
    };
    const onMove = (e: PointerEvent) => {
      if (e.buttons === 0) renderer.domElement.style.cursor = pick(e) ? 'pointer' : 'grab';
    };
    renderer.domElement.addEventListener('pointerdown', onDown);
    renderer.domElement.addEventListener('pointerup', onUp);
    renderer.domElement.addEventListener('pointermove', onMove);

    const resize = new ResizeObserver(() => {
      renderer.setSize(width(), height());
      labels.setSize(width(), height());
      camera.aspect = width() / height();
      camera.updateProjectionMatrix();
    });
    resize.observe(container);

    renderer.setAnimationLoop(() => {
      controls.update();
      renderer.render(scene, camera);
      labels.render(scene, camera);
    });

    return () => {
      disposed = true;
      renderer.setAnimationLoop(null);
      resize.disconnect();
      controls.dispose();
      scene.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          (o.geometry as THREE.BufferGeometry).dispose();
          const materials = (
            Array.isArray(o.material) ? o.material : [o.material]
          ) as THREE.Material[];
          for (const m of materials) m.dispose();
        }
      });
      renderer.dispose();
      container.replaceChildren();
    };
    // Rebuild only when the model or the highlighted path changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [href, highlightKey, title, names]);

  return (
    <div className="flex flex-col gap-1">
      <div
        ref={box}
        className="relative overflow-hidden rounded-lg border border-line bg-surface-2"
      />
      {error && <ErrorBox error={error} />}
      <p className="text-[12px] text-muted">{t('maps.model3dHint')}</p>
    </div>
  );
}
