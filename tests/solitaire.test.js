const test = require('node:test');
const assert = require('node:assert/strict');
const { loadSolitaire, makeGame, card, element } = require('./helpers/load-solitaire');

const { Solitaire, sandbox, document, storage } = loadSolitaire();

test('單擊牌面可選取可移動的牌，再點目的牌堆完成移動', () => {
  const game = makeGame(Solitaire, {
    waste: [card('♥', 12)],
    tableau: [[card('♠', 13)], [], [], [], [], [], []],
    selectedCard: null,
    wasteEl: element(),
    tableauEls: Array.from({ length: 7 }, () => element()),
    foundationEls: Array.from({ length: 4 }, () => element())
  });
  const queenEl = element({
    dataset: { source: 'waste', cardIndex: '0' },
    closest(selector) { return selector === '.card' ? this : null; }
  });
  const kingEl = element({
    dataset: { source: 'tableau', pileIndex: '0', cardIndex: '0' },
    closest(selector) { return selector === '.card' ? this : null; }
  });

  game.handleCardClick({ target: queenEl });
  assert.equal(game.selectedCard.card.rank, 'Q');
  game.handleCardClick({ target: kingEl });

  assert.equal(game.waste.length, 0);
  assert.deepEqual(game.tableau[0].map(item => item.rank), ['K', 'Q']);
  assert.equal(game.moves, 1);
});

test('空牌庫與空廢牌堆點擊是純粹無動作，不建立復原紀錄', () => {
  const game = makeGame(Solitaire);
  game.drawFromStock();
  assert.equal(game.history.length, 0);
  assert.equal(game.moves, 0);
});

test('基礎牌堆依畫面花色固定，不允許紅心 A 放到黑桃欄', () => {
  const game = makeGame(Solitaire);
  const heartAce = card('♥', 1);
  assert.equal(game.canPlaceOnFoundation(heartAce, 0), false);
  assert.equal(game.canPlaceOnFoundation(heartAce, 1), true);
});

test('同一勝利狀態重複檢查不會重複記錄勝場或啟動動畫', async () => {
  let wins = 0;
  let animations = 0;
  const game = makeGame(Solitaire, {
    foundations: ['♠', '♥', '♦', '♣'].map(suit => Array.from({ length: 13 }, (_, i) => card(suit, i + 1))),
    timerInterval: null,
    recordWin() { wins += 1; },
    playWinAnimation() { animations += 1; return Promise.resolve(); },
    formatTime: Solitaire.prototype.formatTime
  });

  game.checkWin();
  game.checkWin();
  await Promise.resolve();

  assert.equal(wins, 1);
  assert.equal(animations, 1);
});

test('自動恢復會拒絕結構損壞或重複牌的存檔', () => {
  const duplicate = card('♠', 1);
  const corrupt = {
    gameNumber: 1,
    stock: [duplicate, duplicate],
    waste: [],
    foundations: [[], [], [], []],
    tableau: [[], [], [], [], [], [], []],
    moves: 0,
    seconds: 0,
    history: [],
    solverVersion: 2
  };
  storage.set('solitaire-save', JSON.stringify(corrupt));
  const game = makeGame(Solitaire, {
    SOLVER_SAVE_VERSION: 2,
    updateDisplay() { throw new Error('損壞存檔不應進入畫面'); }
  });

  assert.equal(game.autoRestore(), false);
  assert.equal(storage.has('solitaire-save'), false);
});

test('合法牌局存檔必須恰好包含 52 張不重複的標準牌', () => {
  const cards = [];
  for (const suit of ['♠', '♥', '♦', '♣']) {
    for (let value = 1; value <= 13; value += 1) cards.push(card(suit, value, false));
  }
  const game = makeGame(Solitaire);
  assert.equal(game.isValidSaveData({
    stock: cards,
    waste: [],
    foundations: [[], [], [], []],
    tableau: [[], [], [], [], [], [], []],
    gameNumber: 123,
    moves: 5,
    seconds: 9
  }), true);
});

