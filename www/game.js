// ====================================================================
// FLAPPY PHILIPPOT - MOTEUR MOBILE ULTRA-FLUIDE (60 FPS FIXED PHYSICS)
// MULTIJOUEUR SYNCHRONE : 1 SALON UNIQUE PAR NIVEAU DE DIFFICULTÉ
// ====================================================================

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// --- Dimensions de référence (Identiques au jeu original) ---
const BASE_WIDTH = 400;
const BASE_HEIGHT = 600;
const GROUND_Y = 550; // Le sol est exactement à 550px comme dans l'original

let scale = 1;
let offsetX = 0;
let offsetY = 0;
let canvasWidth = 400;
let canvasHeight = 600;

function resizeCanvas() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2); // Max 2 pour fluidité optimale
    const rect = canvas.getBoundingClientRect();
    canvasWidth = rect.width;
    canvasHeight = rect.height;

    canvas.width = Math.round(canvasWidth * dpr);
    canvas.height = Math.round(canvasHeight * dpr);

    const scaleX = canvasWidth / BASE_WIDTH;
    const scaleY = canvasHeight / BASE_HEIGHT;

    // Si l'écran est un smartphone tout en hauteur (scaleY >= scaleX) :
    // On cale l'échelle sur la largeur et on répartit la hauteur (ciel et sol)
    if (scaleY >= scaleX) {
        scale = scaleX * dpr;
        offsetY = (canvasHeight * dpr / scale - BASE_HEIGHT) / 2;
        offsetX = 0;
    } else {
        // Si l'écran est plus court en hauteur (ex: PC, fenêtre de navigateur) :
        // On cale l'échelle sur la hauteur pour que le sol et TOUS les tuyaux soient 100% VISIBLES !
        scale = scaleY * dpr;
        offsetX = (canvasWidth * dpr / scale - BASE_WIDTH) / 2;
        offsetY = 0;
    }
}
window.addEventListener('resize', resizeCanvas);
window.addEventListener('orientationchange', () => setTimeout(resizeCanvas, 100));
resizeCanvas();

// --- Configuration API & Serveur ---
const REMOTE_API_DEFAULT = 'https://valentingabriel.fr/Flappy-Philippot/api.php';
let storedApi = localStorage.getItem('flappy_api_url');
if (!storedApi || storedApi === 'api.php' || storedApi.trim() === '') {
    storedApi = REMOTE_API_DEFAULT;
    localStorage.setItem('flappy_api_url', storedApi);
}
let API_URL = storedApi;

const CLOUD_WS_DEFAULT = 'wss://flappy-philippot-server.onrender.com';
let rawWs = localStorage.getItem('flappy_ws_url');
if (!rawWs || rawWs.includes('trycloudflare.com') || rawWs.includes('localhost') || rawWs.trim() === '' || rawWs !== CLOUD_WS_DEFAULT) {
    rawWs = CLOUD_WS_DEFAULT;
    localStorage.setItem('flappy_ws_url', rawWs);
}
let WS_URL = rawWs;

function getDefaultWsUrl() {
    return WS_URL || CLOUD_WS_DEFAULT;
}

