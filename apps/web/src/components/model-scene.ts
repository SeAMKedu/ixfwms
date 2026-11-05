import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CSS2DObject, CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';

/* The three.js side of ModelMap: setting up the view, marking up a loaded model, cleaning up. */

export const HIT = new THREE.Color('#1d5ea8');
const ATTENTION = new THREE.Color('#c27a12');

/** The object's name as in Blender (three.js tidies `name`, the loader keeps the original). */
export function keyOf(o: THREE.Object3D): string {
  return typeof o.userData.name === 'string' ? o.userData.name : o.name;
}

/** The place an object stands for: its own link, or the nearest linked ancestor's. */
export function codeOf(
  object: THREE.Object3D | null,
  links: Record<string, string>,
): { code: string; object: THREE.Object3D } | null {
  for (let o = object; o; o = o.parent) {
    const code = links[keyOf(o)];
    if (code) return { code, object: o };
  }
  return null;
}

/** Tints every mesh under `root` (on its own copy of the material, so other objects keep theirs). */
function tint(root: THREE.Object3D, strength: number, color = HIT) {
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    const materials = (Array.isArray(o.material) ? o.material : [o.material]) as THREE.Material[];
    const tinted = materials.map((m) => {
      const copy = m.clone();
      if ('emissive' in copy && copy.emissive instanceof THREE.Color) {
        copy.emissive = color.clone();
        (copy as THREE.MeshStandardMaterial).emissiveIntensity = strength;
      } else if ('color' in copy && copy.color instanceof THREE.Color) {
        copy.color.lerp(color, strength);
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

/** Renderer, label layer, lights, camera and orbit controls, added to `container`. */
export function createStage(container: HTMLElement, width: number, height: number, title: string) {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(width, height);
  renderer.setClearColor('#f6f8f8');
  renderer.domElement.setAttribute('role', 'img');
  renderer.domElement.setAttribute('aria-label', title);
  container.appendChild(renderer.domElement);
  const labels = new CSS2DRenderer();
  labels.setSize(width, height);
  labels.domElement.className = 'ixf-3d-labels';
  container.appendChild(labels.domElement);

  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight('#ffffff', '#8a96a0', 2.2));
  const sun = new THREE.DirectionalLight('#ffffff', 1.6);
  sun.position.set(5, 10, 7);
  scene.add(sun);
  const camera = new THREE.PerspectiveCamera(45, width / height, 0.01, 1000);
  camera.position.set(8, 6, 8);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.autoRotateSpeed = 0.6;
  controls.addEventListener('start', () => (controls.autoRotate = false));

  return { renderer, labels, scene, camera, controls };
}

/**
 * Marks up a loaded model: linked places are tinted (the highlighted path, and in amber the ones
 * needing attention) and labelled, and the camera turns to the last place on the path.
 */
export function markUp(
  model: THREE.Object3D,
  {
    scene,
    camera,
    controls,
  }: Pick<ReturnType<typeof createStage>, 'scene' | 'camera' | 'controls'>,
  {
    links,
    highlight,
    attention,
    names,
    isEditing,
    reducedMotion,
  }: {
    links: Record<string, string>;
    highlight: string[];
    attention: string[];
    names: Map<string, string>;
    isEditing: boolean;
    reducedMotion: boolean;
  },
): { named: Map<string, THREE.Object3D>; pickable: THREE.Object3D[] } {
  const linked = new Map<string, THREE.Object3D>();
  const named = new Map<string, THREE.Object3D>();
  model.traverse((o) => {
    if (o !== model && keyOf(o) && !named.has(keyOf(o))) named.set(keyOf(o), o);
    const found = codeOf(o, links);
    if (found && found.object === o && !linked.has(found.code)) linked.set(found.code, o);
  });
  for (const code of attention)
    if (!highlight.includes(code) && linked.has(code)) tint(linked.get(code)!, 0.5, ATTENTION);
  if (isEditing) {
    for (const o of linked.values()) tint(o, 0.3);
    frame(camera, controls, new THREE.Box3().setFromObject(model), 1.1);
    return { named, pickable: [model] };
  }
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
  frame(camera, controls, new THREE.Box3().setFromObject(model), 1.1);
  if (target) frame(camera, controls, new THREE.Box3().setFromObject(linked.get(target)!), 3);
  else controls.autoRotate = !reducedMotion;
  return { named, pickable: [...linked.values()] };
}

/** Frees the geometry and materials of everything in `scene`. */
export function disposeScene(scene: THREE.Scene) {
  scene.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      (o.geometry as THREE.BufferGeometry).dispose();
      const materials = (Array.isArray(o.material) ? o.material : [o.material]) as THREE.Material[];
      for (const m of materials) m.dispose();
    }
  });
}
