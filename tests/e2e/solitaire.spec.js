const { test, expect } = require('@playwright/test');

function savedDeal() {
  const suits = ['♠', '♥', '♦', '♣'];
  const ranks = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  const cards = [];
  for (const suit of suits) {
    for (let value = 1; value <= 13; value += 1) {
      cards.push({
        suit,
        value,
        rank: ranks[value - 1],
        color: suit === '♥' || suit === '♦' ? 'red' : 'black',
        faceUp: false
      });
    }
  }
  return {
    gameNumber: 2026,
    stock: cards,
    waste: [],
    foundations: [[], [], [], []],
    tableau: [[], [], [], [], [], [], []],
    moves: 0,
    seconds: 0,
    history: [],
    solverVersion: 2
  };
}

async function prepare(page) {
  const deal = savedDeal();
  await page.addInitScript(value => {
    if (!localStorage.getItem('solitaire-save')) {
      localStorage.setItem('solitaire-save', JSON.stringify(value));
    }
  }, deal);
}

test('手機 390px 顯示完整七列與原生式底部操作列', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await prepare(page);
  await page.goto('/?e2e=mobile');

  const layout = await page.evaluate(() => {
    const piles = [...document.querySelectorAll('.tableau-pile')].map(el => el.getBoundingClientRect());
    const controls = [...document.querySelectorAll('.primary-actions button')].map(el => el.getBoundingClientRect());
    const actionsStyle = getComputedStyle(document.querySelector('.actions'));
    const actionsRect = document.querySelector('.actions').getBoundingClientRect();
    return {
      innerWidth,
      innerHeight,
      documentWidth: document.documentElement.scrollWidth,
      piles: piles.map(rect => ({ left: rect.left, right: rect.right, width: rect.width })),
      controls: controls.map(rect => ({ width: rect.width, height: rect.height })),
      actionsPosition: actionsStyle.position,
      actionsBottom: actionsStyle.bottom,
      actionsRect: { left: actionsRect.left, right: actionsRect.right, top: actionsRect.top, bottom: actionsRect.bottom }
    };
  });

  expect(layout.documentWidth).toBe(layout.innerWidth);
  expect(layout.piles).toHaveLength(7);
  expect(Math.min(...layout.piles.map(pile => pile.width))).toBeGreaterThanOrEqual(42);
  expect(Math.max(...layout.piles.map(pile => pile.right))).toBeLessThanOrEqual(390);
  expect(Math.min(...layout.piles.map(pile => pile.left))).toBeGreaterThanOrEqual(0);
  expect(layout.actionsPosition).toBe('fixed');
  expect(layout.actionsBottom).toBe('0px');
  expect(layout.actionsRect.bottom).toBeGreaterThanOrEqual(layout.innerHeight - 1);
  expect(layout.actionsRect.top).toBeGreaterThan(layout.innerHeight - 90);
  expect(layout.actionsRect.left).toBeLessThanOrEqual(1);
  expect(layout.actionsRect.right).toBeGreaterThanOrEqual(layout.innerWidth - 1);
  expect(Math.min(...layout.controls.map(control => control.width))).toBeGreaterThanOrEqual(44);
  expect(Math.min(...layout.controls.map(control => control.height))).toBeGreaterThanOrEqual(44);
  await expect(page.locator('#mobile-more-toggle')).toBeVisible();
  await expect(page.locator('#secondary-actions')).toBeHidden();
});

test('手機更多工具可展開並完整操作', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await prepare(page);
  await page.goto('/?e2e=more');

  await page.locator('#mobile-more-toggle').click();
  await expect(page.locator('#secondary-actions')).toBeVisible();
  await expect(page.locator('#stats-btn')).toBeVisible();
  await expect(page.locator('#challenge-btn')).toBeVisible();
  await expect(page.locator('#mobile-more-toggle')).toHaveAttribute('aria-expanded', 'true');

  const rightEdge = await page.locator('#secondary-actions').evaluate(el => el.getBoundingClientRect().right);
  expect(rightEdge).toBeLessThanOrEqual(390);
});

