/**
 * 經典接龍 (Klondike Solitaire)
 * 完整遊戲邏輯實現 - 含拖曳功能
 * 改進版：有解遊戲編號 + 死局偵測
 */

class Solitaire {
    constructor() {
        // 音效系統
        this.soundEnabled = false;
        this.audioContext = null;
        
        // 死局檢測防抖
        this.deadlockCheckPending = false;
        
        // 統計系統
        this.stats = this.loadStats();
        
        // 挑戰模式
        this.challengeMode = false;
        this.challengeTime = 0;
        this.challengeInterval = null;
        
        // 自動存檔
        this.autoSaveEnabled = true;
        this.SOLVER_SAVE_VERSION = 2;
        
        // 解析 CSS 變數（支援 px, vmin, vmax）
        this.parseCSSValue = (prop) => {
            const val = getComputedStyle(document.documentElement).getPropertyValue(prop);
            if (!val) return null;
            const num = parseFloat(val);
            if (isNaN(num)) return null;
            if (val.includes('vmin')) {
                return num * Math.min(window.innerWidth, window.innerHeight) / 100;
            } else if (val.includes('vmax')) {
                return num * Math.max(window.innerWidth, window.innerHeight) / 100;
            }
            return num;
        };
        
        // 花色定義
        this.suits = ['♠', '♥', '♦', '♣'];
        this.suitColors = { '♠': 'black', '♥': 'red', '♦': 'red', '♣': 'black' };
        this.ranks = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
        
        // 有解遊戲範圍
        this.MIN_GAME = 1;
        this.MAX_GAME = 32000;
        
        // 遊戲狀態
        this.gameNumber = 1;
        this.stock = [];
        this.waste = [];
        this.foundations = [[], [], [], []];
        this.tableau = [[], [], [], [], [], [], []];
        
        // 遊戲資訊
        this.moves = 0;
        this.seconds = 0;
        this.timerInterval = null;
        this.history = [];
        
        // 拖曳狀態
        this.isDragging = false;
        this.draggedCards = [];
        this.dragSource = null;
        this.dragOffsetX = 0;
        this.dragOffsetY = 0;
        this.dragGhost = null;
        this.dragStartX = 0;
        this.dragStartY = 0;
        this.dragThreshold = 8;  // 移動超過 8px 才算拖曳
        this.pendingDrag = null; // 待確認的拖曳
        
        // 點擊選擇狀態
        this.selectedCard = null;
        
        // 提示模式
        this.hintEnabled = false;
        
        // 自動完成狀態
        this.isAutoCompleting = false;
        
        // DOM 元素
        this.stockEl = document.getElementById('stock');
        this.wasteEl = document.getElementById('waste');
        this.foundationEls = [0,1,2,3].map(i => document.getElementById(`foundation-${i}`));
        this.tableauEls = [0,1,2,3,4,5,6].map(i => document.getElementById(`tableau-${i}`));
        this.gameBoard = document.querySelector('.game-board');
        
        this.init();
    }
    
    init() {
        this.setupEventListeners();
        if (!this.autoRestore()) {
            this.newGame();
        }
    }
    
