const { test, expect } = require('@playwright/test');

const targets = [
  { name: 'desktop', width: 1440, height: 1000 },
  { name: 'ipad', width: 1024, height: 1366 },
  { name: 'mobile', width: 390, height: 844 }
];

for (const target of targets) {
  test(`擷取 ${target.name} 發布候選畫面`, async ({ page }, testInfo) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.setViewportSize({ width: target.width, height: target.height });
    await page.goto(`/?visual=${target.name}`);
    const screenshotPath = testInfo.outputPath(`${target.name}.png`);
    await page.screenshot({
      path: screenshotPath,
      fullPage: false
    });
    await testInfo.attach(`${target.name}-release-candidate`, {
      path: screenshotPath,
      contentType: 'image/png'
    });
    expect(errors).toEqual([]);
  });
}