test('計時格式能處理超過一小時且不產生負數', () => {
  const game = makeGame(Solitaire);
  assert.equal(game.formatTime(3661), '61:01');
  assert.equal(game.formatTime(-5), '00:00');
});

test('翻三張時，雙擊廢牌中層不會刪錯頂牌或複製紙牌', () => {
  const ace = card('♠', 1);
  const queen = card('♥', 12);
  const game = makeGame(Solitaire, {
    drawCount: 3,
    waste: [ace, queen]
  });

  const moved = game.tryAutoMoveToFoundation({ source: 'waste', cardIndex: 0, card: ace });

  assert.equal(moved, false);
  assert.deepEqual(game.waste.map(item => item.rank), ['A', 'Q']);
  assert.equal(game.foundations.flat().length, 0);
});

test('基礎牌堆頂牌可以回移時不可誤判為死局', () => {
  const game = makeGame(Solitaire, {
    foundations: [[card('♠', 1)], [], [], []],
    tableau: [[card('♥', 2)], [], [], [], [], [], []]
  });

  assert.equal(game.hasAnyLegalMove(), true);
});

test('翻三張只檢查循環中真正能成為廢牌頂牌的牌', () => {
  const game = makeGame(Solitaire, {
    drawCount: 3,
    stock: [card('♣', 9, false), card('♠', 1, false), card('♣', 8, false)]
  });

  assert.deepEqual(Array.from(game.getReachableStockCards(), item => item.rank), ['9']);
  assert.equal(game.hasAnyLegalMove(), false);
});

test('自動存檔與恢復會保留翻一張或翻三張模式', () => {
  const cards = [];
  for (const suit of ['♠', '♥', '♦', '♣']) {
    for (let value = 1; value <= 13; value += 1) cards.push(card(suit, value, false));
  }
  const game = makeGame(Solitaire, {
    gameNumber: 2026,
    drawCount: 3,
    stock: cards,
    SOLVER_SAVE_VERSION: 2,
    history: [],
    _autoSaveTimer: null
  });
  game._writeAutoSave();
  const saved = JSON.parse(storage.get('solitaire-save'));
  assert.equal(saved.drawCount, 3);

  const restored = makeGame(Solitaire, {
    drawCount: 1,
    SOLVER_SAVE_VERSION: 2,
    updateDisplay() {},
    updateInfo() {},
    updateGameNumber() {}
  });
  assert.equal(restored.autoRestore(), true);
  assert.equal(restored.drawCount, 3);
  clearInterval(restored.timerInterval);
});

test('勝利動畫在減少動態效果模式下不破壞已完成牌局', async () => {
  const previousMatchMedia = sandbox.window.matchMedia;
  sandbox.window.matchMedia = () => ({ matches: true });
  const game = makeGame(Solitaire, {
    foundations: ['♠', '♥', '♦', '♣'].map(suit => Array.from({ length: 13 }, (_, i) => card(suit, i + 1))),
    renderFoundations() {}
  });

  await game.playWinAnimation();

  assert.deepEqual(game.foundations.map(pile => pile.length), [13, 13, 13, 13]);
  sandbox.window.matchMedia = previousMatchMedia;
});

test('恢復合法牌局時會丟棄結構損壞的復原紀錄', () => {
  const cards = [];
  for (const suit of ['♠', '♥', '♦', '♣']) {
    for (let value = 1; value <= 13; value += 1) cards.push(card(suit, value, false));
  }
  storage.set('solitaire-save', JSON.stringify({
    gameNumber: 2026,
    dealSeed: 2026,
    drawCount: 1,
    stock: cards,
    waste: [],
    foundations: [[], [], [], []],
    tableau: [[], [], [], [], [], [], []],
    moves: 0,
    seconds: 0,
    history: [{ stock: [], waste: [], foundations: [[], [], [], []], tableau: [[], [], [], [], [], [], []], moves: 0 }],
    solverVersion: 2
  }));
  const game = makeGame(Solitaire, {
    SOLVER_SAVE_VERSION: 2,
    updateDisplay() {},
    updateInfo() {},
    updateGameNumber() {}
  });

  assert.equal(game.autoRestore(), true);
  assert.equal(game.history.length, 0);
  clearInterval(game.timerInterval);
});