// --- Pseudo-Random déterministe pour synchronisation de la Map ---
function mulberry32(a) {
    return function() {
        let t = (a += 0x6D2B79F5);
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// --- Niveaux et Difficultés (Valeurs exactes de l'original) ---
const diffSettings = {
    'facile': { dx: 1.8, gap: 200, spawnRate: 140, label: 'Facile', moving: false },
    'normal': { dx: 2.5, gap: 160, spawnRate: 110, label: 'Normal', moving: false },
    'difficile': { dx: 3.5, gap: 130, spawnRate: 85, label: 'Dur', moving: false },
    'hardcore': { dx: 2.8, gap: 140, spawnRate: 100, label: 'Hardcore 💀', moving: true, pipeVy: 1.0 }
};
let currentDiff = 'normal';

// --- Sons et Retours Haptiques ---
let audioCtx = null;
let soundEnabled = localStorage.getItem('flappy_sound') !== 'false';
let musicEnabled = localStorage.getItem('flappy_music') !== 'false';
let hapticsEnabled = localStorage.getItem('flappy_haptics') !== 'false';

const bgMusic = new Audio('mario.mp3');
bgMusic.volume = 0.25;
bgMusic.loop = true;

function initAudio() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
}

function triggerHaptic(type) {
    if (!hapticsEnabled) return;
    try {
        if (window.Capacitor?.Plugins?.Haptics) {
            if (type === 'jump') window.Capacitor.Plugins.Haptics.impact({ style: 'LIGHT' });
            else if (type === 'hit') window.Capacitor.Plugins.Haptics.notification({ type: 'ERROR' });
        } else if (navigator.vibrate) {
            navigator.vibrate(type === 'jump' ? 20 : 120);
        }
    } catch (e) {}
}

function playSound(type) {
    if (!soundEnabled || !audioCtx) return;
    try {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.connect(gain);
        gain.connect(audioCtx.destination);

        if (type === 'jump') {
            osc.type = 'sine';
            osc.frequency.setValueAtTime(320, audioCtx.currentTime);
            osc.frequency.exponentialRampToValueAtTime(650, audioCtx.currentTime + 0.09);
            gain.gain.setValueAtTime(0.12, audioCtx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.09);
            osc.start();
            osc.stop(audioCtx.currentTime + 0.09);
        } else if (type === 'hit') {
            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(160, audioCtx.currentTime);
            osc.frequency.exponentialRampToValueAtTime(35, audioCtx.currentTime + 0.25);
            gain.gain.setValueAtTime(0.18, audioCtx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.25);
            osc.start();
            osc.stop(audioCtx.currentTime + 0.25);
        } else if (type === 'score') {
            osc.type = 'sine';
            osc.frequency.setValueAtTime(988, audioCtx.currentTime);
            osc.frequency.setValueAtTime(1319, audioCtx.currentTime + 0.07);
            gain.gain.setValueAtTime(0.12, audioCtx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.25);
            osc.start();
            osc.stop(audioCtx.currentTime + 0.25);
        }
    } catch (e) {}
}

// --- Images et Avatar ---
const defaultImg = new Image();
defaultImg.src = 'visage.png';

// Couleur de l'anneau : JAUNE par défaut (#facc15), puis assignée automatiquement par le serveur
let playerColor = '#facc15';

let savedPseudo = localStorage.getItem('flappy_pseudo') || '';
if (savedPseudo) {
    document.getElementById('playerPseudo').value = savedPseudo;
}

function getPseudo() {
    return document.getElementById('playerPseudo').value.trim();
}

function validatePseudo() {
    const p = getPseudo();
    if (!p) {
        const input = document.getElementById('playerPseudo');
        input.classList.add('input-error');
        input.focus();
        showEventToast('⚠️ Entre ton pseudo pour jouer !');
        setTimeout(() => input.classList.remove('input-error'), 450);
        return false;
    }
    return true;
}

// --- État du Jeu ---
let frames = 0;
let score = 0;
let currentState = 0; // 0 = Menu, 1 = En jeu, 2 = Game Over
let mapSeed = Math.floor(Math.random() * 1000000);

// --- Joueur Local (Physique originale préservée au pixel près) ---
const player = {
    x: 100,
    y: 300,
    width: 60,
    height: 60,
    radius: 24,
    velocity: 0,
    gravity: 0.25,
    jumpForce: -5.5,
    rotation: 0,
    distance: 0,
    alive: true,

    draw: function() {
        ctx.save();
        ctx.translate(this.x, this.y);
        this.rotation = Math.min(Math.PI / 4, Math.max(-Math.PI / 4, this.velocity * 0.1));
        ctx.rotate(this.rotation);

        // Anneau circulaire coloré
        ctx.beginPath();
        ctx.arc(0, 0, this.radius + 3, 0, Math.PI * 2);
        ctx.strokeStyle = playerColor;
        ctx.lineWidth = 3.5;
        ctx.stroke();

        // Découpe circulaire de la vignette
        ctx.beginPath();
        ctx.arc(0, 0, this.radius, 0, Math.PI * 2);
        ctx.closePath();
        ctx.clip();

        if (defaultImg.complete && defaultImg.naturalWidth !== 0) {
            ctx.drawImage(defaultImg, -this.width / 2, -this.height / 2 * 1.3, this.width, this.height * 1.3);
        } else {
            ctx.fillStyle = playerColor;
            ctx.fill();
        }
        ctx.restore();

        // Pseudo au-dessus du joueur local
        ctx.save();
        ctx.font = 'bold 11px sans-serif';
        const pseudo = getPseudo() || 'Moi';
        const tw = ctx.measureText(pseudo).width;
        ctx.fillStyle = 'rgba(15, 23, 42, 0.75)';
        drawRoundedRect(ctx, this.x - tw / 2 - 6, this.y - this.radius - 22, tw + 12, 16, 6);
        ctx.fill();
        ctx.fillStyle = '#fef08a';
        ctx.textAlign = 'center';
        ctx.fillText(pseudo, this.x, this.y - this.radius - 10);
        ctx.restore();
    },

    update: function(dt = 1) {
        this.velocity += this.gravity * dt;
        this.y += this.velocity * dt;
        this.distance += diffSettings[currentDiff].dx * dt;

        // Collision avec le sol
        if (this.y + this.radius >= GROUND_Y) {
            this.y = GROUND_Y - this.radius;
            gameOver();
        }
        // Plafond
        if (this.y - this.radius <= 0) {
            this.y = this.radius;
            this.velocity = 0;
        }
    },

    jump: function() {
        this.velocity = this.jumpForce;
        playSound('jump');
        triggerHaptic('jump');
        sendNetworkUpdate(true);
    }
};

// --- Moteur de Tuyaux Synchronisés (Seeded) ---
const pipes = {
    items: [],
    width: 60,
    gap: 160,
    dx: 2.5,
    spawnRate: 110,
    pipeVy: 0,
    pipeIndex: 0,
    spawnTimer: 0,

    update: function(dt = 1) {
        this.spawnTimer += dt;
        if (this.spawnTimer >= this.spawnRate) {
            this.spawnTimer -= this.spawnRate;
            const minPos = 65;
            const maxPos = GROUND_Y - this.gap - 65;
            const rng = mulberry32(mapSeed + this.pipeIndex * 7919);
            const randVal = rng();
            const top = Math.floor(randVal * (maxPos - minPos + 1) + minPos);
            const bottom = GROUND_Y - this.gap - top;
            const dir = rng() > 0.5 ? 1 : -1;
            // Toujours faire apparaître le tuyau hors du champ visuel droit (y compris sur grand écran PC)
            const spawnX = BASE_WIDTH + offsetX + 20;

            this.items.push({
                index: this.pipeIndex,
                x: spawnX,
                top: top,
                bottom: bottom,
                passed: false,
                moving: diffSettings[currentDiff].moving,
                dir: dir,
                minTop: minPos,
                maxTop: maxPos
            });
            this.pipeIndex++;
        }

        for (let i = 0; i < this.items.length; i++) {
            const p = this.items[i];
            p.x -= this.dx * dt;

            if (p.moving) {
                p.top += p.dir * this.pipeVy * dt;
                if (p.top <= p.minTop || p.top >= p.maxTop) p.dir *= -1;
                p.bottom = GROUND_Y - this.gap - p.top;
            }

            // Détection de collision au pixel près
            if (player.x + player.radius > p.x && player.x - player.radius < p.x + this.width) {
                if (player.y - player.radius < p.top || player.y + player.radius > GROUND_Y - p.bottom) {
                    gameOver();
                }
            }

            // Passage de tuyau et incrémentation de score
            if (p.x + this.width < player.x && !p.passed) {
                score++;
                p.passed = true;
                const scoreEl = document.getElementById('score-display');
                scoreEl.innerText = score;
                playSound('score');
                sendNetworkUpdate();
            }

            // Ne faire disparaître le tuyau que lorsqu'il est complètement sorti à gauche de l'écran visible
            if (p.x + this.width < -offsetX - 30) {
                this.items.splice(i, 1);
                i--;
            }
        }
    },

    draw: function() {
        for (let i = 0; i < this.items.length; i++) {
            const p = this.items[i];

            // 1. Corps du tuyau du haut : s'étend de -1200 jusqu'à p.top pour couvrir 100% du haut de l'écran !
            ctx.fillStyle = '#73bf2e';
            ctx.fillRect(p.x, -1200, this.width, 1200 + p.top);

            // 2. Corps du tuyau du bas : s'étend de (GROUND_Y - p.bottom) jusqu'au sol
            ctx.fillRect(p.x, GROUND_Y - p.bottom, this.width, p.bottom + 800);

            // 3. Têtes / Colliers des tuyaux
            ctx.fillStyle = '#558022';
            ctx.fillRect(p.x - 2, p.top - 20, this.width + 4, 20);
            ctx.fillRect(p.x - 2, GROUND_Y - p.bottom, this.width + 4, 20);

            // 4. Reflet lumineux vertical
            ctx.fillStyle = 'rgba(255, 255, 255, 0.25)';
            ctx.fillRect(p.x + 3, -1200, 5, 1200 + p.top);
            ctx.fillRect(p.x + 3, GROUND_Y - p.bottom, 5, p.bottom + 800);
        }
    },

    reset: function() {
        this.items = [];
        this.pipeIndex = 0;
        this.spawnTimer = 0;
    }
};

// --- Nuages décoratifs ---
const clouds = {
    items: [
        { x: 80, y: 100, s: 25 },
        { x: 260, y: 70, s: 35 },
        { x: 420, y: 130, s: 20 }
    ],
    dx: 0.5,
    draw: function() {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
        for (let i = 0; i < this.items.length; i++) {
            let c = this.items[i];
            ctx.beginPath();
            ctx.arc(c.x, c.y, c.s, 0, Math.PI * 2);
            ctx.arc(c.x + c.s, c.y - c.s * 0.3, c.s * 0.8, 0, Math.PI * 2);
            ctx.arc(c.x + c.s * 1.8, c.y, c.s * 0.9, 0, Math.PI * 2);
            ctx.arc(c.x + c.s, c.y + c.s * 0.3, c.s * 0.7, 0, Math.PI * 2);
            ctx.fill();
        }
    },
    timer: 0,
    update: function(dt = 1) {
        this.timer += dt;
        if (this.timer >= 180) {
            this.timer -= 180;
            this.items.push({ x: BASE_WIDTH + offsetX + 80, y: Math.random() * 180 + 30, s: Math.random() * 15 + 20 });
        }
        for (let i = 0; i < this.items.length; i++) {
            this.items[i].x -= this.dx * dt;
            if (this.items[i].x + 100 < -offsetX - 30) {
                this.items.splice(i, 1);
                i--;
            }
        }
    }
};

function drawBackground() {
    const bgX = -offsetX - 50;
    const bgW = BASE_WIDTH + offsetX * 2 + 100;
    const bgH = Math.max(100, BASE_HEIGHT + offsetY * 2 + 200 - GROUND_Y);
    // Sol herbeux et terre (remplit jusqu'au bas réel de l'écran et sur toute la largeur)
    ctx.fillStyle = '#ded895';
    ctx.fillRect(bgX, GROUND_Y, bgW, bgH);
    ctx.fillStyle = '#73bf2e';
    ctx.fillRect(bgX, GROUND_Y, bgW, 14);

    ctx.fillStyle = '#558022';
    ctx.fillRect(bgX, GROUND_Y + 12, bgW, 3);
}

function drawRoundedRect(ctx, x, y, width, height, radius) {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    ctx.lineTo(x + width, y + height - radius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    ctx.lineTo(x + radius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
}

// ====================================================================
// MULTIJOUEUR EN TEMPS RÉEL (1 SALON PAR DIFFICULTÉ, ZERO FAUX BOTS)
// ====================================================================

const otherPlayers = new Map();
let ws = null;
let isConnectedWs = false;
let lastSendTime = 0;
let isGamePaused = false;
let isCountingDown = false;
let globalOnlinePlayers = 1;

function drawOtherPlayers() {
    if (!isConnectedWs || otherPlayers.size === 0) return;

    otherPlayers.forEach(p => {
        const screenX = player.x + (p.distance - player.distance);
        const screenY = p.y;

        // 1. Affichage à l'écran si dans le champ visuel
        if (screenX >= -offsetX - 50 && screenX <= BASE_WIDTH + offsetX + 50) {
            ctx.save();
            ctx.translate(screenX, screenY);

            const rot = p.alive ? Math.min(Math.PI / 4, Math.max(-Math.PI / 4, (p.vy || 0) * 0.1)) : Math.min(Math.PI / 2, (p.vy || 0) * 0.15);
            ctx.rotate(rot);

            ctx.globalAlpha = p.alive ? 0.88 : 0.45;

            // Anneau de couleur attribué à cet adversaire
            ctx.beginPath();
            ctx.arc(0, 0, player.radius + 2, 0, Math.PI * 2);
            ctx.strokeStyle = p.color || '#38bdf8';
            ctx.lineWidth = 3;
            ctx.stroke();

            // Découpe vignette de l'adversaire
            ctx.beginPath();
            ctx.arc(0, 0, player.radius, 0, Math.PI * 2);
            ctx.closePath();
            ctx.clip();
            ctx.drawImage(defaultImg, -player.width / 2, -player.height / 2 * 1.3, player.width, player.height * 1.3);
            ctx.restore();

            // Badge Pseudo & Score au-dessus
            ctx.save();
            ctx.globalAlpha = p.alive ? 0.95 : 0.55;
            ctx.font = 'bold 10px sans-serif';
            const label = p.alive ? `${p.pseudo} · ${p.score || 0}` : `💥 RIP ${p.pseudo}`;
            const tw = ctx.measureText(label).width;

            ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
            drawRoundedRect(ctx, screenX - tw / 2 - 5, screenY - player.radius - 20, tw + 10, 15, 5);
            ctx.fill();

            ctx.fillStyle = p.alive ? (p.color || '#38bdf8') : '#ef4444';
            ctx.textAlign = 'center';
            ctx.fillText(label, screenX, screenY - player.radius - 9);
            ctx.restore();
        }

        // 2. Radar latéral si l'adversaire est devant ou derrière
        else if (currentState === 1 && p.alive) {
            const isAhead = screenX > BASE_WIDTH + offsetX + 50;
            const radarX = isAhead ? (BASE_WIDTH + offsetX - 20) : (-offsetX + 20);
            const radarY = Math.max(60, Math.min(GROUND_Y - 25, screenY));

            ctx.save();
            ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
            ctx.beginPath();
            ctx.arc(radarX, radarY, 13, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = p.color || '#38bdf8';
            ctx.lineWidth = 2;
            ctx.stroke();

            ctx.fillStyle = '#facc15';
            ctx.font = 'bold 9px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(isAhead ? '▶' : '◀', radarX, radarY);
            ctx.restore();
        }
    });
}

function showEventToast(text) {
    const toast = document.getElementById('event-toast');
    if (!toast) return;
    toast.innerText = text;
    toast.classList.add('show');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => toast.classList.remove('show'), 2500);
}

// --- Connexion WebSocket Réelle (Automatique selon la difficulté) ---
function connectWebSocket() {
    const url = getDefaultWsUrl();
    try {
        if (ws) {
            ws.onclose = null;
            ws.close();
        }
        ws = new WebSocket(url);

        ws.onopen = () => {
            isConnectedWs = true;
            updateHudStatus();

            sendWsMessage({
                type: 'join',
                room: currentDiff, // 1 seul salon par niveau !
                pseudo: getPseudo() || 'Joueur',
                difficulty: currentDiff
            });
        };

        ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);

                if (data.type === 'online_count') {
                    if (typeof data.total === 'number') {
                        globalOnlinePlayers = data.total;
                        updateHudStatus();
                    }
                } else if (data.type === 'welcome') {
                    if (data.seed) mapSeed = data.seed;
                    // Mise à jour de la couleur attribuée automatiquement par le serveur
                    if (data.color) {
                        playerColor = data.color;
                        document.getElementById('avatarPreviewContainer').style.borderColor = playerColor;
                    }
                    if (typeof data.totalPlayers === 'number') {
                        globalOnlinePlayers = data.totalPlayers;
                    } else if (typeof data.playersCount === 'number') {
                        globalOnlinePlayers = Math.max(globalOnlinePlayers, data.playersCount);
                    }
                    otherPlayers.clear();
                    data.players.forEach(p => {
                        otherPlayers.set(p.id, { ...p, targetY: p.y });
                    });
                    updateHudStatus();
                } else if (data.type === 'player_joined') {
                    otherPlayers.set(data.player.id, { ...data.player, targetY: data.player.y });
                    globalOnlinePlayers++;
                    updateHudStatus();
                    showEventToast(`👋 ${data.player.pseudo} a rejoint la partie !`);
                } else if (data.type === 'player_update') {
                    const p = otherPlayers.get(data.id);
                    if (p) {
                        p.targetY = data.y;
                        p.targetDistance = data.distance;
                        p.vy = data.vy;
                        p.score = data.score;
                        p.alive = data.alive;
                        if (typeof p.distance !== 'number' || Math.abs(p.distance - data.distance) > 250) {
                            p.distance = data.distance;
                            p.y = data.y;
                        }
                    }
                } else if (data.type === 'player_died') {
                    const p = otherPlayers.get(data.id);
                    if (p) {
                        p.alive = false;
                        p.score = data.score;
                        showEventToast(`💥 ${data.pseudo} s'est écrasé (Score: ${data.score})`);
                    }
                } else if (data.type === 'player_left') {
                    otherPlayers.delete(data.id);
                    globalOnlinePlayers = Math.max(1, globalOnlinePlayers - 1);
                    updateHudStatus();
                } else if (data.type === 'online_players_list') {
                    if (typeof data.total === 'number') {
                        globalOnlinePlayers = data.total;
                        updateHudStatus();
                    }
                    renderOnlinePlayers(data.players || []);
                }
            } catch (e) {
                console.error(e);
            }
        };

        ws.onerror = () => {
            isConnectedWs = false;
            updateHudStatus();
        };

        ws.onclose = () => {
            isConnectedWs = false;
            otherPlayers.clear();
            updateHudStatus();
            setTimeout(connectWebSocket, 4000); // Reconnexion auto
        };
    } catch (e) {
        isConnectedWs = false;
        updateHudStatus();
    }
}

