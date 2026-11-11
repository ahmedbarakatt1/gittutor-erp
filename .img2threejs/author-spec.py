import copy
import json
from pathlib import Path

root = Path('.img2threejs')
spec = json.loads((root / 'giza-sculpt-spec.json').read_text(encoding='utf-8'))
assessment = json.loads((root / 'assessment.json').read_text(encoding='utf-8'))
spec['preSpecAssessment'] = assessment['preSpecAssessment']
spec['preSpecAssessment']['unknownsToResolveBeforeImplementation'] = []
for detail in spec['preSpecAssessment']['detailInventory']['details']:
    detail['kind'] = 'ridge' if detail['id'] == 'course-rhythm' else 'contour'
    detail['mapsTo'] = {'type': 'component.localFeatures', 'ref': f'root/{detail["id"]}'}
spec['qualityContract'] = assessment['qualityContract']
spec['localSpecSearch'] = assessment['localSpecSearch']
spec['suitability'] = 'conditional'
spec['silhouette'] = {'boundingShape': 'Square footprint with four converging stepped faces and truncated apex', 'aspectRatios': ['height/base width 0.63'], 'symmetry': 'fourfold around Y', 'dominantCurves': [], 'negativeSpaces': [], 'landmarks': ['square base', 'four corners', 'flattened apex']}
spec['assumptions'] = ['Hidden faces inferred from square symmetry.', '18 courses stand in for fine masonry at 240x180px; not survey-accurate.']
spec['viewEvidence'][0]['observations'] = ['Square base, approximately 0.63 height/base ratio, stepped limestone courses, truncated apex.']
spec['viewEvidence'][0]['confidence'] = 0.95
spec['performanceBudget'].update({'qualityPriority': 'bounded-stylized-accent', 'targetTriangles': 6000, 'maxDrawCalls': 24, 'textureSize': 128, 'fpsTarget': 30})
spec['qualityTargets']['reviewViewpoints'] = ['front-oblique', 'right', 'rear', 'left']
spec['referenceCamera'].update({'aspect': 1.3333, 'positionHint': [3.0, 2.0, 4.0], 'note': 'Oblique orthographic miniature; not a camera-matched photogrammetry reconstruction.'})
template = copy.deepcopy(spec['componentTree'][0])
components = []
for index in range(18):
    component = copy.deepcopy(template)
    component['id'] = 'root' if index == 0 else f'course-{index:02}'
    component['name'] = f'Limestone course {index + 1}'
    component['level'] = 'macro' if index == 0 else 'meso'
    component['parent'] = None if index == 0 else 'root'
    component['topologyRationale'] = 'Rigid square masonry course; assembled solid with countable planar faces.'
    component['dimensions'].update({'width': 2 * (1 - index / 18), 'height': 0.0701, 'depth': 2 * (1 - index / 18), 'confidence': 0.95})
    component['transform']['position'] = [0, 0.035 if index == 0 else index * 0.07, 0]
    component['confidence'] = 0.95
    component['colorMaterialRecipe'] = {'dominantAlbedo': 'rgba(198, 172, 120, 1)', 'secondaryAlbedo': 'rgba(184, 158, 109, 1)', 'materialClass': 'stone', 'materialClassConfidence': 0.95, 'evidenceRefs': ['full-object']}
    component['fidelityTier'] = 'blockout'
    component['geometryDescriptor']['topologyIntent'] = 'Square solid course, stepped in from preceding course equally on four sides'
    component['localFeatures'] = [{'id': f'{component["id"]}-stepped-course', 'name': 'Square stepped masonry course', 'type': 'geometric-course', 'description': 'Flush base, parallel top, constant 0.07 rise, decreasing square footprint', 'evidenceRefs': ['full-object'], 'confidence': 0.95}]
    if index > 0:
        component['attachment'] = {'parentSocket': 'stack-center', 'contactType': 'flush-stack', 'localStart': [0, index * 0.07 - 0.035, 0], 'localEnd': [0, index * 0.07 + 0.035, 0], 'embedDepth': 0.0001, 'overlap': 0.0001, 'gapTolerance': 0.0001}
    component['actionProfile']['destruction']['breakable'] = False
    component['actionProfile']['pivot']['confidence'] = 0.95
    components.append(component)
components[0]['actionProfile']['sockets'] = [{'id': 'stack-center', 'position': [0, 0.035, 0], 'rotation': [0, 0, 0], 'purpose': 'Course stack axis'}]
components[0]['localFeatures'] += [{'id': d['id'], 'name': d['description'], 'type': 'observed-feature', 'description': d['description'], 'evidenceRefs': ['full-object'], 'confidence': 0.9} for d in assessment['preSpecAssessment']['detailInventory']['details']]
spec['componentTree'] = components
for build_pass in spec['buildPasses']:
    build_pass['componentRefs'] = [c['id'] for c in components]
spec['materials'][0]['name'] = 'Matte limestone'
spec['materials'][0]['color'] = '#C6AC78'
spec['materials'][0]['baseColor'] = '#C6AC78'
spec['materials'][0]['roughness']['base'] = 0.95
spec['materials'][0]['textureResolution'] = 1024
spec['materials'][0]['notes'] = 'Bounded stylization: matte limestone, no photo texture; exact granular masonry texture not claimed.'
spec['materials'][0]['albedo'].update({'dominant': '#C6AC78', 'secondary': ['#B89E6D', '#D4BD91'], 'samplingNotes': 'Warm beige observed; directional shadow excluded from albedo.'})
spec['materials'][0]['localOverrides'] = [{'id': 'course-variation', 'description': 'Subtle warm beige stone variation, matte finish', 'mask': 'procedural-course', 'evidenceRefs': ['full-object']}]
spec['featureReviewTargets'][0].update({'id': 'giza-silhouette', 'name': 'Square base, four converging faces, 0.63 ratio and truncated apex'})
spec['featureReviewTargets'][1].update({'id': 'giza-courses', 'name': 'Masonry course rhythm and flush contact'})
spec['featureReviewTargets'][2].update({'id': 'giza-limestone', 'name': 'Matte warm limestone with visible step shading'})
spec['lightingFromPhoto'] = ['Key light from upper front left, warm daylight, directional intensity 3.', 'Fill light hemisphere ivory/stone intensity 2.', 'Exposure 1, ACES filmic tone mapping, transparent canvas over ivory background.', 'Contact shadow via ambient occlusion at course joints; no unsupported ground mesh.']
(root / 'giza-sculpt-spec.json').write_text(json.dumps(spec, indent=2), encoding='utf-8')