test('桌機保留完整工具列且牌桌成為主要視覺焦點', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await prepare(page);
  await page.goto('/?e2e=desktop');

  await expect(page.locator('#mobile-more-toggle')).toBeHidden();
  await expect(page.locator('#secondary-actions')).toBeVisible();
  const layout = await page.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    innerWidth,
    boardWidth: document.querySelector('.game-board').getBoundingClientRect().width,
    actionsPosition: getComputedStyle(document.querySelector('.actions')).position
  }));
  expect(layout.documentWidth).toBe(layout.innerWidth);
  expect(layout.boardWidth).toBeGreaterThanOrEqual(850);
  expect(layout.actionsPosition).not.toBe('fixed');
});

test('1280 到 3440px 桌機保持適中牌距，不因超寬螢幕無限拉開', async ({ page }) => {
  await prepare(page);
  const viewports = [
    { width: 1280, height: 900 },
    { width: 1440, height: 1000 },
    { width: 1920, height: 1080 },
    { width: 2560, height: 1295 },
    { width: 3440, height: 1440 }
  ];
  const measurements = [];

  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await page.goto(`/?e2e=balanced-${viewport.width}`);
    const layout = await page.evaluate(() => {
      const board = document.querySelector('.game-board').getBoundingClientRect();
      const topArea = document.querySelector('.top-area').getBoundingClientRect();
      const playfield = document.querySelector('.tableau').getBoundingClientRect();
      const stock = document.querySelector('#stock').getBoundingClientRect();
      const lastFoundation = document.querySelector('#foundation-3').getBoundingClientRect();
      const piles = [...document.querySelectorAll('.tableau-pile')].map(el => el.getBoundingClientRect());
      const first = piles[0];
      const last = piles[piles.length - 1];
      const gap = piles[1].left - first.right;
      return {
        viewportWidth: innerWidth,
        boardWidth: board.width,
        topAreaWidth: topArea.width,
        playfieldWidth: playfield.width,
        stockLeftDelta: stock.left - first.left,
        foundationRightDelta: lastFoundation.right - last.right,
        pileSpan: last.right - first.left,
        cardWidth: first.width,
        gap,
        gapRatio: gap / first.width,
        scrollWidth: document.documentElement.scrollWidth
      };
    });
    measurements.push(layout);

    expect.soft(layout.scrollWidth, `${viewport.width}px 不得橫向溢位`).toBe(viewport.width);
    expect.soft(layout.boardWidth, `${viewport.width}px 外框不得過窄`)
      .toBeGreaterThanOrEqual(Math.min(viewport.width * 0.82, 1800));
    expect.soft(layout.boardWidth, `${viewport.width}px 外框不得鋪滿超寬螢幕`)
      .toBeLessThanOrEqual(Math.min(viewport.width * 0.94, 2250));
    expect.soft(Math.abs(layout.topAreaWidth - layout.playfieldWidth), `${viewport.width}px 上下牌區寬度一致`)
      .toBeLessThanOrEqual(1);
    expect.soft(Math.abs(layout.stockLeftDelta), `${viewport.width}px 牌庫應對齊第一列`)
      .toBeLessThanOrEqual(1);
    expect.soft(Math.abs(layout.foundationRightDelta), `${viewport.width}px 基礎牌堆應對齊第七列`)
      .toBeLessThanOrEqual(1);
    expect.soft(layout.gapRatio, `${viewport.width}px 牌距不得太近`)
      .toBeGreaterThanOrEqual(0.26);
    expect.soft(layout.gapRatio, `${viewport.width}px 牌距不得太遠`)
      .toBeLessThanOrEqual(0.36);
    expect.soft(layout.gap, `${viewport.width}px 牌距上限`)
      .toBeLessThanOrEqual(54);
  }

  console.log('BALANCED_LAYOUT_METRICS', JSON.stringify(measurements));
});

