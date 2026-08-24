const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function classList() {
  const values = new Set();
  return {
    add: (...items) => items.forEach(item => values.add(item)),
    remove: (...items) => items.forEach(item => values.delete(item)),
    toggle: (item, force) => {
      const next = force === undefined ? !values.has(item) : Boolean(force);
      if (next) values.add(item); else values.delete(item);
      return next;
    },
    contains: item => values.has(item)
  };
}

function element(overrides = {}) {
  const attributes = new Map();
  return {
    textContent: '',
    innerHTML: '',
    value: '',
    disabled: false,
    dataset: {},
    style: {},
    classList: classList(),
    children: [],
    lastElementChild: null,
    addEventListener() {},
    querySelector() { return null; },
    querySelectorAll() { return []; },
    setAttribute(name, value) { attributes.set(name, String(value)); },
    getAttribute(name) { return attributes.has(name) ? attributes.get(name) : null; },
    removeAttribute(name) { attributes.delete(name); },
    appendChild(child) { this.children.push(child); this.lastElementChild = child; },
    remove() {},
    closest() { return null; },
    focus() {},
    getBoundingClientRect() { return { left: 0, top: 0, width: 80, height: 112 }; },
    ...overrides
  };
}

function loadSolitaire({ storage = new Map() } = {}) {
  const elements = new Map();
  const document = {
    body: element(),
    documentElement: element(),
    addEventListener() {},
    querySelector() { return null; },
    querySelectorAll() { return []; },
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, element({ id }));
      return elements.get(id);
    },
    createElement() { return element(); },
    createDocumentFragment() { return element(); },
    elementFromPoint() { return null; }
  };

  const localStorage = {
    getItem(key) { return storage.has(key) ? storage.get(key) : null; },
    setItem(key, value) { storage.set(key, String(value)); },
    removeItem(key) { storage.delete(key); }
  };

  const sandbox = {
    console,
    document,
    localStorage,
    window: {
      innerWidth: 1440,
      innerHeight: 900,
      matchMedia: () => ({ matches: false }),
      addEventListener() {},
      AudioContext: function AudioContext() {}
    },
    performance: { now: () => 0 },
    requestAnimationFrame: callback => callback(0),
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    confirm: () => true,
    alert() {}
  };
  sandbox.window.webkitAudioContext = sandbox.window.AudioContext;

  const sourcePath = path.join(__dirname, '..', '..', 'game.js');
  const source = `${fs.readFileSync(sourcePath, 'utf8')}\n;this.__exports = { Solitaire };`;
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: sourcePath });

  return { Solitaire: sandbox.__exports.Solitaire, sandbox, document, elements, storage };
}

function card(suit, value, faceUp = true) {
  const ranks = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  return {
    suit,
    value,
    rank: ranks[value - 1],
    color: suit === '♥' || suit === '♦' ? 'red' : 'black',
    faceUp
  };
}

function makeGame(Solitaire, overrides = {}) {
  return Object.assign(Object.create(Solitaire.prototype), {
    suits: ['♠', '♥', '♦', '♣'],
    ranks: ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'],
    suitColors: { '♠': 'black', '♥': 'red', '♦': 'red', '♣': 'black' },
    MIN_GAME: 1,
    MAX_GAME: 32000,
    stock: [],
    waste: [],
    foundations: [[], [], [], []],
    tableau: [[], [], [], [], [], [], []],
    history: [],
    moves: 0,
    seconds: 0,
    drawCount: 1,
    challengeMode: false,
    isAutoCompleting: false,
    gameWon: false,
    soundEnabled: false,
    saveState: Solitaire.prototype.saveState,
    updateDisplay() {},
    updateInfo() {},
    updateGameNumber() {},
    playSound() {},
    checkDeadlock() {},
    autoSave() {},
    clearSelection() { this.selectedCard = null; },
    ...overrides
  });
}

module.exports = { loadSolitaire, makeGame, card, element };
