import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { usePlaces } from '../api/locations';
import { codeOf, createStage, disposeScene, HIT, keyOf, markUp } from './model-scene';
import type { MapEditing } from './svg-map';
import { ErrorBox } from './ui';

const CLICK_TOLERANCE_PX = 5;

/**
 * A 3D model of a place (glTF from Blender). Objects linked to places (`links`: object name →
 * code) are tinted and labelled along the path in `highlight`, the camera turns to the last of
 * them, and clicking opens a place. With `editing`, any named object can be picked instead.
 */
export default function ModelMap({
  href,
  highlight,
  links,
  title,
  editing,
  tall = false,
  attention = [],
}: {
  href: string;
  highlight: string[];
  links: Record<string, string>;
  title: string;
  editing?: MapEditing;
  /** Fill the screen height (expanded view). */
  tall?: boolean;
  /** Places to tint amber (overdue temporary places, or what holds them). */
  attention?: string[];
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
  const linksKey = JSON.stringify(links);
  const isEditing = !!editing;
  const selected = editing?.selected ?? null;
  // Picking must not rebuild the scene, so the callback and named objects live in refs.
  const onSelect = useRef(editing?.onSelect);
  const tallRef = useRef(tall);
  const refit = useRef<(() => void) | null>(null);
  useEffect(() => {
    onSelect.current = editing?.onSelect;
    tallRef.current = tall;
  });
  // Expanding may not change the width, so the size is redone explicitly.
  useEffect(() => refit.current?.(), [tall]);
  const sceneRef = useRef<{ scene: THREE.Scene; named: Map<string, THREE.Object3D> } | null>(null);

  useEffect(() => {
    const current = sceneRef.current;
    const object = selected ? current?.named.get(selected) : undefined;
    if (!current || !object) return;
    const outline = new THREE.BoxHelper(object, HIT);
    current.scene.add(outline);
    return () => {
      current.scene.remove(outline);
      outline.dispose();
    };
  }, [selected, linksKey]);

  useEffect(() => {
    const container = box.current;
    if (!container || !names) return;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const width = () => container.clientWidth || 600;
    const height = () =>
      tallRef.current
        ? Math.max(280, window.innerHeight - 120)
        : Math.min(
            480,
            Math.max(260, Math.round(width() * 0.6)),
            Math.round(window.innerHeight * 0.6),
          );

    const { renderer, labels, scene, camera, controls } = createStage(
      container,
      width(),
      height(),
      title,
    );

    let pickable: THREE.Object3D[] = [];
    let disposed = false;
    new GLTFLoader().load(
      href,
      (gltf) => {
        if (disposed) return;
        scene.add(gltf.scene);
        const marked = markUp(
          gltf.scene,
          { scene, camera, controls },
          {
            links,
            highlight,
            attention,
            names,
            isEditing,
            reducedMotion,
          },
        );
        sceneRef.current = { scene, named: marked.named };
        pickable = marked.pickable;
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
      return raycaster.intersectObjects(pickable, true)[0]?.object ?? null;
    };
    /** The picked object's name and its named ancestors', innermost first. */
    const namesUp = (object: THREE.Object3D | null) => {
      const keys: string[] = [];
      for (let o = object; o && o.parent; o = o.parent) if (keyOf(o)) keys.push(keyOf(o));
      return keys;
    };
    let downAt: { x: number; y: number } | null = null;
    const onDown = (e: PointerEvent) => (downAt = { x: e.clientX, y: e.clientY });
    const onUp = (e: PointerEvent) => {
      if (downAt && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) < CLICK_TOLERANCE_PX) {
        const hit = pick(e);
        if (isEditing) {
          const keys = namesUp(hit);
          onSelect.current?.(keys[0] ?? null, keys.slice(1));
        } else {
          const found = codeOf(hit, links);
          if (found) void navigate(`/l/${found.code}`);
        }
      }
      downAt = null;
    };
    const onMove = (e: PointerEvent) => {
      if (e.buttons !== 0) return;
      const hit = pick(e);
      const pointing = isEditing ? !!hit : !!codeOf(hit, links);
      renderer.domElement.style.cursor = pointing ? (isEditing ? 'crosshair' : 'pointer') : 'grab';
    };
    renderer.domElement.addEventListener('pointerdown', onDown);
    renderer.domElement.addEventListener('pointerup', onUp);
    renderer.domElement.addEventListener('pointermove', onMove);

    const fit = () => {
      renderer.setSize(width(), height());
      labels.setSize(width(), height());
      camera.aspect = width() / height();
      camera.updateProjectionMatrix();
    };
    refit.current = fit;
    const resize = new ResizeObserver(fit);
    resize.observe(container);

    renderer.setAnimationLoop(() => {
      controls.update();
      renderer.render(scene, camera);
      labels.render(scene, camera);
    });

    return () => {
      disposed = true;
      sceneRef.current = null;
      refit.current = null;
      renderer.setAnimationLoop(null);
      resize.disconnect();
      controls.dispose();
      disposeScene(scene);
      renderer.dispose();
      container.replaceChildren();
    };
    // Rebuild only when the model, its links or the highlighted path change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [href, highlightKey, linksKey, title, names, isEditing, attention.join(',')]);

  return (
    <div className="flex flex-col gap-1">
      <div
        ref={box}
        className="relative overflow-hidden rounded-lg border border-line bg-surface-2"
      />
      {error && <ErrorBox error={error} />}
      <p className="text-[12px] text-muted">
        {t(isEditing ? 'maps.model3dPickHint' : 'maps.model3dHint')}
      </p>
    </div>
  );
}