test('2560px 桌機縮放只改變牌面，不破壞七列展開與對齊', async ({ page }) => {
  await page.setViewportSize({ width: 2560, height: 1440 });
  await prepare(page);
  await page.goto('/?e2e=wide-zoom');

  const measure = () => page.evaluate(() => {
    const piles = [...document.querySelectorAll('.tableau-pile')].map(el => el.getBoundingClientRect());
    const topArea = document.querySelector('.top-area').getBoundingClientRect();
    const tableau = document.querySelector('.tableau').getBoundingClientRect();
    return {
      cardWidth: piles[0].width,
      gap: piles[1].left - piles[0].right,
      gapRatio: (piles[1].left - piles[0].right) / piles[0].width,
      pileSpan: piles[6].right - piles[0].left,
      topAreaWidth: topArea.width,
      tableauWidth: tableau.width,
      scrollWidth: document.documentElement.scrollWidth
    };
  });

  const initial = await measure();
  expect(initial.gapRatio).toBeGreaterThanOrEqual(0.26);
  expect(initial.gapRatio).toBeLessThanOrEqual(0.36);

  await page.locator('#zoom-in').click();
  const enlarged = await measure();
  expect(enlarged.cardWidth).toBeGreaterThan(initial.cardWidth + 10);
  expect(enlarged.gap).toBeGreaterThan(initial.gap);
  expect(enlarged.gapRatio).toBeGreaterThanOrEqual(0.26);
  expect(enlarged.gapRatio).toBeLessThanOrEqual(0.36);
  expect(enlarged.pileSpan).toBeGreaterThan(initial.pileSpan);
  expect(enlarged.topAreaWidth).toBeCloseTo(enlarged.tableauWidth, 0);
  expect(enlarged.scrollWidth).toBe(2560);

  await page.locator('#zoom-out').click();
  await page.locator('#zoom-out').click();
  const reduced = await measure();
  expect(reduced.cardWidth).toBeLessThan(initial.cardWidth - 10);
  expect(reduced.gap).toBeLessThan(initial.gap);
  expect(reduced.gapRatio).toBeGreaterThanOrEqual(0.26);
  expect(reduced.gapRatio).toBeLessThanOrEqual(0.36);
  expect(reduced.pileSpan).toBeLessThan(initial.pileSpan);
  expect(reduced.scrollWidth).toBe(2560);
});

test('點選移動與復原形成完整互動鏈', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await prepare(page);
  await page.goto('/?e2e=tap');

  await page.evaluate(() => {
    const game = window.solitaire;
    const make = (suit, value) => ({
      suit,
      value,
      rank: ['A','2','3','4','5','6','7','8','9','10','J','Q','K'][value - 1],
      color: suit === '♥' || suit === '♦' ? 'red' : 'black',
      faceUp: true
    });
    game.stock = [make('♣', 2)];
    game.stock[0].faceUp = false;
    game.waste = [make('♥', 12)];
    game.foundations = [[], [], [], []];
    game.tableau = [[make('♠', 13)], [], [], [], [], [], []];
    game.history = [];
    game.moves = 0;
    game.gameWon = false;
    game.updateDisplay();
    game.updateInfo();
  });

  await page.locator('#waste .card').click();
  await expect(page.locator('#waste .card')).toHaveClass(/selected/);
  await page.locator('#tableau-0 .card').click();
  await expect(page.locator('#tableau-0 .card')).toHaveCount(2);
  await expect(page.locator('#moves')).toHaveText('1');

  await page.locator('#undo-btn').click();
  await expect(page.locator('#waste .card')).toHaveCount(1);
  await expect(page.locator('#tableau-0 .card')).toHaveCount(1);
  await expect(page.locator('#moves')).toHaveText('0');
});

test('桌機拖曳可移動合法紙牌並保留復原狀態', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await prepare(page);
  await page.goto('/?e2e=drag');

  await page.evaluate(() => {
    const make = (suit, value) => ({
      suit,
      value,
      rank: ['A','2','3','4','5','6','7','8','9','10','J','Q','K'][value - 1],
      color: suit === '♥' || suit === '♦' ? 'red' : 'black',
      faceUp: true
    });
    const game = window.solitaire;
    game.stock = [{ ...make('♣', 2), faceUp: false }];
    game.waste = [make('♥', 12)];
    game.foundations = [[], [], [], []];
    game.tableau = [[make('♠', 13)], [], [], [], [], [], []];
    game.history = [];
    game.moves = 0;
    game.updateDisplay();
    game.updateInfo();
  });

  await page.locator('#waste .card').dragTo(page.locator('#tableau-0 .card'));
  await expect(page.locator('#waste .card')).toHaveCount(0);
  await expect(page.locator('#tableau-0 .card')).toHaveCount(2);
  await expect(page.locator('#moves')).toHaveText('1');
  await expect(page.locator('#undo-btn')).toBeEnabled();
});

