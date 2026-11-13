import{expect,test}from'@playwright/test';
// Explicit UI-only fixture. Real ownership/SQL checks remain tests/integration/support.test.ts.
test('support entry is responsive and preserves a failed session retry',async({page},info)=>{
 await page.route('**/api/v1/support/session',r=>r.fulfill({status:503,contentType:'application/json',body:JSON.stringify({code:'DEPENDENCY_UNAVAILABLE'})}));
 await page.goto('/support');await expect(page.getByRole('heading',{name:'Let’s work it out.'})).toBeVisible();await page.getByRole('button',{name:'Start a conversation',exact:true}).click();await expect(page.getByRole('alert').filter({hasText:'Support could not connect'})).toContainText('Support could not connect');await expect(page.getByRole('button',{name:'Start a conversation',exact:true})).toBeEnabled();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await expect(page.locator('a[href="https://wa.me/201508823452"]')).toBeVisible();await page.screenshot({path:`.local/screenshots/t11-support-entry-${info.project.name}.png`,fullPage:true});
});