test('輸入的遊戲編號保持穩定且會映射到同一副已驗證牌局', () => {
  const game = makeGame(Solitaire, { gameNumber: 2, drawCount: 1 });
  game.ensureSolvable();
  const first = JSON.stringify({ stock: game.stock, tableau: game.tableau });
  assert.equal(game.gameNumber, 2);

  const replay = makeGame(Solitaire, { gameNumber: 2, drawCount: 1 });
  replay.ensureSolvable();
  assert.equal(replay.gameNumber, 2);
  assert.equal(JSON.stringify({ stock: replay.stock, tableau: replay.tableau }), first);
});

test('勝利後復原會解除勝利鎖並恢復計時', () => {
  const game = makeGame(Solitaire, {
    gameWon: true,
    timerInterval: null,
    history: [{
      stock: [card('♠', 1, false)],
      waste: [],
      foundations: [[], [], [], []],
      tableau: [[], [], [], [], [], [], []],
      moves: 8
    }]
  });

  game.undo();

  assert.equal(game.gameWon, false);
  assert.equal(game.moves, 8);
  assert.ok(game.timerInterval);
  clearInterval(game.timerInterval);
});

test('翻牌或回收牌庫會清除舊選牌，不能把不存在的牌移進牌桌', () => {
  const queen = card('♥', 12);
  const game = makeGame(Solitaire, {
    stock: [],
    waste: [queen],
    tableau: [[card('♠', 13)], [], [], [], [], [], []],
    selectedCard: { source: 'waste', cardIndex: 0, card: queen }
  });

  game.drawFromStock();

  assert.equal(game.selectedCard, null);
  assert.deepEqual(game.stock.map(item => item.rank), ['Q']);
  assert.deepEqual(game.tableau[0].map(item => item.rank), ['K']);
});

test('自動完成動畫途中復原會取消舊流程，不會複製同一張牌', async () => {
  let releaseAnimation;
  const animationGate = new Promise(resolve => { releaseAnimation = resolve; });
  const ace = card('♠', 1);
  const game = makeGame(Solitaire, {
    stock: [],
    waste: [],
    foundations: [[], [], [], []],
    tableau: [[ace], [], [], [], [], [], []],
    animateCardToFoundation: () => animationGate,
    renderFoundations() {}
  });

  game.autoComplete();
  assert.equal(game.history.length, 1);
  game.undo();
  releaseAnimation();
  await new Promise(resolve => setTimeout(resolve, 0));

  const allCards = [...game.stock, ...game.waste, ...game.foundations.flat(), ...game.tableau.flat()];
  assert.equal(allCards.length, 1);
  assert.equal(new Set(allCards.map(item => `${item.suit}:${item.value}`)).size, 1);
  assert.deepEqual(game.tableau[0].map(item => item.rank), ['A']);
  assert.deepEqual(game.foundations[0], []);
  assert.equal(game.isAutoCompleting, false);
});

test('勝利動畫途中開始新局不會在新局顯示舊勝利視窗', async () => {
  let releaseAnimation;
  let shown = 0;
  const animationGate = new Promise(resolve => { releaseAnimation = resolve; });
  const game = makeGame(Solitaire, {
    gameRunId: 7,
    foundations: ['♠', '♥', '♦', '♣'].map(suit => Array.from({ length: 13 }, (_, i) => card(suit, i + 1))),
    recordWin() {},
    playWinAnimation: () => animationGate,
    showModal() { shown += 1; }
  });

  game.checkWin();
  game.gameRunId += 1;
  game.gameWon = false;
  releaseAnimation();
  await new Promise(resolve => setTimeout(resolve, 0));

  assert.equal(shown, 0);
});