test('主題切換具可存續狀態與可存取名稱', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await prepare(page);
  await page.goto('/?e2e=theme');

  const button = page.locator('#theme-toggle');
  await expect(button).toHaveAttribute('aria-pressed', 'false');
  await button.click();
  await expect(button).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('body')).toHaveClass(/dark-mode/);
  await page.reload();
  await expect(page.locator('body')).toHaveClass(/dark-mode/);
  await expect(button).toHaveAttribute('aria-pressed', 'true');
});

test('對話框具備語意，且頁面沒有 JavaScript 或資源錯誤', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(`pageerror: ${error.message}`));
  page.on('console', message => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  page.on('requestfailed', request => errors.push(`request: ${request.url()} ${request.failure()?.errorText}`));
  await prepare(page);
  await page.goto('/?e2e=a11y');

  await page.locator('#stats-btn').click();
  await expect(page.locator('#stats-modal')).toHaveAttribute('role', 'dialog');
  await expect(page.locator('#stats-modal')).toHaveAttribute('aria-modal', 'true');
  await expect(page.locator('#stats-modal h2')).toHaveAttribute('id', 'stats-title');
  await expect(page.locator('#stats-close')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.locator('#stats-clear')).toBeFocused();
  expect(await page.evaluate(() => document.querySelector('#stats-modal').contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(page.locator('#stats-modal')).toHaveClass(/hidden/);
  await expect(page.locator('#stats-btn')).toBeFocused();

  expect(errors).toEqual([]);
});

test('翻三張模式會保存並在重新載入後恢復', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await prepare(page);
  await page.goto('/?e2e=draw3');

  await page.locator('#difficulty-toggle').click();
  await expect(page.locator('#difficulty-toggle')).toHaveText('翻 3');
  await expect(page.locator('#difficulty-toggle')).toHaveAttribute('aria-pressed', 'true');
  await page.waitForTimeout(650);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('solitaire-save')).drawCount)).toBe(3);

  await page.reload();
  await expect(page.locator('#difficulty-toggle')).toHaveText('翻 3');
  await expect(page.locator('#difficulty-toggle')).toHaveAttribute('aria-pressed', 'true');
});

test('指定遊戲編號不會被可解性搜尋偷偷改號', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await prepare(page);
  await page.goto('/?e2e=number');

  await page.locator('#game-number').click();
  await page.locator('#game-number-input').fill('2');
  await page.locator('#game-select-ok').click();
  await expect(page.locator('#game-number')).toHaveText('第 2 局');
  await page.waitForTimeout(650);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('solitaire-save')).gameNumber)).toBe(2);

  await page.reload();
  await expect(page.locator('#game-number')).toHaveText('第 2 局');
});

test('翻三張的廢牌中只有頂牌可操作與鍵盤聚焦', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await prepare(page);
  await page.goto('/?e2e=waste');

  await page.evaluate(() => {
    const make = (suit, value) => ({
      suit,
      value,
      rank: ['A','2','3','4','5','6','7','8','9','10','J','Q','K'][value - 1],
      color: suit === '♥' || suit === '♦' ? 'red' : 'black',
      faceUp: true
    });
    const game = window.solitaire;
    game.drawCount = 3;
    game.stock = [{ ...make('♠', 13), faceUp: false }];
    game.waste = [make('♠', 1), make('♥', 2), make('♣', 3)];
    game.updateDifficultyButton();
    game.updateDisplay();
  });

  await expect(page.locator('#waste .card')).toHaveCount(3);
  await expect(page.locator('#waste .card.covered')).toHaveCount(2);
  await expect(page.locator('#waste .card[role="button"]')).toHaveCount(1);
  await expect(page.locator('#waste .card').last()).toHaveAttribute('tabindex', '0');
});

