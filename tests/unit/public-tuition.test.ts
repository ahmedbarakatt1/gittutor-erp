import { expect, test } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { TuitionComparison } from '../../src/components/catalog/tuition-comparison';

test('public tuition shows the owner rates and request journey without course bundles or compensation', () => {
  const html = renderToStaticMarkup(createElement(TuitionComparison));
  for (const amount of ['650', '575', '550', '500']) expect(html).toContain(amount);
  expect(html).toContain('90–105 minutes');
  expect(html).toContain('per student, per session');
  expect(html).toContain('/learn/requests');
  expect(html).not.toMatch(/450|600|625|700|725|750|tutor_fee|compensation|margin|published offers/i);
});