    setupEventListeners() {
        // 新遊戲按鈕
        document.getElementById('new-game').addEventListener('click', () => this.newGame());
        document.getElementById('play-again').addEventListener('click', () => {
            document.getElementById('win-modal').classList.add('hidden');
            this.newGame();
        });
        
        // 復原按鈕
        document.getElementById('undo-btn').addEventListener('click', () => this.undo());
        
        // 提示開關
        document.getElementById('hint-toggle').addEventListener('click', () => this.toggleHint());
        
        // 縮放功能
        this.zoomLevel = 1;
        document.getElementById('zoom-in').addEventListener('click', () => this.setZoom(0.1));
        document.getElementById('zoom-out').addEventListener('click', () => this.setZoom(-0.1));
        
        // 難度切換
        this.drawCount = 1; // 預設簡單
        document.getElementById('difficulty-toggle').addEventListener('click', () => this.toggleDifficulty());
        
        // 音效開關
        document.getElementById('sound-toggle').addEventListener('click', () => this.toggleSound());
        
        // 統計按鈕
        document.getElementById('stats-btn').addEventListener('click', () => this.showStats());
        document.getElementById('stats-close').addEventListener('click', () => {
            document.getElementById('stats-modal').classList.add('hidden');
        });
        document.getElementById('stats-clear').addEventListener('click', () => this.clearStats());
        
        // 挑戰按鈕
        document.getElementById('challenge-btn').addEventListener('click', () => {
            document.getElementById('challenge-modal').classList.remove('hidden');
        });
        document.getElementById('challenge-close').addEventListener('click', () => {
            document.getElementById('challenge-modal').classList.add('hidden');
        });
        
        // 挑戰時間選擇
        document.querySelectorAll('.challenge-time').forEach(btn => {
            btn.addEventListener('click', () => {
                this.startChallenge(parseInt(btn.dataset.minutes));
            });
        });

        // 挑戰結果按鈕
        document.getElementById('challenge-result-new')?.addEventListener('click', () => {
            document.getElementById('challenge-result-modal').classList.add('hidden');
            this.newGame();
        });
        document.getElementById('challenge-result-close')?.addEventListener('click', () => {
            document.getElementById('challenge-result-modal').classList.add('hidden');
        });
        
        // 主題切換（暗色/亮色模式）
        this.initTheme();
        document.getElementById('theme-toggle').addEventListener('click', () => this.toggleTheme());
        
        // 發牌堆點擊
        this.stockEl.addEventListener('click', (e) => {
            e.stopPropagation();
            this.drawFromStock();
        });

        // 委派 hover 音效：一張牌一個 listener 太浪費，整個 board 一個就夠
        // 全域節流 100ms，避免快速掃過卡牌時聲音洪流
        this.lastHoverSoundAt = 0;
        if (this.gameBoard) {
            this.gameBoard.addEventListener('mouseover', (e) => {
                if (!this.soundEnabled) return;
                const card = e.target.closest('.card.face-up');
                if (!card) return;
                // 只在進入新的卡片時觸發
                if (e.relatedTarget && card.contains(e.relatedTarget)) return;
                const now = performance.now();
                if (now - this.lastHoverSoundAt < 100) return;
                this.lastHoverSoundAt = now;
                this.playSound('hover');
            });
        }
        
        // 拖曳事件
        document.addEventListener('mousedown', (e) => this.handleMouseDown(e));
        document.addEventListener('mousemove', (e) => this.handleMouseMove(e));
        document.addEventListener('mouseup', (e) => this.handleMouseUp(e));
        
        // 觸控事件
        document.addEventListener('touchstart', (e) => this.handleTouchStart(e), { passive: false });
        document.addEventListener('touchmove', (e) => this.handleTouchMove(e), { passive: false });
        document.addEventListener('touchend', (e) => this.handleTouchEnd(e));
        
        // 雙擊自動移動到基礎牌堆
        document.addEventListener('dblclick', (e) => this.handleDoubleClick(e));
        
        // 鍵盤快捷鍵
        document.addEventListener('keydown', (e) => {
            // Ctrl/Cmd + Z: 撤銷
            if (e.key === 'z' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                this.undo();
            }
            // 空格: 發牌
            if (e.key === ' ' && !e.target.matches('input')) {
                e.preventDefault();
                this.drawFromStock();
            }
            // H: 提示
            if (e.key === 'h' && !e.target.matches('input')) {
                this.toggleHint();
            }
            // N: 新遊戲
            if (e.key === 'n' && !e.target.matches('input')) {
                this.newGame();
            }
            // T: 切換主題
            if (e.key === 't' && !e.target.matches('input')) {
                this.toggleTheme();
            }
        });
        
        // 自動存檔：關頁面前一定要立即寫，不走 debounce
        window.addEventListener('beforeunload', () => {
            if (this._autoSaveTimer) {
                clearTimeout(this._autoSaveTimer);
                this._autoSaveTimer = null;
            }
            this._writeAutoSave();
        });

        // 點擊空牌堆
        this.setupEmptyPileClicks();
        
        // 死局對話框按鈕
        document.getElementById('deadlock-undo')?.addEventListener('click', () => {
            document.getElementById('deadlock-modal').classList.add('hidden');
            this.undo();
        });
        document.getElementById('deadlock-new')?.addEventListener('click', () => {
            document.getElementById('deadlock-modal').classList.add('hidden');
            this.newGame();
        });
        document.getElementById('deadlock-close')?.addEventListener('click', () => {
            document.getElementById('deadlock-modal').classList.add('hidden');
        });
        
        // 遊戲選擇對話框
        document.getElementById('game-number')?.addEventListener('click', () => this.showGameSelectModal());
        document.getElementById('game-select-ok')?.addEventListener('click', () => this.startSelectedGame());
        document.getElementById('game-select-cancel')?.addEventListener('click', () => {
            document.getElementById('game-select-modal').classList.add('hidden');
        });
        document.getElementById('game-number-input')?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') this.startSelectedGame();
        });
    }
    
    setupEmptyPileClicks() {
        // 點擊空的 tableau 牌堆
        this.tableauEls.forEach((pileEl, index) => {
            pileEl.addEventListener('click', (e) => {
                if (e.target === pileEl && this.selectedCard) {
                    const targetInfo = { source: 'tableau', pileIndex: index };
                    this.tryMove(targetInfo);
                }
            });
        });
        
        // 點擊空的 foundation 牌堆
        this.foundationEls.forEach((pileEl, index) => {
            pileEl.addEventListener('click', (e) => {
                if (e.target === pileEl && this.selectedCard) {
                    const targetInfo = { source: 'foundation', pileIndex: index };
                    this.tryMove(targetInfo);
                }
            });
        });
    }
    
    // === 遊戲選擇 ===
    
    showGameSelectModal() {
        const modal = document.getElementById('game-select-modal');
        const input = document.getElementById('game-number-input');
        if (modal && input) {
            input.value = '';
            modal.classList.remove('hidden');
            input.focus();
        } else {
            // 如果沒有對話框，直接開始隨機遊戲
            this.newGame(this.getRandomGameNumber());
        }
    }
    
    startSelectedGame() {
        const input = document.getElementById('game-number-input');
        const modal = document.getElementById('game-select-modal');
        
        let gameNum;
        if (input && input.value) {
            gameNum = parseInt(input.value);
            gameNum = Math.max(this.MIN_GAME, Math.min(this.MAX_GAME, gameNum));
        } else {
            gameNum = this.getRandomGameNumber();
        }
        
        if (modal) modal.classList.add('hidden');
        this.newGame(gameNum);
    }
    
    getRandomGameNumber() {
        return Math.floor(Math.random() * this.MAX_GAME) + this.MIN_GAME;
    }
    
    // === 遊戲初始化 ===
    
    newGame(gameNumber = null) {
        if (gameNumber === null) {
            gameNumber = this.getRandomGameNumber();
        }
        
        this.gameNumber = gameNumber;
        this.stock = [];
        this.waste = [];
        this.foundations = [[], [], [], []];
        this.tableau = [[], [], [], [], [], [], []];
        this.moves = 0;
        this.seconds = 0;
        this.history = [];
        this.selectedCard = null;
        this.isDragging = false;
        
        // 重置提示狀態
        this.hintEnabled = false;
        document.getElementById('hint-toggle')?.classList.remove('active');
        this.clearHints();
        
        // 重置自動完成狀態
        this.isAutoCompleting = false;
        
        if (this.timerInterval) clearInterval(this.timerInterval);
        this.timerInterval = setInterval(() => this.updateTimer(), 1000);
        
        // 使用反向發牌法生成保證可解的牌局
        this.ensureSolvable();
        
        this.updateDisplay();
        this.updateInfo();
        this.updateGameNumber();
        
        // 自動存檔
        this.autoSave();
    }
    
    // 自動存檔（debounced 500ms，避免快速移動時頻繁同步寫入 localStorage）
    autoSave() {
        if (!this.autoSaveEnabled) return;
        if (this._autoSaveTimer) return; // 已經排程，等下一輪一起寫
        this._autoSaveTimer = setTimeout(() => {
            this._autoSaveTimer = null;
            this._writeAutoSave();
        }, 500);
    }

    _writeAutoSave() {
        try {
            const saveData = {
                gameNumber: this.gameNumber,
                stock: this.stock,
                waste: this.waste,
                foundations: this.foundations,
                tableau: this.tableau,
                moves: this.moves,
                seconds: this.seconds,
                history: this.history.slice(-30),
                solverVersion: this.SOLVER_SAVE_VERSION
            };
            localStorage.setItem('solitaire-save', JSON.stringify(saveData));
        } catch (e) {}
    }
    
    // 自動恢復
    autoRestore() {
        try {
            const saved = localStorage.getItem('solitaire-save');
            if (!saved) return false;

            const data = JSON.parse(saved);
            if (!data || !data.tableau || !data.stock) return false;
            if (data.solverVersion !== this.SOLVER_SAVE_VERSION) {
                localStorage.removeItem('solitaire-save');
                return false;
            }

            // 恢復遊戲狀態
            this.gameNumber = data.gameNumber;
            this.stock = data.stock;
            this.waste = data.waste;
            this.foundations = data.foundations;
            this.tableau = data.tableau;
            this.moves = data.moves;
            this.seconds = data.seconds;
            this.history = data.history || [];

            this.updateDisplay();
            this.updateInfo();
            this.updateGameNumber();

            // 恢復計時器
            if (this.timerInterval) clearInterval(this.timerInterval);
            this.timerInterval = setInterval(() => this.updateTimer(), 1000);

            console.log('[接龍] 遊戲已自動恢復');
            return true;
        } catch (e) {
            return false;
        }
    }
    
    // 產生可解牌局。每個候選牌局都先用解牌器驗證，避免只靠評分造成死棋。
    ensureSolvable() {
        const maxAttempts = 140;
        const nodeLimit = this.drawCount === 3 ? 70000 : 45000;
        let bestSeed = this.gameNumber;
        let bestScore = -Infinity;

        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            const trySeed = this.normalizeGameNumber(this.gameNumber + attempt);
            this.prepareSeededDeal(trySeed);
            this.spreadStockCards();

            const dealScore = this.scoreDeal();
            const simScore = this.simulatePlayability();
            const totalScore = dealScore + simScore;

            if (totalScore > bestScore) {
                bestScore = totalScore;
                bestSeed = trySeed;
            }

            if (this.solveCurrentDeal({ nodeLimit })) {
                this.gameNumber = trySeed;
                console.log(`[接龍] 已驗證可解牌局 #${trySeed}，搜尋 ${attempt + 1} 次`);
                return;
            }
        }

        console.warn(`[接龍] ${maxAttempts} 個候選牌局未通過解牌器，改用保證可解安全牌局。最佳候選 #${bestSeed}，分數 ${bestScore}`);
        this.createGuaranteedSolvableDeal();
    }

    normalizeGameNumber(num) {
        const range = this.MAX_GAME - this.MIN_GAME + 1;
        return ((num - this.MIN_GAME) % range + range) % range + this.MIN_GAME;
    }

    prepareSeededDeal(seed) {
        this.gameNumber = seed;
        this.foundations = [[], [], [], []];
        this.tableau = [[], [], [], [], [], [], []];
        this.waste = [];
        this.stock = [];
        this.createDeck();
        this.shuffleDeck(seed);
        this.dealCards();
    }

    createGuaranteedSolvableDeal() {
        const makeCard = (suit, value) => ({
            suit,
            rank: this.ranks[value - 1],
            value,
            color: this.suitColors[suit],
            faceUp: true
        });

        const sequences = [
            ['♠', '♥'],
            ['♣', '♦'],
            ['♥', '♠'],
            ['♦', '♣']
        ];

        this.gameNumber = this.normalizeGameNumber(this.gameNumber);
        this.stock = [];
        this.waste = [];
        this.foundations = [[], [], [], []];
        this.tableau = [[], [], [], [], [], [], []];

        sequences.forEach((pair, pileIndex) => {
            for (let value = 13; value >= 1; value--) {
                const suit = value % 2 === 1 ? pair[0] : pair[1];
                this.tableau[pileIndex].push(makeCard(suit, value));
            }
        });
    }

    solveCurrentDeal({ nodeLimit = 50000 } = {}) {
        const state = this.cloneSolverState({
            stock: this.stock,
            waste: this.waste,
            foundations: this.foundations,
            tableau: this.tableau
        });
        const visited = new Set();
        let nodes = 0;

        const search = (current) => {
            nodes++;
            if (nodes > nodeLimit) return false;
            if (this.isSolverWon(current)) return true;

            const key = this.serializeSolverState(current);
            if (visited.has(key)) return false;
            visited.add(key);

            const moves = this.getSolverMoves(current);
            for (const move of moves) {
                if (search(this.applySolverMove(current, move))) return true;
            }
            return false;
        };

        return search(state);
    }

    cloneSolverState(state) {
        const cloneCard = (card) => ({ ...card });
        return {
            stock: state.stock.map(cloneCard),
            waste: state.waste.map(cloneCard),
            foundations: state.foundations.map(pile => pile.map(cloneCard)),
            tableau: state.tableau.map(pile => pile.map(cloneCard))
        };
    }

    isSolverWon(state) {
        return state.foundations.reduce((sum, pile) => sum + pile.length, 0) === 52;
    }

    getCardKey(card) {
        return `${card.suit}${card.value}${card.faceUp ? 'u' : 'd'}`;
    }

    serializeSolverState(state) {
        const pileKey = (pile) => pile.map(card => this.getCardKey(card)).join(',');
        return [
            pileKey(state.stock),
            pileKey(state.waste),
            state.foundations.map(pileKey).join('|'),
            state.tableau.map(pileKey).join('|')
        ].join('#');
    }

    getSolverMoves(state) {
        const moves = [];
        const addFoundationMove = (source, pileIndex = -1, cardIndex = -1) => {
            const card = source === 'waste'
                ? state.waste[state.waste.length - 1]
                : state.tableau[pileIndex][cardIndex];
            if (!card) return;

            for (let f = 0; f < 4; f++) {
                if (this.canPlaceOnFoundationState(card, state.foundations[f])) {
                    moves.push({ type: 'toFoundation', source, pileIndex, cardIndex, foundationIndex: f });
                }
            }
        };

        if (state.waste.length > 0) {
            addFoundationMove('waste');
        }

        for (let pileIndex = 0; pileIndex < 7; pileIndex++) {
            const pile = state.tableau[pileIndex];
            if (pile.length === 0) continue;
            const topIndex = pile.length - 1;
            if (pile[topIndex].faceUp) addFoundationMove('tableau', pileIndex, topIndex);
        }

        if (state.waste.length > 0) {
            const card = state.waste[state.waste.length - 1];
            for (let targetPile = 0; targetPile < 7; targetPile++) {
                if (this.canPlaceOnTableauState(card, state.tableau[targetPile])) {
                    moves.push({ type: 'wasteToTableau', targetPile });
                }
            }
        }

        for (let sourcePile = 0; sourcePile < 7; sourcePile++) {
            const pile = state.tableau[sourcePile];
            for (let cardIndex = 0; cardIndex < pile.length; cardIndex++) {
                const card = pile[cardIndex];
                if (!card.faceUp) continue;

                for (let targetPile = 0; targetPile < 7; targetPile++) {
                    if (targetPile === sourcePile) continue;
                    if (!this.canPlaceOnTableauState(card, state.tableau[targetPile])) continue;
                    if (state.tableau[targetPile].length === 0 && cardIndex === 0) continue;
                    moves.push({ type: 'tableauToTableau', sourcePile, cardIndex, targetPile });
                }
            }
        }

        if (state.stock.length > 0) {
            moves.push({ type: 'draw' });
        } else if (state.waste.length > 0) {
            moves.push({ type: 'recycle' });
        }

        return moves;
    }

    applySolverMove(state, move) {
        const next = this.cloneSolverState(state);
        const flipTop = (pileIndex) => {
            const pile = next.tableau[pileIndex];
            if (pile.length > 0 && !pile[pile.length - 1].faceUp) {
                pile[pile.length - 1].faceUp = true;
            }
        };

        if (move.type === 'toFoundation') {
            const card = move.source === 'waste'
                ? next.waste.pop()
                : next.tableau[move.pileIndex].pop();
            next.foundations[move.foundationIndex].push(card);
            if (move.source === 'tableau') flipTop(move.pileIndex);
            return next;
        }

        if (move.type === 'wasteToTableau') {
            next.tableau[move.targetPile].push(next.waste.pop());
            return next;
        }

        if (move.type === 'tableauToTableau') {
            const cards = next.tableau[move.sourcePile].splice(move.cardIndex);
            next.tableau[move.targetPile].push(...cards);
            flipTop(move.sourcePile);
            return next;
        }

        if (move.type === 'draw') {
            const drawCount = Math.min(this.drawCount, next.stock.length);
            for (let i = 0; i < drawCount; i++) {
                const card = next.stock.pop();
                card.faceUp = true;
                next.waste.push(card);
            }
            return next;
        }

        if (move.type === 'recycle') {
            while (next.waste.length > 0) {
                const card = next.waste.pop();
                card.faceUp = false;
                next.stock.push(card);
            }
            return next;
        }

        return next;
    }
    
    updateGameNumber() {
        const el = document.getElementById('game-number');
        if (el) {
            el.textContent = `#${this.gameNumber}`;
        }
    }

    /**
     * 評估當前牌局的品質分數
     * 分數越高代表牌局越好玩（開局有路可走、顏色平衡、牌堆多樣性）
     */
    scoreDeal() {
        let score = 0;

        // 收集所有翻開的牌（初始發牌時每堆只有最上面一張翻開）
        const faceUpCards = [];
        for (let i = 0; i < 7; i++) {
            const pile = this.tableau[i];
            if (pile.length > 0) {
                const topCard = pile[pile.length - 1];
                if (topCard.faceUp) {
                    faceUpCards.push({ card: topCard, pileIdx: i, pileSize: pile.length });
                }
            }
        }

        // 1. 計算初始可用移動數（牌堆之間 + 送上基座）
        let moveCount = 0;
        for (const { card, pileIdx, pileSize } of faceUpCards) {
            // 檢查是否能移到其他牌堆
            for (let t = 0; t < 7; t++) {
                if (t === pileIdx) continue;
                if (this.canPlaceOnTableauState(card, this.tableau[t])) {
                    moveCount++;
                    // 能翻開隱藏牌的移動更有價值
                    if (pileSize > 1) score += 5;
                }
            }
            // 檢查是否能送上基座
            for (let f = 0; f < 4; f++) {
                if (this.canPlaceOnFoundationState(card, this.foundations[f])) {
                    moveCount++;
                    score += 10; // 基座移動非常有價值
                }
            }
        }
        score += moveCount * 8;

        // 2. A 和 2 翻開是好事（能快速開始基座）
        for (const { card } of faceUpCards) {
            if (card.value === 1) score += 15;
            if (card.value === 2) score += 5;
        }

        // 3. 牌堆頂部幾張牌的可用性（玩家最先抽到的牌）
        const checkCount = Math.min(5, this.stock.length);
        for (let i = this.stock.length - 1; i >= this.stock.length - checkCount; i--) {
            const card = this.stock[i];
            if (card.value === 1) { score += 8; continue; }
            for (let t = 0; t < 7; t++) {
                if (this.canPlaceOnTableauState(card, this.tableau[t])) {
                    score += 3;
                    break;
                }
            }
        }

        // 4. 顏色平衡（理想是紅黑各半，3:4 或 4:3）
        const redCount = faceUpCards.filter(fc => fc.card.color === 'red').length;
        const blackCount = faceUpCards.filter(fc => fc.card.color === 'black').length;
        score += Math.min(redCount, blackCount) * 5;

        // 5. 數值多樣性（翻開的牌數值越不同越好）
        const values = new Set(faceUpCards.map(fc => fc.card.value));
        score += values.size * 2;

        // 6. 完全沒有移動是大扣分
        if (moveCount === 0) score -= 25;

        // 7. K 獨佔一個單牌堆浪費空間
        for (const { card, pileSize } of faceUpCards) {
            if (card.value === 13 && pileSize === 1) score -= 5;
        }

        // 8. 牌堆中相鄰同數值牌的懲罰（避免「消了5又來5」）
        for (let i = 1; i < this.stock.length; i++) {
            if (this.stock[i].value === this.stock[i - 1].value) score -= 3;
        }

        // 9. 深埋 A/2/3 的懲罰（死局的首要原因）
        for (let i = 0; i < 7; i++) {
            const pile = this.tableau[i];
            for (let j = 0; j < pile.length - 1; j++) { // 面朝下的牌
                const card = pile[j];
                const depth = pile.length - 1 - j; // 上面壓了幾張
                if (card.value === 1) score -= 14 * depth; // 深埋 A 極度不利
                if (card.value === 2) score -= 7 * depth;  // 深埋 2
                if (card.value === 3) score -= 3 * depth;  // 深埋 3
            }
        }

        // 10. A 在牌庫中的可及性
        let aceAccessible = faceUpCards.some(fc => fc.card.value === 1);
        if (!aceAccessible) {
            // 檢查牌庫前幾張有沒有 A
            for (let i = this.stock.length - 1; i >= Math.max(0, this.stock.length - 8); i--) {
                if (this.stock[i].value === 1) {
                    const depthFromTop = this.stock.length - 1 - i;
                    score += (8 - depthFromTop) * 2; // 越靠頂越好
                    aceAccessible = true;
                }
            }
        }
        // 如果完全沒有可及的 A，大幅扣分
        if (!aceAccessible) score -= 30;

        // 11. 確保至少有 2 個初始可移動的牌（不然開局就卡住）
        if (moveCount < 2) score -= 20;

        // 12. 同色連續牌堆疊在同一堆的懲罰（互相阻擋）
        for (let i = 0; i < 7; i++) {
            const pile = this.tableau[i];
            for (let j = 0; j < pile.length - 1; j++) {
                for (let k = j + 1; k < pile.length; k++) {
                    if (pile[j].color === pile[k].color &&
                        Math.abs(pile[j].value - pile[k].value) === 1) {
                        score -= 4; // 同色連號在同堆，互相阻擋
                    }
                }
            }
        }

        return score;
    }

    /**
     * 模擬貪心試玩，評估牌局的可玩性
     * 自動執行一系列最優移動，計算能推進多遠
     */
    simulatePlayability() {
        // 深拷貝當前狀態
        const sim = {
            stock: this.stock.map(c => ({...c})),
            waste: [],
            foundations: [[], [], [], []],
            tableau: this.tableau.map(p => p.map(c => ({...c})))
        };

        let foundationCards = 0;
        let revealed = 0;
        let stockDraws = 0;
        const maxRounds = 80;

        for (let round = 0; round < maxRounds; round++) {
            let moved = false;

            // 優先 1: 將 A/2/3 送上基座
            for (let t = 0; t < 7 && !moved; t++) {
                const pile = sim.tableau[t];
                if (pile.length === 0) continue;
                const card = pile[pile.length - 1];
                if (!card.faceUp || card.value > 3) continue;
                for (let f = 0; f < 4; f++) {
                    if (this.canPlaceOnFoundationState(card, sim.foundations[f])) {
                        pile.pop();
                        sim.foundations[f].push(card);
                        if (pile.length > 0 && !pile[pile.length - 1].faceUp) {
                            pile[pile.length - 1].faceUp = true;
                            revealed++;
                        }
                        foundationCards++;
                        moved = true;
                        break;
                    }
                }
            }
            if (moved) continue;

            // 優先 2: 移動牌以翻開隱藏牌
            for (let t = 0; t < 7 && !moved; t++) {
                const pile = sim.tableau[t];
                if (pile.length <= 1) continue;
                let firstFaceUp = -1;
                for (let j = 0; j < pile.length; j++) {
                    if (pile[j].faceUp) { firstFaceUp = j; break; }
                }
                if (firstFaceUp <= 0) continue;
                const card = pile[firstFaceUp];
                for (let tt = 0; tt < 7; tt++) {
                    if (tt === t) continue;
                    if (this.canPlaceOnTableauState(card, sim.tableau[tt])) {
                        const cards = pile.splice(firstFaceUp);
                        sim.tableau[tt].push(...cards);
                        if (pile.length > 0 && !pile[pile.length - 1].faceUp) {
                            pile[pile.length - 1].faceUp = true;
                            revealed++;
                        }
                        moved = true;
                        break;
                    }
                }
            }
            if (moved) continue;

            // 優先 3: 將頂牌送上基座
            for (let t = 0; t < 7 && !moved; t++) {
                const pile = sim.tableau[t];
                if (pile.length === 0) continue;
                const card = pile[pile.length - 1];
                if (!card.faceUp) continue;
                for (let f = 0; f < 4; f++) {
                    if (this.canPlaceOnFoundationState(card, sim.foundations[f])) {
                        pile.pop();
                        sim.foundations[f].push(card);
                        if (pile.length > 0 && !pile[pile.length - 1].faceUp) {
                            pile[pile.length - 1].faceUp = true;
                            revealed++;
                        }
                        foundationCards++;
                        moved = true;
                        break;
                    }
                }
            }
            if (moved) continue;

            // 優先 4: 在牌堆之間移動（建立序列）
            for (let t = 0; t < 7 && !moved; t++) {
                const pile = sim.tableau[t];
                if (pile.length === 0) continue;
                let firstFaceUp = -1;
                for (let j = 0; j < pile.length; j++) {
                    if (pile[j].faceUp) { firstFaceUp = j; break; }
                }
                if (firstFaceUp < 0) continue;
                const card = pile[firstFaceUp];
                // 不移動 K 到空位（除非能翻牌）
                if (card.value === 13 && firstFaceUp === 0) continue;
                for (let tt = 0; tt < 7; tt++) {
                    if (tt === t) continue;
                    if (this.canPlaceOnTableauState(card, sim.tableau[tt])) {
                        const cards = pile.splice(firstFaceUp);
                        sim.tableau[tt].push(...cards);
                        if (pile.length > 0 && !pile[pile.length - 1].faceUp) {
                            pile[pile.length - 1].faceUp = true;
                            revealed++;
                        }
                        moved = true;
                        break;
                    }
                }
            }
            if (moved) continue;

            // 優先 5: 從牌庫抽牌
            if (sim.stock.length > 0 && stockDraws < 24) {
                const card = sim.stock.pop();
                card.faceUp = true;
                stockDraws++;

                let placed = false;
                // 試基座
                for (let f = 0; f < 4; f++) {
                    if (this.canPlaceOnFoundationState(card, sim.foundations[f])) {
                        sim.foundations[f].push(card);
                        foundationCards++;
                        placed = true;
                        break;
                    }
                }
                // 試牌堆
                if (!placed) {
                    for (let t = 0; t < 7; t++) {
                        if (this.canPlaceOnTableauState(card, sim.tableau[t])) {
                            sim.tableau[t].push(card);
                            placed = true;
                            break;
                        }
                    }
                }
                if (!placed) sim.waste.push(card);
                moved = true;
            }

            if (!moved) break;
        }

        // 根據模擬結果計算分數
        return foundationCards * 6 + revealed * 4 + Math.min(stockDraws, 15);
    }

    /**
     * 分散牌堆中相鄰的同數值牌，避免玩家連續抽到同數字
     */
    spreadStockCards() {
        const stock = this.stock;
        if (stock.length <= 2) return;

        // 多輪掃描，把相鄰的同數值牌與較遠的牌交換
        for (let pass = 0; pass < 3; pass++) {
            for (let i = 0; i < stock.length - 1; i++) {
                if (stock[i].value === stock[i + 1].value) {
                    // 往後找一張不同數值的牌來交換
                    for (let j = i + 3; j < stock.length; j++) {
                        if (stock[j].value !== stock[i].value) {
                            [stock[i + 1], stock[j]] = [stock[j], stock[i + 1]];
                            break;
                        }
                    }
                }
            }
        }
    }

    createDeck() {
        this.stock = [];
        for (const suit of this.suits) {
            for (let i = 0; i < this.ranks.length; i++) {
                this.stock.push({
                    suit,
                    rank: this.ranks[i],
                    value: i + 1,
                    color: this.suitColors[suit],
                    faceUp: false
                });
            }
        }
    }
    
    shuffleDeck(seed) {
        // 使用種子的確定性洗牌（類似 MS Solitaire）
        let s = seed;
        const random = () => {
            s = (s * 214013 + 2531011) & 0x7FFFFFFF;
            return (s >> 16) & 0x7FFF;
        };
        
        // Fisher-Yates shuffle with seed
        for (let i = this.stock.length - 1; i > 0; i--) {
            const j = random() % (i + 1);
            [this.stock[i], this.stock[j]] = [this.stock[j], this.stock[i]];
        }
        
        //額外洗牌回合，增加隨機性
        for (let i = 0; i < 200; i++) {
            const j = random() % 52;
            const k = random() % 52;
            [this.stock[j], this.stock[k]] = [this.stock[k], this.stock[j]];
        }
    }
    
    dealCards() {
        for (let i = 0; i < 7; i++) {
            for (let j = i; j < 7; j++) {
                const card = this.stock.pop();
                card.faceUp = (j === i);
                this.tableau[j].push(card);
            }
        }
    }
    
    // === 發牌堆操作 ===
    
    drawFromStock() {
        this.saveState();
        
        if (this.stock.length === 0) {
            // 重新翻轉廢牌堆
            if (this.waste.length > 0) {
                while (this.waste.length > 0) {
                    const card = this.waste.pop();
                    card.faceUp = false;
                    this.stock.push(card);
                }
                this.moves++;
            }
        } else {
            // 根據難度翻牌
            const drawCount = Math.min(this.drawCount, this.stock.length);
            for (let i = 0; i < drawCount; i++) {
                const card = this.stock.pop();
                card.faceUp = true;
                this.waste.push(card);
            }
            this.moves++;
        }
        
        // 翻牌音效
        this.playSound('flip');
        
        this.updateDisplay();
        this.updateInfo();
        // 延遲死局檢測
        setTimeout(() => this.checkDeadlock(), 100);
    }
    
    // === 死局偵測 ===
    
    checkDeadlock() {
        // 如果正在自動完成，不檢查死局
        if (this.isAutoCompleting) return;

        // 如果已經贏了，不檢查
        const totalFoundationCards = this.foundations.reduce((sum, f) => sum + f.length, 0);
        if (totalFoundationCards === 52) return;

        // 防止頻繁檢查（debounce）
        if (this.deadlockCheckPending) return;
        this.deadlockCheckPending = true;

        setTimeout(() => {
            this.deadlockCheckPending = false;

            // 死局 = 沒有任何合法的下一步（不是「無法獲勝」）。
            // 用 isSolvable 會把「還能玩但不會贏」的局面誤判成死局。
            if (!this.hasAnyLegalMove()) {
                this.showDeadlockModal();
            }
        }, 500);
    }

    /**
     * 檢查是否可放到 foundation（任意狀態）— 由評分/模擬與 hasAnyLegalMove 使用
     */
    canPlaceOnFoundationState(card, foundation) {
        if (foundation.length === 0) {
            return card.value === 1;
        }
        const topCard = foundation[foundation.length - 1];
        return card.suit === topCard.suit && card.value === topCard.value + 1;
    }

    /**
     * 檢查是否可放到 tableau（任意狀態）— 由評分/模擬使用
     */
    canPlaceOnTableauState(card, pile) {
        if (pile.length === 0) {
            return card.value === 13;
        }
        const topCard = pile[pile.length - 1];
        if (!topCard.faceUp) return false;
        return card.color !== topCard.color && card.value === topCard.value - 1;
    }

    hasAnyLegalMove() {
        // 1. waste 頂牌可移動
        if (this.waste.length > 0) {
            const card = this.waste[this.waste.length - 1];
            for (let i = 0; i < 4; i++) {
                if (this.canPlaceOnFoundation(card, i)) return true;
            }
            for (let i = 0; i < 7; i++) {
                if (this.canPlaceOnTableau(card, i)) return true;
            }
        }

        // 2. tableau 任一張翻開的牌可移動到 foundation 或其他 tableau
        for (let pileIndex = 0; pileIndex < 7; pileIndex++) {
            const pile = this.tableau[pileIndex];
            for (let cardIndex = 0; cardIndex < pile.length; cardIndex++) {
                const card = pile[cardIndex];
                if (!card.faceUp) continue;

                // 只有最頂的單張可上 foundation
                if (cardIndex === pile.length - 1) {
                    for (let f = 0; f < 4; f++) {
                        if (this.canPlaceOnFoundation(card, f)) return true;
                    }
                }

                // 整段（card 及其上）可移到其他 tableau
                for (let targetPile = 0; targetPile < 7; targetPile++) {
                    if (targetPile === pileIndex) continue;
                    if (this.canPlaceOnTableau(card, targetPile)) {
                        // 避免「同色 K 整堆搬到空堆」這種無意義移動造成偽陽性
                        const target = this.tableau[targetPile];
                        if (target.length === 0 && cardIndex === 0) continue;
                        return true;
                    }
                }
            }
        }

        // 3. stock 或 waste 中（非頂牌）若有任一張未來抽到後可放到任何位置，
        //    就不算死局（因為玩家可以抽牌或循環）
        const wasteRest = this.waste.slice(0, Math.max(0, this.waste.length - 1));
        const drawable = this.stock.concat(wasteRest);
        for (const c of drawable) {
            // 假設這張牌會被抽出來面朝上
            const card = { ...c, faceUp: true };
            for (let f = 0; f < 4; f++) {
                if (this.canPlaceOnFoundation(card, f)) return true;
            }
            for (let t = 0; t < 7; t++) {
                if (this.canPlaceOnTableau(card, t)) return true;
            }
        }

        return false;
    }
    
    showDeadlockModal() {
        const modal = document.getElementById('deadlock-modal');
        if (modal) {
            modal.classList.remove('hidden');
        }
    }
    
    // === 拖曳處理 ===
    
    handleMouseDown(e) {
        const cardEl = e.target.closest('.card');
        if (!cardEl || cardEl.classList.contains('face-down')) {
            if (cardEl && cardEl.classList.contains('face-down')) {
                this.tryFlipCard(cardEl);
            }
            return;
        }
        
        if (cardEl.closest('#stock')) return;
        
        // 記錄起始位置，等移動超過閾值才開始拖曳
        this.dragStartX = e.clientX;
        this.dragStartY = e.clientY;
        this.pendingDrag = { cardEl, clientX: e.clientX, clientY: e.clientY };
    }
    
    handleTouchStart(e) {
        const touch = e.touches[0];
        const cardEl = document.elementFromPoint(touch.clientX, touch.clientY)?.closest('.card');
        
        if (!cardEl || cardEl.classList.contains('face-down')) {
            if (cardEl && cardEl.classList.contains('face-down')) {
                this.tryFlipCard(cardEl);
            }
            return;
        }
        
        if (cardEl.closest('#stock')) return;
        
        this.dragStartX = touch.clientX;
        this.dragStartY = touch.clientY;
        this.pendingDrag = { cardEl, clientX: touch.clientX, clientY: touch.clientY };
    }
    
    startDrag(cardEl, clientX, clientY) {
        const cardInfo = this.getCardFromElement(cardEl);
        if (!cardInfo || !cardInfo.card) return;
        
        // 從 waste 拖曳時，總是最上面的牌
        if (cardInfo.source === 'waste') {
            cardInfo.cardIndex = this.waste.length - 1;
            cardInfo.card = this.waste[cardInfo.cardIndex];
        }
        
        this.isDragging = true;
        this.dragSource = cardInfo;
        
        const rect = cardEl.getBoundingClientRect();
        this.dragOffsetX = clientX - rect.left;
        this.dragOffsetY = clientY - rect.top;
        
        // 建立拖曳幽靈
        this.createDragGhost(cardInfo, clientX, clientY);
        
        // 標記原始卡片
        cardEl.classList.add('dragging');
        
        // 如果是 tableau，也包含其上的所有牌
        if (cardInfo.source === 'tableau') {
            const pile = this.tableau[cardInfo.pileIndex];
            for (let i = cardInfo.cardIndex + 1; i < pile.length; i++) {
                const el = this.tableauEls[cardInfo.pileIndex].children[i];
                if (el) el.classList.add('dragging');
            }
        }
    }
    
    createDragGhost(cardInfo, clientX, clientY) {
        this.dragGhost = document.createElement('div');
        this.dragGhost.className = 'drag-ghost';
        this.dragGhost.style.cssText = `
            position: fixed;
            pointer-events: none;
            z-index: 10000;
            left: ${clientX - this.dragOffsetX}px;
            top: ${clientY - this.dragOffsetY}px;
        `;
        
        // 收集要拖曳的卡片
        this.draggedCards = [];
        
        if (cardInfo.source === 'waste') {
            this.draggedCards = [cardInfo.card];
        } else if (cardInfo.source === 'foundation') {
            this.draggedCards = [cardInfo.card];
        } else if (cardInfo.source === 'tableau') {
            const pile = this.tableau[cardInfo.pileIndex];
            this.draggedCards = pile.slice(cardInfo.cardIndex);
        }
        
        // 建立卡片視覺
        const tableauOffset = this.parseCSSValue('--tableau-offset') || 2.5 * Math.min(window.innerWidth, window.innerHeight) / 100;
        
        this.draggedCards.forEach((card, i) => {
            const cardEl = this.createCardElement(card, true);
            cardEl.style.position = 'absolute';
            cardEl.style.left = '0';
            cardEl.style.top = `${i * tableauOffset}px`;
            cardEl.style.boxShadow = '0 10px 30px rgba(0,0,0,0.4)';
            this.dragGhost.appendChild(cardEl);
        });
        
        document.body.appendChild(this.dragGhost);
    }
    
    handleMouseMove(e) {
        // 檢查是否應該開始拖曳
        if (this.pendingDrag && !this.isDragging) {
            const dx = e.clientX - this.dragStartX;
            const dy = e.clientY - this.dragStartY;
            const distance = Math.sqrt(dx * dx + dy * dy);
            
            if (distance > this.dragThreshold) {
                this.startDrag(this.pendingDrag.cardEl, this.pendingDrag.clientX, this.pendingDrag.clientY);
                this.pendingDrag = null;
            }
        }
        
        if (!this.isDragging || !this.dragGhost) return;
        e.preventDefault();
        this.updateDragPosition(e.clientX, e.clientY);
    }
    
    handleTouchMove(e) {
        // 檢查是否應該開始拖曳
        if (this.pendingDrag && !this.isDragging) {
            const touch = e.touches[0];
            const dx = touch.clientX - this.dragStartX;
            const dy = touch.clientY - this.dragStartY;
            const distance = Math.sqrt(dx * dx + dy * dy);
            
            if (distance > this.dragThreshold) {
                e.preventDefault();
                this.startDrag(this.pendingDrag.cardEl, this.pendingDrag.clientX, this.pendingDrag.clientY);
                this.pendingDrag = null;
            }
        }
        
        if (!this.isDragging || !this.dragGhost) return;
        e.preventDefault();
        const touch = e.touches[0];
        this.updateDragPosition(touch.clientX, touch.clientY);
    }
    
    updateDragPosition(clientX, clientY) {
        this.dragGhost.style.left = `${clientX - this.dragOffsetX}px`;
        this.dragGhost.style.top = `${clientY - this.dragOffsetY}px`;
        
        // 高亮可放置的目標
        this.highlightDropTarget(clientX, clientY);
    }
    
    highlightDropTarget(clientX, clientY) {
        // 移除所有高亮
        document.querySelectorAll('.drop-highlight').forEach(el => el.classList.remove('drop-highlight'));
        
        const target = this.getDropTarget(clientX, clientY);
        if (target && target.element) {
            target.element.classList.add('drop-highlight');
        }
    }
    
    handleMouseUp(e) {
        // 如果有 pendingDrag 但沒有真正開始拖曳，就是點擊（不干擾雙擊）
        if (this.pendingDrag) {
            this.pendingDrag = null;
        }
        
        if (!this.isDragging) return;
        this.endDrag(e.clientX, e.clientY);
    }
    
    handleTouchEnd(e) {
        if (this.pendingDrag) {
            this.pendingDrag = null;
        }
        
        if (!this.isDragging) return;
        const touch = e.changedTouches[0];
        this.endDrag(touch.clientX, touch.clientY);
    }
    
    endDrag(clientX, clientY) {
        // 移除高亮
        document.querySelectorAll('.drop-highlight').forEach(el => el.classList.remove('drop-highlight'));
        document.querySelectorAll('.dragging').forEach(el => el.classList.remove('dragging'));
        
        // 找到放置目標
        const target = this.getDropTarget(clientX, clientY);
        
        if (target && this.canDrop(target)) {
            this.saveState();
            this.executeDrop(target);
            this.moves++;
            this.playSound('success');
            this.updateInfo();
            this.checkWin();
        } else if (target) {
            this.playSound('error');
        }

        // 清理
        if (this.dragGhost) {
            this.dragGhost.remove();
            this.dragGhost = null;
        }

        this.isDragging = false;
        this.dragSource = null;
        this.draggedCards = [];

        this.updateDisplay();
        
        // 延遲死局檢測，讓 UI 先回應
        setTimeout(() => this.checkDeadlock(), 100);
    }
    
    getDropTarget(clientX, clientY) {
        // 暫時隱藏拖曳幽靈以獲取底下的元素
        if (this.dragGhost) {
            this.dragGhost.style.display = 'none';
        }
        
        const element = document.elementFromPoint(clientX, clientY);
        
        if (this.dragGhost) {
            this.dragGhost.style.display = '';
        }
        
        if (!element) return null;
        
        // 檢查是否是 foundation
        const foundation = element.closest('.foundation');
        if (foundation) {
            const index = this.foundationEls.indexOf(foundation);
            if (index !== -1) {
                return { type: 'foundation', index, element: foundation };
            }
        }
        
        // 檢查是否是 tableau
        const tableau = element.closest('.tableau-pile');
        if (tableau) {
            const index = this.tableauEls.indexOf(tableau);
            if (index !== -1) {
                return { type: 'tableau', index, element: tableau };
            }
        }
        
        // 檢查是否是卡片
        const card = element.closest('.card');
        if (card) {
            const cardInfo = this.getCardFromElement(card);
            if (cardInfo) {
                if (cardInfo.source === 'foundation') {
                    return { type: 'foundation', index: cardInfo.pileIndex, element: this.foundationEls[cardInfo.pileIndex] };
                } else if (cardInfo.source === 'tableau') {
                    return { type: 'tableau', index: cardInfo.pileIndex, element: this.tableauEls[cardInfo.pileIndex] };
                }
            }
        }
        
        return null;
    }
    
    canDrop(target) {
        if (!this.dragSource || this.draggedCards.length === 0) return false;
        
        const sourceCard = this.draggedCards[0];
        
        if (target.type === 'foundation') {
            // 只能放單張到 foundation
            if (this.draggedCards.length > 1) return false;
            return this.canPlaceOnFoundation(sourceCard, target.index);
        } else if (target.type === 'tableau') {
            return this.canPlaceOnTableau(sourceCard, target.index);
        }
        
        return false;
    }
    
    executeDrop(target) {
        // 檢查是否 K 放到空白處
        const isKingToEmpty = this.draggedCards.length > 0 && 
                             this.draggedCards[0].rank === 'K' && 
                             target.type === 'tableau' && 
                             this.tableau[target.index].length === 0;
        
        // 從來源移除
        if (this.dragSource.source === 'waste') {
            this.waste.pop();
        } else if (this.dragSource.source === 'foundation') {
            this.foundations[this.dragSource.pileIndex].pop();
        } else if (this.dragSource.source === 'tableau') {
            this.tableau[this.dragSource.pileIndex].splice(this.dragSource.cardIndex, this.draggedCards.length);
            this.flipTopCard(this.dragSource.pileIndex);
        }
        
        // 放到目標
        if (target.type === 'foundation') {
            this.foundations[target.index].push(this.draggedCards[0]);
        } else if (target.type === 'tableau') {
            this.tableau[target.index].push(...this.draggedCards);
            
            // K 放到空白處的音效
            if (isKingToEmpty) {
                this.playSound('placeKing');
            }
        }
    }
    
    tryFlipCard(cardEl) {
        const pileInfo = this.getCardPileInfo(cardEl);
        if (pileInfo && pileInfo.type === 'tableau') {
            const pile = this.tableau[pileInfo.index];
            const cardIndex = parseInt(cardEl.dataset.cardIndex);
            
            // 只能翻最上面的牌
            if (cardIndex === pile.length - 1 && !pile[cardIndex].faceUp) {
                this.saveState();
                pile[cardIndex].faceUp = true;
                this.moves++;
                this.updateDisplay();
                this.updateInfo();
            }
        }
    }
    
    // === 點擊選擇（備用操作方式）===
    
    handleDoubleClick(e) {
        const cardEl = e.target.closest('.card');
        if (!cardEl || cardEl.classList.contains('face-down')) return;
        
        const cardInfo = this.getCardFromElement(cardEl);
        if (!cardInfo) return;
        
        // 雙擊音效
        this.playSound('doubleClick');
        
        this.tryAutoMoveToFoundation(cardInfo);
    }
    
    tryAutoMoveToFoundation(cardInfo) {
        const card = cardInfo.card;
        if (!card) return false;
        
        // 只能移動最上面的牌到 foundation
        if (cardInfo.source === 'tableau') {
            const pile = this.tableau[cardInfo.pileIndex];
            if (cardInfo.cardIndex !== pile.length - 1) {
                return false; // 不是最上面的牌
            }
        }
        
        for (let i = 0; i < 4; i++) {
            if (this.canPlaceOnFoundation(card, i)) {
                this.saveState();
                
                if (cardInfo.source === 'waste') {
                    this.waste.pop();
                } else if (cardInfo.source === 'tableau') {
                    this.tableau[cardInfo.pileIndex].pop();
                    this.flipTopCard(cardInfo.pileIndex);
                } else if (cardInfo.source === 'foundation') {
                    this.foundations[cardInfo.pileIndex].pop();
                }
                
                this.foundations[i].push(card);
                this.moves++;
                
                this.clearSelection();
                this.updateDisplay();
                this.updateInfo();
                this.checkWin();
                return true;
            }
        }
        return false;
    }
    
    tryMove(targetInfo) {
        if (!this.selectedCard) return;
        
        const sourceCard = this.selectedCard.card;
        let moved = false;
        
        if (targetInfo.source === 'foundation') {
            if (this.canPlaceOnFoundation(sourceCard, targetInfo.pileIndex)) {
                if (this.selectedCard.source === 'tableau') {
                    const pile = this.tableau[this.selectedCard.pileIndex];
                    if (this.selectedCard.cardIndex !== pile.length - 1) {
                        this.clearSelection();
                        return;
                    }
                }
                
                this.saveState();
                this.moveCard(this.selectedCard, 'foundation', targetInfo.pileIndex);
                moved = true;
            }
        } else if (targetInfo.source === 'tableau') {
            if (this.canPlaceOnTableau(sourceCard, targetInfo.pileIndex)) {
                // 檢查是否 K 放到空白處（移動前檢查）
                const targetPile = this.tableau[targetInfo.pileIndex];
                const isKingToEmpty = sourceCard.rank === 'K' && targetPile.length === 0;
                
                this.saveState();
                this.moveCards(this.selectedCard, targetInfo.pileIndex);
                moved = true;
                
                // K 放到空白處的音效（移動後播放）
                if (isKingToEmpty) {
                    this.playSound('placeKing');
                }
            }
        }
        
        if (moved) {
            this.moves++;
            this.playSound('success');
            this.updateInfo();
            this.checkWin();
        } else {
            this.playSound('error');
        }
        
        this.clearSelection();
        this.updateDisplay();
    }
    
    moveCard(sourceInfo, targetType, targetIndex) {
        let card;
        
        if (sourceInfo.source === 'waste') {
            card = this.waste.pop();
        } else if (sourceInfo.source === 'tableau') {
            card = this.tableau[sourceInfo.pileIndex].pop();
            this.flipTopCard(sourceInfo.pileIndex);
        } else if (sourceInfo.source === 'foundation') {
            card = this.foundations[sourceInfo.pileIndex].pop();
        }
        
        if (targetType === 'foundation') {
            this.foundations[targetIndex].push(card);
        } else if (targetType === 'tableau') {
            this.tableau[targetIndex].push(card);
        }
    }
    
    moveCards(sourceInfo, targetPileIndex) {
        if (sourceInfo.source === 'waste') {
            const card = this.waste.pop();
            this.tableau[targetPileIndex].push(card);
        } else if (sourceInfo.source === 'tableau') {
            const sourcePile = this.tableau[sourceInfo.pileIndex];
            const cards = sourcePile.splice(sourceInfo.cardIndex);
            this.tableau[targetPileIndex].push(...cards);
            this.flipTopCard(sourceInfo.pileIndex);
        } else if (sourceInfo.source === 'foundation') {
            const card = this.foundations[sourceInfo.pileIndex].pop();
            this.tableau[targetPileIndex].push(card);
        }
    }
    
    flipTopCard(pileIndex) {
        const pile = this.tableau[pileIndex];
        if (pile.length > 0 && !pile[pile.length - 1].faceUp) {
            pile[pile.length - 1].faceUp = true;
        }
    }
    
    // === 規則檢查 ===
    
    canPlaceOnFoundation(card, foundationIndex) {
        const foundation = this.foundations[foundationIndex];
        
        if (foundation.length === 0) {
            return card.value === 1;
        }
        
        const topCard = foundation[foundation.length - 1];
        return card.suit === topCard.suit && card.value === topCard.value + 1;
    }
    
    canPlaceOnTableau(card, pileIndex) {
        const pile = this.tableau[pileIndex];
        
        if (pile.length === 0) {
            return card.value === 13;
        }
        
        const topCard = pile[pile.length - 1];
        if (!topCard.faceUp) return false;
        
        return card.color !== topCard.color && card.value === topCard.value - 1;
    }
    
    // === 縮放功能 ===
    
    setZoom(delta) {
        this.zoomLevel = Math.max(0.5, Math.min(2, this.zoomLevel + delta));
        const root = document.documentElement;
        const baseWidth = 8;
        const baseHeight = 11.2;
        const baseRadius = 0.7;
        const baseGap = 1.4;
        // 間距隨縮放增加，但保持最小間距防止重疊
        const baseOffset = Math.max(3.4, baseHeight * 0.34 * this.zoomLevel);

        // 縮放只影響牌桌（卡片大小、間距、字面字體），不動 header/menu，
        // 避免按鈕變大後換行造成介面跑版。
        root.style.setProperty('--card-width', `${baseWidth * this.zoomLevel}vmin`);
        root.style.setProperty('--card-height', `${baseHeight * this.zoomLevel}vmin`);
        root.style.setProperty('--card-radius', `${baseRadius * this.zoomLevel}vmin`);
        root.style.setProperty('--pile-gap', `${Math.max(baseGap, baseGap * this.zoomLevel)}vmin`);
        root.style.setProperty('--tableau-offset', `${baseOffset}vmin`);

        // 容器寬度也跟著變大，確保牌桌橫向擺得下
        root.style.setProperty('--container-width', `${Math.min(98, 90 * this.zoomLevel)}vmin`);

        // 卡面內字體
        root.style.setProperty('--font-rank', `${1.5 * this.zoomLevel}vmin`);
        root.style.setProperty('--font-suit', `${1.1 * this.zoomLevel}vmin`);
        root.style.setProperty('--font-center', `${3 * this.zoomLevel}vmin`);

        // 重新渲染牌桌以更新間距
        this.renderTableau();
    }
    
    // === 提示功能 ===
    
    toggleHint() {
        this.hintEnabled = !this.hintEnabled;
        const btn = document.getElementById('hint-toggle');
        btn.classList.toggle('active', this.hintEnabled);
        
        if (this.hintEnabled) {
            this.showHints();
        } else {
            this.clearHints();
        }
    }
    
    // === 難度切換 ===
    
    toggleDifficulty() {
        this.drawCount = this.drawCount === 1 ? 3 : 1;
        const btn = document.getElementById('difficulty-toggle');
        // 用顏色狀態 + tooltip 標示，按鈕本身保持精簡
        btn.classList.toggle('btn-active', this.drawCount === 3);
        btn.title = this.drawCount === 1 ? '難度: 簡單（每次翻 1 張）' : '難度: 困難（每次翻 3 張）';
        // 抽牌數會影響可解性，切換難度後必須重新產生一局並再次驗證。
        this.newGame(this.gameNumber);
    }
    
    // === 音效系統 ===
    
    toggleSound() {
        // 第一次點擊時初始化音頻上下文
        if (!this.audioContext) {
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        }
        
        this.soundEnabled = !this.soundEnabled;
        const btn = document.getElementById('sound-toggle');
        btn.textContent = this.soundEnabled ? '🔊' : '🔇';
        btn.classList.toggle('btn-active', this.soundEnabled);
        btn.title = this.soundEnabled ? '音效已開啟（點擊關閉）' : '音效已關閉（點擊開啟）';
        
        // 測試音效（如果開啟）
        if (this.soundEnabled) {
            this.playSound('flip');
        }
    }
    
    // === 統計系統 ===
    loadStats() {
        const defaultStats = {
            games: 0,
            wins: 0,
            bestTime: Infinity,
            bestMoves: Infinity,
            currentStreak: 0,
            maxStreak: 0
        };

        try {
            const saved = localStorage.getItem('solitaire-stats');
            if (!saved) return defaultStats;
            const parsed = JSON.parse(saved);
            // JSON 會把 Infinity 轉成 null，還原為 Infinity
            if (parsed.bestTime == null) parsed.bestTime = Infinity;
            if (parsed.bestMoves == null) parsed.bestMoves = Infinity;
            return { ...defaultStats, ...parsed };
        } catch (e) {
            return defaultStats;
        }
    }
    
    saveStats() {
        try {
            localStorage.setItem('solitaire-stats', JSON.stringify(this.stats));
        } catch (e) {}
    }
    
    recordWin() {
        this.stats.games++;
        this.stats.wins++;
        this.stats.currentStreak++;
        this.stats.maxStreak = Math.max(this.stats.maxStreak, this.stats.currentStreak);
        
        if (this.seconds < this.stats.bestTime) {
            this.stats.bestTime = this.seconds;
        }
        if (this.moves < this.stats.bestMoves) {
            this.stats.bestMoves = this.moves;
        }
        
        this.saveStats();
    }
    
    recordLoss() {
        this.stats.games++;
        this.stats.currentStreak = 0;
        this.saveStats();
    }
    
    showStats() {
        document.getElementById('stat-games').textContent = this.stats.games;
        document.getElementById('stat-wins').textContent = this.stats.wins;
        document.getElementById('stat-winrate').textContent = 
            this.stats.games > 0 ? Math.round(this.stats.wins / this.stats.games * 100) + '%' : '0%';
        document.getElementById('stat-best-time').textContent = 
            this.stats.bestTime < Infinity ? this.formatTime(this.stats.bestTime) : '--:--';
        document.getElementById('stat-best-moves').textContent = 
            this.stats.bestMoves < Infinity ? this.stats.bestMoves : '-';
        document.getElementById('stat-streak').textContent = this.stats.maxStreak;
        document.getElementById('stat-current-streak').textContent = this.stats.currentStreak;

        document.getElementById('stats-modal').classList.remove('hidden');
    }
    
    clearStats() {
        if (confirm('確定要清除所有統計資料嗎？')) {
            this.stats = { games: 0, wins: 0, bestTime: Infinity, bestMoves: Infinity, currentStreak: 0, maxStreak: 0 };
            this.saveStats();
            this.showStats();
        }
    }
    
    // === 挑戰模式 ===
    startChallenge(minutes) {
        // 清除已存在的挑戰計時器，避免洩漏
        if (this.challengeInterval) {
            clearInterval(this.challengeInterval);
            this.challengeInterval = null;
        }

        this.challengeMode = true;
        this.challengeTime = minutes * 60;
        document.getElementById('challenge-modal').classList.add('hidden');
        const scoreEl = document.getElementById('challenge-score');
        if (scoreEl) scoreEl.classList.remove('hidden');
        const timerEl = document.getElementById('challenge-timer');
        if (timerEl) timerEl.textContent = this.formatTime(this.challengeTime);

        // 開始計時
        this.challengeInterval = setInterval(() => {
            this.challengeTime--;
            if (timerEl) timerEl.textContent = this.formatTime(this.challengeTime);

            if (this.challengeTime <= 0) {
                this.endChallenge(false);
            }
        }, 1000);

        this.newGame();
    }

    endChallenge(win) {
        if (this.challengeInterval) {
            clearInterval(this.challengeInterval);
            this.challengeInterval = null;
        }
        this.challengeMode = false;

        const scoreEl = document.getElementById('challenge-score');
        if (scoreEl) scoreEl.classList.add('hidden');

        if (!win) {
            this.recordLoss();
        }

        // 使用挑戰結果 modal 取代 alert
        const modal = document.getElementById('challenge-result-modal');
        const title = document.getElementById('challenge-result-title');
        const message = document.getElementById('challenge-result-message');
        if (modal && title && message) {
            if (win) {
                title.textContent = '🎉 挑戰成功！';
                message.textContent = `用時 ${this.formatTime(this.seconds)}，移動 ${this.moves} 次`;
            } else {
                title.textContent = '⏰ 時間到！';
                message.textContent = '挑戰失敗，再試一次吧！';
            }
            modal.classList.remove('hidden');
        } else {
            // 備援：若 modal 不存在才用 alert
            if (win) {
                alert(`🎉 挑戰成功！用時 ${this.formatTime(this.seconds)}，移動 ${this.moves} 次！`);
            } else {
                alert('⏰ 時間到！挑戰失敗，再試一次吧！');
            }
            this.newGame();
        }
    }
    
    // === 主題系統（暗色/亮色模式）===
    
    initTheme() {
        // 從 localStorage 讀取主題設置
        const savedTheme = localStorage.getItem('solitaire-theme');
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        
        // 預設亮色模式，如果用戶設置過則使用設置值
        const isDark = savedTheme === 'dark' || (!savedTheme && prefersDark);
        
        if (isDark) {
            document.body.classList.add('dark-mode');
            this.updateThemeButton(true);
        } else {
            document.body.classList.remove('dark-mode');
            this.updateThemeButton(false);
        }
    }
    
    toggleTheme() {
        const isDark = document.body.classList.toggle('dark-mode');
        this.updateThemeButton(isDark);
        
        // 保存設置
        localStorage.setItem('solitaire-theme', isDark ? 'dark' : 'light');
        
        // 播放切換音效
        if (this.soundEnabled) {
            this.playSound('flip');
        }
    }
    
    updateThemeButton(isDark) {
        const btn = document.getElementById('theme-toggle');
        if (isDark) {
            btn.textContent = '☀️';
            btn.title = '目前: 暗色模式（點擊切換亮色）';
        } else {
            btn.textContent = '🌙';
            btn.title = '目前: 亮色模式（點擊切換暗色）';
        }
    }
    
    playSound(type) {
        if (!this.soundEnabled || !this.audioContext) return;
        
        const ctx = this.audioContext;
        const now = ctx.currentTime;
        
        if (type === 'flip') {
            // 翻牌音效 - 輕脆的彈聲
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.frequency.setValueAtTime(800, now);
            osc.frequency.exponentialRampToValueAtTime(400, now + 0.1);
            gain.gain.setValueAtTime(0.3, now);
            gain.gain.exponentialRampToValueAtTime(0.01, now + 0.1);
            osc.start(now);
            osc.stop(now + 0.1);
        } else if (type === 'hover') {
            // 懸停音效 - 柔和的提示音
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.frequency.setValueAtTime(600, now);
            gain.gain.setValueAtTime(0.1, now);
            gain.gain.exponentialRampToValueAtTime(0.01, now + 0.05);
            osc.start(now);
            osc.stop(now + 0.05);
        } else if (type === 'win') {
            // 獲勝音效 - 愉快的和弦
            const frequencies = [523, 659, 784, 1047]; // C E G C
            frequencies.forEach((freq, i) => {
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.connect(gain);
                gain.connect(ctx.destination);
                osc.frequency.setValueAtTime(freq, now + i * 0.1);
                osc.type = 'sine';
                gain.gain.setValueAtTime(0.2, now + i * 0.1);
                gain.gain.exponentialRampToValueAtTime(0.01, now + i * 0.1 + 0.3);
                osc.start(now + i * 0.1);
                osc.stop(now + i * 0.1 + 0.3);
            });
        } else if (type === 'drop') {
            // 落牌音效
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.frequency.setValueAtTime(300, now);
            osc.frequency.exponentialRampToValueAtTime(150, now + 0.08);
            gain.gain.setValueAtTime(0.25, now);
            gain.gain.exponentialRampToValueAtTime(0.01, now + 0.08);
            osc.start(now);
            osc.stop(now + 0.08);
        } else if (type === 'doubleClick') {
            // 雙擊音效 - 較沉的敲擊聲
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.frequency.setValueAtTime(500, now);
            osc.frequency.exponentialRampToValueAtTime(200, now + 0.15);
            gain.gain.setValueAtTime(0.35, now);
            gain.gain.exponentialRampToValueAtTime(0.01, now + 0.15);
            osc.start(now);
            osc.stop(now + 0.15);
        } else if (type === 'placeKing') {
            // K放到空白處 - 低沉的轟鳴聲
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.frequency.setValueAtTime(150, now);
            osc.frequency.exponentialRampToValueAtTime(80, now + 0.25);
            gain.gain.setValueAtTime(0.4, now);
            gain.gain.exponentialRampToValueAtTime(0.01, now + 0.25);
            osc.start(now);
            osc.stop(now + 0.25);
        } else if (type === 'success') {
            // 成功放置 - 愉快的短音效
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.frequency.setValueAtTime(600, now);
            osc.frequency.setValueAtTime(800, now + 0.05);
            gain.gain.setValueAtTime(0.25, now);
            gain.gain.exponentialRampToValueAtTime(0.01, now + 0.12);
            osc.start(now);
            osc.stop(now + 0.12);
        } else if (type === 'error') {
            // 錯誤放置 - 較短的警告聲
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.frequency.setValueAtTime(200, now);
            osc.frequency.setValueAtTime(150, now + 0.1);
            gain.gain.setValueAtTime(0.3, now);
            gain.gain.exponentialRampToValueAtTime(0.01, now + 0.15);
            osc.start(now);
            osc.stop(now + 0.15);
        }
    }
    
    showHints() {
        this.clearHints();
        if (!this.hintEnabled) return;
        
        const movableCards = this.findMovableCards();
        
        movableCards.forEach(info => {
            const cardEl = this.getCardElement(info);
            if (cardEl) {
                cardEl.classList.add('hint-highlight');
            }
        });
    }
    
    clearHints() {
        document.querySelectorAll('.hint-highlight').forEach(el => {
            el.classList.remove('hint-highlight');
        });
    }
    
    findMovableCards() {
        const movable = [];
        
        // 檢查 waste 最上面的牌
        if (this.waste.length > 0) {
            const card = this.waste[this.waste.length - 1];
            if (this.canMoveAnywhere(card, 'waste', -1)) {
                movable.push({ source: 'waste', cardIndex: this.waste.length - 1 });
            }
        }
        
        // 檢查每個 tableau 的可移動牌
        for (let pileIndex = 0; pileIndex < 7; pileIndex++) {
            const pile = this.tableau[pileIndex];
            
            for (let cardIndex = 0; cardIndex < pile.length; cardIndex++) {
                const card = pile[cardIndex];
                if (!card.faceUp) continue;
                
                // 檢查這張牌（及其上的牌）是否可以移動到其他地方
                if (this.canMoveAnywhere(card, 'tableau', pileIndex, cardIndex)) {
                    movable.push({ source: 'tableau', pileIndex, cardIndex });
                }
            }
        }
        
        // 檢查 foundation 最上面的牌（可以移回 tableau）
        for (let i = 0; i < 4; i++) {
            if (this.foundations[i].length > 0) {
                const card = this.foundations[i][this.foundations[i].length - 1];
                if (this.canMoveToAnyTableau(card)) {
                    movable.push({ source: 'foundation', pileIndex: i, cardIndex: this.foundations[i].length - 1 });
                }
            }
        }
        
        return movable;
    }
    
    canMoveAnywhere(card, source, pileIndex, cardIndex = -1) {
        // 檢查能否移到任一 foundation
        for (let i = 0; i < 4; i++) {
            if (this.canPlaceOnFoundation(card, i)) {
                // 只有單張牌能移到 foundation
                if (source === 'waste' || source === 'foundation') return true;
                if (source === 'tableau' && cardIndex === this.tableau[pileIndex].length - 1) return true;
            }
        }
        
        // 檢查能否移到任一 tableau
        if (this.canMoveToAnyTableau(card, source === 'tableau' ? pileIndex : -1)) {
            return true;
        }
        
        return false;
    }
    
    canMoveToAnyTableau(card, excludePileIndex = -1) {
        for (let i = 0; i < 7; i++) {
            if (i === excludePileIndex) continue;
            if (this.canPlaceOnTableau(card, i)) {
                return true;
            }
        }
        return false;
    }
    
    getCardElement(info) {
        if (info.source === 'waste') {
            // 頂牌為最後渲染的子元素（drawCount=3 時會顯示多張）
            return this.wasteEl.lastElementChild;
        } else if (info.source === 'tableau') {
            return this.tableauEls[info.pileIndex].children[info.cardIndex];
        } else if (info.source === 'foundation') {
            return this.foundationEls[info.pileIndex].lastElementChild;
        }
        return null;
    }
    
    // === 復原功能 ===
    
    saveState() {
        this.history.push({
            stock: this.stock.map(c => ({...c})),
            waste: this.waste.map(c => ({...c})),
            foundations: this.foundations.map(f => f.map(c => ({...c}))),
            tableau: this.tableau.map(t => t.map(c => ({...c}))),
            moves: this.moves
        });
        
        if (this.history.length > 30) {
            this.history.shift();
        }
    }
    
    undo() {
        if (this.history.length === 0) return;
        
        const state = this.history.pop();
        this.stock = state.stock;
        this.waste = state.waste;
        this.foundations = state.foundations;
        this.tableau = state.tableau;
        this.moves = state.moves;
        
        this.clearSelection();
        this.updateDisplay();
        this.updateInfo();
    }
    
    // === 勝利檢查 ===
    
    checkWin() {
        const totalFoundationCards = this.foundations.reduce((sum, f) => sum + f.length, 0);
        if (totalFoundationCards === 52) {
            clearInterval(this.timerInterval);
            
            // 記錄勝利
            this.recordWin();
            
            // 如果是挑戰模式，結束挑戰
            if (this.challengeMode) {
                this.endChallenge(true);
                return;
            }
            
            // 勝利音效
            this.playSound('win');
            
            // 播放勝利動畫
            this.playWinAnimation().then(() => {
                document.getElementById('final-moves').textContent = this.moves;
                document.getElementById('final-time').textContent = this.formatTime(this.seconds);
                document.getElementById('win-modal').classList.remove('hidden');
            });
        }
    }
    
    // === 勝利動畫 ===
    
    async playWinAnimation() {
        // 建立動畫容器
        const container = document.createElement('div');
        container.className = 'win-animation-container';
        document.body.appendChild(container);
        
        const screenWidth = window.innerWidth;
        const screenHeight = window.innerHeight;
        const cardWidth = this.parseCSSValue('--card-width') || 90;
        const cardHeight = this.parseCSSValue('--card-height') || 126;
        
        // 建立發牌順序：輪流從每個 foundation 取最上面的牌
        const cardQueue = [];
        const foundationCopies = this.foundations.map(f => [...f]);
        
        while (foundationCopies.some(f => f.length > 0)) {
            for (let f = 0; f < 4; f++) {
                if (foundationCopies[f].length > 0) {
                    const card = foundationCopies[f].pop();
                    cardQueue.push({ card, foundationIndex: f });
                }
            }
        }
        
        // 物理模擬參數
        const gravity = 0.4;
        const bounce = 0.7;
        const cards = [];
        
        // 依序發射卡牌
        let cardIndex = 0;
        const launchInterval = 100;  // 每張牌間隔
        
        return new Promise((resolve) => {
            const launchCard = () => {
                if (cardIndex >= cardQueue.length) return;
                
                const { card, foundationIndex } = cardQueue[cardIndex];
                const foundationEl = this.foundationEls[foundationIndex];
                const rect = foundationEl.getBoundingClientRect();
                
                // 從真正的 foundation 移除這張牌並更新顯示
                this.foundations[foundationIndex].pop();
                this.renderFoundations();
                
                // 建立掉落的卡牌元素
                const cardEl = document.createElement('div');
                cardEl.className = `falling-card ${card.color}`;
                cardEl.innerHTML = `
                    <div class="card-corner top">
                        <span class="card-rank">${card.rank}</span>
                        <span class="card-suit">${card.suit}</span>
                    </div>
                    <div class="card-center">${card.suit}</div>
                    <div class="card-corner bottom">
                        <span class="card-rank">${card.rank}</span>
                        <span class="card-suit">${card.suit}</span>
                    </div>
                `;
                cardEl.style.transform = `translate(${rect.left}px, ${rect.top}px)`;
                container.appendChild(cardEl);
                
                // 設定初始位置和速度
                const angle = -30 - Math.random() * 30;
                const speed = 8 + Math.random() * 4;
                const radians = angle * Math.PI / 180;
                
                cards.push({
                    el: cardEl,
                    x: rect.left,
                    y: rect.top,
                    vx: Math.cos(radians) * speed * (foundationIndex < 2 ? -1 : 1),
                    vy: Math.sin(radians) * speed,
                    rotation: 0,
                    rotationSpeed: (Math.random() - 0.5) * 8
                });
                
                cardIndex++;
                
                // 落牌音效
                this.playSound('drop');
                
                if (cardIndex < cardQueue.length) {
                    setTimeout(launchCard, launchInterval);
                }
            };
            
            // 動畫迴圈
            let animationFrame;
            let framesWithoutMovement = 0;
            
            const animate = () => {
                let anyMoving = false;
                
                cards.forEach(card => {
                    // 物理更新
                    card.vy += gravity;
                    card.x += card.vx;
                    card.y += card.vy;
                    card.rotation += card.rotationSpeed;
                    
                    // 地板碰撞
                    if (card.y > screenHeight - cardHeight) {
                        card.y = screenHeight - cardHeight;
                        card.vy = -card.vy * bounce;
                        card.vx *= 0.9;
                        card.rotationSpeed *= 0.8;
                        
                        if (Math.abs(card.vy) < 1) {
                            card.vy = 0;
                        }
                    }
                    
                    // 側邊碰撞
                    if (card.x < 0) {
                        card.x = 0;
                        card.vx = -card.vx * bounce;
                    } else if (card.x > screenWidth - cardWidth) {
                        card.x = screenWidth - cardWidth;
                        card.vx = -card.vx * bounce;
                    }
                    
                    // 更新位置
                    card.el.style.transform = `translate(${card.x}px, ${card.y}px) rotate(${card.rotation}deg)`;
                    
                    // 檢查是否還在移動
                    if (Math.abs(card.vx) > 0.1 || Math.abs(card.vy) > 0.1 || card.y < screenHeight - cardHeight - 5) {
                        anyMoving = true;
                    }
                });
                
                if (!anyMoving && cardIndex >= cardQueue.length) {
                    framesWithoutMovement++;
                    if (framesWithoutMovement > 60) {
                        cancelAnimationFrame(animationFrame);
                        setTimeout(() => {
                            container.remove();
                            resolve();
                        }, 500);
                        return;
                    }
                } else {
                    framesWithoutMovement = 0;
                }
                
                animationFrame = requestAnimationFrame(animate);
            };
            
            // 開始動畫
            launchCard();
            animate();
            
            // 最長 10 秒後結束
            setTimeout(() => {
                cancelAnimationFrame(animationFrame);
                container.remove();
                resolve();
            }, 10000);
        });
    }
    
    // === 自動完成功能 ===
    
    canAutoComplete() {
        // 條件：stock 和 waste 都是空的，且 tableau 上所有牌都翻開
        if (this.stock.length > 0) return false;
        if (this.waste.length > 0) return false;
        
        for (let pile of this.tableau) {
            for (let card of pile) {
                if (!card.faceUp) return false;
            }
        }
        
        return true;
    }
    
    async autoComplete() {
        if (this.isAutoCompleting) return;
        this.isAutoCompleting = true;
        
        const moveCard = async () => {
            // 找一張可以移到 foundation 的牌
            let moved = false;
            
            // 先檢查 tableau
            for (let pileIndex = 0; pileIndex < 7; pileIndex++) {
                const pile = this.tableau[pileIndex];
                if (pile.length === 0) continue;
                
                const card = pile[pile.length - 1];
                
                for (let foundationIndex = 0; foundationIndex < 4; foundationIndex++) {
                    if (this.canPlaceOnFoundation(card, foundationIndex)) {
                        // 執行飛行動畫
                        await this.animateCardToFoundation(pileIndex, foundationIndex, 'tableau');
                        
                        // 移動牌
                        pile.pop();
                        this.foundations[foundationIndex].push(card);
                        this.updateDisplay();
                        
                        moved = true;
                        break;
                    }
                }
                
                if (moved) break;
            }
            
            if (moved) {
                // 檢查是否贏了
                const totalFoundationCards = this.foundations.reduce((sum, f) => sum + f.length, 0);
                if (totalFoundationCards === 52) {
                    this.isAutoCompleting = false;
                    this.checkWin();
                } else {
                    // 繼續下一張
                    setTimeout(moveCard, 80);
                }
            } else {
                this.isAutoCompleting = false;
            }
        };
        
        moveCard();
    }
    
    async animateCardToFoundation(sourceIndex, foundationIndex, sourceType) {
        return new Promise(resolve => {
            let sourceEl, cardEl;
            
            if (sourceType === 'tableau') {
                sourceEl = this.tableauEls[sourceIndex];
                cardEl = sourceEl.lastElementChild;
            } else if (sourceType === 'waste') {
                sourceEl = this.wasteEl;
                cardEl = sourceEl.lastElementChild;
            }
            
            if (!cardEl) {
                resolve();
                return;
            }
            
            const targetEl = this.foundationEls[foundationIndex];
            const sourceRect = cardEl.getBoundingClientRect();
            const targetRect = targetEl.getBoundingClientRect();
            
            // 建立飛行中的牌
            const flyingCard = cardEl.cloneNode(true);
            flyingCard.classList.add('flying-card');
            flyingCard.style.position = 'fixed';
            flyingCard.style.left = sourceRect.left + 'px';
            flyingCard.style.top = sourceRect.top + 'px';
            flyingCard.style.zIndex = '10000';
            flyingCard.style.transition = 'all 0.25s ease-out';
            document.body.appendChild(flyingCard);
            
            // 隱藏原始牌
            cardEl.style.visibility = 'hidden';
            
            // 觸發動畫
            requestAnimationFrame(() => {
                flyingCard.style.left = targetRect.left + 'px';
                flyingCard.style.top = targetRect.top + 'px';
            });
            
            // 動畫結束後清理
            setTimeout(() => {
                flyingCard.remove();
                resolve();
            }, 260);
        });
    }
    
    checkAutoComplete() {
        if (this.canAutoComplete() && !this.isAutoCompleting) {
            this.autoComplete();
        }
    }
    
    // === UI 更新 ===
    
    updateDisplay() {
        this.renderStock();
        this.renderWaste();
        this.renderFoundations();
        this.renderTableau();
        
        // 刷新提示
        if (this.hintEnabled) {
            this.showHints();
        }
        
        // 檢查是否可以自動完成
        this.checkAutoComplete();
    }
    
    renderStock() {
        this.stockEl.innerHTML = '';
        if (this.stock.length > 0) {
            this.stockEl.classList.remove('empty');
            const cardEl = this.createCardElement({ faceUp: false }, false);
            cardEl.style.top = '0';
            this.stockEl.appendChild(cardEl);
        } else {
            this.stockEl.classList.add('empty');
        }
    }
    
    renderWaste() {
        this.wasteEl.innerHTML = '';
        if (this.waste.length > 0) {
            // 根據難度顯示卡片
            const showCount = Math.min(this.drawCount, this.waste.length);
            const startIndex = this.waste.length - showCount;
            
            for (let i = 0; i < showCount; i++) {
                const card = this.waste[startIndex + i];
                const cardEl = this.createCardElement(card, true);
                // 卡片稍微重疊
                cardEl.style.left = `${i * 0.6}vmin`;
                cardEl.style.top = '0';
                cardEl.style.zIndex = i + 1;
                cardEl.dataset.source = 'waste';
                cardEl.dataset.cardIndex = startIndex + i;
                this.wasteEl.appendChild(cardEl);
            }
        }
    }
    
    renderFoundations() {
        for (let i = 0; i < 4; i++) {
            this.foundationEls[i].innerHTML = '';
            const foundation = this.foundations[i];
            if (foundation.length > 0) {
                const card = foundation[foundation.length - 1];
                const cardEl = this.createCardElement(card, true);
                cardEl.style.top = '0';
                cardEl.dataset.source = 'foundation';
                cardEl.dataset.pileIndex = i;
                cardEl.dataset.cardIndex = foundation.length - 1;
                this.foundationEls[i].appendChild(cardEl);
            }
        }
    }
    
    renderTableau() {
        const cardHeight = this.parseCSSValue('--card-height') || 11.2 * Math.min(window.innerWidth, window.innerHeight) / 100;
        const tableauOffset = this.parseCSSValue('--tableau-offset') || 2.5 * Math.min(window.innerWidth, window.innerHeight) / 100;
        
        for (let i = 0; i < 7; i++) {
            this.tableauEls[i].innerHTML = '';
            const pile = this.tableau[i];
            
            pile.forEach((card, j) => {
                const cardEl = this.createCardElement(card, card.faceUp);
                cardEl.style.top = `${j * tableauOffset}px`;
                cardEl.style.zIndex = j;
                cardEl.dataset.source = 'tableau';
                cardEl.dataset.pileIndex = i;
                cardEl.dataset.cardIndex = j;
                this.tableauEls[i].appendChild(cardEl);
            });
            
            if (pile.length > 0) {
                const height = cardHeight + (pile.length - 1) * tableauOffset;
                this.tableauEls[i].style.height = `${height}px`;
            } else {
                this.tableauEls[i].style.height = '';
            }
        }
    }
    
    createCardElement(card, faceUp) {
        const el = document.createElement('div');
        el.className = `card ${faceUp ? 'face-up' : 'face-down'}`;

        // 懸停音效改在 setupEventListeners 用單一 delegated listener 處理，
        // 不在每張牌上掛 listener 以節省記憶體與 GC 壓力。


        if (faceUp && card.rank) {
            el.classList.add(card.color);
            el.innerHTML = `
                <div class="card-corner top">
                    <span class="card-rank">${card.rank}</span>
                    <span class="card-suit">${card.suit}</span>
                </div>
                <div class="card-center">${card.suit}</div>
                <div class="card-corner bottom">
                    <span class="card-rank">${card.rank}</span>
                    <span class="card-suit">${card.suit}</span>
                </div>
            `;
        }
        
        return el;
    }
    
    getCardFromElement(cardEl) {
        const source = cardEl.dataset.source;
        const pileIndex = parseInt(cardEl.dataset.pileIndex);
        const cardIndex = parseInt(cardEl.dataset.cardIndex);
        
        let card;
        if (source === 'waste') {
            card = this.waste[cardIndex];
        } else if (source === 'foundation') {
            card = this.foundations[pileIndex][cardIndex];
        } else if (source === 'tableau') {
            card = this.tableau[pileIndex][cardIndex];
        }
        
        return { source, pileIndex, cardIndex, card };
    }
    
    getCardPileInfo(cardEl) {
        const source = cardEl.dataset.source;
        if (!source) {
            const parent = cardEl.closest('.card-pile');
            if (parent) {
                if (parent.classList.contains('tableau-pile')) {
                    const index = this.tableauEls.indexOf(parent);
                    return { type: 'tableau', index };
                }
            }
        }
        
        if (source === 'tableau') {
            return { type: 'tableau', index: parseInt(cardEl.dataset.pileIndex) };
        }
        return null;
    }
    
    clearSelection() {
        document.querySelectorAll('.card.selected').forEach(el => {
            el.classList.remove('selected');
        });
        this.selectedCard = null;
    }
    
    updateInfo() {
        document.getElementById('moves').textContent = this.moves;
        const undoBtn = document.getElementById('undo-btn');
        if (undoBtn) {
            const count = this.history.length;
            undoBtn.textContent = count > 0 ? `↶ 復原 (${count})` : '↶ 復原';
            undoBtn.disabled = count === 0;
        }
        // 每次狀態變動後自動存檔，避免瀏覽器當機時遺失進度
        this.autoSave();
    }

    updateTimer() {
        this.seconds++;
        document.getElementById('timer').textContent = this.formatTime(this.seconds);
    }
    
    formatTime(seconds) {
        const m = Math.floor(seconds / 60);
        const s = seconds % 60;
        return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }
}

// 初始化遊戲
document.addEventListener('DOMContentLoaded', () => {
    window.solitaire = new Solitaire();
});