function sendWsMessage(obj) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(obj));
    }
}

function sendNetworkUpdate(force = false) {
    const now = Date.now();
    if (!force && now - lastSendTime < 32) return; // ~30Hz
    lastSendTime = now;

    sendWsMessage({
        type: 'update',
        y: player.y,
        vy: player.velocity,
        score: score,
        distance: player.distance,
        alive: player.alive
    });
}

function updateHudStatus() {
    const dot = document.getElementById('network-status');
    const txt = document.getElementById('online-text');
    const diffLabel = diffSettings[currentDiff].label;
    const hud = document.getElementById('hud');

    if (currentState === 2) {
        // Écran Game Over : masquer le HUD pour laisser l'écran net
        hud.style.display = 'none';
    } else {
        hud.style.display = 'flex';
    }

    if (isConnectedWs) {
        dot.classList.remove('offline');
        if (currentState === 0) {
            // Sur l'accueil : nombre total de joueurs connectés à l'application
            const label = globalOnlinePlayers > 1 ? `${globalOnlinePlayers} en ligne` : `${globalOnlinePlayers} en ligne`;
            txt.innerText = label;
        } else {
            // En jeu : nombre de joueurs volant dans ce salon spécifique
            const count = otherPlayers.size + 1;
            txt.innerText = `${count} en vol (${diffLabel})`;
        }
    } else {
        dot.classList.add('offline');
        txt.innerText = `Hors ligne`;
    }
}

