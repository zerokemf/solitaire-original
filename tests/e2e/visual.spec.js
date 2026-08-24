const { test, expect } = require('@playwright/test');

const targets = [
  { name: 'desktop', width: 1440, height: 1000 },
  { name: 'wide-desktop', width: 2560, height: 1295 },
  { name: 'ultrawide', width: 3440, height: 1440 },
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

test('擷取經典破關反彈動畫中段畫面', async ({ page }, testInfo) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/?visual=classic-win-animation');
  await page.evaluate(() => {
    const suits = ['♠', '♥', '♦', '♣'];
    const ranks = ['A','2','3','4','5','6','7','8','9','10','J','Q','K'];
    const game = window.solitaire;
    game.stock = [];
    game.waste = [];
    game.tableau = [[], [], [], [], [], [], []];
    game.foundations = suits.map(suit => ranks.map((rank, index) => ({
      suit,
      rank,
      value: index + 1,
      color: suit === '♥' || suit === '♦' ? 'red' : 'black',
      faceUp: true
    })));
    game.gameWon = false;
    game.winAnimationSpeed = 1;
    game.renderFoundations();
    game.checkWin();
  });

  await page.waitForFunction(() => Number(document.querySelector('.win-animation-container')?.dataset.launched || 0) >= 16);
  await page.waitForFunction(() => Number(document.querySelector('.win-animation-container')?.dataset.bounces || 0) >= 1);
  const screenshotPath = testInfo.outputPath('classic-win-animation.png');
  await page.screenshot({ path: screenshotPath, fullPage: false });
  await testInfo.attach('classic-win-animation', { path: screenshotPath, contentType: 'image/png' });
  expect(await page.locator('.falling-card').count()).toBeGreaterThanOrEqual(16);
  expect(errors).toEqual([]);
  await page.evaluate(() => window.solitaire.newGame(2026));
});
