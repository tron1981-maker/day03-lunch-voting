// Application State
let state = {
    // Combined votes (sheet + local user votes)
    votes: {
        bibimbap: 0,
        donkatsu: 0,
        gukbap: 0,
        salad: 0
    },
    // Votes loaded from the Google Sheet
    sheetVotes: {
        bibimbap: 0,
        donkatsu: 0,
        gukbap: 0,
        salad: 0
    },
    // User's own votes in this browser session
    localVotes: {
        bibimbap: 0,
        donkatsu: 0,
        gukbap: 0,
        salad: 0
    },
    selectedMenu: null,
    isSimulationActive: false,
    lastVoteTime: null
};

// Menu names Korean mapping
const MENU_NAMES_KR = {
    bibimbap: '비빔밥 🍚',
    donkatsu: '돈까스 🥩',
    gukbap: '국밥 🍲',
    salad: '샐러드 🥗'
};

// DOM Elements
const menuCards = document.querySelectorAll('.menu-card');
const voteButton = document.getElementById('voteButton');
const resetButton = document.getElementById('resetButton');
const totalVotesCount = document.getElementById('totalVotesCount');
const topMenuValue = document.getElementById('topMenuValue');
const lastVoteTimeValue = document.getElementById('lastVoteTimeValue');
const simulationToggle = document.getElementById('simulationToggle');
const toastAlert = document.getElementById('toastAlert');
const toastIcon = document.getElementById('toastIcon');
const toastMessage = document.getElementById('toastMessage');

// Simulation & Polling Timer variables
let simulationIntervalId = null;
let pollingIntervalId = null;
let toastTimeoutId = null;

// Initialize App
function init() {
    // Load local votes from localStorage
    const savedLocalVotes = localStorage.getItem('lunch_local_votes');
    const savedLastVoteTime = localStorage.getItem('lunch_last_vote_time');
    
    if (savedLocalVotes) {
        state.localVotes = JSON.parse(savedLocalVotes);
    }
    if (savedLastVoteTime) {
        state.lastVoteTime = savedLastVoteTime;
    }

    // Set up card event listeners
    menuCards.forEach(card => {
        card.addEventListener('click', () => {
            const menuName = card.dataset.menu;
            selectMenu(menuName);
        });

        card.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                selectMenu(card.dataset.menu);
            }
        });
    });

    // Set up button listeners
    voteButton.addEventListener('click', handleVoteSubmit);
    resetButton.addEventListener('click', handleReset);
    simulationToggle.addEventListener('change', handleSimulationToggle);

    // Initial load from Google Sheet
    refreshVotesFromSheet();

    // Start polling from Google Sheet every 5 seconds
    startPolling();
}

// Start polling from backend API
function startPolling() {
    if (pollingIntervalId) clearInterval(pollingIntervalId);
    pollingIntervalId = setInterval(() => {
        // Only poll if simulation is not overriding the screen
        if (!state.isSimulationActive) {
            refreshVotesFromSheet();
        }
    }, 5000);
}

// Stop polling from backend API
function stopPolling() {
    if (pollingIntervalId) {
        clearInterval(pollingIntervalId);
        pollingIntervalId = null;
    }
}

// Fetch and parse votes from Google Sheet proxy API
function refreshVotesFromSheet() {
    fetch('/api/votes')
        .then(res => res.json())
        .then(data => {
            if (data && !data.error) {
                // Update sheet votes (default to 0 if not present)
                state.sheetVotes = {
                    bibimbap: data.bibimbap || 0,
                    donkatsu: data.donkatsu || 0,
                    gukbap: data.gukbap || 0,
                    salad: data.salad || 0
                };
                
                // Combine sheet votes with user's local votes
                combineVotes();
                updateUI();
            } else if (data && data.error) {
                console.warn('API returned error fetching sheet:', data.error);
                // Fallback to local votes only (sheet votes are treated as 0)
                state.sheetVotes = { bibimbap: 0, donkatsu: 0, gukbap: 0, salad: 0 };
                combineVotes();
                updateUI();
            }
        })
        .catch(err => {
            console.error('Error fetching sheet votes:', err);
            // Fallback: treat sheet votes as 0
            state.sheetVotes = { bibimbap: 0, donkatsu: 0, gukbap: 0, salad: 0 };
            combineVotes();
            updateUI();
        });
}

