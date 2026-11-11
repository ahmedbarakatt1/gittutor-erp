import { BoxGeometry, Group, Mesh, MeshStandardMaterial, Vector3 } from 'three';

// Typed runtime projection of .img2threejs/giza-sculpt-spec.json.
// Stylized Khufu pyramid, based on Nina Aldin Thune's CC BY 2.5 reference.
// This is an architectural accent, not an archaeological reconstruction.
export const gizaModelSpec = {
  courses: 18,
  baseWidth: 2,
  courseRise: 0.07,
  courseThickness: 0.0701,
  stoneColor: '#c6ac78',
  roughness: 0.95,
  maxTriangles: 6000,
} as const;

export function createGizaAccentModel() {
  const root = new Group();
  root.name = 'giza-pyramid-accent';
  const geometry = new BoxGeometry(1, 1, 1);
  const material = new MeshStandardMaterial({ color: gizaModelSpec.stoneColor, roughness: gizaModelSpec.roughness, metalness: 0 });
  const parts: Record<string, Mesh<BoxGeometry, MeshStandardMaterial>> = {};

  for (let index = 0; index < gizaModelSpec.courses; index += 1) {
    const part = new Mesh(geometry, material);
    const width = gizaModelSpec.baseWidth * (1 - index / gizaModelSpec.courses);
    part.name = index === 0 ? 'root' : `course-${String(index).padStart(2, '0')}`;
    part.scale.set(width, gizaModelSpec.courseThickness, width);
    part.position.set(0, gizaModelSpec.courseRise * (index + 0.5), 0);
    part.userData.restPosition = part.position.clone();
    part.userData.partId = part.name;
    root.add(part);
    parts[part.name] = part;
  }

  root.userData.sculptRuntime = {
    nodes: parts,
    meshes: parts,
    sockets: { 'stack-center': new Vector3(0, 0.035, 0) },
    colliders: { bounds: { width: 2, height: 1.26005, depth: 2 } },
    destructionGroups: { courses: Object.values(parts) },
    // Shared part identity supports inspection/explode without adding website controls.
    setExplode: (amount: number) => {
      const clamped = Math.min(1, Math.max(0, amount));
      Object.values(parts).forEach((part) => {
        const rest = part.userData.restPosition as Vector3;
        part.position.copy(rest).multiplyScalar(1 + clamped);
      });
    },
  };

  return { root, parts, dispose: () => { geometry.dispose(); material.dispose(); } };
}