test('鍵盤可把選取的牌移到空基礎牌堆', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await prepare(page);
  await page.goto('/?e2e=keyboard-target');

  await page.evaluate(() => {
    const ace = { suit: '♠', value: 1, rank: 'A', color: 'black', faceUp: true };
    const game = window.solitaire;
    game.stock = [{ suit: '♥', value: 13, rank: 'K', color: 'red', faceUp: false }];
    game.waste = [ace];
    game.foundations = [[], [], [], []];
    game.tableau = [[], [], [], [], [], [], []];
    game.history = [];
    game.selectedCard = null;
    game.updateDisplay();
    game.updateInfo();
  });

  await page.locator('#waste .card').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#waste .card')).toHaveClass(/selected/);
  await page.locator('#foundation-0').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#waste .card')).toHaveCount(0);
  await expect(page.locator('#foundation-0 .card')).toHaveCount(1);
});

test('手機放大後旋轉回直向會重新計算牌寬', async ({ page }) => {
  await page.setViewportSize({ width: 600, height: 390 });
  await prepare(page);
  await page.goto('/?e2e=rotate');
  await page.locator('#mobile-more-toggle').click();
  await page.locator('#zoom-in').click();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(100);
  const layout = await page.evaluate(() => {
    const piles = [...document.querySelectorAll('.tableau-pile')].map(el => el.getBoundingClientRect());
    return {
      minLeft: Math.min(...piles.map(rect => rect.left)),
      maxRight: Math.max(...piles.map(rect => rect.right)),
      width: document.querySelector('.tableau').getBoundingClientRect().width,
      cardWidth: piles[0].width,
      inlineWidth: document.documentElement.style.getPropertyValue('--card-width')
    };
  });
  expect(layout.minLeft).toBeGreaterThanOrEqual(0);
  expect(layout.maxRight).toBeLessThanOrEqual(390);
  expect(layout.cardWidth).toBeLessThan(60);
  expect(layout.inlineWidth).not.toContain('82.');
});

test('320 到 1440px 的關鍵斷點皆無橫向溢位或牌列裁切', async ({ page }) => {
  await prepare(page);
  const viewports = [
    { width: 320, height: 700 },
    { width: 390, height: 844 },
    { width: 600, height: 900 },
    { width: 768, height: 1024 },
    { width: 1024, height: 1366 },
    { width: 1440, height: 1000 }
  ];

  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await page.goto(`/?e2e=responsive-${viewport.width}`);
    const layout = await page.evaluate(() => {
      const piles = [...document.querySelectorAll('.tableau-pile')].map(el => el.getBoundingClientRect());
      const actions = document.querySelector('.actions').getBoundingClientRect();
      const buttons = [...document.querySelectorAll('.actions button')]
        .filter(el => getComputedStyle(el).display !== 'none')
        .map(el => el.getBoundingClientRect());
      return {
        width: innerWidth,
        height: innerHeight,
        scrollWidth: document.documentElement.scrollWidth,
        pileMinLeft: Math.min(...piles.map(rect => rect.left)),
        pileMaxRight: Math.max(...piles.map(rect => rect.right)),
        pileMinWidth: Math.min(...piles.map(rect => rect.width)),
        actionPosition: getComputedStyle(document.querySelector('.actions')).position,
        actionRect: { left: actions.left, right: actions.right, top: actions.top, bottom: actions.bottom },
        buttonsWithinViewport: buttons.every(rect => rect.left >= -1 && rect.right <= innerWidth + 1)
      };
    });

    expect(layout.scrollWidth, `${viewport.width}px 不得橫向溢位`).toBe(layout.width);
    expect(layout.pileMinLeft, `${viewport.width}px 左側牌列`).toBeGreaterThanOrEqual(0);
    expect(layout.pileMaxRight, `${viewport.width}px 右側牌列`).toBeLessThanOrEqual(layout.width);
    expect(layout.buttonsWithinViewport, `${viewport.width}px 工具按鈕`).toBe(true);
    if (viewport.width <= 600) {
      expect(layout.pileMinWidth, `${viewport.width}px 牌寬`).toBeGreaterThanOrEqual(viewport.width === 320 ? 44 : 40);
      expect(layout.actionPosition).toBe('fixed');
      expect(layout.actionRect.left).toBeLessThanOrEqual(1);
      expect(layout.actionRect.right).toBeGreaterThanOrEqual(layout.width - 1);
      expect(layout.actionRect.top).toBeGreaterThan(layout.height - 90);
    } else {
      expect(layout.actionPosition).not.toBe('fixed');
    }
  }
});