// Combine Google Sheet votes and user's local votes
function combineVotes() {
    Object.keys(state.votes).forEach(key => {
        state.votes[key] = (state.sheetVotes[key] || 0) + (state.localVotes[key] || 0);
    });
}

// Select Menu Item
function selectMenu(menuKey) {
    if (state.selectedMenu === menuKey) {
        state.selectedMenu = null;
    } else {
        state.selectedMenu = menuKey;
    }

    menuCards.forEach(card => {
        const isSelected = card.dataset.menu === state.selectedMenu;
        card.setAttribute('aria-checked', isSelected ? 'true' : 'false');
    });

    if (state.selectedMenu) {
        voteButton.removeAttribute('disabled');
        voteButton.classList.add('animate-pulse-btn');
    } else {
        voteButton.setAttribute('disabled', 'true');
        voteButton.classList.remove('animate-pulse-btn');
    }
}

// Handle Vote Submission
function handleVoteSubmit() {
    if (!state.selectedMenu) return;

    const selected = state.selectedMenu;
    
    // Disable the button to prevent multiple submissions
    voteButton.setAttribute('disabled', 'true');
    voteButton.classList.remove('animate-pulse-btn');
    
    // POST request to backend proxy (Google Sheet Write Proxy)
    fetch('/api/vote', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ menu: selected })
    })
    .then(res => res.json())
    .then(data => {
        const now = new Date();
        state.lastVoteTime = now.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        
        if (data.result === 'success') {
            // Vote successfully written to Google Sheet!
            showToast(`"${MENU_NAMES_KR[selected]}" 메뉴에 성공적으로 투표했습니다! (구글 시트 저장 완료)`, '🎉');
            
            // Refetch immediately to display the new vote
            refreshVotesFromSheet();
        } else if (data.result === 'local') {
            // GAS URL is not configured, fall back to local storage
            state.localVotes[selected]++;
            saveToStorage();
            showToast(`"${MENU_NAMES_KR[selected]}" 메뉴에 투표했습니다! (구글 시트 미연동 - 로컬 저장됨)`, '💡');
            combineVotes();
            updateUI();
        } else {
            // Error from server
            console.error('Vote submission error:', data.error);
            showToast('투표 처리 중 오류가 발생했습니다. 로컬에 임시 기록합니다.', '⚠️');
            state.localVotes[selected]++;
            saveToStorage();
            combineVotes();
            updateUI();
        }
    })
    .catch(err => {
        console.error('Vote connection error:', err);
        showToast('네트워크 오류가 발생했습니다. 로컬에 임시 기록합니다.', '🔌');
        state.localVotes[selected]++;
        saveToStorage();
        combineVotes();
        updateUI();
    })
    .finally(() => {
        // Reset selection state
        state.selectedMenu = null;
        menuCards.forEach(card => card.setAttribute('aria-checked', 'false'));
    });
}

// Handle Results Reset
function handleReset() {
    if (confirm('투표 결과를 초기화하시겠습니까?\n구글 시트 데이터는 읽기 전용이므로 사용자의 로컬 투표 기록만 초기화됩니다.')) {
        state.localVotes = {
            bibimbap: 0,
            donkatsu: 0,
            gukbap: 0,
            salad: 0
        };
        state.lastVoteTime = null;
        state.selectedMenu = null;
        
        // Turn off simulation if running
        if (state.isSimulationActive) {
            simulationToggle.checked = false;
            handleSimulationToggle();
        }

        saveToStorage();
        
        menuCards.forEach(card => card.setAttribute('aria-checked', 'false'));
        voteButton.setAttribute('disabled', 'true');
        voteButton.classList.remove('animate-pulse-btn');

        showToast('로컬 투표 기록이 초기화되었습니다.', '🔄');
        
        // Refetch sheet and update UI
        refreshVotesFromSheet();
    }
}