connectWebSocket();

// ====================================================================
// BOUCLE PRINCIPALE ULTRA-FLUIDE (DELTA-TIME SYNCHRONISÉ V-SYNC 60Hz/120Hz)
// ====================================================================

let lastTime = 0;

function updatePhysics(dt = 1) {
    if (isGamePaused || isCountingDown) {
        return;
    }

    if (currentState === 1) { // En cours de partie
        clouds.update(dt);
        pipes.update(dt);
        player.update(dt);
        sendNetworkUpdate();
    } else if (currentState === 0) { // Écran de départ
        clouds.update(dt);
        player.y = 300 + Math.cos(frames / 12) * 6;
        player.distance = 0;
    } else if (currentState === 2) { // Game Over
        if (player.y + player.radius < GROUND_Y) {
            player.velocity += player.gravity * dt;
            player.y += player.velocity * dt;
        }
    }

    // Mise à jour fluide (60Hz / 120Hz) et prédiction dead reckoning des autres joueurs
    if (otherPlayers.size > 0) {
        const currentDx = diffSettings[currentDiff].dx;
        otherPlayers.forEach(p => {
            if (p.alive) {
                // Avance continue synchronisée sur la vitesse exacte du niveau
                p.distance = (p.distance || 0) + currentDx * dt;
                if (typeof p.targetDistance === 'number') {
                    p.distance += (p.targetDistance - p.distance) * Math.min(1, 0.15 * dt);
                }
                // Physique verticale continue (gravité + interpolation fluide vers targetY)
                p.vy = (p.vy || 0) + player.gravity * dt;
                p.y = (p.y || 300) + p.vy * dt;
                if (typeof p.targetY === 'number') {
                    p.y += (p.targetY - p.y) * Math.min(1, 0.25 * dt);
                }
                if (p.y + player.radius >= GROUND_Y) {
                    p.y = GROUND_Y - player.radius;
                }
            } else {
                p.vy = (p.vy || 0) + player.gravity * dt;
                p.y = Math.min(GROUND_Y - player.radius, (p.y || 300) + p.vy * dt);
            }
        });
    }

    frames += dt;
}

