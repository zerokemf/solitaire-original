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
        this.newGame();
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
        
        // 發牌堆點擊
        this.stockEl.addEventListener('click', (e) => {
            e.stopPropagation();
            this.drawFromStock();
        });
        
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
            if (e.key === 'z' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                this.undo();
            }
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
        
        this.createDeck();
        this.shuffleDeck(this.gameNumber);
        this.dealCards();
        
        this.updateDisplay();
        this.updateInfo();
        this.updateGameNumber();
    }
    
    updateGameNumber() {
        const el = document.getElementById('game-number');
        if (el) {
            el.textContent = `遊戲 #${this.gameNumber}`;
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
            
            // 使用求解器檢查是否還有解（減少迭代次數優化性能）
            const solvable = this.isSolvable();
            if (!solvable) {
                this.showDeadlockModal();
            }
        }, 500);
    }
    
    /**
     * 接龍求解器 - 使用深度限制搜索判斷是否可解
     * 回傳 true 表示可能有解，false 表示確定無解
     */
    isSolvable() {
        const maxIterations = 800; // 減少迭代次數提升性能
        let iterations = 0;
        
        // 狀態緩存，避免重複搜索
        const visitedStates = new Set();
        
        // 建立初始狀態
        const initialState = this.serializeState();
        
        // 使用 BFS 搜索
        const queue = [initialState];
        
        while (queue.length > 0 && iterations < maxIterations) {
            iterations++;
            const stateStr = queue.shift();
            
            // 跳過已訪問的狀態
            if (visitedStates.has(stateStr)) continue;
            visitedStates.add(stateStr);
            
            // 反序列化狀態
            const state = this.deserializeState(stateStr);
            
            // 檢查是否勝利
            const foundationTotal = state.foundations.reduce((sum, f) => sum + f.length, 0);
            if (foundationTotal === 52) {
                return true; // 找到解！
            }
            
            // 產生所有可能的下一步
            const nextStates = this.generateNextStates(state);
            
            for (const nextState of nextStates) {
                const nextStateStr = this.serializeStateObj(nextState);
                if (!visitedStates.has(nextStateStr)) {
                    queue.push(nextStateStr);
                }
            }
        }
        
        // 如果搜索完畢或達到限制，檢查是否還有移動可做
        // 如果還有狀態沒搜索完，假設可能有解
        if (queue.length > 0) {
            return true; // 還有未探索的可能性
        }
        
        return false; // 確定無解
    }
    
    /**
     * 序列化當前遊戲狀態為字串
     */
    serializeState() {
        return JSON.stringify({
            stock: this.stock.map(c => `${c.suit}${c.value}${c.faceUp ? 'U' : 'D'}`),
            waste: this.waste.map(c => `${c.suit}${c.value}`),
            foundations: this.foundations.map(f => f.map(c => `${c.suit}${c.value}`)),
            tableau: this.tableau.map(p => p.map(c => `${c.suit}${c.value}${c.faceUp ? 'U' : 'D'}`))
        });
    }
    
    /**
     * 序列化狀態物件為字串
     */
    serializeStateObj(state) {
        return JSON.stringify({
            stock: state.stock.map(c => `${c.suit}${c.value}${c.faceUp ? 'U' : 'D'}`),
            waste: state.waste.map(c => `${c.suit}${c.value}`),
            foundations: state.foundations.map(f => f.map(c => `${c.suit}${c.value}`)),
            tableau: state.tableau.map(p => p.map(c => `${c.suit}${c.value}${c.faceUp ? 'U' : 'D'}`))
        });
    }
    
    /**
     * 反序列化狀態字串
     */
    deserializeState(stateStr) {
        const data = JSON.parse(stateStr);
        
        const parseCard = (s, includeFace = true) => {
            const suit = s[0];
            let valueStr, faceUp;
            if (includeFace) {
                faceUp = s.endsWith('U');
                valueStr = s.slice(1, -1);
            } else {
                faceUp = true;
                valueStr = s.slice(1);
            }
            const value = parseInt(valueStr);
            return {
                suit,
                rank: this.ranks[value - 1],
                value,
                color: this.suitColors[suit],
                faceUp
            };
        };
        
        return {
            stock: data.stock.map(s => parseCard(s, true)),
            waste: data.waste.map(s => parseCard(s, false)),
            foundations: data.foundations.map(f => f.map(s => parseCard(s, false))),
            tableau: data.tableau.map(p => p.map(s => parseCard(s, true)))
        };
    }
    
    /**
     * 產生所有可能的下一個狀態
     */
    generateNextStates(state) {
        const nextStates = [];
        
        // 1. 從 stock 翻牌到 waste
        if (state.stock.length > 0) {
            const newState = this.cloneState(state);
            const card = newState.stock.pop();
            card.faceUp = true;
            newState.waste.push(card);
            nextStates.push(newState);
        } else if (state.waste.length > 0) {
            // 翻轉 waste 回 stock
            const newState = this.cloneState(state);
            while (newState.waste.length > 0) {
                const card = newState.waste.pop();
                card.faceUp = false;
                newState.stock.push(card);
            }
            nextStates.push(newState);
        }
        
        // 2. 從 waste 移動到 foundation 或 tableau
        if (state.waste.length > 0) {
            const card = state.waste[state.waste.length - 1];
            
            // 移到 foundation
            for (let f = 0; f < 4; f++) {
                if (this.canPlaceOnFoundationState(card, state.foundations[f])) {
                    const newState = this.cloneState(state);
                    const movedCard = newState.waste.pop();
                    newState.foundations[f].push(movedCard);
                    nextStates.push(newState);
                }
            }
            
            // 移到 tableau
            for (let t = 0; t < 7; t++) {
                if (this.canPlaceOnTableauState(card, state.tableau[t])) {
                    const newState = this.cloneState(state);
                    const movedCard = newState.waste.pop();
                    newState.tableau[t].push(movedCard);
                    nextStates.push(newState);
                }
            }
        }
        
        // 3. 從 tableau 移動
        for (let t = 0; t < 7; t++) {
            const pile = state.tableau[t];
            
            for (let cardIdx = 0; cardIdx < pile.length; cardIdx++) {
                const card = pile[cardIdx];
                if (!card.faceUp) continue;
                
                // 最上面的牌可以移到 foundation
                if (cardIdx === pile.length - 1) {
                    for (let f = 0; f < 4; f++) {
                        if (this.canPlaceOnFoundationState(card, state.foundations[f])) {
                            const newState = this.cloneState(state);
                            const movedCard = newState.tableau[t].pop();
                            newState.foundations[f].push(movedCard);
                            this.flipTopCardState(newState.tableau[t]);
                            nextStates.push(newState);
                        }
                    }
                }
                
                // 移動到其他 tableau（包含其上的所有牌）
                for (let targetT = 0; targetT < 7; targetT++) {
                    if (targetT === t) continue;
                    if (this.canPlaceOnTableauState(card, state.tableau[targetT])) {
                        const newState = this.cloneState(state);
                        const movedCards = newState.tableau[t].splice(cardIdx);
                        newState.tableau[targetT].push(...movedCards);
                        this.flipTopCardState(newState.tableau[t]);
                        nextStates.push(newState);
                    }
                }
            }
        }
        
        // 4. 從 foundation 移回 tableau（較少用但合法）
        for (let f = 0; f < 4; f++) {
            if (state.foundations[f].length > 0) {
                const card = state.foundations[f][state.foundations[f].length - 1];
                for (let t = 0; t < 7; t++) {
                    if (this.canPlaceOnTableauState(card, state.tableau[t])) {
                        const newState = this.cloneState(state);
                        const movedCard = newState.foundations[f].pop();
                        newState.tableau[t].push(movedCard);
                        nextStates.push(newState);
                    }
                }
            }
        }
        
        return nextStates;
    }
    
    /**
     * 深拷貝狀態
     */
    cloneState(state) {
        return {
            stock: state.stock.map(c => ({...c})),
            waste: state.waste.map(c => ({...c})),
            foundations: state.foundations.map(f => f.map(c => ({...c}))),
            tableau: state.tableau.map(p => p.map(c => ({...c})))
        };
    }
    
    /**
     * 檢查是否可放到 foundation（使用狀態）
     */
    canPlaceOnFoundationState(card, foundation) {
        if (foundation.length === 0) {
            return card.value === 1;
        }
        const topCard = foundation[foundation.length - 1];
        return card.suit === topCard.suit && card.value === topCard.value + 1;
    }
    
    /**
     * 檢查是否可放到 tableau（使用狀態）- 修正版
     */
    canPlaceOnTableauState(card, pile) {
        if (pile.length === 0) {
            return true; // 空牌堆可以放任何牌
        }
        const topCard = pile[pile.length - 1];
        if (!topCard.faceUp) return false;
        return card.color !== topCard.color && card.value === topCard.value - 1;
    }
    
    /**
     * 翻開牌堆最上面的牌
     */
    flipTopCardState(pile) {
        if (pile.length > 0 && !pile[pile.length - 1].faceUp) {
            pile[pile.length - 1].faceUp = true;
        }
    }
    
    hasAnyLegalMove() {
        // 這個函數現在只用於快速檢查，真正的死局判斷由 isSolvable 處理
        // 保留原本的邏輯作為快速篩選
        if (this.stock.length > 0) return true;
        if (this.stock.length === 0 && this.waste.length > 0) return true;
        
        // 檢查 waste
        if (this.waste.length > 0) {
            const card = this.waste[this.waste.length - 1];
            for (let i = 0; i < 4; i++) {
                if (this.canPlaceOnFoundation(card, i)) return true;
            }
            for (let i = 0; i < 7; i++) {
                if (this.canPlaceOnTableau(card, i)) return true;
            }
        }
        
        // 檢查 tableau
        for (let pileIndex = 0; pileIndex < 7; pileIndex++) {
            const pile = this.tableau[pileIndex];
            for (let cardIndex = 0; cardIndex < pile.length; cardIndex++) {
                const card = pile[cardIndex];
                if (!card.faceUp) continue;
                
                if (cardIndex === pile.length - 1) {
                    for (let f = 0; f < 4; f++) {
                        if (this.canPlaceOnFoundation(card, f)) return true;
                    }
                }
                
                for (let targetPile = 0; targetPile < 7; targetPile++) {
                    if (targetPile === pileIndex) continue;
                    if (this.canPlaceOnTableau(card, targetPile)) return true;
                }
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
        const tableauOffset = this.parseCSSValue('--tableau-offset') || 28;
        
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
            this.tableau[this.dragSource.pileIndex].splice(this.dragSource.cardIndex);
            this.flipTopCard(this.dragSource.pileIndex);
        }
        
        // 放到目標
        if (target.type === 'foundation') {
            this.foundations[target.index].push(this.draggedCards[0]);
        } else if (target.type === 'tableau') {
            this.tableau[target.index].push(...this.draggedCards);
            
            // K 放到空白處的音效
            if (isKingToEmpty) {
                console.log('Playing placeKing sound for drag K to empty');
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
                    console.log('Playing placeKing sound for K to empty pile');
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
        const baseOffset = Math.max(3.0, 2.5 * this.zoomLevel);
        
        root.style.setProperty('--card-width', `${baseWidth * this.zoomLevel}vmin`);
        root.style.setProperty('--card-height', `${baseHeight * this.zoomLevel}vmin`);
        root.style.setProperty('--card-radius', `${baseRadius * this.zoomLevel}vmin`);
        root.style.setProperty('--pile-gap', `${baseGap * this.zoomLevel}vmin`);
        root.style.setProperty('--tableau-offset', `${baseOffset}vmin`);
        
        // 遊戲容器寬度也跟著變大
        root.style.setProperty('--container-width', `${90 * this.zoomLevel}vmin`);
        
        // 花色大小也跟著變
        root.style.setProperty('--font-rank', `${1.5 * this.zoomLevel}vmin`);
        root.style.setProperty('--font-suit', `${1.1 * this.zoomLevel}vmin`);
        root.style.setProperty('--font-center', `${3 * this.zoomLevel}vmin`);
        
        // 菜單字體
        root.style.setProperty('--font-header', `${2 * this.zoomLevel}vmin`);
        root.style.setProperty('--font-info', `${1.3 * this.zoomLevel}vmin`);
        root.style.setProperty('--font-btn', `${1.3 * this.zoomLevel}vmin`);
        
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
        btn.textContent = this.drawCount === 1 ? '📋 簡單' : '📋 困難';
        btn.title = this.drawCount === 1 ? '目前：一次翻一張' : '目前：一次翻三張';
        // 重新渲染廢牌堆
        this.renderWaste();
    }
    
    // === 音效系統 ===
    
    toggleSound() {
        // 第一次點擊時初始化音頻上下文
        if (!this.audioContext) {
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        }
        
        this.soundEnabled = !this.soundEnabled;
        const btn = document.getElementById('sound-toggle');
        btn.textContent = this.soundEnabled ? '🔊 音效' : '🔇 靜音';
        btn.title = this.soundEnabled ? '點擊關閉音效' : '點擊開啟音效';
        
        // 測試音效（如果開啟）
        if (this.soundEnabled) {
            this.playSound('flip');
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
            return this.wasteEl.querySelector('.card');
        } else if (info.source === 'tableau') {
            return this.tableauEls[info.pileIndex].children[info.cardIndex];
        } else if (info.source === 'foundation') {
            return this.foundationEls[info.pileIndex].querySelector('.card');
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
        
        if (this.history.length > 50) {
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
        const tableauOffset = this.parseCSSValue('--tableau-offset') || 28;
        
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
                const height = 126 + (pile.length - 1) * tableauOffset;
                this.tableauEls[i].style.height = `${height}px`;
            } else {
                this.tableauEls[i].style.height = '';
            }
        }
    }
    
    createCardElement(card, faceUp) {
        const el = document.createElement('div');
        el.className = `card ${faceUp ? 'face-up' : 'face-down'}`;
        
        // 懸停音效（節流）
        let hoverPlaying = false;
        el.addEventListener('mouseenter', () => {
            if (!hoverPlaying) {
                hoverPlaying = true;
                this.playSound('hover');
                setTimeout(() => hoverPlaying = false, 100);
            }
        });
        
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
        document.getElementById('moves').textContent = `移動: ${this.moves}`;
    }
    
    updateTimer() {
        this.seconds++;
        document.getElementById('timer').textContent = `時間: ${this.formatTime(this.seconds)}`;
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
