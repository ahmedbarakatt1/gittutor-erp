import { expect, test } from '@playwright/test';

const channels = [
  { name: 'WhatsApp', href: 'https://wa.me/201508823452', icon: 'whatsapp' },
  { name: 'Instagram', href: 'https://www.instagram.com/gittutor/', icon: 'instagram' },
  { name: 'TikTok', href: 'https://www.tiktok.com/@gittutor', icon: 'tiktok' },
  { name: 'Call us +20 15 08823452', href: 'tel:+201508823452', icon: 'telephone' },
];

test('public contact links show their app icons, names and destinations', async ({ page }) => {
  for (const path of ['/', '/subjects', '/support']) {
    await page.goto(path);
    const contacts = page.getByRole('group', { name: 'Contact Git Tutor' });
    for (const { name, href, icon } of channels) {
      const link = contacts.getByRole('link', { name, exact: true });
      await expect(link).toBeVisible();
      await expect(link).toHaveAttribute('href', href);
      const mark = link.locator('svg[aria-hidden="true"] use');
      await expect(mark).toHaveAttribute('href', `/brand/contact-icons.svg#${icon}`);
      await expect.poll(() => mark.evaluate(element => (element as SVGUseElement).getBBox().width)).toBeGreaterThan(0);
      await link.focus();
      await expect(link).toBeFocused();
      const bounds = await link.boundingBox();
      expect(bounds!.height).toBeGreaterThanOrEqual(44);
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
    }
    if (path === '/subjects') {
      const action = page.getByRole('link', { name: 'Ask us on WhatsApp', exact: true });
      await expect(action).toHaveAttribute('href', channels[0].href);
      await expect(action.locator('svg[aria-hidden="true"] use')).toHaveAttribute('href', '/brand/contact-icons.svg#whatsapp');
    }
  }
});