function render() {
    ctx.save();
    // Centrage et mise à l'échelle
    ctx.scale(scale, scale);
    ctx.translate(offsetX, offsetY);

    // Ciel (s'étend de -offsetX et -offsetY pour couvrir tout l'écran)
    ctx.fillStyle = '#70c5ce';
    ctx.fillRect(-offsetX - 50, -offsetY - 200, BASE_WIDTH + offsetX * 2 + 100, BASE_HEIGHT + offsetY * 2 + 400);

    // Entités
    clouds.draw();
    pipes.draw();
    drawBackground();
    drawOtherPlayers(); // Vrais joueurs
    player.draw();      // Joueur local

    ctx.restore();
}

function loop(currentTime) {
    requestAnimationFrame(loop);

    if (!lastTime) {
        lastTime = currentTime;
        render();
        return;
    }

    const delta = currentTime - lastTime;
    lastTime = currentTime;

    // Normalisation à 60 FPS (16.6667 ms = dt 1.0)
    // Borner dt entre 0.1 et 2.0 pour absorber tout micro-écart sans saut ni saccade
    const dt = Math.max(0.1, Math.min(delta / 16.6667, 2.0));

    updatePhysics(dt);
    render();
}
requestAnimationFrame(loop);

// ====================================================================
// CONTRÔLES & GESTION DES PARTIES
// ====================================================================

function startGame() {
    // 1. OBLIGATION DE RENTRER UN PSEUDO
    if (!validatePseudo()) return;

    const pseudo = getPseudo();
    localStorage.setItem('flappy_pseudo', pseudo);

    initAudio();
    if (musicEnabled) {
        bgMusic.currentTime = 0;
        bgMusic.play().catch(() => {});
    }

    // Réinitialisation avec les paramètres stricts du niveau
    pipes.dx = diffSettings[currentDiff].dx;
    pipes.gap = diffSettings[currentDiff].gap;
    pipes.spawnRate = diffSettings[currentDiff].spawnRate;
    pipes.pipeVy = diffSettings[currentDiff].pipeVy || 0;

    currentState = 1;
    isGamePaused = false;
    isCountingDown = false;
    document.getElementById('pauseCountdown').classList.add('hidden');
    document.getElementById('startScreen').classList.add('hidden');
    document.getElementById('gameOverScreen').classList.add('hidden');
    updateHudStatus();

    pipes.reset();
    player.y = 300;
    player.velocity = 0;
    player.distance = 0;
    player.alive = true;
    score = 0;
    document.getElementById('score-display').innerText = score;

    lastTime = performance.now();
    player.jump();

    sendWsMessage({
        type: 'restart',
        room: currentDiff,
        pseudo: pseudo,
        difficulty: currentDiff
    });
    sendWsMessage({
        type: 'set_state',
        state: 'playing',
        room: currentDiff,
        score: 0,
        pseudo: pseudo
    });
}

function gameOver() {
    if (currentState !== 2) {
        currentState = 2;
        isGamePaused = false;
        isCountingDown = false;
        document.getElementById('pauseCountdown').classList.add('hidden');
        player.alive = false;
        bgMusic.pause();
        playSound('hit');
        triggerHaptic('hit');
        updateHudStatus();

        document.getElementById('gameOverScreen').classList.remove('hidden');
        document.getElementById('finalScore').innerText = score;

        const bestKey = `flappy_best_${currentDiff}`;
        const prevBest = parseInt(localStorage.getItem(bestKey) || '0', 10);
        if (score > prevBest) {
            localStorage.setItem(bestKey, score);
            document.getElementById('bestScoreVal').innerText = score + ' (Nouveau !)';
        } else {
            document.getElementById('bestScoreVal').innerText = prevBest;
        }

        const pseudo = getPseudo();
        submitScore(pseudo, score, currentDiff);

        // Annoncer la mort aux autres vrais joueurs et au suivi en ligne
        sendWsMessage({
            type: 'game_over',
            score: score,
            pseudo: pseudo
        });
        sendWsMessage({
            type: 'set_state',
            state: 'game_over',
            room: currentDiff,
            score: score,
            pseudo: pseudo
        });
    }
}

function resetGame() {
    currentState = 0;
    isGamePaused = false;
    isCountingDown = false;
    document.getElementById('pauseCountdown').classList.add('hidden');
    document.getElementById('gameOverScreen').classList.add('hidden');
    document.getElementById('startScreen').classList.remove('hidden');
    player.y = 300;
    player.rotation = 0;
    lastTime = performance.now();
    updateHudStatus();

    sendWsMessage({
        type: 'set_state',
        state: 'menu',
        room: currentDiff,
        score: 0,
        pseudo: getPseudo() || 'Joueur'
    });
}

// Changement de difficulté = Changement automatique de salon !
function setDifficulty(level, btn) {
    currentDiff = level;
    document.querySelectorAll('.diff-btn').forEach(b => b.classList.remove('active'));
    if (!btn) {
        btn = document.getElementById('btn-' + level);
    }
    if (btn) btn.classList.add('active');

    // Mettre à jour les tuyaux
    pipes.dx = diffSettings[currentDiff].dx;
    pipes.gap = diffSettings[currentDiff].gap;
    pipes.spawnRate = diffSettings[currentDiff].spawnRate;
    pipes.pipeVy = diffSettings[currentDiff].pipeVy || 0;

    updateHudStatus();

    // Rejoindre automatiquement le salon de cette difficulté
    sendWsMessage({
        type: 'join',
        room: currentDiff,
        pseudo: getPseudo() || 'Joueur',
        difficulty: currentDiff
    });
}

document.getElementById('btn-facile').addEventListener('click', (e) => setDifficulty('facile', e.target));
document.getElementById('btn-normal').addEventListener('click', (e) => setDifficulty('normal', e.target));
document.getElementById('btn-difficile').addEventListener('click', (e) => setDifficulty('difficile', e.target));
document.getElementById('btn-hardcore').addEventListener('click', (e) => setDifficulty('hardcore', e.target));

// Bouton Son
const soundBtn = document.getElementById('soundToggleBtn');
function updateSoundIcon() {
    const isAudioActive = (soundEnabled || musicEnabled);
    soundBtn.innerText = isAudioActive ? '🔊' : '🔇';
    soundBtn.title = isAudioActive ? 'Couper le son' : 'Activer le son';
}

soundBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    // Si au moins un audio est actif, on coupe tout (mute) ; si tout est coupé, on réactive tout
    const isCurrentlyActive = (soundEnabled || musicEnabled);
    const targetState = !isCurrentlyActive;
    soundEnabled = targetState;
    musicEnabled = targetState;
    localStorage.setItem('flappy_sound', soundEnabled);
    localStorage.setItem('flappy_music', musicEnabled);
    if (!musicEnabled) bgMusic.pause();
    else if (currentState === 1) bgMusic.play().catch(() => {});
    updateSoundIcon();
});

// Initialiser l'icône dès le démarrage
updateSoundIcon();

// Modal Paramètres & Pause
document.getElementById('settingsBtn').addEventListener('click', (e) => {
    e.stopPropagation();
    if (currentState === 1) {
        isGamePaused = true;
        if (musicEnabled) bgMusic.pause();
        document.getElementById('resumeGameBtn').classList.remove('hidden');
        document.getElementById('settingsTitle').innerText = '⏸️ Pause';
    } else {
        document.getElementById('resumeGameBtn').classList.add('hidden');
        document.getElementById('settingsTitle').innerText = '⚙️ Paramètres';
    }
    document.getElementById('settingsScreen').classList.remove('hidden');
    document.getElementById('settingHaptics').checked = hapticsEnabled;
    document.getElementById('settingMusic').checked = musicEnabled;
    document.getElementById('settingSfx').checked = soundEnabled;
    const wsInput = document.getElementById('settingWsUrl');
    if (wsInput) wsInput.value = getDefaultWsUrl();
    const apiInput = document.getElementById('settingApiUrl');
    if (apiInput) apiInput.value = API_URL;
    const testWsRes = document.getElementById('testWsResult');
    if (testWsRes) testWsRes.innerHTML = '';
});

const testWsBtn = document.getElementById('testWsBtn');
if (testWsBtn) {
    testWsBtn.addEventListener('click', () => {
        const resEl = document.getElementById('testWsResult');
        const wsInput = document.getElementById('settingWsUrl');
        const testUrl = (wsInput && wsInput.value.trim()) || getDefaultWsUrl();
        if (resEl) resEl.innerHTML = '<span style="color:#facc15;">Test de connexion...</span>';

        try {
            const testSocket = new WebSocket(testUrl);
            const timer = setTimeout(() => {
                testSocket.close();
                if (resEl) resEl.innerHTML = '<span style="color:#ef4444;">❌ Délai dépassé (Vérifiez l\'IP ou le pare-feu du PC).</span>';
            }, 3500);

            testSocket.onopen = () => {
                clearTimeout(timer);
                testSocket.close();
                if (resEl) resEl.innerHTML = '<span style="color:#22c55e;">✅ Connecté avec succès au serveur !</span>';
            };

            testSocket.onerror = () => {
                clearTimeout(timer);
                if (resEl) resEl.innerHTML = '<span style="color:#ef4444;">❌ Échec : impossible de joindre le serveur.</span>';
            };
        } catch(err) {
            if (resEl) resEl.innerHTML = '<span style="color:#ef4444;">❌ Format d\'URL invalide.</span>';
        }
    });
}

function closeSettingsAndResume() {
    hapticsEnabled = document.getElementById('settingHaptics').checked;
    musicEnabled = document.getElementById('settingMusic').checked;
    soundEnabled = document.getElementById('settingSfx').checked;
    const wsInput = document.getElementById('settingWsUrl');
    const apiInput = document.getElementById('settingApiUrl');
    const newWs = (wsInput && wsInput.value.trim()) || getDefaultWsUrl();
    const newApi = (apiInput && apiInput.value.trim()) || REMOTE_API_DEFAULT;

    const wsChanged = newWs !== WS_URL;
    WS_URL = newWs;
    API_URL = newApi;

    localStorage.setItem('flappy_haptics', hapticsEnabled);
    localStorage.setItem('flappy_music', musicEnabled);
    localStorage.setItem('flappy_sound', soundEnabled);
    localStorage.setItem('flappy_ws_url', WS_URL);
    localStorage.setItem('flappy_api_url', API_URL);

    updateSoundIcon();
    document.getElementById('settingsScreen').classList.add('hidden');

    if (wsChanged) {
        connectWebSocket();
    }

    if (isGamePaused && currentState === 1) {
        startResumeCountdown();
    }
}

document.getElementById('closeSettingsBtn').addEventListener('click', closeSettingsAndResume);
document.getElementById('resumeGameBtn').addEventListener('click', closeSettingsAndResume);

function startResumeCountdown() {
    isCountingDown = true;
    // Remettre une vitesse verticale neutre pour ne pas s'écraser instantanément à la reprise
    if (player.velocity > 0) player.velocity = 0;

    const countdownEl = document.getElementById('pauseCountdown');
    const numEl = document.getElementById('countdownNum');
    countdownEl.classList.remove('hidden');

    let count = 3;
    function triggerCountAnimation(val) {
        numEl.innerText = val;
        numEl.classList.remove('count-pulse');
        void numEl.offsetWidth; // Force le reflow CSS
        numEl.classList.add('count-pulse');
        if (val === 'GO !') {
            playSound('score');
        } else {
            playSound('jump');
        }
    }

    triggerCountAnimation(count);

    const timer = setInterval(() => {
        count--;
        if (count > 0) {
            triggerCountAnimation(count);
        } else if (count === 0) {
            triggerCountAnimation('GO !');
        } else {
            clearInterval(timer);
            countdownEl.classList.add('hidden');
            isCountingDown = false;
            isGamePaused = false;
            if (musicEnabled && currentState === 1) {
                bgMusic.play().catch(() => {});
            }
        }
    }, 850);
}

// Tap sur l'écran
function handleScreenTap(e) {
    if (isGamePaused || isCountingDown) return;
    if (e.target.closest('#partner-box') || 
        e.target.closest('.ui-layer') || 
        e.target.closest('.hud-btn') || 
        e.target.closest('#hud')) {
        return;
    }
    initAudio();
    if (currentState === 1) {
        player.jump();
    }
}

document.getElementById('game-wrapper').addEventListener('pointerdown', handleScreenTap);
window.addEventListener('keydown', (e) => {
    if (e.code === 'Space') {
        e.preventDefault();
        if (isGamePaused || isCountingDown) return;
        initAudio();
        if (currentState === 1) player.jump();
        else if (currentState === 0 && document.getElementById('generalLeaderboardScreen').classList.contains('hidden') && document.getElementById('settingsScreen').classList.contains('hidden') && document.getElementById('onlinePlayersScreen').classList.contains('hidden')) {
            if (validatePseudo()) startGame();
        }
        else if (currentState === 2 && document.getElementById('leaderboardScreen').classList.contains('hidden')) resetGame();
    }
});

