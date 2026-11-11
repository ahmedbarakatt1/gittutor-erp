import json
from pathlib import Path

path = Path('.img2threejs/assessment.json')
data = json.loads(path.read_text(encoding='utf-8'))
assessment = data['preSpecAssessment']
assessment['objectClass'] = {
    'primaryType': 'stepped limestone pyramid', 'primaryDomain': 'object',
    'formLanguage': ['architectural', 'hard-surface'],
    'structureKind': ['repeated modules'], 'motionPotential': ['static prop'],
    'materialFamilies': ['stone'],
    'notes': 'Bounded stylized miniature of the visible Khufu pyramid; hidden sides inferred by fourfold symmetry.'
}
assessment['complexity']['scores'] = dict(zip(assessment['complexity']['scores'], [1, 1, 1, 1, 1, 1, 1, 0]))
assessment['complexity']['estimatedCounts'] = {'macroComponents': 1, 'mesoComponents': 18, 'microFeatureGroups': 3, 'materialLayers': 1, 'repetitionSystems': 1}
assessment['complexity']['reasoning'] = ['Simple square-base macro form; 18 stepped courses preserve exposed masonry at footer scale.']
assessment['specDepthDecision']['rationale'] = 'Simple stylized architectural accent; macro slope and course rhythm are the quality target, not survey detail.'
assessment['unknownsToResolveBeforeImplementation'] = ['Rear masonry inferred by symmetry; individual stones and entrances omitted as documented stylization.']
details = [
    ('square-footprint', 'Square foundation footprint', 'root'),
    ('height-ratio', 'Height 0.63 of base width', 'root'),
    ('four-faces', 'Four converging triangular face envelope', 'root'),
    ('course-rhythm', '18 stepped horizontal courses', 'root'),
    ('flat-apex', 'Small flattened apex instead of perfect point', 'root'),
    ('base-contact', 'Bottom course contacts ground without floating', 'root'),
    ('matte-stone', 'Nonmetallic matte limestone', 'stone'),
    ('warm-albedo', 'Warm beige limestone albedo', 'stone'),
    ('course-variation', 'Subtle deterministic per-course stone value variation', 'stone'),
]
assessment['detailInventory']['targetMinDetails'] = 9
assessment['detailInventory']['details'] = [
    {'id': key, 'description': desc, 'componentId': target if target == 'root' else 'root',
     'materialId': 'stone', 'importance': 'critical' if i < 5 else 'important',
     'evidenceRefs': ['full-object'], 'confidence': 0.9, 'mappedTo': 'componentTree.root.localFeatures' if target == 'root' else 'materials.stone.localOverrides'}
    for i, (key, desc, target) in enumerate(details)
]
data['qualityContract']['definitionOfDone'] = ['Square-based stepped limestone pyramid readable at 240x180 CSS pixels.', 'Height/base ratio 0.63, flat apex and flush course contacts.', 'Matte beige stone with no metallic highlight, no texture fetches, no animation loop.']
data['qualityContract']['minimumSpecDepth'].update({'mesoComponents': 0, 'microFeatureGroups': 0, 'repetitionSystems': 0, 'reviewViewpoints': 4})
path.write_text(json.dumps(data, indent=2), encoding='utf-8')
