import { expect, test } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { TuitionComparison } from '../../src/components/catalog/tuition-comparison';
import { tuition } from '../../src/modules/catalog/public-tuition';

test('Arabic pricing displays each current customer price and duration in Egyptian Arabic', () => {
  const html = renderToStaticMarkup(TuitionComparison({ language: 'ar' }));
  const numbers = new Intl.NumberFormat('ar-EG');
  for (const tier of tuition.tiers) expect(html).toContain(numbers.format(tier.price_minor / 100));
  expect(html).toContain(numbers.format(tuition.duration_minutes_min));
  expect(html).toContain(numbers.format(tuition.duration_minutes_max));
  expect(html).toContain('للطالب في الحصة الواحدة');
  expect(html).toContain('/learn/requests');
  expect(html).not.toMatch(/tutor_fee|compensation|margin/);
});

test('public tuition shows the owner rates and request journey without course bundles or compensation', () => {
  const html = renderToStaticMarkup(createElement(TuitionComparison));
  for (const amount of ['650', '575', '550', '500']) expect(html).toContain(amount);
  expect(html).toContain('90–105 minutes');
  expect(html).toContain('per student, per session');
  expect(html).toContain('/learn/requests');
  expect(html).not.toMatch(/450|600|625|700|725|750|tutor_fee|compensation|margin|published offers/i);
});