document.getElementById('startBtn').addEventListener('click', startGame);
document.getElementById('restartBtn').addEventListener('click', resetGame);

// Bandeau Partenaire : permanent en bas, masqué uniquement si l'utilisateur clique sur la croix pour la session en cours
try {
    localStorage.removeItem('flappy_partner_closed');
} catch(e) {}
let partnerDismissed = false;

function updatePartnerBox() {
    const box = document.getElementById('partner-box');
    if (!box) return;
    if (partnerDismissed) {
        box.style.transform = 'translateY(115%)';
    } else {
        box.style.transform = 'translateY(0)';
    }
}

document.getElementById('closeBox').addEventListener('click', (e) => {
    e.stopPropagation();
    partnerDismissed = true;
    updatePartnerBox();
});
document.getElementById('infoLink').addEventListener('click', (e) => e.stopPropagation());

// Initialiser l'état du bandeau au chargement (toujours visible)
updatePartnerBox();

// ====================================================================
// CLASSEMENTS (API MYSQL OVH + LOCAL)
// ====================================================================

function getDeviceInfo() {
    const ua = navigator.userAgent;
    let os = "Android";
    if (ua.includes("iPhone") || ua.includes("iPad")) os = "iOS";
    else if (ua.includes("Win")) os = "Windows";
    return `${os} Mobile`;
}

function cleanAndGroupScores(data) {
    if (!Array.isArray(data)) return [];
    const map = new Map();
    data.forEach(item => {
        if (!item || !item.pseudo) return;
        const pseudoClean = item.pseudo.trim();
        const key = pseudoClean.toLowerCase();
        const scoreVal = parseInt(item.score, 10) || 0;
        const gamesVal = parseInt(item.games_played, 10) || 1;
        if (!map.has(key)) {
            map.set(key, {
                pseudo: pseudoClean,
                score: scoreVal,
                games_played: gamesVal,
                device: item.device || 'Mobile'
            });
        } else {
            const existing = map.get(key);
            if (scoreVal > existing.score) {
                existing.score = scoreVal;
                existing.device = item.device || existing.device;
            }
            existing.games_played = Math.max(existing.games_played, gamesVal);
        }
    });
    return Array.from(map.values()).sort((a, b) => b.score - a.score);
}

async function submitScore(pseudo, score, difficulty) {
    if (!pseudo || score === 0) return;
    const device = getDeviceInfo();

    // 1. Sauvegarde locale avec déduplication stricte par pseudo
    try {
        const key = 'flappy_scores_' + difficulty;
        let localScores = JSON.parse(localStorage.getItem(key) || '[]');
        let found = false;
        for (let entry of localScores) {
            if (entry && entry.pseudo && entry.pseudo.trim().toLowerCase() === pseudo.trim().toLowerCase()) {
                entry.score = Math.max(parseInt(entry.score, 10) || 0, score);
                entry.games_played = (parseInt(entry.games_played, 10) || 1) + 1;
                entry.device = device;
                found = true;
                break;
            }
        }
        if (!found) {
            localScores.push({ pseudo: pseudo.trim(), score, device, games_played: 1 });
        }
        localScores = cleanAndGroupScores(localScores);
        localStorage.setItem(key, JSON.stringify(localScores.slice(0, 20)));
    } catch (e) {}

    // 2. Synchronisation avec la base OVH MySQL
    try {
        await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'save', pseudo, score, difficulty, device })
        });
    } catch (e) {
        console.warn("API OVH inaccessible en direct, score sauvegardé en local.", e);
    }
}

async function loadLeaderboard(difficulty) {
    const listDiv = document.getElementById('leaderboard-list');
    const loadingText = document.getElementById('loading-text');
    listDiv.innerHTML = '';
    loadingText.style.display = 'block';

    try {
        const response = await fetch(`${API_URL}?action=get&difficulty=${difficulty}`, { signal: AbortSignal.timeout(3500) });
        const data = await response.json();
        loadingText.style.display = 'none';
        renderLeaderboardEntries(listDiv, data);
    } catch (e) {
        loadingText.style.display = 'none';
        const local = JSON.parse(localStorage.getItem('flappy_scores_' + difficulty) || '[]');
        renderLeaderboardEntries(listDiv, local);
    }
}

async function loadGeneralLeaderboard() {
    const listDiv = document.getElementById('general-leaderboard-list');
    const loadingText = document.getElementById('gl-loading-text');
    listDiv.innerHTML = '';
    loadingText.style.display = 'block';

    const difficulties = ['facile', 'normal', 'difficile', 'hardcore'];
    const labels = ['Facile', 'Normal', 'Dur', 'Hardcore 💀'];
    let html = '';

    try {
        const requests = difficulties.map(diff => 
            fetch(`${API_URL}?action=get&difficulty=${diff}`, { signal: AbortSignal.timeout(3500) })
                .then(res => res.json())
                .catch(() => JSON.parse(localStorage.getItem('flappy_scores_' + diff) || '[]'))
        );
        const results = await Promise.all(requests);
        loadingText.style.display = 'none';

        for (let i = 0; i < difficulties.length; i++) {
            const data = cleanAndGroupScores(results[i]);
            html += `<h3 style="color: #93c5fd; margin: 10px 0 5px 0; text-align: left; border-bottom: 2px solid #334155; padding-bottom: 3px; font-size: 15px;">${labels[i]}</h3>`;
            if (!data || data.length === 0) {
                html += '<div style="color:#94a3b8; font-size: 12px; text-align: left; margin-bottom: 8px;">Aucun score enregistré.</div>';
            } else {
                data.slice(0, 5).forEach((entry, idx) => {
                    const rankColor = idx === 0 ? '#facc15' : (idx === 1 ? '#cbd5e1' : (idx === 2 ? '#b45309' : 'white'));
                    html += `
                        <div class="lb-entry" style="padding: 5px 8px; margin-bottom: 4px;">
                            <div style="display: flex; flex-direction: column; text-align: left;">
                                <span class="lb-pseudo" style="color: ${rankColor}; font-size: 13px;">${idx + 1}. ${entry.pseudo} <span style="color: #94a3b8; font-size: 10px; font-weight: normal;">(${entry.games_played} essais)</span></span>
                            </div>
                            <div class="lb-score" style="font-size: 15px;">${entry.score}</div>
                        </div>
                    `;
                });
            }
        }
        listDiv.innerHTML = html;
    } catch (e) {
        loadingText.innerText = 'Erreur de chargement.';
    }
}