// Handle Simulation Toggle
function handleSimulationToggle() {
    state.isSimulationActive = simulationToggle.checked;
    
    if (state.isSimulationActive) {
        stopPolling();
        showToast('실시간 모의 투표 시뮬레이션이 시작되었습니다.', '⚡');
        startSimulation();
    } else {
        stopSimulation();
        showToast('실시간 모의 투표 시뮬레이션이 종료되었습니다. 구글 시트 데이터를 동기화합니다.', '⏹️');
        refreshVotesFromSheet();
        startPolling();
    }
}

// Start Live Simulation (adds mock votes to visual count)
function startSimulation() {
    if (simulationIntervalId) clearInterval(simulationIntervalId);

    const runTick = () => {
        if (!state.isSimulationActive) return;

        const menuKeys = Object.keys(state.votes);
        const randomMenu = menuKeys[Math.floor(Math.random() * menuKeys.length)];

        // Increment combined votes directly for animation effect
        state.votes[randomMenu]++;
        
        const now = new Date();
        state.lastVoteTime = now.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        
        updateUI();

        const nextInterval = Math.random() * 2500 + 1500;
        simulationIntervalId = setTimeout(runTick, nextInterval);
    };

    simulationIntervalId = setTimeout(runTick, 1000);
}

// Stop Live Simulation
function stopSimulation() {
    if (simulationIntervalId) {
        clearTimeout(simulationIntervalId);
        simulationIntervalId = null;
    }
}

// Save state to localStorage
function saveToStorage() {
    localStorage.setItem('lunch_local_votes', JSON.stringify(state.localVotes));
    if (state.lastVoteTime) {
        localStorage.setItem('lunch_last_vote_time', state.lastVoteTime);
    } else {
        localStorage.removeItem('lunch_last_vote_time');
    }
}

// Update DOM elements based on state
function updateUI() {
    const totalVotes = Object.values(state.votes).reduce((sum, val) => sum + val, 0);
    totalVotesCount.textContent = `총 ${totalVotes}표`;

    // Render Progress Bars
    Object.keys(state.votes).forEach(menuKey => {
        const count = state.votes[menuKey];
        const percentage = totalVotes > 0 ? Math.round((count / totalVotes) * 100) : 0;
        
        const resultItem = document.getElementById(`result-${menuKey}`);
        if (resultItem) {
            const pctLabel = resultItem.querySelector('.pct');
            const cntLabel = resultItem.querySelector('.cnt');
            const barFill = resultItem.querySelector('.bar-fill');

            pctLabel.textContent = `${percentage}%`;
            cntLabel.textContent = `(${count}표)`;
            barFill.style.width = `${percentage}%`;
        }
    });

    // Update Top Menu
    let topMenus = [];
    let maxVotes = -1;

    Object.keys(state.votes).forEach(menuKey => {
        const count = state.votes[menuKey];
        if (count > maxVotes && count > 0) {
            maxVotes = count;
            topMenus = [menuKey];
        } else if (count === maxVotes && count > 0) {
            topMenus.push(menuKey);
        }
    });

    if (topMenus.length === 0) {
        topMenuValue.textContent = '투표 없음';
    } else if (topMenus.length === 1) {
        topMenuValue.textContent = MENU_NAMES_KR[topMenus[0]];
    } else {
        const tieNames = topMenus.map(m => m === 'bibimbap' ? '비빔밥' : m === 'donkatsu' ? '돈까스' : m === 'gukbap' ? '국밥' : '샐러드').join(', ');
        topMenuValue.textContent = `${tieNames} (공동 1위)`;
    }

    lastVoteTimeValue.textContent = state.lastVoteTime || '-';
}

// Display Custom Toast Alert
function showToast(message, icon = '💡') {
    if (toastTimeoutId) {
        clearTimeout(toastTimeoutId);
    }

    toastIcon.textContent = icon;
    toastMessage.textContent = message;
    toastAlert.classList.remove('hidden');

    toastTimeoutId = setTimeout(() => {
        toastAlert.classList.add('hidden');
    }, 3000);
}

// Run app init on load
document.addEventListener('DOMContentLoaded', init);
