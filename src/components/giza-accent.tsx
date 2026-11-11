'use client';

import { useEffect, useRef } from 'react';

export function GizaAccent() {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    let disposed = false;
    let cleanup: (() => void) | undefined;
    const observer = new IntersectionObserver(async (entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      try {
      const [THREE, { createGizaAccentModel }] = await Promise.all([import('three'), import('./giza-model')]);
      if (disposed) return;
      let renderer: InstanceType<typeof THREE.WebGLRenderer>;
      try {
        renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'low-power' });
      } catch {
        element.dataset.renderState = 'unavailable';
        return;
      }
      cleanup = () => {
        renderer.dispose();
        renderer.forceContextLoss();
        renderer.domElement.remove();
      };
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
      renderer.setSize(240, 180, false);
      renderer.setClearColor(0xf8f6ef, 0);
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      const scene = new THREE.Scene();
      const camera = new THREE.OrthographicCamera(-1.65, 1.65, 1.2375, -1.2375, 0.1, 20);
      camera.position.set(3, 1.75, 4);
      camera.lookAt(0, 0.58, 0);
      scene.add(new THREE.HemisphereLight(0xfff5df, 0x8d7751, 2.2));
      const key = new THREE.DirectionalLight(0xfff5df, 3.2);
      key.position.set(-3, 6, 4);
      scene.add(key);
      const model = createGizaAccentModel();
      const releaseRenderer = cleanup;
      cleanup = () => { model.dispose(); releaseRenderer(); };
      scene.add(model.root);
      renderer.domElement.setAttribute('data-testid', 'giza-canvas');
      element.appendChild(renderer.domElement);
      renderer.render(scene, camera);
      element.dataset.renderState = 'ready';

      // No animation loop or input listeners. Review hook is eliminated in production.
      if (process.env.NODE_ENV === 'development') {
        const review = {
          azimuth: (degrees: number) => { model.root.rotation.y = degrees * Math.PI / 180; renderer.render(scene, camera); },
          parts: () => Object.values(model.parts).map((part) => ({ name: part.name, position: part.position.toArray(), scale: part.scale.toArray() })),
          triangles: renderer.info.render.triangles,
        };
        Object.assign(element, { gizaReview: review });
      }
      } catch {
        cleanup?.();
        if (!disposed) element.dataset.renderState = 'unavailable';
      }
    }, { rootMargin: '100px' });
    observer.observe(element);
    return () => { disposed = true; observer.disconnect(); cleanup?.(); };
  }, []);

  return <div className="giza-accent" ref={host} aria-hidden="true" data-render-state="waiting" />;
}