function renderLeaderboardEntries(container, data) {
    const list = cleanAndGroupScores(data);
    if (!list || list.length === 0) {
        container.innerHTML = '<div style="color:white; padding:10px;">Aucun score pour le moment.</div>';
        return;
    }
    container.innerHTML = '';
    list.slice(0, 10).forEach((entry, index) => {
        const rankColor = index === 0 ? '#facc15' : (index === 1 ? '#cbd5e1' : (index === 2 ? '#b45309' : 'white'));
        container.innerHTML += `
            <div class="lb-entry">
                <div style="display: flex; flex-direction: column; text-align: left;">
                    <span class="lb-pseudo" style="color: ${rankColor};">${index + 1}. ${entry.pseudo} <span style="color: #94a3b8; font-size: 11px; font-weight: normal;">(${entry.games_played} essais)</span></span>
                    <span class="lb-device">${entry.device || 'Mobile'}</span>
                </div>
                <div class="lb-score">${entry.score}</div>
            </div>
        `;
    });
}

// Navigation Modals
document.getElementById('showLeaderboardBtn').addEventListener('click', () => {
    document.getElementById('gameOverScreen').classList.add('hidden');
    document.getElementById('leaderboardScreen').classList.remove('hidden');
    document.getElementById('lb-diff-label').innerText = diffSettings[currentDiff].label;
    loadLeaderboard(currentDiff);
});

document.getElementById('closeLeaderboardBtn').addEventListener('click', () => {
    document.getElementById('leaderboardScreen').classList.add('hidden');
    document.getElementById('gameOverScreen').classList.remove('hidden');
});

document.getElementById('homeLeaderboardBtn').addEventListener('click', () => {
    document.getElementById('startScreen').classList.add('hidden');
    document.getElementById('generalLeaderboardScreen').classList.remove('hidden');
    loadGeneralLeaderboard();
});

document.getElementById('closeGeneralLeaderboardBtn').addEventListener('click', () => {
    document.getElementById('generalLeaderboardScreen').classList.add('hidden');
    document.getElementById('startScreen').classList.remove('hidden');
});

// ====================================================================
// MODALE DES JOUEURS EN LIGNE (LOBBY MULTIJOUEUR EN DIRECT)
// ====================================================================

function renderOnlinePlayers(players) {
    const listContainer = document.getElementById('onlinePlayersList');
    if (!listContainer) return;

    // Filtrer les autres joueurs en ligne
    const otherPlayers = Array.isArray(players) ? players.filter(p => !p.isYou) : [];

    if (!players || players.length === 0) {
        listContainer.innerHTML = '<div style="color: #94a3b8; font-size: 14px; font-weight: bold; text-align: center; padding: 24px 12px; line-height: 1.5;">Aucun joueur en ligne actuellement</div>';
        return;
    }

    if (otherPlayers.length === 0) {
        listContainer.innerHTML = '<div style="color: #94a3b8; font-size: 14px; font-weight: bold; text-align: center; padding: 24px 12px; line-height: 1.6;">👤 Vous seul êtes en ligne actuellement<br><span style="font-size: 12px; font-weight: normal; color: #64748b;">Aucun autre joueur connecté pour le moment.</span></div>';
        return;
    }

    let html = '';
    otherPlayers.forEach(p => {
        const isCurrentRoom = (p.room === currentDiff);
        const diffLabel = (diffSettings[p.room] && diffSettings[p.room].label) ? diffSettings[p.room].label : (p.room || 'Normal');

        let statusBadge = '';
        if (p.state === 'playing') {
            statusBadge = `<span class="badge-status badge-flight">🚀 En vol (${diffLabel} - ${p.score || 0} pts)</span>`;
        } else if (p.state === 'game_over') {
            statusBadge = `<span class="badge-status badge-dead">💥 Écrasé (${p.score || 0} pts)</span>`;
        } else {
            statusBadge = `<span class="badge-status badge-menu">🏠 À l'accueil</span>`;
        }

        let actionBtn = isCurrentRoom 
            ? `<button class="join-room-btn current">Dans ce salon</button>`
            : `<button class="join-room-btn" onclick="joinPlayerRoom('${p.room}')">Rejoindre</button>`;

        html += `
            <div class="online-player-card">
                <div class="online-avatar-circle" style="border-color: ${p.color || '#facc15'};">
                    <img src="visage.png" alt="Avatar">
                </div>
                <div class="online-player-info">
                    <span class="online-player-pseudo" title="${p.pseudo}">
                        ${p.pseudo}
                    </span>
                    ${statusBadge}
                </div>
                <div>${actionBtn}</div>
            </div>
        `;
    });

    listContainer.innerHTML = html;
}

window.joinPlayerRoom = function(targetRoom) {
    if (!diffSettings[targetRoom]) return;
    setDifficulty(targetRoom);
    document.getElementById('onlinePlayersScreen').classList.add('hidden');
    showEventToast(`🎮 Salon rejoint : ${diffSettings[targetRoom].label}`);

    if (currentState === 1) {
        // Si en cours de partie, recommencer la partie dans le salon rejoint
        startGame();
    } else if (currentState === 2) {
        // Si écran de fin, revenir à l'accueil
        resetGame();
    }
};

const onlineCounterPill = document.getElementById('online-counter');
if (onlineCounterPill) {
    onlineCounterPill.addEventListener('click', (e) => {
        e.stopPropagation();
        if (currentState === 1 && !isGamePaused) {
            isGamePaused = true;
            if (musicEnabled) bgMusic.pause();
        }
        const listContainer = document.getElementById('onlinePlayersList');
        if (listContainer) {
            listContainer.innerHTML = isConnectedWs
                ? '<div style="color: #94a3b8; font-size: 14px; font-weight: bold; text-align: center; padding: 24px 12px; line-height: 1.6;">👤 Vous seul êtes en ligne actuellement<br><span style="font-size: 12px; font-weight: normal; color: #64748b;">Aucun autre joueur connecté pour le moment.</span></div>'
                : '<div style="color: #94a3b8; font-size: 14px; font-weight: bold; text-align: center; padding: 24px 12px; line-height: 1.5;">Aucun joueur en ligne actuellement</div>';
        }
        document.getElementById('onlinePlayersScreen').classList.remove('hidden');
        sendWsMessage({ type: 'get_online_list' });
    });
}

const closeOnlinePlayersBtn = document.getElementById('closeOnlinePlayersBtn');
if (closeOnlinePlayersBtn) {
    closeOnlinePlayersBtn.addEventListener('click', () => {
        document.getElementById('onlinePlayersScreen').classList.add('hidden');
        if (isGamePaused && currentState === 1) {
            startResumeCountdown();
        }
    });
}

