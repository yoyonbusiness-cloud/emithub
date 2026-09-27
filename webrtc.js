window.showHostedResumeModal = function (token, filenames, onResume) {
    let modal = document.getElementById('hosted-resume-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'hosted-resume-modal';
        modal.className = 'drop-modal-overlay';
        modal.innerHTML = `
            <div class="drop-modal" style="max-width:420px;">
                <div class="hosted-resume-panel">
                    <div class="hosted-resume-title">Resume Upload?</div>
                    <div class="hosted-resume-copy">A previous upload for this file was interrupted.<br>Would you like to resume?</div>
                    <div class="hosted-resume-files">
                        ${filenames.map(f => `<div class='resume-file-item'><i class="fa-solid fa-file"></i><span>${f}</span></div>`).join('')}
                    </div>
                    <button class="btn-pill btn-primary hosted-resume-btn" id="hosted-resume-confirm">Resume Upload</button>
                    <button class="btn-pill btn-ghost hosted-resume-btn" id="hosted-resume-cancel">Cancel</button>
                    <div class="hosted-resume-footnote">If you cancel, the upload will start over from the beginning.</div>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
    }
    modal.style.display = 'flex';
    document.getElementById('hosted-resume-confirm').onclick = function () {
        modal.style.display = 'none';
        if (onResume) onResume();
    };
    document.getElementById('hosted-resume-cancel').onclick = function () {
        modal.style.display = 'none';
    };
};


window.checkAndShowHostedResume = function (token, file, onResume) {
    const resumeState = window.loadHostedResumeState(token);
    if (!resumeState) return false;
    if (resumeState.fileName !== file.name || resumeState.fileSize !== file.size) return false;
    if (resumeState.chunks && resumeState.chunks.length > 0 && resumeState.chunks.length < resumeState.chunkCount) {
        window.showHostedResumeModal(token, [file.name], function () {
            if (typeof ActivityTracker !== 'undefined') ActivityTracker.setHostedLinkResuming(token, true);
            onResume();
        });
        return true;
    }
    return false;
};
const socket = io({ transports: ['websocket'] });
let myPersistentId = null;
let myTabSessionId = null;
let pendingJoinState = null;
let roomId = null;
let signalingId = null;
let lastJoinEmit = null;

socket.on('public-rooms-list', (rooms) => {
    if (!Array.isArray(rooms)) return;
    window._cachedPublicRooms = rooms;
    if (typeof renderPublicRoomsList === 'function') {
        const discoveryBody = document.getElementById('activity-discovery-body');
        if (discoveryBody && discoveryBody.style.display !== 'none') {
            renderPublicRoomsList(rooms);
        }
    }
});

socket.on('live-stats-updated', (stats) => {
    if (!stats) return;
    const usersEl = document.getElementById('live-stat-users');
    const linksEl = document.getElementById('live-stat-links');
    if (usersEl) usersEl.textContent = stats.connectedUsers !== undefined ? stats.connectedUsers : '—';
    if (linksEl) linksEl.textContent = stats.activeHostedLinks !== undefined ? stats.activeHostedLinks : '—';
});

socket.on('connect', () => {
    window.isShadowTab = false;
    window.primarySocketId = null;
    syncDebugState();
    if (typeof announceNearbyPresence === 'function') announceNearbyPresence();
    if (typeof roomId !== 'undefined' && roomId && typeof signalingId !== 'undefined' && signalingId) {
        try {
            localStorage.setItem('ys_workspace', roomId);
            const reconnectGuard = window._pendingPassphrase || localStorage.getItem('ys_guard') || '';
            if (reconnectGuard) localStorage.setItem('ys_guard', reconnectGuard);
            else localStorage.removeItem('ys_guard');
            localStorage.setItem('ys_is_creator', window._pendingIsCreator ? 'true' : 'false');
        } catch (e) { }
        let myName = localStorage.getItem('ys_persistent_name') || sessionStorage.getItem('ys_user_name');
        if (!myName) {
            myName = `User-${Math.floor(Math.random() * 9000 + 1000)}`;
            sessionStorage.setItem('ys_user_name', myName);
        }
        peerId = socket.id;
        const inactivityValue = document.getElementById('inactivity-timer-select') ? document.getElementById('inactivity-timer-select').value : '0';
        const allowedInactivityValues = new Set([0, 5, 10, 15, 30, 60]);
        const requestedInactivity = parseInt(inactivityValue, 10) || 0;
        const inactivityMins = allowedInactivityValues.has(requestedInactivity) ? requestedInactivity : 0;
        if (!myPersistentId) {
            try {
                myPersistentId = localStorage.getItem('emit-persistent-id') || sessionStorage.getItem('emit-persistent-id');
            } catch (e) { }
        }
        if (!myTabSessionId) {
            try {
                myTabSessionId = sessionStorage.getItem('emit-tab-session-id');
            } catch (e) { }
        }
        if (!myPersistentId) {
            if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
                myPersistentId = crypto.randomUUID();
            } else {
                myPersistentId = 'f' + Math.random().toString(36).substring(2, 15) + '-' + Date.now().toString(36);
            }
            try {
                localStorage.setItem('emit-persistent-id', myPersistentId);
            } catch (e) { }
            try {
                sessionStorage.setItem('emit-persistent-id', myPersistentId);
            } catch (e) { }
        }
        if (!myTabSessionId) {
            if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
                myTabSessionId = crypto.randomUUID();
            } else {
                myTabSessionId = 't' + Math.random().toString(36).substring(2, 15) + '-' + Date.now().toString(36);
            }
            try {
                sessionStorage.setItem('emit-tab-session-id', myTabSessionId);
            } catch (e) { }
        }
        const persistentId = myPersistentId;
        const joinSignature = JSON.stringify({ signalingId, isCreator: !!window._pendingIsCreator, persistentId, tabSessionId: myTabSessionId, socketId: socket.id, isSpectator: !!window.isSpectator });
        if (lastJoinEmit !== joinSignature) {
            lastJoinEmit = joinSignature;
            const isPublic = !!document.getElementById('public-room-checkbox')?.checked;
            socket.emit('join-room', signalingId, window._pendingIsCreator || false, { name: myName, inactivity: inactivityMins, persistentId, tabSessionId: myTabSessionId, isPublic: isPublic, isSpectator: !!window.isSpectator });
        }
    }
});
let peers = {};
window.peers = peers;
let peerId = null;
let serverTimeOffset = 0;
let latestRoomMetadata = null;

function syncDebugState() {
    window.socket = socket;
    window.roomId = roomId;
    window.signalingId = signalingId;
    window.pendingJoinState = pendingJoinState;
}

function renderImmediateIdleTimer(msLeft = 2 * 60 * 1000) {
    const timerEl = document.getElementById('p2p-expiry-timer');
    const textEl = document.getElementById('p2p-expiry-text');
    if (!timerEl || !textEl) return;
    const totalSeconds = Math.max(0, Math.ceil(msLeft / 1000));
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    timerEl.style.display = 'inline-flex';
    textEl.textContent = `Idle popup in ${mins}m ${secs.toString().padStart(2, '0')}s`;
}

function bumpLocalInactivityDeadline() {
    if (!latestRoomMetadata?.inactivityExpiresAt) return;
    const now = Date.now();
    const currentServerNow = now - serverTimeOffset;
    const currentGraceMs = Math.max(0, latestRoomMetadata.inactivityExpiresAt - latestRoomMetadata.inactivityWarningAt);
    latestRoomMetadata = {
        ...latestRoomMetadata,
        serverTime: now,
        inactivityWarningAt: currentServerNow + (2 * 60 * 1000),
        inactivityExpiresAt: currentServerNow + (2 * 60 * 1000) + currentGraceMs,
        inactivityMode: 'idle'
    };
    serverTimeOffset = 0;
    renderImmediateIdleTimer(2 * 60 * 1000);
}

function shouldBeOfferer(targetId) {
    if (!targetId || !socket.id) return false;
    return socket.id < targetId;
}

function hasUsablePeerConnection(peer) {
    if (!peer) return false;
    const channel = peer.dc || peer.channel;
    if (channel && channel.readyState === 'open') return true;
    const pc = peer.pc;
    if (!pc) return false;
    return pc.connectionState === 'connected' || pc.connectionState === 'connecting';
}

syncDebugState();
let audioContextEnabled = false;
let pendingCandidates = {};

let pendingOffers = {};

let myECDHKeyPair = null;
let zeroTrustKey = null;

let encryptWorker = null;
const workerCallbacks = {};

function initEncryptWorker() {
    encryptWorker = new Worker('/encrypt-worker.js');
    encryptWorker.onmessage = (e) => {
        const { type, id, chunkIndex, data, error } = e.data;
        if (type === 'key-ready') {
            auditLog('Encryption engine ready');
        } else if (type === 'key-error' || type === 'encrypt-error' || type === 'decrypt-error') {
            const cb = workerCallbacks[`${id}:${chunkIndex}`] || workerCallbacks['init'];
            if (cb) {
                cb.reject(new Error(error));
                delete workerCallbacks[`${id}:${chunkIndex}`];
            }
            console.error('Worker Error:', error);
        } else if (type === 'chunk-encrypted' || type === 'chunk-decrypted') {
            const cb = workerCallbacks[`${id}:${chunkIndex}`];
            if (cb) {
                cb.resolve(data);
                delete workerCallbacks[`${id}:${chunkIndex}`];
            }
        }
    };
}

function workerEncrypt(fileId, chunkIndex, chunkBuffer) {
    return new Promise((resolve, reject) => {
        workerCallbacks[`${fileId}:${chunkIndex}`] = { resolve, reject };
        encryptWorker.postMessage(
            { type: 'encrypt-chunk', id: fileId, payload: { chunk: chunkBuffer, chunkIndex } },
            [chunkBuffer]
        );
    });
}

function workerDecrypt(fileId, chunkIndex, packedBuffer) {
    return new Promise((resolve, reject) => {
        workerCallbacks[`${fileId}:${chunkIndex}`] = { resolve, reject };
        encryptWorker.postMessage(
            { type: 'decrypt-chunk', id: fileId, payload: { chunk: packedBuffer, chunkIndex } },
            [packedBuffer]
        );
    });
}

const _auditEntries = [];
function auditLog(message) {
    const now = new Date();
    const ts = `${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}.${String(now.getMilliseconds()).padStart(3, '0')}`;
    const entry = `[${ts}] ${message}`;
    _auditEntries.push(entry);
    const panel = document.getElementById('audit-log-body');
    if (panel) {
        const line = document.createElement('div');
        line.className = 'audit-line';
        line.textContent = entry;
        panel.appendChild(line);
        panel.scrollTop = panel.scrollHeight;
    }
    console.log('%cAUDIT', 'color:#10b981;font-weight:bold', entry);
}
window.auditLog = auditLog;

async function generateECDHKeyPair() {
    const keyPair = await crypto.subtle.generateKey(
        { name: 'ECDH', namedCurve: 'P-256' },
        true,
        ['deriveKey', 'deriveBits']
    );
    myECDHKeyPair = keyPair;
    auditLog('ECDH P-256 key pair generated locally — private key never leaves this browser');
    return keyPair;
}

async function deriveSharedKey(theirPublicKeyJwk, passphrase = '') {

    const theirPublicKey = await crypto.subtle.importKey(
        'jwk', theirPublicKeyJwk,
        { name: 'ECDH', namedCurve: 'P-256' },
        false, []
    );

    const sharedBits = await crypto.subtle.deriveBits(
        { name: 'ECDH', public: theirPublicKey },
        myECDHKeyPair.privateKey,
        256
    );
    auditLog('Shared secret computed via ECDH — this value exists only in RAM, never transmitted');

    let keyMaterial = sharedBits;
    if (passphrase) {
        const enc = new TextEncoder();
        const pinKey = await crypto.subtle.importKey('raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveBits']);
        const pinBits = await crypto.subtle.deriveBits(
            { name: 'PBKDF2', salt: enc.encode('YS_ECDH_PIN'), iterations: 10000, hash: 'SHA-256' },
            pinKey, 256
        );

        const a = new Uint8Array(sharedBits), b = new Uint8Array(pinBits);
        const combined = new Uint8Array(32);
        for (let i = 0; i < 32; i++) combined[i] = a[i] ^ b[i];
        keyMaterial = combined.buffer;
        auditLog('Passphrase PIN XORed with ECDH secret — dual-factor key hardening active');
    }

    const rawImport = await crypto.subtle.importKey('raw', keyMaterial, 'HKDF', false, ['deriveKey']);
    const aesKey = await crypto.subtle.deriveKey(
        { name: 'HKDF', hash: 'SHA-256', salt: new TextEncoder().encode('emit-v3'), info: new ArrayBuffer(0) },
        rawImport,
        { name: 'AES-GCM', length: 256 },
        true,
        ['encrypt', 'decrypt']
    );
    auditLog('AES-GCM 256-bit session key derived via HKDF — unique to this session');
    return aesKey;
}

async function loadKeyIntoWorker(aesKey) {
    const rawBytes = await crypto.subtle.exportKey('raw', aesKey);
    encryptWorker.postMessage({ type: 'import-key', payload: { rawKey: rawBytes }, id: 'init' });
    auditLog('AES key loaded into Web Worker (dedicated CPU core for encryption)');
}

initEncryptWorker();
auditLog('emit initialised — all crypto runs client-side');

const configuration = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
    ]
};

let receiveBuffer = {};
let receivedChunks = {};
let activeReceives = {};
let directStreamHandles = {};
const CHUNK_SIZE = 64 * 1024;
const RECEIVE_PERSIST_EVERY_CHUNKS = 16;
const P2P_RESUME_STORAGE_KEY = 'emit-p2p-resume-state';
const P2P_SEND_RESUME_STORAGE_KEY = 'emit-p2p-send-resume-state';

window.activeReceives = activeReceives;
window.directStreamHandles = directStreamHandles;

async function setupDirectToDiskStream(fileId, meta) {
    const isOver500MB = meta && meta.size && meta.size >= 500 * 1024 * 1024;
    if (!isOver500MB || typeof window.showSaveFilePicker !== 'function') {
        return null;
    }
    const modal = document.getElementById('direct-stream-modal');
    const fnEl = document.getElementById('direct-stream-filename');
    const fsEl = document.getElementById('direct-stream-filesize');
    const pickBtn = document.getElementById('direct-stream-pick-btn');
    const memBtn = document.getElementById('direct-stream-memory-btn');

    if (modal && pickBtn && memBtn) {
        if (fnEl) fnEl.textContent = meta.originalName || meta.name || 'file';
        if (fsEl) fsEl.textContent = typeof formatBytes === 'function' ? formatBytes(meta.size || 0) : ((meta.size || 0) + ' bytes');
        modal.style.display = 'flex';
        if (typeof playProceduralSound === 'function') playProceduralSound('chime');

        return new Promise((resolve) => {
            pickBtn.onclick = async () => {
                modal.style.display = 'none';
                try {
                    const handle = await window.showSaveFilePicker({
                        suggestedName: meta.originalName || meta.name || 'download'
                    });
                    const writable = await handle.createWritable();
                    const streamObj = {
                        handle,
                        writable,
                        writeQueue: Promise.resolve(),
                        active: true
                    };
                    directStreamHandles[fileId] = streamObj;
                    if (receiveBuffer[fileId]) {
                        for (const [idxStr, chunkData] of Object.entries(receiveBuffer[fileId])) {
                            const cIdx = Number(idxStr);
                            if (chunkData) {
                                enqueueDirectWrite(fileId, cIdx, chunkData);
                                delete receiveBuffer[fileId][cIdx];
                            }
                        }
                    }
                    auditLog(`Direct-to-Disk stream created for "${meta.name}" — writing chunks straight to disk.`);
                    resolve(streamObj);
                } catch (err) {
                    if (err.name !== 'AbortError') {
                        console.warn('Direct-to-disk picker error:', err);
                    }
                    resolve(null);
                }
            };
            memBtn.onclick = () => {
                modal.style.display = 'none';
                resolve(null);
            };
        });
    }

    try {
        const handle = await window.showSaveFilePicker({
            suggestedName: meta.originalName || meta.name || 'download'
        });
        const writable = await handle.createWritable();
        const streamObj = {
            handle,
            writable,
            writeQueue: Promise.resolve(),
            active: true
        };
        directStreamHandles[fileId] = streamObj;
        if (receiveBuffer[fileId]) {
            for (const [idxStr, chunkData] of Object.entries(receiveBuffer[fileId])) {
                const cIdx = Number(idxStr);
                if (chunkData) {
                    enqueueDirectWrite(fileId, cIdx, chunkData);
                    delete receiveBuffer[fileId][cIdx];
                }
            }
        }
        auditLog(`Direct-to-Disk stream created for "${meta.name}" — writing chunks straight to disk.`);
        return streamObj;
    } catch (err) {
        if (err.name !== 'AbortError') {
            console.warn('Direct-to-disk picker error:', err);
        }
        return null;
    }
}

function enqueueDirectWrite(fileId, chunkIndex, chunkData) {
    const stream = directStreamHandles[fileId];
    if (!stream || !stream.writable || !stream.active) return false;
    if (!stream.bufferedChunks) {
        stream.bufferedChunks = new Map();
        stream.bufferedBytes = 0;
    }
    const chunkBuf = chunkData instanceof Uint8Array ? chunkData : new Uint8Array(chunkData);
    stream.bufferedChunks.set(chunkIndex, chunkBuf);
    stream.bufferedBytes += chunkBuf.byteLength;

    if (stream.bufferedBytes >= 4 * 1024 * 1024) {
        flushDirectStreamBuffer(fileId);
    }
    return true;
}

function flushDirectStreamBuffer(fileId) {
    const stream = directStreamHandles[fileId];
    if (!stream || !stream.writable || !stream.active || !stream.bufferedChunks || stream.bufferedChunks.size === 0) return;

    const entries = Array.from(stream.bufferedChunks.entries()).sort((a, b) => a[0] - b[0]);
    stream.bufferedChunks = new Map();
    stream.bufferedBytes = 0;

    let currentStartChunk = entries[0][0];
    let currentChunks = [entries[0][1]];
    let currentTotalSize = entries[0][1].byteLength;

    const batches = [];

    for (let i = 1; i < entries.length; i++) {
        const [cIdx, buf] = entries[i];
        const lastIdx = currentStartChunk + currentChunks.length - 1;
        if (cIdx === lastIdx + 1) {
            currentChunks.push(buf);
            currentTotalSize += buf.byteLength;
        } else {
            batches.push({ startChunk: currentStartChunk, chunks: currentChunks, totalSize: currentTotalSize });
            currentStartChunk = cIdx;
            currentChunks = [buf];
            currentTotalSize = buf.byteLength;
        }
    }
    batches.push({ startChunk: currentStartChunk, chunks: currentChunks, totalSize: currentTotalSize });

    for (const batch of batches) {
        let combined;
        if (batch.chunks.length === 1) {
            combined = batch.chunks[0];
        } else {
            combined = new Uint8Array(batch.totalSize);
            let offset = 0;
            for (const chunk of batch.chunks) {
                combined.set(chunk, offset);
                offset += chunk.byteLength;
            }
        }
        const writePosition = batch.startChunk * CHUNK_SIZE;
        stream.writeQueue = stream.writeQueue.then(async () => {
            try {
                await stream.writable.write({
                    type: 'write',
                    position: writePosition,
                    data: combined
                });
            } catch (err) {
                console.warn('Direct disk batch write error at chunk ' + batch.startChunk + ':', err);
            }
        });
    }
}

let p2pTransfersResuming = {};
let transferSpeedStats = {};

function ensureTransferScreenVisibleForRestore() {
    const container = document.getElementById('transfers-container');
    if (!container || !container.children.length) return;
    if (!roomId && !signalingId) return;
    if (typeof showScreen === 'function') {
        showScreen('transfer');
    }
}

function restoreCompletedTransferRow(fileId, transfer) {
    if (!transfer || document.getElementById(`item-${fileId}`)) return false;
    const isDownload = transfer.direction === 'download';
    createTransferElement(fileId, transfer.name, transfer.size, isDownload, null, transfer.nickname || '');
    forceTransferDirection(fileId, isDownload, transfer.size);
    updateTransferProgress(
        fileId,
        100,
        isDownload ? 'Ready to Save' : 'Sent',
        '',
        ''
    );
    setResumeButtonState(fileId, false, null);
    const downloadBtn = document.getElementById(`download-btn-${fileId}`);
    if (downloadBtn) {
        downloadBtn.style.pointerEvents = isDownload ? 'auto' : 'none';
        downloadBtn.style.opacity = isDownload ? '1' : '0.4';
    }
    const cancelBtn = document.getElementById(`cancel-transfer-${fileId}`);
    if (cancelBtn) {
        cancelBtn.style.display = 'inline-flex';
        cancelBtn.onclick = () => {
            window.dispatchEvent(new CustomEvent('cancel-transfer', {
                detail: { fileId }
            }));
        };
    }
    return true;
}

async function restorePersistedP2PTransfers() {
    const container = document.getElementById('transfers-container');
    if (!container) {
        return false;
    }
    const canShowTransferScreen = !!(roomId || signalingId);
    if (!canShowTransferScreen) {
        return false;
    }

    let restoredAny = false;
    const activeRoomKey = (roomId || signalingId || '').toString().trim().toUpperCase();
    const sendState = backfillSendResumeStateFromActivity();
    const state = loadP2PResumeState();
    Object.values(state).forEach((entry) => {
        if (!entry || !entry.meta || !entry.receivedChunks || !entry.receivedChunks.length) return;
        const meta = entry.meta;
        const entryRoomKey = (meta.roomId || '').toString().trim().toUpperCase();
        if (activeRoomKey && entryRoomKey && entryRoomKey !== activeRoomKey) return;
        if (document.getElementById(`item-${meta.id}`)) return;
        activeReceives[meta.id] = { ...meta, senderId: meta.senderId || null };
        receiveBuffer[meta.id] = receiveBuffer[meta.id] || [];
        receivedChunks[meta.id] = new Set(entry.receivedChunks);
        if (meta.roomId && typeof ActivityTracker !== 'undefined') {
            ActivityTracker.addP2PRoom(meta.roomId, { name: meta.roomId });
        }
        createTransferElement(meta.id, meta.originalName || meta.name, meta.size, true, null, meta.nickname);
        restoredAny = true;
        const progress = Math.min(((entry.receivedChunks.length * CHUNK_SIZE) / meta.size) * 100, 100);
        updateTransferProgress(meta.id, progress, 'Paused - waiting to resume', '', '');
        if (typeof ActivityTracker !== 'undefined') {
            ActivityTracker.addTransfer(meta.id, {
                name: meta.originalName || meta.name,
                nickname: meta.nickname,
                size: meta.size,
                roomId: meta.roomId || roomId || null,
                direction: 'download',
                progress,
                paused: true,
                pausedLabel: 'Waiting for sender'
            });
        }
        setResumeButtonState(meta.id, false, null);
    });

    for (const entry of Object.values(sendState)) {
        if (!entry || !entry.fileId || !entry.fileName || !entry.fileSize) return;
        const entryRoomKey = (entry.roomId || '').toString().trim().toUpperCase();
        if (activeRoomKey && entryRoomKey && entryRoomKey !== activeRoomKey) continue;
        if (activeReceives[entry.fileId]) continue;
        const resolvedPeer = entry.targetId
            ? (peers[entry.targetId]
                || Object.values(peers).find((peer) => peer && peer.name === entry.peerName)
                || (Object.keys(peers).length === 1 ? Object.values(peers)[0] : null))
            : (Object.values(peers).find((peer) => peer && peer.name === entry.peerName)
                || (Object.keys(peers).length === 1 ? Object.values(peers)[0] : null));
        if (resolvedPeer?.id) {
            entry.targetId = resolvedPeer.id;
            entry.peerName = resolvedPeer.name || entry.peerName;
        }
        const statusPeer = entry.peerName || resolvedPeer?.name || 'peer';
        let cachedFile = null;
        try {
            cachedFile = await getCachedP2PSendFile(entry.fileId);
        } catch (e) {
            cachedFile = null;
        }
        const hasLiveFile = !!(activeSends[entry.fileId]?.file && typeof activeSends[entry.fileId].file.slice === 'function');
        const hasCachedFile = !!(cachedFile && typeof cachedFile.slice === 'function');
        const hasPersistedMeta = !!(entry.fileMeta && typeof entry.fileMeta.name === 'string' && typeof entry.fileMeta.size === 'number');
        const hasFileData = hasLiveFile || hasCachedFile || hasPersistedMeta;
        const shouldKeepQueuedState = hasFileData && !!entry.waitingForOpen;
        if (!activeSends[entry.fileId]) {
            activeSends[entry.fileId] = {
                file: hasCachedFile ? cachedFile : (entry.fileMeta ? {
                    name: entry.fileMeta.name,
                    size: entry.fileMeta.size,
                    type: entry.fileMeta.type || '',
                    nickname: entry.fileMeta.nickname || entry.nickname || ''
                } : null),
                chunkIndex: entry.chunkIndex ?? Math.max(0, Math.floor(((entry.progress ?? 0) / 100) * Math.ceil(entry.fileSize / CHUNK_SIZE))),
                paused: true,
                aborted: false,
                fileId: entry.fileId,
                targetId: entry.targetId,
                resumeLoop: null,
                waitingForOpen: !!entry.waitingForOpen,
                restoredFromStorage: true,
                missingFile: false
            };
        } else if (hasCachedFile) {
            activeSends[entry.fileId].file = cachedFile || activeSends[entry.fileId].file;
            activeSends[entry.fileId].missingFile = false;
        }
        entry.missingFile = false;
        restoredAny = true;
        if (!document.getElementById(`item-${entry.fileId}`)) {
            createTransferElement(entry.fileId, entry.fileName, entry.fileSize, false, null, entry.nickname || '');
        }
        forceTransferDirection(entry.fileId, false, entry.fileSize);
        const restoredStatus = shouldKeepQueuedState
            ? `Connecting to ${statusPeer}`
            : `Paused - waiting for ${statusPeer}`;
        updateTransferProgress(entry.fileId, entry.progress ?? 0, restoredStatus, '', '');
        if (typeof ActivityTracker !== 'undefined') {
            ActivityTracker.addTransfer(entry.fileId, {
                name: entry.fileName,
                nickname: entry.nickname || '',
                size: entry.fileSize,
                roomId: entry.roomId || roomId || null,
                direction: 'upload',
                progress: entry.progress ?? 0,
                paused: !shouldKeepQueuedState,
                pausedLabel: shouldKeepQueuedState ? '' : `Waiting for ${statusPeer}`
            });
        }
        if (shouldKeepQueuedState) {
            setResumeButtonState(entry.fileId, false, null);
            if (typeof ActivityTracker !== 'undefined') {
                ActivityTracker.updateTransfer(entry.fileId, {
                    progress: entry.progress ?? 0,
                    speed: 'Connecting',
                    eta: 'Waiting for peer',
                    paused: false,
                    pausedLabel: ''
                });
            }
            persistPausedSend(entry.fileId, statusPeer, entry.progress ?? 0);
        } else {
            markSendPaused(entry.fileId, statusPeer, entry.progress ?? 0);
        }

        const matchingReceive = state[entry.fileId];
        if (matchingReceive && matchingReceive.receivedChunks?.length && resolvedPeer?.dc?.readyState === 'open' && hasFileData) {
            activeSends[entry.fileId].paused = false;
            setResumeButtonState(entry.fileId, false, null);
            updateTransferProgress(entry.fileId, entry.progress ?? 0, `Resuming to ${statusPeer}`, '', '');
            setTimeout(() => {
                const latestPeer = peers[activeSends[entry.fileId]?.targetId || resolvedPeer.id] || resolvedPeer;
                if (latestPeer?.dc?.readyState === 'open') {
                    resumeSendFile(entry.fileId, latestPeer.id);
                }
            }, 150);
        }
    }

    if (restoredAny && canShowTransferScreen) {
        ensureTransferScreenVisibleForRestore();
    }

    if (!restoredAny && typeof ActivityTracker !== 'undefined') {
        const activityTransfers = ActivityTracker.state?.transfers || {};
        Object.entries(activityTransfers).forEach(([fileId, transfer]) => {
            if (!transfer || document.getElementById(`item-${fileId}`)) return;
            if (transfer.direction !== 'upload' && transfer.direction !== 'download') return;
            const transferRoomKey = (transfer.roomId || '').toString().trim().toUpperCase();
            if (activeRoomKey && transferRoomKey && transferRoomKey !== activeRoomKey) return;
            if ((transfer.progress ?? 0) >= 100) {
                if (restoreCompletedTransferRow(fileId, transfer)) {
                    restoredAny = true;
                }
                return;
            }
            createTransferElement(fileId, transfer.name, transfer.size, transfer.direction === 'download', null, transfer.nickname || '');
            forceTransferDirection(fileId, transfer.direction === 'download', transfer.size);
            updateTransferProgress(
                fileId,
                transfer.progress ?? 0,
                transfer.paused
                    ? `Paused - ${String(transfer.pausedLabel || 'waiting for peer').toLowerCase()}`
                    : (transfer.speed || 'Restoring transfer'),
                '',
                ''
            );
            if (transfer.direction === 'upload') {
                setResumeButtonState(fileId, true, null);
            }
            restoredAny = true;
        });
        if (restoredAny && canShowTransferScreen) {
            ensureTransferScreenVisibleForRestore();
        }
    }

    return restoredAny;
}

function hasPersistedTransferRecord(fileId) {
    if (!fileId) return false;
    const sendState = loadP2PSendResumeState();
    if (sendState && sendState[fileId]) return true;
    const receiveState = loadP2PResumeState();
    if (receiveState && receiveState[fileId]) return true;
    if (typeof ActivityTracker !== 'undefined' && ActivityTracker.state?.transfers?.[fileId]) return true;
    return false;
}

function hasPersistedTransferActivityForCurrentRoom() {
    if (typeof ActivityTracker === 'undefined' || !ActivityTracker.state?.transfers) return false;
    const activeRoomKey = (roomId || '').toString().trim().toUpperCase();
    return Object.values(ActivityTracker.state.transfers).some((transfer) => {
        if (!transfer) return false;
        const transferRoomKey = (transfer.roomId || '').toString().trim().toUpperCase();
        if (activeRoomKey && transferRoomKey && transferRoomKey !== activeRoomKey) return false;
        return transfer.direction === 'upload' || transfer.direction === 'download';
    });
}

function getSavedReceiveProgress(meta) {
    const saved = loadP2PResumeState()[meta.id];
    if (!saved || !saved.receivedChunks || !saved.receivedChunks.length) return null;
    receivedChunks[meta.id] = new Set(saved.receivedChunks);
    return Math.min(((saved.receivedChunks.length * CHUNK_SIZE) / meta.size) * 100, 100);
}

function setP2PTransferResuming(fileId, isResuming) {
    p2pTransfersResuming[fileId] = !!isResuming;
    if (typeof ActivityTracker !== 'undefined') {
        ActivityTracker.setP2PTransferResuming(fileId, isResuming);
    }
}

function updateTransferSpeed(fileId, bytesReceived, elapsedMs) {
    if (!transferSpeedStats[fileId]) {
        transferSpeedStats[fileId] = { lastUpdate: Date.now(), lastBytes: 0, speed: 0 };
    }
    const stats = transferSpeedStats[fileId];
    const timeDelta = Date.now() - stats.lastUpdate;
    if (timeDelta > 1000) {
        const bytesDelta = bytesReceived - stats.lastBytes;
        stats.speed = (bytesDelta / timeDelta) * 1000;
        stats.lastBytes = bytesReceived;
        stats.lastUpdate = Date.now();
    }
    return stats.speed;
}
async function encryptMeta(metaObj) {
    if (!zeroTrustKey) return { encrypted: false, data: JSON.stringify(metaObj) };
    const enc = new TextEncoder();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const cipher = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        zeroTrustKey,
        enc.encode(JSON.stringify(metaObj))
    );
    return { encrypted: true, iv: Array.from(iv), data: Array.from(new Uint8Array(cipher)) };
}

async function decryptMeta(envelope) {
    if (!envelope.encrypted) return JSON.parse(envelope.data);
    const iv = new Uint8Array(envelope.iv);
    const cipher = new Uint8Array(envelope.data).buffer;
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, zeroTrustKey, cipher);
    return JSON.parse(new TextDecoder().decode(plain));
}

let activeSends = {};

window.activeSends = activeSends;

function loadP2PResumeState() {
    try {
        const raw = localStorage.getItem(P2P_RESUME_STORAGE_KEY);
        if (!raw) return {};
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (e) {
        return {};
    }
}

function saveP2PResumeState(state) {
    try {
        localStorage.setItem(P2P_RESUME_STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
    }
}

function loadP2PSendResumeState() {
    try {
        const raw = localStorage.getItem(P2P_SEND_RESUME_STORAGE_KEY);
        if (!raw) return {};
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (e) {
        return {};
    }
}

function saveP2PSendResumeState(state) {
    try {
        localStorage.setItem(P2P_SEND_RESUME_STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
    }
}

function backfillSendResumeStateFromActivity() {
    const existing = loadP2PSendResumeState();
    if (Object.keys(existing).length > 0) return existing;
    return existing;
}

function persistPausedSend(fileId, peerName, progress = null) {
    const state = activeSends[fileId];
    const persisted = !state ? loadP2PSendResumeState()[fileId] : null;
    const fileRef = state?.file || persisted?.fileMeta || null;
    if (!fileRef) return;
    const pct = progress !== null
        ? progress
        : state
            ? Math.min(((state.chunkIndex * CHUNK_SIZE) / state.file.size) * 100, 100)
            : (persisted?.progress ?? 0);
    const saved = loadP2PSendResumeState();
    saved[fileId] = {
        fileId,
        fileName: fileRef.name,
        fileSize: fileRef.size,
        roomId: roomId || persisted?.roomId || null,
        nickname: fileRef.nickname || persisted?.nickname || '',
        targetId: state?.targetId || persisted?.targetId || null,
        peerName: peerName || 'peer',
        progress: pct,
        chunkIndex: state?.chunkIndex ?? persisted?.chunkIndex ?? Math.max(0, Math.floor(((pct ?? 0) / 100) * Math.ceil((fileRef.size || persisted?.fileSize || 1) / CHUNK_SIZE))),
        fileMeta: {
            name: fileRef.name,
            size: fileRef.size,
            type: fileRef.type || '',
            nickname: fileRef.nickname || persisted?.nickname || ''
        },
        waitingForOpen: !!(state?.waitingForOpen || persisted?.waitingForOpen),
        missingFile: false,
        updatedAt: Date.now()
    };
    saveP2PSendResumeState(saved);
}

function clearPersistedPausedSend(fileId) {
    const state = loadP2PSendResumeState();
    if (!state[fileId]) return;
    delete state[fileId];
    saveP2PSendResumeState(state);
}

function clearPersistedTransferArtifacts(fileId) {
    if (!fileId) return;
    clearPersistedPausedSend(fileId);
    clearPersistedPartialReceive(fileId);
    clearCachedP2PSendFile(fileId).catch(() => { });
    if (typeof ActivityTracker !== 'undefined') {
        ActivityTracker.removeTransfer(fileId);
    }
}

function persistPartialReceive(fileId) {
    const meta = activeReceives[fileId];
    const chunks = receivedChunks[fileId];
    if (!meta || !chunks || chunks.size === 0) return;
    const state = loadP2PResumeState();
    state[fileId] = {
        meta: {
            ...meta,
            roomId: roomId || meta.roomId || null
        },
        receivedChunks: Array.from(chunks),
        updatedAt: Date.now()
    };
    saveP2PResumeState(state);
}

function clearPersistedPartialReceive(fileId) {
    const state = loadP2PResumeState();
    if (!state[fileId]) return;
    delete state[fileId];
    saveP2PResumeState(state);
}

function setResumeButtonState(fileId, visible, onClick) {
    const resumeBtn = document.getElementById(`resume-btn-${fileId}`);
    if (!resumeBtn) return;
    resumeBtn.style.display = visible ? 'inline-flex' : 'none';
    resumeBtn.onclick = visible ? onClick : null;
}

function forceTransferDirection(fileId, isReceiving, size = null) {
    const item = document.getElementById(`item-${fileId}`);
    if (!item) return;
    const info = item.querySelector('.transfer-details .transfer-info-text');
    const downloadBtn = document.getElementById(`download-btn-${fileId}`);
    if (info) {
        const sizeText = size !== null
            ? (typeof ActivityTracker !== 'undefined' ? ActivityTracker.formatBytes(size) : `${(size / (1024 * 1024)).toFixed(2)} MB`)
            : info.textContent.split('|')[0].trim();
        info.innerHTML = `${sizeText} | <i class="fa-solid ${isReceiving ? 'fa-arrow-down' : 'fa-arrow-up'}"></i> ${isReceiving ? 'Receiving' : 'Sending'}`;
    }
    if (downloadBtn) {
        downloadBtn.style.pointerEvents = isReceiving ? 'none' : 'auto';
        downloadBtn.style.opacity = isReceiving ? '0.4' : '1';
    }
}

function showReceivePausedState(meta, peer) {
    const progress = Math.min((((receivedChunks[meta.id] || new Set()).size * CHUNK_SIZE) / meta.size) * 100, 100);
    setResumeButtonState(meta.id, false, null);
    updateTransferProgress(meta.id, progress, `Paused - waiting for ${peer.name}`, '', '');
    if (typeof ActivityTracker !== 'undefined') {
        ActivityTracker.updateTransfer(meta.id, {
            progress,
            speed: 'Paused',
            eta: 'Waiting for sender',
            paused: true,
            pausedLabel: `Waiting for ${peer.name}`
        });
    }
}

function markSendPaused(fileId, peerName, progress = null) {
    const state = activeSends[fileId];
    const persisted = !state ? loadP2PSendResumeState()[fileId] : null;
    if (!state && !persisted) return;
    const pct = progress !== null
        ? progress
        : state
            ? Math.min(((state.chunkIndex * CHUNK_SIZE) / state.file.size) * 100, 100)
            : (persisted.progress ?? 0);
    persistPausedSend(fileId, peerName, pct);
    setResumeButtonState(fileId, true, () => {
        const tryResume = async () => {
            let latestState = activeSends[fileId];
            const persistedState = loadP2PSendResumeState()[fileId] || persisted || null;
            if ((!latestState || !latestState.file || typeof latestState.file.slice !== 'function') && persisted?.fileMeta) {
                try {
                    const cachedFile = await getCachedP2PSendFile(fileId);
                    if (cachedFile && typeof cachedFile.slice === 'function') {
                        latestState = activeSends[fileId] || {
                            file: cachedFile,
                            chunkIndex: Math.max(0, Math.floor(((persisted.progress ?? 0) / 100) * Math.ceil((persisted.fileSize || cachedFile.size) / CHUNK_SIZE))),
                            paused: true,
                            aborted: false,
                            fileId,
                            targetId: persisted.targetId,
                            peerName: persisted.peerName || peerName,
                            resumeLoop: null,
                            waitingForOpen: !!persisted.waitingForOpen,
                            restoredFromStorage: true,
                            missingFile: false
                        };
                        latestState.file = cachedFile;
                        latestState.missingFile = false;
                        activeSends[fileId] = latestState;
                        window.activeSends = activeSends;
                    }
                } catch (e) {
                    console.warn('Failed to restore cached P2P send file', e);
                }
            }

            if (latestState && typeof latestState.resumeLoop !== 'function' && latestState.file && typeof latestState.file.slice === 'function') {
                const resolvedTargetId = latestState.targetId || persistedState?.targetId || null;
                const resolvedPeer = resolvedTargetId
                    ? (peers[resolvedTargetId]
                        || Object.values(peers).find((peer) => peer && peer.name === (latestState.peerName || peerName))
                        || (Object.keys(peers).length === 1 ? Object.values(peers)[0] : null))
                    : (Object.values(peers).find((peer) => peer && peer.name === (latestState.peerName || peerName))
                        || (Object.keys(peers).length === 1 ? Object.values(peers)[0] : null));

                if (resolvedPeer?.id) {
                    latestState.targetId = resolvedPeer.id;
                    latestState.peerName = resolvedPeer.name || latestState.peerName || peerName;
                    const fileToResume = latestState.file;
                    fileToResume.nickname = fileToResume.nickname || persistedState?.nickname || persistedState?.fileMeta?.nickname || '';
                    setResumeButtonState(fileId, false, null);
                    const oldRow = document.getElementById(`item-${fileId}`);
                    if (oldRow) oldRow.remove();
                    delete activeSends[fileId];
                    await sendFile(fileToResume, resolvedPeer.id, fileToResume.nickname || '');
                    return;
                }
            }

            const latestPeer = latestState
                ? (peers[latestState.targetId]
                    || Object.values(peers).find((peer) => peer && peer.name === (latestState.peerName || peerName))
                    || (Object.keys(peers).length === 1 ? Object.values(peers)[0] : null))
                : null;

            if (!latestState || latestState.aborted || !latestState.file || typeof latestState.file.slice !== 'function') {
                persistPausedSend(fileId, peerName, pct);
                updateTransferProgress(fileId, pct, `Paused - waiting for ${peerName}`, '', '');
                if (typeof ActivityTracker !== 'undefined') {
                    ActivityTracker.updateTransfer(fileId, {
                        progress: pct,
                        speed: 'Paused',
                        eta: 'Waiting for reconnect',
                        paused: true,
                        pausedLabel: `Waiting for ${peerName}`
                    });
                }
                return;
            }
            if (!latestPeer || !latestPeer.dc || latestPeer.dc.readyState !== 'open') {
                updateTransferProgress(fileId, pct, `Paused - waiting for ${peerName}`, '', '');
                showToast('Still Waiting', `${peerName} is not connected yet.`, 'info');
                return;
            }
            latestState.targetId = latestPeer.id || latestState.targetId;
            latestState.peerName = latestPeer.name || latestState.peerName || peerName;
            latestState.paused = false;
            setResumeButtonState(fileId, false, null);
            updateTransferProgress(fileId, pct, `Resuming to ${latestPeer.name}`, '', '');
            if (typeof ActivityTracker !== 'undefined') {
                ActivityTracker.updateTransfer(fileId, {
                    paused: false,
                    pausedLabel: ''
                });
            }
            resumeSendFile(fileId, latestPeer.id || latestState.targetId);
        };
        tryResume();
    });
    const applyPausedUi = async () => {
        if ((!state || !state.file || typeof state.file.slice !== 'function') && persisted?.fileMeta) {
            try {
                const cachedFile = await getCachedP2PSendFile(fileId);
                if (cachedFile && typeof cachedFile.slice === 'function') {
                    const latest = activeSends[fileId] || {};
                    latest.file = cachedFile;
                    latest.missingFile = false;
                    latest.fileId = latest.fileId || fileId;
                    latest.targetId = latest.targetId || persisted?.targetId || null;
                    latest.peerName = latest.peerName || persisted?.peerName || peerName;
                    latest.chunkIndex = latest.chunkIndex ?? Math.max(0, Math.floor(((persisted.progress ?? 0) / 100) * Math.ceil((persisted.fileSize || cachedFile.size) / CHUNK_SIZE)));
                    latest.paused = true;
                    latest.aborted = !!latest.aborted;
                    latest.waitingForOpen = !!(latest.waitingForOpen || persisted?.waitingForOpen);
                    activeSends[fileId] = latest;
                    persistPausedSend(fileId, peerName, pct);
                }
            } catch (e) {
                console.warn('Failed to verify cached P2P send file during pause UI update', e);
            }
        }
        updateTransferProgress(fileId, pct, `Paused - waiting for ${peerName}`, '', '');
        if (typeof ActivityTracker !== 'undefined') {
            ActivityTracker.updateTransfer(fileId, {
                progress: pct,
                speed: 'Paused',
                eta: 'Waiting for reconnect',
                paused: true,
                pausedLabel: `Waiting for ${peerName}`
            });
        }
    };
    applyPausedUi();
}



function sendDestroyRequest() {
    const peerCount = Object.keys(peers).length;
    const persistentId = myPersistentId || localStorage.getItem('emit-persistent-id');
    if (peerCount === 0) {
        socket.emit('destroy-room', signalingId);
        showToast('Workspace Wiped', 'Workspace destroyed successfully.', 'success');
        if (ui.panels.destroyModal) ui.panels.destroyModal.style.display = 'none';
        animateVanishAndClear(true).then(() => {
            if (roomId && typeof ActivityTracker !== 'undefined') {
                ActivityTracker.handleRoomClose(roomId);
            } else {
                performWipe(true);
            }
        });
        return;
    } else {
        window.isDestructionRequester = true;
        socket.emit('request-destruction', persistentId);
        showToast('Destruction Requested', `Waiting for all ${peerCount + 1} people to accept...`, 'info');
    }
    if (ui.panels.destroyModal) ui.panels.destroyModal.style.display = 'none';
}

if (ui.buttons.destroyConfirm) {
    ui.buttons.destroyConfirm.onclick = sendDestroyRequest;
}

if (ui.buttons.destroyCancel) {
    ui.buttons.destroyCancel.onclick = () => {
        ui.panels.destroyModal.style.display = 'none';

        socket.emit('peer-destroy-reject', signalingId);
    };
}

if (ui.buttons.destroy) {
    ui.buttons.destroy.onclick = (e) => {
        if (e) e.preventDefault();
        const peerCount = Object.keys(peers).length;
        if (peerCount === 0) {
            socket.emit('destroy-room', signalingId);
            showToast('Workspace Wiped', 'Workspace destroyed successfully.', 'success');
            animateVanishAndClear(true).then(() => {
                if (roomId && typeof ActivityTracker !== 'undefined') {
                    ActivityTracker.handleRoomClose(roomId);
                } else {
                    performWipe(true);
                }
            });
        } else {
            const textEl = document.getElementById('destroy-request-text');
            const confirmBtn = document.getElementById('destroy-confirm-btn');
            if (textEl) {
                textEl.textContent = "This will initiate a 15-second destruction countdown for ALL peers. Any peer can reject this request.";
                textEl.style.color = "var(--text-muted)";
            }
            if (confirmBtn) {
                confirmBtn.textContent = "Request Destruction";
                confirmBtn.onclick = sendDestroyRequest;
            }
            if (ui.panels.destroyModal) ui.panels.destroyModal.style.display = 'flex';
        }
    };
}

socket.on('peer-destroy-request', () => {
    if (typeof playProceduralSound === 'function') playProceduralSound('chime');

    const textEl = document.getElementById('destroy-request-text');
    const confirmBtn = document.getElementById('destroy-confirm-btn');

    if (textEl) {
        textEl.textContent = "Your peer is requesting to instantly wipe this workspace and disconnect everyone. Do you agree?";
        textEl.style.color = "var(--accent-red)";
    }

    if (confirmBtn) {
        confirmBtn.textContent = "Agree & Wipe";
        confirmBtn.onclick = () => {
            socket.emit('destroy-room', signalingId);
            if (roomId && typeof ActivityTracker !== 'undefined') {
                ActivityTracker.handleRoomClose(roomId);
            } else {
                performWipe(true);
            }
            ui.panels.destroyModal.style.display = 'none';
        };
    }

    if (ui.panels.destroyModal) ui.panels.destroyModal.style.display = 'flex';
});

socket.on('peer-destroy-reject', () => {
    if (typeof playProceduralSound === 'function') playProceduralSound('pop');
    showToast('Vault Intact', 'Your peer declined the request to destroy the workspace.', 'error');
});

let p2pTimerInterval = null;

function animateVanishAndClear(fullPage = false) {
    return new Promise((resolve) => {
        const container = document.getElementById('transfers-container');
        let elementsToVanish = [];

        if (fullPage) {
            const transferScreen = document.getElementById('screen-transfer');
            if (transferScreen && transferScreen.classList.contains('active')) {
                const header = document.querySelector('.site-header');
                const mainScreens = document.querySelectorAll('.screen');
                if (header) elementsToVanish.push(header);
                mainScreens.forEach(s => elementsToVanish.push(s));
                if (typeof playProceduralSound === 'function') playProceduralSound('chime');
            }
        } else if (container) {
            elementsToVanish = Array.from(container.querySelectorAll('.transfer-item'));
        }

        if (elementsToVanish.length === 0) {
            if (container) container.innerHTML = '';
            return resolve();
        }

        if (!document.getElementById('vanish-style')) {
            const style = document.createElement('style');
            style.id = 'vanish-style';
            style.textContent = `
                @keyframes sandVanish {
                    0% { opacity: 1; transform: scale(1) translateY(0); filter: blur(0px); }
                    100% { opacity: 0; transform: scale(0.8) translateY(20px); filter: blur(8px) sepia(60%) contrast(150%); }
                }
                .vanish-sand-slow {
                    animation: sandVanish 1.2s cubic-bezier(0.25, 1, 0.5, 1) forwards;
                    pointer-events: none !important;
                }
                .sand-particle {
                    position: fixed; width: 4px; height: 4px; background: #a6a6a6;
                    pointer-events: none; z-index: 9999;
                    animation: sandFall 1.2s ease-in forwards;
                    box-shadow: 0 0 4px #fff;
                    border-radius: 50%;
                }
                @keyframes sandFall {
                    0% { transform: translate(0, 0) rotate(0deg) scale(1); opacity: 1; }
                    100% { transform: translate(var(--tx), var(--ty)) rotate(var(--rot)) scale(0); opacity: 0; }
                }
            `;
            document.head.appendChild(style);
        }

        elementsToVanish.forEach(item => {
            item.classList.add('vanish-sand-slow');
            const rect = item.getBoundingClientRect();
            const pCount = fullPage ? 60 : 25;
            for (let i = 0; i < pCount; i++) {
                const p = document.createElement('div');
                p.className = 'sand-particle';
                p.style.left = (rect.left + Math.random() * rect.width) + 'px';
                p.style.top = (rect.top + Math.random() * rect.height) + 'px';
                p.style.setProperty('--tx', ((Math.random() - 0.5) * 150) + 'px');
                p.style.setProperty('--ty', (Math.random() * 150 + 50) + 'px');
                p.style.setProperty('--rot', (Math.random() * 360) + 'deg');
                document.body.appendChild(p);
                setTimeout(() => p.remove(), 1200);
            }
        });

        setTimeout(() => {
            if (container) container.innerHTML = '';
            elementsToVanish.forEach(item => item.classList.remove('vanish-sand-slow'));
            resolve();
        }, 1200);
    });
}


let isWiping = false;
async function performWipe(fullPage = false) {
    if (isWiping) return;
    isWiping = true;
    try {
        const hasSavedWorkspaceState = !fullPage && !!localStorage.getItem('ys_workspace');
        const hasPersistedTransferState = !fullPage && (
            Object.keys(loadP2PResumeState()).length > 0 ||
            Object.keys(loadP2PSendResumeState()).length > 0
        );
        const shouldPreserveSessionState = hasPersistedTransferState || hasSavedWorkspaceState;
        const savedWorkspaceId = hasSavedWorkspaceState ? localStorage.getItem('ys_workspace') : null;
        const savedGuard = hasSavedWorkspaceState ? (localStorage.getItem('ys_guard') || '') : '';
        const preservedRoomId = shouldPreserveSessionState ? (roomId || savedWorkspaceId) : null;
        const preservedSignalingId = shouldPreserveSessionState ? (signalingId || (savedWorkspaceId ? (savedGuard ? `${savedWorkspaceId}:${savedGuard}` : savedWorkspaceId) : null)) : null;
        const preservedReceiveResumeState = !fullPage ? localStorage.getItem(P2P_RESUME_STORAGE_KEY) : null;
        const preservedSendResumeState = !fullPage ? localStorage.getItem(P2P_SEND_RESUME_STORAGE_KEY) : null;
        const preservedTransferActivityState = !fullPage ? localStorage.getItem('emit-p2p-transfers') : null;

        if (p2pTimerInterval) {
            clearInterval(p2pTimerInterval);
            p2pTimerInterval = null;
        }
        const timerEl = document.getElementById('p2p-expiry-timer');
        if (timerEl) timerEl.style.display = 'none';

        for (const id in peers) {
            if (peers[id].pc) {
                try { peers[id].pc.close(); } catch (e) { }
            }
        }
        peers = {};
        if (roomId && typeof ActivityTracker !== 'undefined') {
            ActivityTracker.removeP2PRoom(roomId);
        }
        if (fullPage && typeof ActivityTracker !== 'undefined' && typeof ActivityTracker.clearAllTransfers === 'function') {
            ActivityTracker.clearAllTransfers();
        }
        roomId = shouldPreserveSessionState ? preservedRoomId : null;
        signalingId = shouldPreserveSessionState ? preservedSignalingId : null;
        lastJoinEmit = null;
        window.isShadowTab = false;
        window.primarySocketId = null;
        peerId = null;
        pendingCandidates = {};
        receiveBuffer = {};
        receivedChunks = {};
        activeReceives = {};
        activeSends = {};
        window.activeReceives = activeReceives;
        window.activeSends = activeSends;
        window.peers = peers;
        syncDebugState();
        p2pTransferQueue = [];
        activeP2PCount = 0;

        const chatLog = document.getElementById('chat-log');
        if (chatLog) {
            chatLog.innerHTML = `
                <div class="chat-placeholder">
                    <p>Messages are end-to-end encrypted. They are never stored and exist only in this session.</p>
                </div>
            `;
        }

        const peerList = document.getElementById('peer-list');
        if (peerList) peerList.innerHTML = '<div class="empty-peers">Waiting for peers to join...</div>';

        if (!shouldPreserveSessionState) {
            localStorage.removeItem('ys_workspace');
            localStorage.removeItem('ys_guard');
            localStorage.removeItem('ys_is_creator');
        }
        if (!fullPage) {
            if (preservedReceiveResumeState !== null) {
                localStorage.setItem(P2P_RESUME_STORAGE_KEY, preservedReceiveResumeState);
            }
            if (preservedSendResumeState !== null) {
                localStorage.setItem(P2P_SEND_RESUME_STORAGE_KEY, preservedSendResumeState);
            }
            if (preservedTransferActivityState !== null) {
                localStorage.setItem('emit-p2p-transfers', preservedTransferActivityState);
            }
        }
        if (shouldPreserveSessionState && preservedRoomId) {
            if (ui.text.currentRoom) ui.text.currentRoom.textContent = preservedRoomId;
            if (ui.text.displayRoomCode) ui.text.displayRoomCode.textContent = preservedRoomId;
            hasAutoJoined = false;
        }
        const textEl = document.getElementById('destroy-request-text');
        if (textEl) textEl.textContent = "This will instantly wipe all encryption keys and files for BOTH users. Your peer must agree to proceed.";
        if (ui.buttons.destroyConfirm) {
            ui.buttons.destroyConfirm.textContent = "Request Destruction";
            ui.buttons.destroyConfirm.onclick = typeof sendDestroyRequest !== 'undefined' ? sendDestroyRequest : null;
        }
        if (ui.buttons.destroyCancel) {
            ui.buttons.destroyCancel.textContent = "Cancel";
            ui.buttons.destroyCancel.onclick = () => {
                if (ui.panels.destroyModal) ui.panels.destroyModal.style.display = 'none';
                socket.emit('peer-destroy-reject', signalingId);
            };
        }

        if (window._expiryInterval) clearInterval(window._expiryInterval);
        if (inactivityGraceInterval) clearInterval(inactivityGraceInterval);
        if (ui.panels.inactivityModal) ui.panels.inactivityModal.style.display = 'none';

        ui.panels.destroyModal.style.display = 'none';
        ui.panels.leaveModal.style.display = 'none';

        if (typeof window.closeTab === 'function' && window.activeTabId && window.activeTabId !== 'home') {
            window.closeTab(window.activeTabId);
        } else {
            if (window.history && window.history.pushState && !(shouldPreserveSessionState && !fullPage)) {
                window.history.pushState({}, '', window.location.pathname);
            }
            if (!(shouldPreserveSessionState && !fullPage)) {
                showScreen('room');
            }
            if (!shouldPreserveSessionState) {
                updateConnectionStatus('disconnected', 'Offline');
            }
        }
    } finally {
        isWiping = false;
    }
}


ui.buttons.leaveConfirm.addEventListener('click', () => {
    const strategyElement = document.querySelector('input[name="exit-strategy"]:checked');
    if (!strategyElement) return;
    const strategy = strategyElement.value;
    let timerMin = parseInt(document.getElementById('leave-timer-min').value) || 5;
    if (timerMin > 60) timerMin = 60;
    if (timerMin < 1) timerMin = 1;

    if (typeof playProceduralSound === 'function') playProceduralSound('chime');
    const transferScreen = document.getElementById('screen-transfer');
    if (transferScreen) transferScreen.classList.add('screen-exit');

    setTimeout(() => {
        if (transferScreen) transferScreen.classList.remove('screen-exit');
        ui.panels.leaveModal.style.display = 'none';

        if (strategy === 'standard') {
            socket.emit('leave-room', signalingId, { strategy: 'standard' });
            performWipe(true);
            showToast('Left Workspace', 'You have disconnected from the workspace.', 'info');
        } else if (strategy === 'peer') {
            showToast('Standby Mode', 'Connection closed, but files will stay hosted until peer exits.', 'info');
            socket.emit('leave-room', signalingId, { strategy: 'on-peer-exit' });
            performWipe(true);
        } else if (strategy === 'timer') {
            showToast('Self-Destruct Armed', `This workspace will wipe in ${timerMin} minutes.`, 'warning');
            socket.emit('leave-room', signalingId, { strategy: 'timer', duration: timerMin * 60 * 1000 });
            performWipe(true);
        }
    }, 280);
});

window.forceLeave = function (reason = 'standard', fullPage = true) {
    let actualReason = reason;
    let actualFullPage = fullPage;
    if (typeof reason === 'boolean') {
        actualFullPage = reason;
        actualReason = 'standard';
    }
    if (typeof socket !== 'undefined' && typeof signalingId !== 'undefined') {
        socket.emit('leave-room', signalingId, { strategy: 'standard', reason: actualReason });
    }
    performWipe(actualFullPage);
};

window.leaveRoom = function () {
    if (roomId) {
        if (ui.panels.leaveModal) ui.panels.leaveModal.style.display = 'flex';
    } else {
        performWipe(true);
    }
};

document.addEventListener('change', (e) => {
    if (e.target.name === 'exit-strategy') {
        window.safetyTimerActive = (e.target.value === 'timer');
    }
});

const leaveTimerMinInput = document.getElementById('leave-timer-min');
if (leaveTimerMinInput) {
    leaveTimerMinInput.addEventListener('focus', () => {
        const timerRadio = document.querySelector('input[name="exit-strategy"][value="timer"]');
        if (timerRadio) {
            timerRadio.checked = true;
            window.safetyTimerActive = true;
        }
    });
    leaveTimerMinInput.addEventListener('input', () => {
        let val = parseInt(leaveTimerMinInput.value);
        if (!isNaN(val)) {
            if (val > 60) leaveTimerMinInput.value = 60;
            else if (val < 1) leaveTimerMinInput.value = 1;
        }
    });
}

async function joinRoom(idParam, secretParam, isCreator = false, skipWipe = false) {
    window.safetyTimerActive = false;
    window.isShadowTab = false;
    window.primarySocketId = null;
    const hasPersistedTransferState = Object.keys(loadP2PResumeState()).length > 0 || Object.keys(loadP2PSendResumeState()).length > 0;
    if (!skipWipe) {
        const hasPersistedTransferActivity = (() => {
            try {
                const savedTransfers = JSON.parse(localStorage.getItem('emit-p2p-transfers') || '{}');
                return savedTransfers && typeof savedTransfers === 'object' && Object.keys(savedTransfers).length > 0;
            } catch (e) {
                return false;
            }
        })();
        await performWipe(!(hasPersistedTransferState || hasPersistedTransferActivity));
    }

    let id = typeof idParam === 'string' ? idParam : null;
    if (!id && ui.inputs.roomId) id = ui.inputs.roomId.value.trim();
    if (!id || id === "") {
        const urlParams = new URLSearchParams(window.location.search);
        id = urlParams.get('workspace');
    }
    if (!id || id === "") {
        showToast('Required', 'Please enter a Workspace Code to join.', 'info');
        return;
    }

    let secret = secretParam;
    if ((secret === undefined || secret === null || secret === '') && ui.inputs.joinSecret && ui.inputs.joinSecret.value.trim()) {
        secret = ui.inputs.joinSecret.value.trim();
    }
    if (secret === undefined || secret === null) {
        const urlParams = new URLSearchParams(window.location.search);
        secret = urlParams.get('guard') || '';
    }

    let normalizedId = id.toUpperCase().replace(/[^A-Z0-9-]/g, '');
    if (normalizedId.length === 8 && !normalizedId.includes('-')) {
        normalizedId = normalizedId.slice(0, 4) + '-' + normalizedId.slice(4, 8);
    }

    if (normalizedId.length < 9) {
        showToast('Invalid Code', 'Code is too short (e.g. A8B2-X9M4).', 'error');
        return;
    }

    const rawId = normalizedId;
    const finalId = normalizedId + (secret ? ":" + secret : "");
    id = normalizedId;

    const urlParams = new URLSearchParams(window.location.search);
    const urlOpen = urlParams.get('open');
    const urlClose = urlParams.get('close');

    const activeRoomScheduleMap = JSON.parse(localStorage.getItem('ys_rooms_schedule') || '{}');
    const hadConfigPreload = !!activeRoomScheduleMap[rawId];

    if (urlOpen && urlClose) {
        const tzParam = urlParams.get('tz');
        let storedOpen = urlOpen;
        let storedClose = urlClose;
        if (tzParam !== null) {
            const creatorOffset = parseInt(tzParam, 10);
            const localOffset = new Date().getTimezoneOffset();
            const diffMinutes = creatorOffset - localOffset;
            const convertTime = (timeStr) => {
                const [h, m] = timeStr.split(':').map(Number);
                let total = h * 60 + m + diffMinutes;
                total = ((total % 1440) + 1440) % 1440;
                const rh = String(Math.floor(total / 60)).padStart(2, '0');
                const rm = String(total % 60).padStart(2, '0');
                return `${rh}:${rm}`;
            };
            storedOpen = convertTime(urlOpen);
            storedClose = convertTime(urlClose);
        }
        activeRoomScheduleMap[rawId] = { open: storedOpen, close: storedClose };
        localStorage.setItem('ys_rooms_schedule', JSON.stringify(activeRoomScheduleMap));
    }

    if (activeRoomScheduleMap[rawId]) {
        const { open, close } = activeRoomScheduleMap[rawId];
        if (typeof isCurrentTimeInSchedule === 'function' && !isCurrentTimeInSchedule(open, close)) {
            showToast('Workspace Closed', `This recurring workspace opens daily from ${open} to ${close}.`, 'error');
            return;
        }
        if (hadConfigPreload && !(urlOpen && urlClose)) {
            isCreator = true;
        }
    }
    const isScheduleEnabled = document.getElementById('enable-schedule-checkbox')?.checked;
    if (isCreator && isScheduleEnabled && !rawId.startsWith('AIR-')) {
        const openTime = document.getElementById('recurring-open-time') ? document.getElementById('recurring-open-time').value : '';
        const closeTime = document.getElementById('recurring-close-time') ? document.getElementById('recurring-close-time').value : '';
        if (openTime && closeTime && openTime !== closeTime) {
            activeRoomScheduleMap[rawId] = { open: openTime, close: closeTime };
            localStorage.setItem('ys_rooms_schedule', JSON.stringify(activeRoomScheduleMap));
        }
    }

    const isSecure = window.isSecureContext && window.crypto && window.crypto.subtle;
    if (isSecure) {
        try {
            await generateECDHKeyPair();
        } catch (err) {
            console.error('ECDH Generation Failed:', err);
            showToast('Encryption Error', 'Failed to generate secure keys.', 'error');
            return;
        }
    }

    roomId = rawId;
    signalingId = finalId;
    pendingJoinState = {
        roomId: rawId,
        signalingId: finalId,
        secret,
        isCreator,
        inviteUrl: `${window.location.origin}${window.location.pathname}?workspace=${rawId}`
    };
    syncDebugState();
    try {
        localStorage.setItem('ys_workspace', rawId);
        if (secret) localStorage.setItem('ys_guard', secret);
        else localStorage.removeItem('ys_guard');
        localStorage.setItem('ys_is_creator', isCreator ? 'true' : 'false');
    } catch (e) { }
    if (ui.text.currentRoom) ui.text.currentRoom.textContent = roomId;
    if (ui.text.displayRoomCode) ui.text.displayRoomCode.textContent = roomId;
    if (document.getElementById('current-room-display')) document.getElementById('current-room-display').textContent = roomId;
    if (document.getElementById('display-room-code')) document.getElementById('display-room-code').textContent = roomId;

    const myPublicJwk = isSecure ? await crypto.subtle.exportKey('jwk', myECDHKeyPair.publicKey) : { insecure: true };

    window._pendingPassphrase = secret || '';
    window._pendingIsCreator = isCreator;

    const inviteUrl = `${window.location.origin}${window.location.pathname}?workspace=${roomId}`;
    if (ui.inputs.shareUrl) ui.inputs.shareUrl.value = inviteUrl;
    if (document.getElementById('share-url')) document.getElementById('share-url').value = inviteUrl;

    if (typeof QRCode !== 'undefined' && ui.qrContainer) {
        ui.qrContainer.innerHTML = '';
        new QRCode(ui.qrContainer, { text: inviteUrl, width: 140, height: 140 });
    }

    if (window.history && window.history.pushState) {
        window.history.pushState({ workspace: roomId, guard: secret }, '', inviteUrl);
    }

    let myName = localStorage.getItem('ys_persistent_name') || sessionStorage.getItem('ys_user_name');
    if (!myName) {
        myName = `User-${Math.floor(Math.random() * 9000 + 1000)}`;
        sessionStorage.setItem('ys_user_name', myName);
    }

    peerId = socket.id;
    const inactivityValue = document.getElementById('inactivity-timer-select') ? document.getElementById('inactivity-timer-select').value : '0';
    const allowedInactivityValues = new Set([0, 5, 10, 15, 30, 60]);
    const requestedInactivity = parseInt(inactivityValue, 10) || 0;
    const inactivityMins = (rawId.startsWith('AIR-') || !allowedInactivityValues.has(requestedInactivity)) ? 0 : requestedInactivity;
    if (!myPersistentId) {
        try {
            myPersistentId = localStorage.getItem('emit-persistent-id') || sessionStorage.getItem('emit-persistent-id');
        } catch (e) { }
    }
    if (!myTabSessionId) {
        try {
            myTabSessionId = sessionStorage.getItem('emit-tab-session-id');
        } catch (e) { }
    }
    if (!myPersistentId) {
        if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
            myPersistentId = crypto.randomUUID();
        } else {
            myPersistentId = 'f' + Math.random().toString(36).substring(2, 15) + '-' + Date.now().toString(36);
        }
        try {
            localStorage.setItem('emit-persistent-id', myPersistentId);
        } catch (e) { }
        try {
            sessionStorage.setItem('emit-persistent-id', myPersistentId);
        } catch (e) { }
    }
    if (!myTabSessionId) {
        if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
            myTabSessionId = crypto.randomUUID();
        } else {
            myTabSessionId = 't' + Math.random().toString(36).substring(2, 15) + '-' + Date.now().toString(36);
        }
        try {
            sessionStorage.setItem('emit-tab-session-id', myTabSessionId);
        } catch (e) { }
    }
    const persistentId = myPersistentId;
    const joinSignature = JSON.stringify({ signalingId, isCreator: !!isCreator, persistentId, tabSessionId: myTabSessionId, socketId: socket.id });
    lastJoinEmit = joinSignature;
    window.isPublicRoomSession = !!document.getElementById('public-room-checkbox')?.checked;
    const pendingPublic = window._pendingPublicRoom || {};
    const activeSchedule = activeRoomScheduleMap[rawId] || null;
    socket.emit('join-room', signalingId, isCreator, {
        name: myName,
        inactivity: inactivityMins,
        persistentId,
        tabSessionId: myTabSessionId,
        isPublic: window.isPublicRoomSession,
        roomName: pendingPublic.roomName || '',
        roomDesc: pendingPublic.roomDesc || '',
        isSpectator: !!window.isSpectator,
        scheduleOpen: activeSchedule ? activeSchedule.open : null,
        scheduleClose: activeSchedule ? activeSchedule.close : null
    });
    window._pendingPublicRoom = null;

    if (isCreator && typeof ActivityTracker !== 'undefined') {
        ActivityTracker.addP2PRoom(roomId, { name: roomId });
    }

    showScreen('transfer');
    updateConnectionStatus(isCreator ? 'waiting' : 'connecting');
    if (isCreator && !hasPersistedTransferActivityForCurrentRoom()) {
        updateConnectionStatus('connected');
    }

    if (hasPersistedTransferState) {
        setTimeout(async () => {
            await restorePersistedP2PTransfers();
        }, 300);
        setTimeout(async () => {
            if (!document.getElementById('transfers-container')?.children.length) {
                await restorePersistedP2PTransfers();
            }
        }, 1800);
    }

    const timerEl = document.getElementById('p2p-expiry-timer');
    const textEl = document.getElementById('p2p-expiry-text');
    if (timerEl && textEl) {
        timerEl.style.display = 'inline-flex';
        textEl.textContent = 'No time specified';
    }

    if (window.tabStates) {
        const tabId = 'room-' + rawId;
        if (!window.tabStates[tabId]) {
            window.tabStates[tabId] = {
                id: tabId, name: rawId, roomId: rawId, signalingId: finalId,
                peers: {}, activeSends: {}, activeReceives: {}, receiveBuffer: {},
                receivedChunks: {}, p2pTransferQueue: [], activeP2PCount: 0,
                chatHtml: '', peerListHtml: '', transfersHtml: '', socket: socket
            };
        }
        if (typeof window.switchTab === 'function') {
            window.switchTab(tabId);
        } else {
            window.activeTabId = tabId;
            if (typeof window.renderTabsUI === 'function') window.renderTabsUI();
            showScreen('transfer');
        }
    } else {
        showScreen('transfer');
    }

    updatePeerListUI();
    syncDebugState();
    if (typeof ActivityTracker !== 'undefined' && typeof ActivityTracker.forceRefresh === 'function') {
        ActivityTracker.forceRefresh();
    }
}

socket.on('room-locked', () => {
    showToast('Workspace Full', 'This secure workspace has reached its participant limit (5).', 'error');
    roomId = null;
    localStorage.removeItem('ys_workspace');
    localStorage.removeItem('ys_guard');
    localStorage.removeItem('ys_is_creator');
    showScreen('room');
    updateConnectionStatus('disconnected', 'Offline');
});

socket.on('room-not-found', () => {
    showToast('Vault Not Found', 'Invalid code or the creator has not joined yet.', 'error');
    const failedRoomId = roomId;
    const hasPersistedTransferState = Object.keys(loadP2PResumeState()).length > 0 || Object.keys(loadP2PSendResumeState()).length > 0;
    pendingJoinState = null;
    roomId = null;
    signalingId = null;
    syncDebugState();
    window._pendingIsCreator = false;
    window._pendingPassphrase = '';
    if (failedRoomId && typeof ActivityTracker !== 'undefined') {
        ActivityTracker.removeP2PRoom(failedRoomId);
    }
    if (!hasPersistedTransferState) {
        localStorage.removeItem('ys_workspace');
        localStorage.removeItem('ys_guard');
        localStorage.removeItem('ys_is_creator');
    }
    showScreen('room');
    updateConnectionStatus('disconnected', 'Offline');
});

socket.on('room-expired', () => {
    if (roomId) {
        showToast('Workspace Expired', 'This workspace was destroyed automatically.', 'warning');
        performWipe(true);
    }
});

socket.on('secret-mismatch', () => {
    const targetWorkspace = roomId || window._pendingWorkspaceId || (ui.inputs.roomId ? ui.inputs.roomId.value.trim() : '');
    window._pendingWorkspaceId = targetWorkspace;
    const wasAlreadyPrompted = window._secretPromptAttempted || false;
    window._secretPromptAttempted = true;
    if (targetWorkspace && typeof ActivityTracker !== 'undefined') {
        ActivityTracker.removeP2PRoom(targetWorkspace);
    }
    pendingJoinState = null;
    roomId = null;
    signalingId = null;
    syncDebugState();
    if (typeof showScreen === 'function') showScreen('room');
    updateConnectionStatus('disconnected');
    
    if (wasAlreadyPrompted) {
        showToast('Incorrect Passcode', 'The secret word for this workspace is incorrect. Please try again.', 'error');
    } else {
        showToast('Passcode Required', 'This workspace is protected by a secret passcode. Please enter it to join.', 'error');
    }
    
    if (typeof ui !== 'undefined' && ui.panels.secretPromptModal) {
        ui.panels.secretPromptModal.style.display = 'flex';
        if (ui.inputs.promptSecret) {
            ui.inputs.promptSecret.value = '';
            ui.inputs.promptSecret.focus();
        }
    }
});

socket.on('chat-history', (history) => {
    history.forEach(msg => {
        if (msg.text == null || msg.text === '') return;
        appendToChatLog(msg.senderName || 'Peer', msg.text, false);
    });
});

socket.on('destruction-requested', (requesterName, reqPersistentId) => {
    const myId = myPersistentId || localStorage.getItem('emit-persistent-id');
    if ((reqPersistentId && myId && reqPersistentId === myId) || window.isDestructionRequester) {
        window.isDestructionRequester = true;
        return; // Don't show the modal to the requester
    }
    const modal = document.getElementById('destruction-request-modal');
    const nameSpan = document.getElementById('destruction-requester-name');
    const countdownText = document.getElementById('destruction-request-countdown');
    if (!modal) return;

    if (nameSpan) nameSpan.textContent = requesterName;
    modal.style.display = 'flex';
    renderDestructionVoteLists([], []);

    let timeLeft = 15;
    if (window.destructionRequestInterval) clearInterval(window.destructionRequestInterval);
    window.destructionRequestInterval = setInterval(() => {
        timeLeft--;
        if (countdownText) countdownText.textContent = timeLeft;
        if (timeLeft <= 0) {
            clearInterval(window.destructionRequestInterval);
            window.destructionRequestInterval = null;
            modal.style.display = 'none';
        }
    }, 1000);

    const rejectBtn = document.getElementById('destruction-reject-btn');
    const acceptBtn = document.getElementById('destruction-accept-btn');

    if (rejectBtn) rejectBtn.onclick = () => {
        socket.emit('peer-destroy-reject');
        modal.style.display = 'none';
        if (window.destructionRequestInterval) clearInterval(window.destructionRequestInterval);
    };
    if (acceptBtn) acceptBtn.onclick = () => {
        modal.style.display = 'none';
        if (window.destructionRequestInterval) clearInterval(window.destructionRequestInterval);
        window.destructionRequestInterval = null;
        socket.emit('peer-destroy-accept');
    };
});

socket.on('duplicate-tab-joined', ({ primarySocketId } = {}) => {
    window.isShadowTab = true;
    window.primarySocketId = primarySocketId || null;
    showToast('Extra Tab Joined', 'This tab is passive. Your other tab stays in charge of P2P.', 'info');
});

function renderDestructionVoteLists(acceptedNames = [], pendingNames = []) {
    const acceptedList = document.getElementById('destruction-accepted-list');
    const pendingList = document.getElementById('destruction-pending-list');
    if (acceptedList) {
        acceptedList.innerHTML = acceptedNames.length
            ? acceptedNames.map(name => `<div>• ${name}</div>`).join('')
            : '<div style="color:var(--text-muted);">Nobody yet</div>';
    }
    if (pendingList) {
        pendingList.innerHTML = pendingNames.length
            ? pendingNames.map(name => `<div>• ${name}</div>`).join('')
            : '<div style="color:var(--text-muted);">Nobody waiting</div>';
    }
}

socket.on('destruction-vote-update', ({ accepted = 0, required = 0, requesterName = 'A participant', acceptedNames = [], pendingNames = [] } = {}) => {
    if (window.isDestructionRequester) {
        return; // Don't show the modal to the requester
    }
    const modal = document.getElementById('destruction-request-modal');
    const countdownText = document.getElementById('destruction-request-countdown');
    const nameSpan = document.getElementById('destruction-requester-name');
    if (nameSpan) nameSpan.textContent = requesterName;
    if (countdownText) countdownText.textContent = `${accepted}/${required}`;
    renderDestructionVoteLists(acceptedNames, pendingNames);
    if (modal && modal.style.display !== 'flex') {
        modal.style.display = 'flex';
    }
});

socket.on('peer-destroy-reject', (peerName) => {
    window.isDestructionRequester = false;
    const modal = document.getElementById('destruction-request-modal');
    if (modal) modal.style.display = 'none';
    const name = peerName || 'A participant';
    showToast('Destruction Rejected', `${name} rejected the workspace destruction.`, 'warning');
});

socket.on('room-metadata', (data) => {
    const serverNow = data.serverTime || Date.now();
    latestRoomMetadata = {
        ...data,
        inactivityMode: data.inactivityWarningAt && serverNow < data.inactivityWarningAt
            ? 'idle'
            : (data.inactivityExpiresAt && serverNow < data.inactivityExpiresAt ? 'grace' : null)
    };
    if (data.serverTime) {
        serverTimeOffset = Date.now() - data.serverTime;
    }
    const timerEl = document.getElementById('p2p-expiry-timer');
    const textEl = document.getElementById('p2p-expiry-text');
    if (!timerEl || !textEl) return;

    if (window._expiryInterval) clearInterval(window._expiryInterval);

    const formatRemaining = (ms) => {
        if (window.uiShared && typeof window.uiShared.formatExpiryCountdown === 'function') {
            return window.uiShared.formatExpiryCountdown(ms);
        }
        const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
        const hours = Math.floor(totalSeconds / 3600);
        const mins = Math.floor((totalSeconds % 3600) / 60);
        const secs = totalSeconds % 60;
        if (hours > 0) return `${hours}h ${mins}m`;
        if (mins > 0) return `${mins}m ${secs.toString().padStart(2, '0')}s`;
        return `${secs}s`;
    };

    const updateTimer = () => {
        const metadata = latestRoomMetadata || data;
        const now = Date.now() - serverTimeOffset;
        if (metadata.inactivityWarningAt && now < metadata.inactivityWarningAt) {
            hideInactivityWarning();
        } else if (
            metadata.inactivityWarningAt &&
            metadata.inactivityExpiresAt &&
            now >= metadata.inactivityWarningAt &&
            now < metadata.inactivityExpiresAt &&
            !inactivityGraceInterval
        ) {
            showInactivityWarning(metadata.inactivityExpiresAt - now);
            return;
        } else if (inactivityGraceInterval) {
            return;
        }

        let targetTime = null;
        let prefix = '';

        if (metadata.inactivityWarningAt && now < metadata.inactivityWarningAt) {
            targetTime = metadata.inactivityWarningAt;
            prefix = 'Idle popup in ';
        } else if (metadata.inactivityMode === 'idle' && metadata.inactivityWarningAt) {
            targetTime = metadata.inactivityWarningAt;
            prefix = 'Idle popup in ';
        } else if (metadata.inactivityExpiresAt) {
            targetTime = metadata.inactivityExpiresAt;
            prefix = 'Inactive: ';
        } else if (metadata.expiresAt) {
            targetTime = metadata.expiresAt;
            prefix = 'Expires in ';
        }

        if (!targetTime) {
            timerEl.style.display = 'none';
            textEl.textContent = 'no time specified';
            clearInterval(window._expiryInterval);
            return;
        }

        timerEl.style.display = 'inline-flex';

        const left = targetTime - now;
        if (left <= 0) {
            textEl.textContent = prefix === 'Idle popup in ' ? 'Idle popup...' : 'Expiring...';
            clearInterval(window._expiryInterval);
            return;
        }

        textEl.textContent = `${prefix}${formatRemaining(left)}`.trim();
    };

    updateTimer();
    window._expiryInterval = setInterval(updateTimer, 1000);
});

socket.on('room-settings', ({ forceSpectatorOnly } = {}) => {
    const ctrl = document.getElementById('owner-force-spectator-control');
    const chk = document.getElementById('toggle-force-spectator');
    if (ctrl) ctrl.style.display = 'flex';
    if (chk) chk.checked = !!forceSpectatorOnly;
    if (window._pendingForceSpectator && !forceSpectatorOnly) {
        socket.emit('set-force-spectator', true);
        if (chk) chk.checked = true;
        window._pendingForceSpectator = false;
    }
});

socket.on('room-settings-update', ({ forceSpectatorOnly } = {}) => {
    const chk = document.getElementById('toggle-force-spectator');
    if (chk) chk.checked = !!forceSpectatorOnly;
    if (forceSpectatorOnly && !window._pendingIsCreator && !window.isSpectator) {
        window.isSpectator = true;
        const spectatorChk = document.getElementById('spectator-mode-checkbox');
        if (spectatorChk) spectatorChk.checked = true;
        const dropZone = document.getElementById('drop-zone');
        if (dropZone) dropZone.style.display = 'none';
        showToast('Spectator Mode Enabled', 'The room owner has set all peers to spectator mode.', 'info');
    }
});

socket.on('force-spectator-mode', () => {
    window.isSpectator = true;
    const spectatorChk = document.getElementById('spectator-mode-checkbox');
    if (spectatorChk) spectatorChk.checked = true;
    const dropZone = document.getElementById('drop-zone');
    if (dropZone) dropZone.style.display = 'none';
    showToast('Spectator Mode', 'This room requires spectator-only mode. You can receive files but not send.', 'info');
});

document.addEventListener('DOMContentLoaded', () => {
    const toggleChk = document.getElementById('toggle-force-spectator');
    if (toggleChk) {
        toggleChk.addEventListener('change', () => {
            if (typeof socket !== 'undefined' && socket.emit) {
                socket.emit('set-force-spectator', toggleChk.checked);
            }
        });
    }
});

socket.on('peer-destroyed-room', () => {
    if (isWiping) return;
    if (typeof playProceduralSound === 'function') playProceduralSound('pop');

    const modal = document.getElementById('destruction-request-modal');
    if (modal) modal.style.display = 'none';
    if (window.destructionRequestInterval) {
        clearInterval(window.destructionRequestInterval);
        window.destructionRequestInterval = null;
    }

    showToast('Room Destroyed', 'The workspace has been permanently deleted.', 'warning');
    animateVanishAndClear(true).then(() => {
        if (typeof window.closeTab === 'function' && window.activeTabId && window.activeTabId !== 'home') {
            window.closeTab(window.activeTabId);
        } else {
            performWipe(true);
        }
    });
});

socket.on('chat-message', (msg) => {
    if (msg.senderId === socket.id) return;
    const peerName = msg.senderName || 'Peer';
    setPeerTyping(peerName, false);
    if (msg.text != null && msg.text !== '') {
        if (typeof window.appendToChatLog === 'function') window.appendToChatLog(peerName, msg.text, false, !!msg.ephemeral, msg.msgId || null);
        reportUserActivity(true);
        if (typeof playProceduralSound === 'function') playProceduralSound('pop');
    }
});

socket.on('message-read', (msgId) => {
    const el = document.getElementById(msgId);
    if (el) el.remove();
});

socket.on('ecdh-public-key', async (theirPublicJwk, senderId) => {
    if (!myECDHKeyPair || !peers[senderId]) return;
    auditLog(`ECDH public key from ${peers[senderId].name} received — computing shared secret`);

    const passphrase = window._pendingPassphrase || '';
    const sharedKey = await deriveSharedKey(theirPublicJwk, passphrase);
    peers[senderId].ecdhKey = sharedKey;



    peers[senderId].encryptReady = true;

    const statusEl = document.getElementById(`peer-status-${senderId}`);
    if (statusEl) {
        statusEl.textContent = 'Encrypted';
        statusEl.classList.add('active-text');
    }

    showToast('Secured', `Private link with ${peers[senderId].name} ready.`, 'success');
});



socket.on('peer-list', async (peerList) => {
    if (pendingJoinState && pendingJoinState.roomId === roomId && !pendingJoinState.isCreator) {
        ui.text.currentRoom.textContent = pendingJoinState.roomId;
        if (ui.text.displayRoomCode) ui.text.displayRoomCode.textContent = pendingJoinState.roomId;
        if (window.history && window.history.pushState) {
            window.history.pushState({ workspace: pendingJoinState.roomId, guard: pendingJoinState.secret }, '', pendingJoinState.inviteUrl);
        }
        localStorage.setItem('ys_workspace', pendingJoinState.roomId);
        if (pendingJoinState.secret) localStorage.setItem('ys_guard', pendingJoinState.secret);
        else localStorage.removeItem('ys_guard');
        localStorage.setItem('ys_is_creator', 'false');
        window._pendingIsCreator = false;
        if (typeof ActivityTracker !== 'undefined') {
            ActivityTracker.addP2PRoom(pendingJoinState.roomId, { name: pendingJoinState.roomId });
        }
        if (window.tabStates) {
            const tabId = 'room-' + pendingJoinState.roomId;
            if (!window.tabStates[tabId]) {
                window.tabStates[tabId] = {
                    id: tabId, name: pendingJoinState.roomId, roomId: pendingJoinState.roomId,
                    signalingId: pendingJoinState.signalingId,
                    peers: {}, activeSends: {}, activeReceives: {}, receiveBuffer: {},
                    receivedChunks: {}, p2pTransferQueue: [], activeP2PCount: 0,
                    chatHtml: '', peerListHtml: '', transfersHtml: '', socket: socket
                };
            }
            if (typeof window.switchTab === 'function') {
                window.switchTab(tabId);
            } else {
                window.activeTabId = tabId;
                if (typeof window.renderTabsUI === 'function') window.renderTabsUI();
                showScreen('transfer');
            }
        } else {
            showScreen('transfer');
        }
        if (window.isSpectator) {
            const dropZone = document.getElementById('drop-zone');
            if (dropZone) {
                dropZone.style.display = 'none';
            }
            showToast('Spectator Mode', 'You are in read-only mode. You can receive files but not send.', 'info');
        } else {
            const dropZone = document.getElementById('drop-zone');
            if (dropZone) {
                dropZone.style.display = '';
            }
        }
        pendingJoinState = null;
    }
    if (window.isShadowTab) {
        peers = {};
        window.peers = peers;
        updatePeerListUI();
        return;
    }
    const otherPeers = peerList.filter(p => p.id !== socket.id);

    const peersToPreserveState = {}; // oldId -> { pc, dc, name, ecdhKey, ... }

    otherPeers.forEach(p => {
        if (p.persistentId) {
            const oldPeerId = Object.keys(peers).find(id =>
                peers[id].persistentId === p.persistentId && id !== p.id
            );

            if (oldPeerId && peers[oldPeerId]) {
                const oldPeer = peers[oldPeerId];
                const activeChannel = oldPeer.dc || oldPeer.channel;
                const isDcOpen = activeChannel && activeChannel.readyState === 'open';
                if (isDcOpen) {
                    if (oldPeer.pc) {
                        oldPeer.pc.ondatachannel = null;
                        oldPeer.pc.onicecandidate = null;
                        oldPeer.pc.oniceconnectionstatechange = null;
                        oldPeer.pc.onconnectionstatechange = null;
                    }
                    peersToPreserveState[p.id] = {
                        pc: oldPeer.pc,
                        dc: oldPeer.dc,
                        channel: activeChannel,
                        ecdhKey: oldPeer.ecdhKey,
                        currentSpeedStats: oldPeer.currentSpeedStats,
                        persistentId: p.persistentId,
                        name: p.name,
                        oldPeerId: oldPeerId
                    };
                } else {
                    if (oldPeer.pc) {
                        try { oldPeer.pc.close(); } catch (e) { }
                    }
                }

                for (const [fId, meta] of Object.entries(activeReceives)) {
                    if (meta.senderId === oldPeerId) {
                        meta.senderId = p.id;
                        auditLog(`Transfer "${meta.name}" mapped from old peer ${oldPeerId.substring(0, 6)} → new ${p.id.substring(0, 6)}`);
                    }
                }
                for (const [fId, sendState] of Object.entries(activeSends)) {
                    if (sendState.targetId === oldPeerId) {
                        sendState.targetId = p.id;
                        auditLog(`Send transfer "${fId.substring(0, 6)}" mapped to new peer ${p.id.substring(0, 6)}`);
                    }
                }

                delete peers[oldPeerId];
            }
        }
    });

    const newPeers = {};
    otherPeers.forEach(p => {
        if (peersToPreserveState[p.id]) {
            newPeers[p.id] = {
                id: p.id,
                name: p.name,
                persistentId: p.persistentId,
                pc: peersToPreserveState[p.id].pc,
                dc: peersToPreserveState[p.id].dc,
                channel: peersToPreserveState[p.id].channel || peersToPreserveState[p.id].dc || null,
                ecdhKey: peersToPreserveState[p.id].ecdhKey,
                currentSpeedStats: peersToPreserveState[p.id].currentSpeedStats,
                isOfferer: shouldBeOfferer(p.id),
                reconnecting: false  // Mark as fully reconnected
            };
            auditLog(`Peer ${p.id.substring(0, 6)} seamlessly reconnected - connection preserved`);
        } else if (peers[p.id]) {
            newPeers[p.id] = peers[p.id];
            newPeers[p.id].name = p.name;
            newPeers[p.id].persistentId = p.persistentId;
            newPeers[p.id].isOfferer = shouldBeOfferer(p.id);
            newPeers[p.id].reconnecting = p.reconnecting || false;
        } else {
            newPeers[p.id] = {
                id: p.id,
                name: p.name,
                persistentId: p.persistentId,
                pc: null,
                dc: null,
                channel: null,
                isOfferer: shouldBeOfferer(p.id),
                reconnecting: p.reconnecting || false,
                isSpectator: p.isSpectator || false
            };
        }
    });


    Object.keys(peers).forEach(id => {
        if (!newPeers[id]) {
            if (peers[id].pc) {
                try { peers[id].pc.close(); } catch (e) { }
            }
        }
    });

    peers = newPeers;
    window.peers = peers;
    syncDebugState();
    updatePeerListUI();

    if (typeof ActivityTracker !== 'undefined') {
        const curId = (typeof roomId !== 'undefined' && roomId) ? roomId : (signalingId || 'current-room');
        const peerNames = Object.values(peers).filter(p => !p.reconnecting).map(p => p.name);
        ActivityTracker.updateP2PRoom(curId, peerNames);
    }

    for (const [newPeerId, preservedState] of Object.entries(peersToPreserveState)) {
        const preservedChannel = preservedState.dc || preservedState.channel;
        if (preservedChannel && preservedChannel.readyState === 'open') {
            setupDataChannel(preservedChannel, newPeerId);
            if (myECDHKeyPair) {
                crypto.subtle.exportKey('jwk', myECDHKeyPair.publicKey).then(jwk => {
                    socket.emit('ecdh-public-key', jwk, signalingId, newPeerId);
                }).catch(() => { });
            }
            for (const [fId, sendState] of Object.entries(activeSends)) {
                if (sendState.targetId === newPeerId && sendState.paused && !sendState.aborted) {
                    resumeSendFile(fId, newPeerId);
                    auditLog(`Resumed paused send "${fId.substring(0, 6)}" to peer ${newPeerId.substring(0, 6)} after reconnect`);
                }
            }
        }
    }

    if (!window.isSpectator) {
        for (const p of otherPeers) {
            const peer = peers[p.id];
            if (!peer || peer.isSpectator) continue;
            const activeChannel = peer.dc || peer.channel;
            const connectionState = peer.pc ? peer.pc.connectionState : null;
            const signalingState = peer.pc ? peer.pc.signalingState : null;
            const hasWorkingConnection = !!(
                peer.pc && (
                    (activeChannel && activeChannel.readyState === 'open') ||
                    connectionState === 'connected' ||
                    connectionState === 'connecting' ||
                    signalingState === 'have-remote-offer' ||
                    signalingState === 'have-local-offer'
                )
            );
            if (!p.reconnecting && !hasWorkingConnection) {
                if (peer.pc) {
                    try { peer.pc.close(); } catch (e) { }
                    peer.pc = null;
                    peer.dc = null;
                    peer.channel = null;
                }
                peer.isOfferer = shouldBeOfferer(p.id);
                if (peer.isOfferer) {
                    await initiateMeshOffer(p.id);
                }
            }
        }
    }
});

socket.on('user-joined', async (peerData) => {
    if (peerData.id === socket.id) return;
    if (!peerData.isReconnect) {
        showToast('Peer Joined', `${peerData.name} entered the workspace.`, 'success');
        if (typeof playProceduralSound === 'function') playProceduralSound('chime');
    }
});

socket.on('user-left', (leftPeerId, reason) => {
    window.safetyTimerActive = true;
    if (leftPeerId === socket.id) return;

    const isKnown = !!peers[leftPeerId];
    let peerName = 'A participant';

    if (peers[leftPeerId]) {
        peerName = peers[leftPeerId].name;
        if (reason === 'reconnect') {
            peers[leftPeerId].reconnecting = true;
            const statusEl = document.getElementById(`peer-status-${leftPeerId}`);
            if (statusEl) {
                statusEl.textContent = 'Reconnecting...';
                statusEl.style.color = 'var(--text-warning)';
            }
            auditLog(`Peer ${peerName} (${leftPeerId.substring(0, 6)}) disconnected - awaiting reconnect...`);
            return;
        } else {
            if (peers[leftPeerId].pc) {
                try { peers[leftPeerId].pc.close(); } catch (e) { }
            }
            delete peers[leftPeerId];
            window.peers = peers;
        }
    }

    const statusMsg = reason === 'kicked' ? 'got kicked for cursing.' : 'left the workspace.';

    if (isKnown && reason !== 'reconnect') {
        showToast('Participant Left', `${peerName} ${statusMsg}`, 'info');
        appendToChatLog('System', `${peerName} ${statusMsg}`, false);
    }

    updatePeerListUI();

    const shouldPreserveTransferRows = reason === 'reconnect' || Object.keys(loadP2PResumeState()).length > 0 || Object.keys(loadP2PSendResumeState()).length > 0;
    if (!shouldPreserveTransferRows) {
        const item = document.getElementById(`peer-item-${leftPeerId}`);
        if (item) item.remove();

        for (const [fId, meta] of Object.entries(activeReceives)) {
            if (meta.senderId === leftPeerId) {
                delete activeReceives[fId];
                delete receiveBuffer[fId];
                delete receivedChunks[fId];
                const item = document.getElementById(`item-${fId}`);
                if (item) item.remove();
                auditLog(`Incoming transfer from ${peerName} cancelled (peer left).`);
            }
        }
        for (const [fId, sendState] of Object.entries(activeSends)) {
            if (sendState.targetId === leftPeerId) {
                sendState.paused = true;
                persistPausedSend(fId, peerName, Math.min((((sendState.chunkIndex || 0) * CHUNK_SIZE) / (sendState.file?.size || 1)) * 100, 100));
                markSendPaused(fId, peerName);
                auditLog(`Outgoing transfer to ${peerName} paused (peer left).`);
            }
        }
    }

    if (typeof ActivityTracker !== 'undefined') {
        const curId = (typeof roomId !== 'undefined' && roomId) ? roomId : (signalingId || 'current-room');
        const peerNames = Object.values(peers).filter(p => !p.reconnecting).map(p => p.name);
        ActivityTracker.updateP2PRoom(curId, peerNames);
    }
});

async function initiateMeshOffer(targetId) {
    const existingPeer = peers[targetId];
    if (existingPeer && existingPeer.isOfferer === false) {
        return;
    }
    if (existingPeer && existingPeer.pc) {
        const state = existingPeer.pc.signalingState;
        if (state === 'have-local-offer' || state === 'have-remote-offer') {
            return;
        }
        try { existingPeer.pc.close(); } catch (e) { }
        existingPeer.pc = null;
        existingPeer.dc = null;
        existingPeer.channel = null;
    }
    const pc = setupPeerConnection(targetId);
    peers[targetId].pc = pc;

    const dc = pc.createDataChannel('fileTransfer');
    setupDataChannel(dc, targetId);
    peers[targetId].dc = dc;

    try {
        let offer = await pc.createOffer();
        offer = { type: offer.type, sdp: mangleSDP(offer.sdp) };
        await pc.setLocalDescription(offer);
        socket.emit('offer', offer, signalingId, targetId);
    } catch (e) {
        console.error(`Error creating offer for ${targetId}`, e);
    }
}

socket.on('offer', async (offer, senderId, senderName) => {
    if (window.isSpectator) return;
    if (!peers[senderId]) {
        peers[senderId] = { id: senderId, name: senderName, pc: null, dc: null, channel: null, isOfferer: shouldBeOfferer(senderId) };
        updatePeerListUI();
    }

    peers[senderId].isOfferer = shouldBeOfferer(senderId);
    if (peers[senderId].isOfferer) {
        return;
    }

    const existingPeer = peers[senderId];
    if (existingPeer && existingPeer.pc) {
        const existingState = existingPeer.pc.signalingState;
        if (existingState === 'have-remote-offer' || existingState === 'have-local-pranswer' || existingState === 'have-remote-pranswer') {
            return;
        }
        if (existingState !== 'stable') {
            try { existingPeer.pc.close(); } catch (e) { }
            existingPeer.pc = null;
            existingPeer.dc = null;
            existingPeer.channel = null;
        }
    }

    const pc = setupPeerConnection(senderId);
    peers[senderId].pc = pc;

    try {
        await pc.setRemoteDescription(new RTCSessionDescription(offer));

        const candidates = pendingCandidates[senderId] || [];
        for (const c of candidates) {
            await pc.addIceCandidate(new RTCIceCandidate(c));
        }
        delete pendingCandidates[senderId];

        let answer = await pc.createAnswer();
        answer = { type: answer.type, sdp: mangleSDP(answer.sdp) };
        await pc.setLocalDescription(answer);
        socket.emit('answer', answer, signalingId, senderId);
    } catch (e) {
        console.error(`Error handling offer from ${senderId}`, e);
    }
});

socket.on('answer', async (answer, senderId) => {
    const peer = peers[senderId];
    if (peer && peer.pc) {
        if (peer.isOfferer === false) {
            return;
        }
        if (peer.pc.signalingState !== 'have-local-offer') {
            return;
        }
        try {
            await peer.pc.setRemoteDescription(new RTCSessionDescription(answer));
            const candidates = pendingCandidates[senderId] || [];
            for (const c of candidates) {
                await peer.pc.addIceCandidate(new RTCIceCandidate(c));
            }
            delete pendingCandidates[senderId];
        } catch (e) {
            console.error(`Error handling answer from ${senderId}`, e);
        }
    }
});

socket.on('ice-candidate', async (candidate, senderId) => {
    const peer = peers[senderId];
    if (peer && peer.pc && peer.pc.remoteDescription) {
        try {
            await peer.pc.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (e) {
            console.error(`Error adding ICE candidate from ${senderId}`, e);
        }
    } else {
        if (!pendingCandidates[senderId]) pendingCandidates[senderId] = [];
        pendingCandidates[senderId].push(candidate);
    }
});

async function updatePeerListUI() {
    const container = document.getElementById('peer-list');
    if (!container) return;

    const peerArray = Object.values(peers);
    const myName = localStorage.getItem('ys_persistent_name') || sessionStorage.getItem('ys_user_name') || 'Me';
    const isGeneric = myName.startsWith('User-');

    let html = `
        <div class="peer-item local-user ${isGeneric ? 'identity-nudge' : ''}">
            <div class="peer-avatar" style="background: var(--accent-emerald); color: #fff;">${myName.charAt(0).toUpperCase()}</div>
            <div class="peer-info">
                <div class="peer-name">
                    ${myName} (You)
                    ${isGeneric ? `<button class="btn-pill btn-ghost btn-xs claim-badge" style="margin-left:8px; font-size:0.65rem; padding: 2px 6px; color:var(--accent-emerald); border: 1px solid rgba(16,185,129,0.3); background:rgba(16,185,129,0.1);" onclick="if(ui.buttons.settingsBtn)ui.buttons.settingsBtn.click()">Claim Name</button>` : ''}
                </div>
                <div class="peer-status active-text">Connected</div>
            </div>
        </div>
    `;

    if (peerArray.length === 0) {
    }

    html += peerArray.map(p => {
        const isSpec = p.isSpectator || false;
        let status = 'Connecting...';
        if (isSpec) status = 'Spectating';
        else if (p.reconnecting) status = 'Reconnecting...';
        else if ((p.dc && p.dc.readyState === 'open') || (p.pc && p.pc.connectionState === 'connected')) status = 'Connected';
        return `
            <div class="peer-item ${isSpec ? 'spectator-user' : ''}" id="peer-item-${p.id}">
                <div class="peer-avatar" style="${isSpec ? 'background: rgba(255,255,255,0.06); color: var(--text-muted);' : ''}">${p.name.charAt(0).toUpperCase()}</div>
                <div class="peer-info">
                    <div class="peer-name" style="display:flex; align-items:center; gap:6px;">
                        ${p.name}
                        ${isSpec ? `<span style="font-size:0.65rem; padding: 1px 4px; border-radius:3px; background: rgba(255,255,255,0.08); color: var(--text-muted);">Spectator</span>` : ''}
                    </div>
                    <div class="peer-status" id="peer-status-${p.id}">${status}</div>
                </div>
                <div class="peer-checkbox-wrapper">
                    ${isSpec ? '' : `<input type="checkbox" class="peer-checkbox" data-peer-id="${p.id}" checked>`}
                </div>
            </div>
        `;
    }).join('');

    container.innerHTML = html;

    if (roomId && typeof ActivityTracker !== 'undefined') {
        const fullParticipants = [myName, ...peerArray.map(p => p.name || 'Peer')];
        ActivityTracker.updateP2PRoom(roomId, fullParticipants);
    }

    if (peerArray.length > 0) {
        updateConnectionStatus('connected');
    } else {
        updateConnectionStatus('waiting');
    }
}

function setupPeerConnection(targetId) {
    const pc = new RTCPeerConnection(configuration);

    pc.oniceconnectionstatechange = () => {
        if (pc.iceConnectionState === 'failed') {
            pc.createOffer({ iceRestart: true })
                .then(offer => pc.setLocalDescription(offer))
                .then(() => {
                    socket.emit('offer', pc.localDescription, signalingId, targetId);
                });
        }
    };

    pc.onicecandidate = (e) => {
        if (e.candidate) {
            socket.emit('ice-candidate', e.candidate, signalingId, targetId);
        }
    };

    pc.onconnectionstatechange = () => {
        const state = pc.connectionState;
        const peerName = (peers[targetId] && peers[targetId].name) ? peers[targetId].name : 'Unknown Peer';
        auditLog(`Connection with ${peerName} → ${state}`);
        const statusEl = document.getElementById(`peer-status-${targetId}`);
        if (statusEl) statusEl.textContent = state.charAt(0).toUpperCase() + state.slice(1);

        if (state === 'connected') {
            updateConnectionStatus('connected');
            if (myECDHKeyPair) {
                crypto.subtle.exportKey('jwk', myECDHKeyPair.publicKey).then(jwk => {
                    socket.emit('ecdh-public-key', jwk, signalingId, targetId);
                });
            }
        } else if (state === 'failed' || state === 'closed' || state === 'disconnected') {
            const statusEl = document.getElementById(`peer-status-${targetId}`);
            if (statusEl) statusEl.textContent = 'Disconnected';
        }
    };

    pc.ondatachannel = (e) => {
        setupDataChannel(e.channel, targetId);
    };

    return pc;
}

let currentSpeedStats = null;

function formatSpeed(bytesPerSec) {
    if (bytesPerSec === 0) return '0 B/s';
    const k = 1024;
    const sizes = ['B/s', 'KB/s', 'MB/s', 'GB/s'];
    const i = Math.floor(Math.log(bytesPerSec) / Math.log(k));
    return parseFloat((bytesPerSec / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function formatETA(seconds) {
    if (!isFinite(seconds) || seconds < 0) return '--:--';
    if (seconds < 1) return '< 1s';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) return `${h}h ${m}m ${s}s`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
}

function mangleSDP(sdp) {
    return sdp.replace(/b=AS:.*\r\n/g, "").replace(/a=mid:.*\r\n/g, (match) => match + "b=AS:1048576\r\n");
}

function setupP2PSendLoop(fileId, targetId, activePeer, onDone) {
    const getPeer = () => {
        const s = activeSends[fileId];
        return (s && peers[s.targetId]) ? peers[s.targetId] : activePeer;
    };

    const state = activeSends[fileId];
    if (!state) {
        if (typeof onDone === 'function') onDone();
        return;
    }
    if (typeof onDone === 'function') {
        state.onDone = onDone;
    }

    const cancelBtn = document.getElementById(`cancel-transfer-${fileId}`);
    if (cancelBtn) {
        cancelBtn.onclick = () => {
            state.aborted = true;
            delete activeSends[fileId];
            clearPersistedTransferArtifacts(fileId);
            const item = document.getElementById(`item-${fileId}`);
            if (item) item.remove();
            auditLog(`Outgoing transfer to ${getPeer().name} cancelled.`);
            if (getPeer().dc && getPeer().dc.readyState === 'open') {
                getPeer().dc.send(JSON.stringify({ type: 'cancel-transfer', fileId }));
            }
            if (typeof state.onDone === 'function') state.onDone();
        };
    }

    let sendStats = { lastTime: Date.now(), lastBytes: (state.chunkIndex || 0) * CHUNK_SIZE };
    let pipeline = [];
    const MAX_PIPELINE = 16;

    if (activePeer.dc) {
        activePeer.dc.bufferedAmountLowThreshold = 256 * 1024;
    }

    const pumpPipeline = async () => {
        const s = activeSends[fileId];
        if (!s || s.paused || s.aborted) return;
        const totalChunks = Math.ceil(s.file.size / CHUNK_SIZE);

        while (pipeline.length < MAX_PIPELINE && s.chunkIndex < totalChunks) {
            const idx = s.chunkIndex++;
            const start = idx * CHUNK_SIZE;
            const end = Math.min(start + CHUNK_SIZE, s.file.size);
            const blobChunk = s.file.slice(start, end);
            const rawChunk = await blobChunk.arrayBuffer();
            pipeline.push(Promise.resolve({ idx, p: rawChunk }));
        }
    };

    const sendNextChunk = async () => {
        try {
            const s = activeSends[fileId];
            if (!s || s.paused || s.aborted) return;
            const totalChunks = Math.ceil(s.file.size / CHUNK_SIZE);

            await pumpPipeline();

            while (pipeline.length > 0) {
                const currentState = activeSends[fileId];
                if (!currentState || currentState.aborted || currentState.paused) {
                    return;
                }
                const currentPeer = getPeer();
                if (!currentPeer || !currentPeer.dc || currentPeer.dc.readyState !== 'open') {
                    currentState.paused = true;
                    if (currentPeer && currentPeer.dc && currentPeer.dc.readyState === 'open') {
                        currentPeer.dc.send(JSON.stringify({ type: 'transfer-disturbed', fileId, message: 'Sender connection got interrupted. Waiting for resume.' }));
                    }
                    markSendPaused(fileId, currentPeer?.name || activePeer.name);
                    return;
                }
                if (currentPeer.dc.bufferedAmount > 1024 * 1024) {
                    await new Promise((res) => {
                        let isResolved = false;
                        const handleLow = () => {
                            if (isResolved) return;
                            const activePeer = getPeer();
                            if (!activePeer || !activePeer.dc || activePeer.dc.readyState !== 'open') {
                                isResolved = true;
                                res();
                                return;
                            }
                            const threshold = activePeer.dc.bufferedAmountLowThreshold || (256 * 1024);
                            if (activePeer.dc.bufferedAmount <= threshold) {
                                isResolved = true;
                                activePeer.dc.onbufferedamountlow = null;
                                res();
                            }
                        };
                        currentPeer.dc.onbufferedamountlow = handleLow;
                        const check = () => {
                            if (isResolved) return;
                            const activePeer = getPeer();
                            if (!activePeer || !activePeer.dc || activePeer.dc.readyState !== 'open') {
                                isResolved = true;
                                res();
                                return;
                            }
                            const threshold = activePeer.dc.bufferedAmountLowThreshold || (256 * 1024);
                            if (activePeer.dc.bufferedAmount <= threshold) {
                                isResolved = true;
                                activePeer.dc.onbufferedamountlow = null;
                                res();
                            } else {
                                setTimeout(check, 4);
                            }
                        };
                        setTimeout(check, 4);
                    });
                }

                const nextChunk = await pipeline.shift();
                if (!nextChunk) {
                    await pumpPipeline();
                    if (!pipeline.length) {
                        break;
                    }
                    continue;
                }
                const { idx, p } = nextChunk;
                const activePeer = getPeer();
                if (!activePeer || !activePeer.dc || activePeer.dc.readyState !== 'open') {
                    currentState.paused = true;
                    if (activePeer && activePeer.dc && activePeer.dc.readyState === 'open') {
                        activePeer.dc.send(JSON.stringify({ type: 'transfer-disturbed', fileId, message: 'Sender connection got interrupted. Waiting for resume.' }));
                    }
                    markSendPaused(fileId, activePeer?.name || 'peer');
                    return;
                }

                let dataToSend = p;
                if (activePeer.ecdhKey) {
                    const iv = crypto.getRandomValues(new Uint8Array(12));
                    const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, activePeer.ecdhKey, p);
                    const combined = new Uint8Array(iv.length + cipher.byteLength);
                    combined.set(iv);
                    combined.set(new Uint8Array(cipher), iv.length);
                    dataToSend = combined;
                }

                activePeer.dc.send(JSON.stringify({ type: 'chunk-header', fileId, chunkIndex: idx }));
                activePeer.dc.send(dataToSend);
                await pumpPipeline();

                if (idx % 64 === 0) {
                    await new Promise(r => setTimeout(r, 4));
                }

                const now = Date.now();
                const elapsed = (now - sendStats.lastTime) / 1000;
                if (elapsed >= 0.5 || idx + 1 === totalChunks) {
                    const bytesDone = (idx + 1) * CHUNK_SIZE;
                    const progressPct = Math.min((bytesDone / state.file.size) * 100, 100);
                    const speed = (bytesDone - sendStats.lastBytes) / elapsed;
                    const remaining = state.file.size - bytesDone;
                    updateTransferProgress(fileId, progressPct, `Sending to ${activePeer.name}`, formatSpeed(speed), formatETA(remaining / speed), speed);
                    setResumeButtonState(fileId, false, null);
                    persistPausedSend(fileId, activePeer.name, progressPct);
                    if (typeof ActivityTracker !== 'undefined') {
                        ActivityTracker.updateTransfer(fileId, {
                            progress: progressPct,
                            speed: formatSpeed(speed),
                            rawSpeed: speed,
                            eta: formatETA(remaining / speed)
                        });
                    }
                    sendStats.lastTime = now;
                    sendStats.lastBytes = bytesDone;
                }

                if (idx + 1 === totalChunks) {
                    const finalPeer = getPeer();
                    if (finalPeer && finalPeer.dc && finalPeer.dc.readyState === 'open') {
                        finalPeer.dc.send(JSON.stringify({ type: 'file-done', id: fileId }));
                    }
                    setResumeButtonState(fileId, false, null);
                    clearPersistedPausedSend(fileId);
                    clearCachedP2PSendFile(fileId).catch(() => { });
                    updateTransferProgress(fileId, 100, `Sent to ${activePeer.name}`, '', '');
                    const downloadBtn = document.getElementById(`download-btn-${fileId}`);
                    if (downloadBtn && state.file) {
                        const url = URL.createObjectURL(state.file);
                        downloadBtn.href = url;
                        downloadBtn.download = state.file.name;
                        downloadBtn.style.pointerEvents = 'auto';
                        downloadBtn.style.opacity = '1';
                        downloadBtn.onclick = (e) => {
                            const a = document.createElement('a');
                            a.href = url;
                            a.download = state.file.name;
                            document.body.appendChild(a);
                            a.click();
                            a.remove();
                            e.preventDefault();
                        };
                    }
                    if (typeof ActivityTracker !== 'undefined') {
                        ActivityTracker.updateTransfer(fileId, {
                            progress: 100,
                            speed: '',
                            eta: '',
                            paused: false,
                            pausedLabel: '',
                            direction: 'upload',
                            roomId: roomId || null,
                            name: state.file.name,
                            nickname: state.file.nickname || '',
                            size: state.file.size
                        });
                    }
                    const completionCallback = state.onDone;
                    delete activeSends[fileId];
                    if (typeof completionCallback === 'function') completionCallback();
                    return;
                }
            }
        } catch (err) {
            console.error('Send Error:', err);
            updateTransferProgress(fileId, 0, `FAILED: ${err.message}`, '', '');
            persistPausedSend(fileId, getPeer()?.name || activePeer.name, Math.min((((activeSends[fileId]?.chunkIndex || 0) * CHUNK_SIZE) / state.file.size) * 100, 100));
            if (typeof state.onDone === 'function') state.onDone();
        }
    };

    state.resumeLoop = sendNextChunk;

    const heartbeatInterval = setInterval(() => {
        const s = activeSends[fileId];
        if (!s || s.aborted || s.paused) {
            clearInterval(heartbeatInterval);
            return;
        }
        const activePeer = getPeer();
        if (activePeer && activePeer.dc && activePeer.dc.readyState === 'open') {
            activePeer.dc.send(JSON.stringify({ type: 'p2p-heartbeat', fileId }));
            socket.emit('room-heartbeat', signalingId);
        }
    }, 10000);
}

async function resumeSendFile(fileId, targetId) {
    let state = activeSends[fileId];
    if (!state) {
        const persisted = loadP2PSendResumeState()[fileId];
        if (!persisted?.fileMeta) return;
        let cachedFile = null;
        try {
            cachedFile = await getCachedP2PSendFile(fileId);
        } catch (e) {
            cachedFile = null;
        }
        if (!cachedFile || typeof cachedFile.slice !== 'function') return;
        state = {
            file: cachedFile,
            chunkIndex: Math.max(0, Math.floor(((persisted.progress ?? 0) / 100) * Math.ceil((persisted.fileSize || cachedFile.size) / CHUNK_SIZE))),
            paused: true,
            aborted: false,
            fileId,
            targetId: targetId || persisted.targetId || null,
            peerName: persisted.peerName || 'peer',
            resumeLoop: null,
            waitingForOpen: false,
            restoredFromStorage: true,
            missingFile: false
        };
        activeSends[fileId] = state;
        window.activeSends = activeSends;
    }
    const peer = peers[targetId];
    if (!peer || !peer.dc || peer.dc.readyState !== 'open') return;
    if (!state.file || typeof state.file.name !== 'string' || typeof state.file.size !== 'number') {
        markSendPaused(fileId, peer?.name || state.peerName || 'peer', 0);
        return;
    }

    const rawMeta = {
        type: 'file-meta',
        id: fileId,
        name: state.file.name,
        originalName: state.file.name,
        size: state.file.size,
        mime: state.file.type,
        totalChunks: Math.ceil(state.file.size / CHUNK_SIZE),
        nickname: state.file.nickname || ''
    };
    const metaEnvelope = await encryptMeta(rawMeta, peer.ecdhKey);
    try {
        peer.dc.send(JSON.stringify({ type: 'file-meta-envelope', payload: metaEnvelope }));
        state.targetId = targetId;
        state.peerName = peer.name || state.peerName;
        state.waitingForOpen = false;
        state.paused = false;
        persistPausedSend(fileId, state.peerName || peer.name || 'peer');
        if (typeof state.resumeLoop !== 'function') {
            setupP2PSendLoop(fileId, targetId, peer, state.onDone);
        }
        if (typeof state.resumeLoop === 'function') {
            state.resumeLoop();
        }
    } catch (err) {
        console.error('Failed to send resume file-meta', err);
    }
}

function setupDataChannel(channel, targetId) {
    const peer = peers[targetId];
    if (!peer) return;
    peer.dc = channel;
    peer.channel = channel;
    channel._emitTargetId = targetId;

    channel.binaryType = 'arraybuffer';

    channel.onopen = () => {
        console.log(`Data channel to ${peer.name} open`);
        const statusEl = document.getElementById(`peer-status-${targetId}`);
        if (statusEl) statusEl.textContent = 'Connected';
        for (const [fId, sendState] of Object.entries(activeSends)) {
            if (sendState.targetId === targetId && sendState.waitingForOpen && !sendState.aborted) {
                sendState.waitingForOpen = false;
                updateTransferProgress(fId, 0, `Starting send to ${peer.name}`, '', '');
                resumeSendFile(fId, targetId);
                continue;
            }
            if (sendState.targetId === targetId && sendState.paused && !sendState.aborted) {
                resumeSendFile(fId, targetId);
            }
        }
    };

    channel.onclose = () => {
        console.log(`Data channel to ${peer.name} closed`);
        if (peer.channel === channel) {
            peer.channel = null;
        }
    };

    let pendingChunkHeader = null;
    let incomingMessageQueue = [];
    let isProcessingQueue = false;

    if (!peer.currentSpeedStats) {
        peer.currentSpeedStats = { lastTime: Date.now(), lastBytes: 0 };
    }

    channel.onmessage = (e) => {
        incomingMessageQueue.push(e);
        processIncomingQueue();
    };

    async function processIncomingQueue() {
        if (isProcessingQueue) return;
        isProcessingQueue = true;
        try {
            while (incomingMessageQueue.length > 0) {
                const e = incomingMessageQueue.shift();
                if (typeof e.data === 'string') {
                    const msg = JSON.parse(e.data);
                    if (msg.type === 'file-meta-envelope') {
                        try {
                            if (msg.payload?.encrypted && !peer.ecdhKey) {
                                incomingMessageQueue.unshift(e);
                                isProcessingQueue = false;
                                setTimeout(() => processIncomingQueue(), 50);
                                return;
                            }
                            const meta = await decryptMeta(msg.payload, peer.ecdhKey);
                            const persistedState = loadP2PResumeState()[meta.id];
                            if (!activeReceives[meta.id]) {
                                activeReceives[meta.id] = { ...meta, senderId: targetId };
                                receiveBuffer[meta.id] = [];
                                receivedChunks[meta.id] = new Set();
                                createTransferElement(meta.id, meta.originalName || meta.name, meta.size, true, null, meta.nickname);
                                if (typeof ActivityTracker !== 'undefined') {
                                    ActivityTracker.addTransfer(meta.id, {
                                        name: meta.originalName || meta.name,
                                        nickname: meta.nickname,
                                        size: meta.size,
                                        roomId: roomId || meta.roomId || null,
                                        direction: 'download'
                                    });
                                }
                                setupDirectToDiskStream(meta.id, meta);
                            }
                            if (persistedState && persistedState.receivedChunks && persistedState.receivedChunks.length > 0) {
                                receivedChunks[meta.id] = new Set(persistedState.receivedChunks);
                                auditLog(`Partial file detected for ${meta.name}, waiting for sender to resume.`);
                                showReceivePausedState(meta, peer);
                                if (peer.currentSpeedStats) {
                                    peer.currentSpeedStats.lastTime = Date.now();
                                    peer.currentSpeedStats.lastBytes = Math.min((receivedChunks[meta.id].size) * CHUNK_SIZE, meta.size);
                                }
                                if (peer.dc && peer.dc.readyState === 'open') {
                                    peer.dc.send(JSON.stringify({
                                        type: 'resume-request',
                                        fileId: meta.id,
                                        receivedChunks: Array.from(receivedChunks[meta.id]).sort((a, b) => a - b)
                                    }));
                                }
                            }
                            const savedProgress = getSavedReceiveProgress(meta);
                            if (savedProgress !== null) {
                                updateTransferProgress(meta.id, savedProgress, `Resuming from ${peer.name}`, '', '');
                                if (typeof ActivityTracker !== 'undefined') {
                                    ActivityTracker.updateTransfer(meta.id, {
                                        progress: savedProgress,
                                        speed: 'Resuming',
                                        eta: 'Catching up',
                                        paused: false,
                                        pausedLabel: ''
                                    });
                                }
                                if (peer.currentSpeedStats) {
                                    peer.currentSpeedStats.lastTime = Date.now();
                                    peer.currentSpeedStats.lastBytes = Math.min(((receivedChunks[meta.id] || new Set()).size) * CHUNK_SIZE, meta.size);
                                }
                                if (peer.dc && peer.dc.readyState === 'open') {
                                    peer.dc.send(JSON.stringify({
                                        type: 'resume-request',
                                        fileId: meta.id,
                                        receivedChunks: Array.from(receivedChunks[meta.id] || []).sort((a, b) => a - b)
                                    }));
                                }
                            } else {
                                updateTransferProgress(meta.id, 0, `From ${peer.name}`, '0 B/s', '--:--');
                            }
                            const cancelBtn = document.getElementById(`cancel-transfer-${meta.id}`);
                            if (cancelBtn) {
                                cancelBtn.onclick = () => {
                                    setResumeButtonState(meta.id, false, null);
                                    clearPersistedTransferArtifacts(meta.id);
                                    if (directStreamHandles[meta.id]) {
                                        try { if (directStreamHandles[meta.id].writable) directStreamHandles[meta.id].writable.abort(); } catch (e) { }
                                        delete directStreamHandles[meta.id];
                                    }
                                    delete activeReceives[meta.id];
                                    delete receiveBuffer[meta.id];
                                    delete receivedChunks[meta.id];
                                    const item = document.getElementById(`item-${meta.id}`);
                                    if (item) item.remove();
                                    auditLog(`Incoming transfer "${meta.name}" from ${peer.name} cancelled.`);
                                    if (peer.dc && peer.dc.readyState === 'open') {
                                        peer.dc.send(JSON.stringify({ type: 'cancel-transfer', fileId: meta.id }));
                                    }
                                };
                            }
                        } catch (err) {
                            console.error('Meta decryption failed', err);
                            showToast('Decryption Error', 'Could not decrypt file metadata.', 'error');
                        }
                    } else if (msg.type === 'chunk-header') {
                        pendingChunkHeader = msg;
                    } else if (msg.type === 'file-done') {
                        await finalizeDownload(msg.id);
                    } else if (msg.type === 'cancel-transfer') {
                        const cancelId = msg.fileId;
                        if (activeReceives[cancelId]) {
                            setResumeButtonState(cancelId, false, null);
                            clearPersistedTransferArtifacts(cancelId);
                            if (directStreamHandles[cancelId]) {
                                try { if (directStreamHandles[cancelId].writable) directStreamHandles[cancelId].writable.abort(); } catch (e) { }
                                delete directStreamHandles[cancelId];
                            }
                            delete activeReceives[cancelId];
                            delete receiveBuffer[cancelId];
                            delete receivedChunks[cancelId];
                            const item = document.getElementById(`item-${cancelId}`);
                            if (item) item.remove();
                            auditLog('Incoming transfer cancelled by sender.');
                            showToast('Transfer Cancelled', 'The sender cancelled the file transfer.', 'warning');
                        }
                        if (activeSends[cancelId]) {
                            delete activeSends[cancelId];
                            clearPersistedTransferArtifacts(cancelId);
                            const item = document.getElementById(`item-${cancelId}`);
                            if (item) item.remove();
                            auditLog('Outgoing transfer cancelled by receiver.');
                            showToast('Transfer Cancelled', 'The receiver cancelled the file transfer.', 'warning');
                        }
                    } else if (msg.type === 'transfer-disturbed') {
                        const disturbedId = msg.fileId;
                        const disturbedMeta = activeReceives[disturbedId];
                        if (disturbedMeta) {
                            showReceivePausedState(disturbedMeta, peer);
                            updateTransferProgress(disturbedId, Math.min((((receivedChunks[disturbedId] || new Set()).size * CHUNK_SIZE) / disturbedMeta.size) * 100, 100), `Paused - ${msg.message || `waiting for ${peer.name}`}`, '', '');
                            showToast('Transfer Paused', `${disturbedMeta.originalName || disturbedMeta.name} got interrupted.`, 'warning');
                        }
                    } else if (msg.type === 'chat-envelope') {
                        const peerName = (peers[targetId] && peers[targetId].name) || 'Peer';
                        try {
                            const plain = await decryptMeta(msg.payload, peer.ecdhKey);
                            if (plain.type === 'reaction') {
                                appendToChatLog(peerName, plain.emoji, true);
                            } else if (plain.type === 'typing') {
                                setPeerTyping(peerName, !!plain.isTyping);
                            } else if (plain.type === 'chat') {
                                setPeerTyping(peerName, false);
                                if (plain.text != null && plain.text !== '') {
                                    appendToChatLog(peerName, plain.text, false, !!plain.ephemeral, plain.msgId || null);
                                    reportUserActivity(true);
                                    if (typeof playProceduralSound === 'function') playProceduralSound('pop');
                                }
                            } else {
                                setPeerTyping(peerName, false);
                                if (plain.text != null && plain.text !== '') {
                                    appendToChatLog(peerName, plain.text, false, !!plain.ephemeral, plain.msgId || null);
                                    reportUserActivity(true);
                                    if (typeof playProceduralSound === 'function') playProceduralSound('pop');
                                }
                            }
                        } catch (err) {
                            console.error('Chat decryption failed', err);
                        }
                    } else if (msg.type === 'resume-request') {
                        const { fileId, receivedChunks: peerReceived } = msg;
                        if (activeSends[fileId]) {
                            auditLog(`Resuming transfer for ${fileId} from chunk ${peerReceived.length}`);
                            activeSends[fileId].targetId = targetId;
                            activeSends[fileId].peerName = peer.name || activeSends[fileId].peerName;
                            activeSends[fileId].chunkIndex = Math.max(...peerReceived, -1) + 1;
                            activeSends[fileId].paused = false;
                            activeSends[fileId].waitingForOpen = false;
                            clearPersistedPausedSend(fileId);
                            if (typeof ActivityTracker !== 'undefined') {
                                ActivityTracker.updateTransfer(fileId, {
                                    paused: false,
                                    pausedLabel: ''
                                });
                            }
                            setP2PTransferResuming(fileId, true);
                            setTimeout(() => setP2PTransferResuming(fileId, false), 3000);
                            if (typeof activeSends[fileId].resumeLoop === 'function') {
                                activeSends[fileId].resumeLoop();
                            } else {
                                resumeSendFile(fileId, targetId);
                            }
                        }
                    }
                } else {
                    if (!pendingChunkHeader) continue;
                    const { fileId, chunkIndex } = pendingChunkHeader;
                    pendingChunkHeader = null;
                    const meta = activeReceives[fileId];
                    if (!meta) continue;
                    if (receivedChunks[fileId] && receivedChunks[fileId].has(chunkIndex)) continue;
                    let chunkData = e.data;
                    if (peer.ecdhKey) {
                        try {
                            const buf = e.data instanceof ArrayBuffer ? e.data : await e.data.arrayBuffer();
                            const iv = new Uint8Array(buf, 0, 12);
                            const cipher = buf.slice(12);
                            chunkData = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, peer.ecdhKey, cipher);
                        } catch (err) {
                            console.error('Chunk decryption failed', err);
                            updateTransferProgress(meta.id, 0, 'DECRYPTION FAILED', '', '');
                            continue;
                        }
                    }
                    if (directStreamHandles[fileId] && directStreamHandles[fileId].active) {
                        enqueueDirectWrite(fileId, chunkIndex, chunkData);
                    } else {
                        if (!receiveBuffer[fileId]) receiveBuffer[fileId] = [];
                        receiveBuffer[fileId][chunkIndex] = chunkData;
                    }
                    receivedChunks[fileId].add(chunkIndex);
                    if (receivedChunks[fileId].size % RECEIVE_PERSIST_EVERY_CHUNKS === 0 || receivedChunks[fileId].size === meta.totalChunks) {
                        persistPartialReceive(fileId);
                    }
                    setResumeButtonState(fileId, false, null);
                    const receivedBytes = Math.min((receivedChunks[fileId].size) * CHUNK_SIZE, meta.size);
                    const now = Date.now();
                    const speedStats = peer.currentSpeedStats;
                    if (speedStats) {
                        const timeDiff = (now - speedStats.lastTime) / 1000;
                        if (timeDiff >= 0.25 || receivedBytes === meta.size) {
                            const bytesDiff = receivedBytes - speedStats.lastBytes;
                            const speed = timeDiff > 0 ? Math.max(bytesDiff / timeDiff, 0) : 0;
                            const remaining = Math.max(meta.size - receivedBytes, 0);
                            const progressPct = Math.min((receivedBytes / meta.size) * 100, 100);
                            const statusText = speed > 0 ? `Receiving from ${peer.name}` : `Resuming from ${peer.name}`;
                            updateTransferProgress(
                                meta.id,
                                progressPct,
                                statusText,
                                speed > 0 ? formatSpeed(speed) : '',
                                speed > 0 ? formatETA(remaining / speed) : '',
                                speed
                            );
                            if (typeof ActivityTracker !== 'undefined') {
                                ActivityTracker.updateTransfer(meta.id, {
                                    progress: progressPct,
                                    speed: speed > 0 ? formatSpeed(speed) : 'Resuming',
                                    rawSpeed: speed,
                                    eta: speed > 0 ? formatETA(remaining / speed) : 'Catching up'
                                });
                            }
                            speedStats.lastTime = now;
                            speedStats.lastBytes = receivedBytes;
                        }
                    }
                }
            }
        } finally {
            isProcessingQueue = false;
        }
    }
}

async function decryptMeta(envelope, key) {
    if (!envelope.encrypted) return JSON.parse(envelope.data);
    if (!key) throw new Error('No decryption key for peer');
    const iv = new Uint8Array(envelope.iv);
    const cipher = new Uint8Array(envelope.data).buffer;
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, cipher);
    return JSON.parse(new TextDecoder().decode(plain));
}

async function encryptMeta(metaObj, key) {
    if (!key) return { encrypted: false, data: JSON.stringify(metaObj) };
    const enc = new TextEncoder();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const cipher = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        key,
        enc.encode(JSON.stringify(metaObj))
    );
    return { encrypted: true, iv: Array.from(iv), data: Array.from(new Uint8Array(cipher)) };
}
window.encryptMeta = encryptMeta;

let p2pTransferQueue = [];
let activeP2PCount = 0;
const MAX_CONCURRENT_P2P = 1;

function processP2PQueue() {
    while (activeP2PCount < MAX_CONCURRENT_P2P && p2pTransferQueue.length > 0) {
        const item = p2pTransferQueue.shift();
        activeP2PCount++;
        sendFile(item.file, item.targetId, item.nickname, item.note || '', item.pendingId).finally(() => {
            activeP2PCount--;
            processP2PQueue();
        });
    }
}

function consumePendingTransferRow(file, targetId) {
    const targetPeer = peers[targetId];
    const pendingItems = Array.from(document.querySelectorAll('[data-pending-transfer="true"]'));
    const match = pendingItems.find((item) => {
        const title = item.querySelector('.transfer-name')?.getAttribute('title') || '';
        return title === file.name;
    });
    if (!match) return null;
    match.removeAttribute('data-pending-transfer');
    const status = match.querySelector('[id^="status-"]');
    if (status && targetPeer) status.textContent = `To ${targetPeer.name}`;
    return match.id.replace(/^item-/, '');
}

async function handleFiles(files) {
    const peerArray = Object.values(peers);
    if (peerArray.length === 0) {
        showToast('No Peer', 'No direct peer is ready right now.', 'warning');
        return;
    }
    if (window.isSpectator) {
        showToast('Spectator Mode', 'You joined as spectator and cannot send files.', 'warning');
        return;
    }
    const stealthMode = document.getElementById('stealth-mode-checkbox') && document.getElementById('stealth-mode-checkbox').checked;
    if (stealthMode) {
        const confirmed = await window.uiShared.CustomDialog.confirm('Stealth Mode Active', 'All metadata will be stripped from images before transfer. Proceed?');
        if (!confirmed) return;
        showToast('Stealth Mode', 'Cleaning files of hidden metadata...', 'info');
    }

    const scheduledCheckbox = document.getElementById('schedule-checkbox');
    const scheduleTimeSelect = document.getElementById('schedule-time-select');
    const noteInput = document.getElementById('file-note-input');
    const note = noteInput ? noteInput.value.trim() : '';
    if (note) {
        const lowerNote = note.toLowerCase();
        const hasBannedEmoji = ['🖕', '🍑', '🍌', '🍆', '💦', '🔞'].some(emoji => note.includes(emoji));
        const hasBannedWord = ['fuck', 'shit', 'bitch', 'asshole', 'pussy', 'dick', 'nigger', 'nigga', 'sex', 'sexual', 'nude', 'nudes', 'adult', 'xxx', 'porn', 'pornography', 'nsfw', 'girl', 'girls', 'boy', 'boys', 'guy', 'guys', 'lgbt', 'gay', 'lesbian', 'trans', 'dating', 'meetup', 'hookup', 'horny', 'date', 'creeps', 'cunt', 'cock'].some(word => lowerNote.includes(word));
        if (hasBannedEmoji || hasBannedWord) {
            showToast('Note Blocked', 'Sticky note contains restricted content.', 'error');
            return;
        }
    }
    const isScheduled = scheduledCheckbox && scheduledCheckbox.checked && scheduleTimeSelect;

    const doSend = async () => {
        for (let f of files) {
            const processedFile = (stealthMode && window.uiShared?.stripMetadata) ? await window.uiShared.stripMetadata(f) : f;
            for (let peer of peerArray) {
                const pendingId = `pending-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
                createTransferElement(pendingId, processedFile.name, processedFile.size, false, processedFile, '');
                updateTransferProgress(pendingId, 0, `Preparing to send to ${peer.name}`, '', '');
                const pendingItem = document.getElementById(`item-${pendingId}`);
                if (pendingItem) pendingItem.dataset.pendingTransfer = 'true';
                p2pTransferQueue.push({ file: processedFile, targetId: peer.id, nickname: '', note, pendingId });
            }
        }
        processP2PQueue();
        if (noteInput) noteInput.value = '';
    };

    if (isScheduled) {
        const minutes = parseInt(scheduleTimeSelect.value, 10) || 1;
        let delayMs = minutes * 60 * 1000;
        const startTime = Date.now();
        const targetTime = startTime + delayMs;

        const scheduledFiles = [];
        for (let f of files) {
            for (let peer of peerArray) {
                const pendingId = `pending-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
                createTransferElement(pendingId, f.name, f.size, false, null, '');
                updateTransferProgress(pendingId, 0, `Scheduled (in ${minutes}m)`, '', '');

                if (typeof ActivityTracker !== 'undefined') {
                    ActivityTracker.addTransfer(pendingId, {
                        name: f.name,
                        size: f.size,
                        direction: 'upload',
                        progress: 0,
                        speed: 'Scheduled',
                        eta: `${minutes}m`
                    });
                }
                scheduledFiles.push({ pendingId, file: f, peer });
            }
        }

        const interval = setInterval(() => {
            const remainingSec = Math.round((targetTime - Date.now()) / 1000);
            if (remainingSec <= 0) {
                clearInterval(interval);
                for (const sf of scheduledFiles) {
                    const pendingItem = document.getElementById(`item-${sf.pendingId}`);
                    if (!pendingItem) continue;
                    (async () => {
                        const processedFile = (stealthMode && window.uiShared?.stripMetadata) ? await window.uiShared.stripMetadata(sf.file) : sf.file;
                        updateTransferProgress(sf.pendingId, 0, `Preparing to send to ${sf.peer.name}`, '', '');
                        if (pendingItem) pendingItem.dataset.pendingTransfer = 'true';
                        p2pTransferQueue.push({ file: processedFile, targetId: sf.peer.id, nickname: '', note, pendingId: sf.pendingId });
                        processP2PQueue();
                    })();
                }
                if (noteInput) noteInput.value = '';
            } else {
                const minsLeft = Math.floor(remainingSec / 60);
                const secsLeft = remainingSec % 60;
                const timeStr = minsLeft > 0 ? `${minsLeft}m ${secsLeft}s` : `${secsLeft}s`;
                for (const sf of scheduledFiles) {
                    const pendingItem = document.getElementById(`item-${sf.pendingId}`);
                    if (!pendingItem) continue;
                    updateTransferProgress(sf.pendingId, 0, `Scheduled (in ${timeStr})`, '', '');
                    if (typeof ActivityTracker !== 'undefined') {
                        ActivityTracker.updateTransfer(sf.pendingId, {
                            progress: 0,
                            speed: 'Scheduled',
                            eta: timeStr
                        });
                    }
                }
            }
        }, 1000);

        showToast('Transfer Scheduled', `Will send in ${minutes} minute(s).`, 'info');
    } else {
        doSend();
    }
}

window.resumeHostedDrop = async function (files, token) {
    const modal = document.getElementById('drop-modal');
    const dropForm = document.getElementById('drop-modal-form');
    const progressSection = document.getElementById('drop-modal-progress');
    const progressLabel = document.getElementById('drop-progress-label');
    const pctDisplay = document.getElementById('drop-progress-pct-display');
    const ring = document.getElementById('portal-progress-ring');
    const fileDisplay = document.getElementById('drop-progress-filename-display');
    const resultSection = document.getElementById('drop-modal-result');
    const resultUrl = document.getElementById('drop-result-url');
    const copyBtn = document.getElementById('drop-copy-btn');
    const waitBtn = document.getElementById('drop-modal-wait');

    if (dropForm) dropForm.style.display = 'none';
    if (progressSection) progressSection.style.display = 'block';

    const resumeToken = token || (Array.isArray(files) ? files.token : null);
    let resumeFiles = Array.isArray(files) ? files : [];
    if (!resumeFiles || !resumeFiles.length) {
        if (resumeToken) {
            const cachedBlob = await window.getCachedHostedFile(resumeToken).catch(() => null);
            if (cachedBlob) resumeFiles = [cachedBlob];
        }
    }

    if (!resumeFiles || resumeFiles.length === 0) {
        if (progressLabel) progressLabel.textContent = 'Resume failed: cached upload file not found.';
        if (waitBtn) {
            waitBtn.disabled = false;
            waitBtn.textContent = 'Close';
            waitBtn.onclick = () => {
                if (modal) modal.style.display = 'none';
                localStorage.removeItem('emit-active-hosted-token');
                localStorage.removeItem('emit-active-hosted-state');
            };
        }
        return;
    }

    try {
        window.cacheHostedFile(resumeToken, resumeFiles[0]).catch(e => console.warn('Cache failed', e));

        progressSection.innerHTML = `
            <div class="hosted-progress-card">
                <div class="hosted-modal-eyebrow"><i class="fa-solid fa-lock"></i> Resuming Upload</div>
                <div class="hosted-progress-ring-wrap">
                    <svg viewBox="0 0 36 36" class="hosted-progress-ring-svg" aria-hidden="true">
                        <path class="ring-bg" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke-width="2"></path>
                        <path id="portal-progress-ring" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="var(--accent-emerald)" stroke-width="2" stroke-dasharray="0, 100"></path>
                    </svg>
                    <div id="drop-progress-pct-display" class="hosted-progress-pct">0%</div>
                </div>
                <div id="drop-progress-filename-display" class="drop-modal-file hosted-progress-file" style="margin-bottom:0;">Verifying and Resuming...</div>
            </div>
        `;

        const freshPctDisplay = document.getElementById('drop-progress-pct-display');
        const freshRing = document.getElementById('portal-progress-ring');
        const freshFileDisplay = document.getElementById('drop-progress-filename-display');

        const isCollection = JSON.parse(localStorage.getItem('emit-active-hosted-filenames') || '[]').length > 1;

        let fileToUpload = resumeFiles[0];
        if (isCollection) {
            if (freshFileDisplay) freshFileDisplay.textContent = 'Re-bundling for Resume...';
            const zip = new JSZip();
            for (const f of Array.from(resumeFiles)) zip.file(f.name, f);
            fileToUpload = await zip.generateAsync({ type: 'blob' });
        }

        const result = await window.hostedDrop(fileToUpload, (phase, pct) => {
            const roundedPct = Math.round(pct);
            if (freshPctDisplay) freshPctDisplay.textContent = roundedPct + '%';
            if (freshRing) freshRing.setAttribute('stroke-dasharray', `${roundedPct}, 100`);
            if (freshFileDisplay) freshFileDisplay.textContent = phase === 'resuming' ? 'Catching up with server...' : (fileToUpload.name || 'Bundle');
            const barFill = document.getElementById('portal-progress-bar-fill');
            if (barFill) barFill.style.width = roundedPct + '%';
            if (typeof ActivityTracker !== 'undefined') ActivityTracker.updateHostedLinkProgress(token, pct);
        }, (60 * 60 * 1000), '', { skipActivity: true, token: token });

        if (typeof ActivityTracker !== 'undefined') {
            ActivityTracker.updateHostedLinkProgress(token, 100);
            ActivityTracker.updateHostedLinkUrl(token, result.url);
        }

        progressSection.style.display = 'none';
        resultSection.style.display = 'block';
        if (resultUrl) resultUrl.value = result.url;
        localStorage.setItem('emit-active-hosted-state', 'finished');
        localStorage.setItem('emit-active-hosted-url', result.url);
        if (copyBtn) copyBtn.onclick = () => window.copyToClipboard(result.url).then(() => showToast('Copied', 'URL Copied', 'success'));
        if (waitBtn) {
            waitBtn.textContent = 'Close';
            waitBtn.disabled = false;
            waitBtn.onclick = () => {
                if (modal) modal.style.display = 'none';
                localStorage.removeItem('emit-active-hosted-token');
                localStorage.removeItem('emit-active-hosted-state');
            };
        }
    } catch (e) {
        const errDisplay = document.getElementById('drop-progress-filename-display');
        if (errDisplay) errDisplay.textContent = 'Resume Failed: ' + e.message;
        if (waitBtn) waitBtn.disabled = false;
    }
};

const dropModalClose = document.getElementById('drop-modal-close');
if (dropModalClose) {
    dropModalClose.addEventListener('click', () => {
        const modal = document.getElementById('drop-modal');
        if (modal) modal.style.display = 'none';
    });
}

function sendFile(file, targetId, nickname = '', note = '', explicitPendingId = '') {
    return new Promise(async (resolve) => {
        let isResolved = false;
        const done = () => {
            if (!isResolved) {
                isResolved = true;
                resolve();
            }
        };

        const executeSend = async (activePeer) => {
            const processedFile = file;
            let fileId = explicitPendingId;
            if (fileId) {
                const el = document.getElementById(`item-${fileId}`);
                if (el) {
                    el.removeAttribute('data-pending-transfer');
                    const status = el.querySelector('[id^="status-"]');
                    if (status && activePeer) status.textContent = `To ${activePeer.name}`;
                }
            } else {
                fileId = consumePendingTransferRow(processedFile, targetId) || ((typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
                    ? crypto.randomUUID().replace(/-/g, '')
                    : `send_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`);
            }
            const rawMeta = {
                type: 'file-meta',
                id: fileId,
                name: nickname || processedFile.name,
                originalName: processedFile.name,
                size: processedFile.size,
                mime: processedFile.type,
                totalChunks: Math.ceil(processedFile.size / CHUNK_SIZE),
                nickname: nickname,
                note: note || ''
            };

            saveP2PSendResumeState({
                ...loadP2PSendResumeState(),
                [fileId]: {
                    fileId,
                    fileName: processedFile.name,
                    fileSize: processedFile.size,
                    roomId: roomId || null,
                    nickname: nickname || '',
                    targetId,
                    peerName: activePeer.name || 'peer',
                    progress: 0,
                    chunkIndex: 0,
                    fileMeta: {
                        name: processedFile.name,
                        size: processedFile.size,
                        type: processedFile.type || '',
                        nickname: nickname || ''
                    },
                    waitingForOpen: !activePeer.dc || activePeer.dc.readyState !== 'open',
                    missingFile: false,
                    updatedAt: Date.now()
                }
            });

            cacheP2PSendFile(fileId, processedFile).catch((e) => {
                console.warn('Failed to cache P2P send file', e);
            });

            if (!document.getElementById(`item-${fileId}`)) {
                createTransferElement(fileId, processedFile.name, processedFile.size, false, processedFile, nickname);
            }
            if (typeof ActivityTracker !== 'undefined') {
                ActivityTracker.addTransfer(fileId, {
                    name: processedFile.name,
                    nickname: nickname,
                    size: processedFile.size,
                    roomId: roomId || null,
                    direction: 'upload'
                });
            }
            if (typeof socket !== 'undefined' && socket.emit) {
                socket.emit('reset-inactivity');
            }
            const statusEl = document.getElementById(`status-${fileId}`);
            if (statusEl) statusEl.textContent = `To ${activePeer.name}`;

            if (!activePeer.dc || activePeer.dc.readyState !== 'open') {
                processedFile.nickname = nickname;
                const sendState = { file: processedFile, chunkIndex: 0, paused: false, aborted: false, fileId, targetId, resumeLoop: null, waitingForOpen: true, onDone: done };
                activeSends[fileId] = sendState;
                updateTransferProgress(fileId, 0, `Connecting to ${activePeer.name}`, '', '');
                if (typeof ActivityTracker !== 'undefined') {
                    ActivityTracker.updateTransfer(fileId, {
                        progress: 0,
                        speed: 'Connecting',
                        eta: 'Waiting for peer',
                        paused: false,
                        pausedLabel: ''
                    });
                }
                persistPausedSend(fileId, activePeer.name, 0);
                return;
            }

            const metaEnvelope = await encryptMeta(rawMeta, activePeer.ecdhKey);
            try {
                activePeer.dc.send(JSON.stringify({ type: 'file-meta-envelope', payload: metaEnvelope }));
            } catch (err) {
                showToast('Transfer Failed', `Failed to initiate send to ${activePeer.name}.`, 'error');
                return done();
            }

            processedFile.nickname = nickname;
            const sendState = { file: processedFile, chunkIndex: 0, paused: false, aborted: false, fileId, targetId, resumeLoop: null, waitingForOpen: false, onDone: done };
            activeSends[fileId] = sendState;

            setupP2PSendLoop(fileId, targetId, activePeer, done);
            if (activeSends[fileId] && typeof activeSends[fileId].resumeLoop === 'function') {
                activeSends[fileId].resumeLoop();
            }
        };

        const initialPeer = peers[targetId];
        if (initialPeer && initialPeer.dc && initialPeer.dc.readyState === 'open') {
            executeSend(initialPeer);
        } else {
            let checkAttempts = 0;
            const checkTimer = setInterval(() => {
                const currentPeer = peers[targetId];
                if (currentPeer && currentPeer.dc && currentPeer.dc.readyState === 'open') {
                    clearInterval(checkTimer);
                    executeSend(currentPeer);
                } else {
                    checkAttempts++;
                    if (checkAttempts >= 200) {
                        clearInterval(checkTimer);
                        const stalledState = activeSends[fileId];
                        if (stalledState && !stalledState.aborted) {
                            stalledState.paused = true;
                            markSendPaused(fileId, currentPeer ? currentPeer.name : 'peer', 0);
                        }
                        showToast('Transfer Failed', `Connection to ${currentPeer ? currentPeer.name : 'peer'} lost.`, 'error');
                        done();
                    }
                }
            }, 100);
        }
    });
}

async function finalizeDownload(fileId) {
    const meta = activeReceives[fileId];
    if (!meta) return;

    socket.emit('record-stat', { bytes: meta.size });

    const isRoomPublic = window.isPublicRoomSession || !!document.getElementById('public-room-checkbox')?.checked;

    let url = '';
    let isDirectStream = false;

    if (directStreamHandles[fileId] && directStreamHandles[fileId].writable) {
        isDirectStream = true;
        const stream = directStreamHandles[fileId];
        try {
            flushDirectStreamBuffer(fileId);
            if (stream.writeQueue) {
                await stream.writeQueue;
            }
            if (receiveBuffer[fileId]) {
                for (const [idxStr, chunkData] of Object.entries(receiveBuffer[fileId])) {
                    const cIdx = Number(idxStr);
                    if (chunkData) {
                        await stream.writable.write({
                            type: 'write',
                            position: cIdx * CHUNK_SIZE,
                            data: chunkData
                        });
                    }
                }
            }
            await stream.writable.close();
            auditLog(`Direct-to-Disk write completed and file closed for "${meta.name}".`);
        } catch (closeErr) {
            console.error('Error closing direct-to-disk stream:', closeErr);
        }
        delete directStreamHandles[fileId];
        delete receiveBuffer[fileId];
    } else {
        const orderedChunks = (receiveBuffer[fileId] || []).filter(Boolean);
        const blob = new Blob(orderedChunks, { type: meta.mime || 'application/octet-stream' });
        url = URL.createObjectURL(blob);
    }

    if (isRoomPublic) {
        const ext = meta.name.split('.').pop().toLowerCase();
        if (['jpg', 'jpeg', 'png', 'webp'].includes(ext)) {
            const img = new Image();
            img.src = url;
            img.onload = () => {
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
                canvas.width = 100;
                canvas.height = 100;
                ctx.drawImage(img, 0, 0, 100, 100);
                const imgData = ctx.getImageData(0, 0, 100, 100).data;

                let skinPixels = 0;
                for (let i = 0; i < imgData.length; i += 4) {
                    const r = imgData[i];
                    const g = imgData[i + 1];
                    const b = imgData[i + 2];

                    const passesRGB = r > 95 && g > 40 && b > 20 && (Math.max(r, g, b) - Math.min(r, g, b) > 15) && Math.abs(r - g) > 15 && r > g && r > b;

                    if (passesRGB) {
                        const rNorm = r / 255;
                        const gNorm = g / 255;
                        const bNorm = b / 255;
                        const max = Math.max(rNorm, gNorm, bNorm);
                        const min = Math.min(rNorm, gNorm, bNorm);
                        const d = max - min;
                        let h = 0;
                        if (d !== 0) {
                            if (max === rNorm) h = ((gNorm - bNorm) / d) % 6;
                            else if (max === gNorm) h = (bNorm - rNorm) / d + 2;
                            else h = (rNorm - gNorm) / d + 4;
                            h = Math.round(h * 60);
                            if (h < 0) h += 360;
                        }
                        const s = max === 0 ? 0 : d / max;

                        if (h >= 0 && h <= 50 && s >= 0.23 && s <= 0.68) {
                            skinPixels++;
                        }
                    }
                }

                const skinRatio = skinPixels / 10000;
                if (skinRatio > 0.70) {
                    showToast('Safety Warning', 'This image was flagged as potentially containing explicit content. Open with caution.', 'warning');
                    const dlBtn = document.getElementById(`download-btn-${fileId}`);
                    if (dlBtn) {
                        dlBtn.style.background = 'var(--accent-danger)';
                        dlBtn.style.color = '#fff';
                        dlBtn.textContent = '⚠️ Flagged (Open Anyway)';
                        dlBtn.title = 'Warning: Scanner detected potential adult content. Click to open at your own risk.';
                    }
                    updateTransferProgress(meta.id, 100, 'Flagged Content', '', '');
                }
            };
        }
    }

    if (typeof playProceduralSound === 'function') playProceduralSound('pop');

    const thumbEl = document.getElementById(`thumb-${meta.id}`);
    if (thumbEl) {
        const ext = meta.name.split('.').pop().toLowerCase();
        if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext)) {
            thumbEl.innerHTML = `<img src="${url}" style="width:48px;height:48px;border-radius:12px;object-fit:cover;">`;
        } else if (['mp4', 'webm'].includes(ext)) {
            thumbEl.innerHTML = `<video src="${url}" style="width:48px;height:48px;border-radius:12px;object-fit:cover;" autoplay muted loop></video>`;
        }
    }

    const downloadBtn = document.getElementById(`download-btn-${fileId}`);
    if (downloadBtn) {
        if (isDirectStream) {
            downloadBtn.removeAttribute('href');
            downloadBtn.textContent = 'Saved to Disk';
            downloadBtn.setAttribute('role', 'button');
            downloadBtn.style.pointerEvents = 'auto';
            downloadBtn.style.opacity = '1';
            downloadBtn.onclick = (e) => {
                e.preventDefault();
                showToast('Saved to Disk', `${meta.name} was saved directly to your chosen disk location.`, 'success');
            };
        } else {
            downloadBtn.href = url;
            downloadBtn.download = meta.name;
            downloadBtn.setAttribute('role', 'button');
            downloadBtn.style.pointerEvents = 'auto';
            downloadBtn.style.opacity = '1';

            const ext = meta.name.split('.').pop().toLowerCase();
            const isRiskyType = ['exe', 'bat', 'cmd', 'vbs', 'ps1', 'scr', 'jar', 'apk', 'com', 'msi'].includes(ext);

            downloadBtn.onclick = (e) => {
                e.preventDefault();
                const proceedWithDownload = () => {
                    if (meta.note && meta.note.trim()) {
                        const noteModal = document.getElementById('file-note-modal');
                        const noteContent = document.getElementById('file-note-content');
                        const noteOkBtn = document.getElementById('file-note-ok-btn');
                        const noteDownloadBtn = document.getElementById('file-note-download-btn');
                        if (noteModal && noteContent && noteOkBtn) {
                            noteContent.textContent = meta.note;
                            noteModal.style.display = 'flex';
                            noteOkBtn.onclick = () => {
                                noteModal.style.display = 'none';
                            };
                            if (noteDownloadBtn) {
                                noteDownloadBtn.style.display = '';
                                noteDownloadBtn.onclick = () => {
                                    noteModal.style.display = 'none';
                                    const a = document.createElement('a');
                                    a.href = url;
                                    a.download = meta.name;
                                    document.body.appendChild(a);
                                    a.click();
                                    a.remove();
                                };
                            }
                            return;
                        }
                    }
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = meta.name;
                    document.body.appendChild(a);
                    a.click();
                    a.remove();
                };

                if (meta.isFlaggedSecurity || isRiskyType) {
                    if (typeof window.showSecurityWarningModal === 'function') {
                        window.showSecurityWarningModal(meta.name, proceedWithDownload, null);
                    } else {
                        proceedWithDownload();
                    }
                } else {
                    proceedWithDownload();
                }
            };
        }
    }

    updateTransferProgress(meta.id, 100, isDirectStream ? 'Saved to Disk' : 'Ready to Save', '', '');
    if (typeof ActivityTracker !== 'undefined') {
        ActivityTracker.addTransfer(meta.id, {
            name: meta.originalName || meta.name,
            nickname: meta.nickname || '',
            size: meta.size,
            roomId: roomId || meta.roomId || null,
            direction: 'download',
            progress: 100,
            paused: false,
            pausedLabel: ''
        });
        ActivityTracker.updateTransfer(meta.id, {
            progress: 100,
            speed: '',
            eta: '',
            paused: false,
            pausedLabel: ''
        });
    }
    showToast('File Received', isDirectStream ? `${meta.name} saved directly to disk.` : `${meta.name} is ready to save.`, 'success');

    if (meta.note && meta.note.trim()) {
        const noteModal = document.getElementById('file-note-modal');
        const noteContent = document.getElementById('file-note-content');
        const noteOkBtn = document.getElementById('file-note-ok-btn');
        const noteDownloadBtn = document.getElementById('file-note-download-btn');
        if (noteModal && noteContent && noteOkBtn) {
            noteContent.textContent = meta.note;
            noteModal.style.display = 'flex';
            noteOkBtn.onclick = () => {
                noteModal.style.display = 'none';
            };
            if (noteDownloadBtn) {
                noteDownloadBtn.style.display = '';
                noteDownloadBtn.onclick = () => {
                    noteModal.style.display = 'none';
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = meta.name;
                    document.body.appendChild(a);
                    a.click();
                    a.remove();
                };
            }
        }
    }

    setResumeButtonState(fileId, false, null);
    clearPersistedPartialReceive(fileId);
    delete receiveBuffer[fileId];
    delete receivedChunks[fileId];
    delete activeReceives[fileId];
}

window.appendToChatLog = function (user, content, isEmoji = false, isEphemeral = false, msgId = null) {
    const log = document.getElementById('chat-log');
    if (!log) return;

    const placeholder = log.querySelector('.chat-placeholder');
    if (placeholder) placeholder.remove();

    const finalMsgId = msgId || 'msg-' + Math.random().toString(36).substring(2, 11) + '-' + Date.now();
    const entry = document.createElement('div');
    entry.id = finalMsgId;
    entry.style.cssText = 'display:flex; gap:6px; align-items:baseline; animation:fadeIn 0.2s ease; margin-bottom:4px;';

    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const isMe = user === 'Me';

    if (isEphemeral) {
        entry.innerHTML = `
            <span style="font-size: 0.7rem; color: var(--text-muted); flex-shrink: 0;">${time}</span>
            <span style="font-weight: 700; color: ${isMe ? 'var(--text-pure)' : 'var(--accent-emerald)'}; flex-shrink: 0;">${user}:</span>
            <span class="ephemeral-msg" style="color: #ef4444; background: rgba(239,68,68,0.1); border: 1px dashed rgba(239,68,68,0.3); padding: 2px 6px; border-radius: 6px; cursor: pointer; font-size: 0.8rem; display: inline-flex; align-items: center; gap: 4px; user-select: none;">
                <i class="fa-solid fa-lock"></i> Click to open ephemeral message
            </span>
        `;
        const clickArea = entry.querySelector('.ephemeral-msg');
        let fallbackTimer = setTimeout(() => {
            entry.remove();
        }, 30000);

        clickArea.onclick = () => {
            clearTimeout(fallbackTimer);
            clickArea.style.background = 'transparent';
            clickArea.style.border = 'none';
            clickArea.style.color = 'var(--text-primary)';
            clickArea.style.cursor = 'default';
            clickArea.onclick = null;

            if (typeof socket !== 'undefined' && socket.connected) {
                socket.emit('message-read', finalMsgId);
            }

            let timeLeft = 10;
            clickArea.innerHTML = `<i class="fa-solid fa-unlock"></i> ${content} <span style="font-size:0.7rem; color:var(--text-muted); margin-left: 6px;">(Self-destructs in ${timeLeft}s)</span>`;
            const interval = setInterval(() => {
                timeLeft--;
                if (timeLeft <= 0) {
                    clearInterval(interval);
                    clickArea.classList.add('burning');
                    setTimeout(() => {
                        entry.remove();
                    }, 800);
                } else {
                    clickArea.innerHTML = `<i class="fa-solid fa-unlock"></i> ${content} <span style="font-size:0.7rem; color:var(--text-muted); margin-left: 6px;">(Self-destructs in ${timeLeft}s)</span>`;
                }
            }, 1000);
        };
    } else {
        entry.innerHTML = `
            <span style="font-size: 0.7rem; color: var(--text-muted); flex-shrink: 0;">${time}</span>
            <span style="font-weight: 700; color: ${isMe ? 'var(--text-pure)' : 'var(--accent-emerald)'}; flex-shrink: 0;">${user}:</span>
            <span style="${isEmoji ? 'font-size: 1.2rem;' : 'color: var(--text-primary);'}">${content}</span>
        `;
    }
    log.appendChild(entry);
    log.scrollTop = log.scrollHeight;
};

window.broadcastReaction = async function (emoji) {
    if (typeof chatViolations !== 'undefined' && typeof BANNED_EMOJIS !== 'undefined') {
        const isBanned = BANNED_EMOJIS.includes(emoji);
        if (isBanned) {
            chatViolations++;
            if (chatViolations >= 3) {
                showToast('Kicked', 'You have been kicked for repeated behavioral violations.', 'error');
                if (typeof forceLeave === 'function') forceLeave('kicked');
                return;
            }
            const remaining = 3 - chatViolations;
            showToast('Behavioral Warning', `Restricted reaction detected. ${remaining} attempts remaining before kick.`, 'warning');
            return;
        }
    }

    let sentCount = 0;
    for (const id in peers) {
        const peer = peers[id];
        if (peer.dc && peer.dc.readyState === 'open' && peer.ecdhKey) {
            try {
                const payload = await encryptMeta({ type: 'reaction', emoji }, peer.ecdhKey);
                peer.dc.send(JSON.stringify({ type: 'chat-envelope', payload }));
                sentCount++;
            } catch (err) {
                console.error('Failed to encrypt reaction', err);
            }
        }
    }

    if (sentCount === 0 && typeof socket !== 'undefined' && socket.connected) {
        socket.emit('chat-message', { text: emoji });
    }

    if (sentCount > 0 || Object.keys(peers).length === 0 || (typeof socket !== 'undefined' && socket.connected)) {
        reportUserActivity(true);
        appendToChatLog('Me', emoji, true);
    }
};

window.broadcastChatMessage = async function (text) {
    if (!text.trim()) return;

    let sentCount = 0;
    const isEphemeral = document.getElementById('ephemeral-chat-checkbox') && document.getElementById('ephemeral-chat-checkbox').checked;

    const finalMsgId = 'msg-' + Math.random().toString(36).substring(2, 11) + '-' + Date.now();

    for (const id in peers) {
        const peer = peers[id];
        if (peer.dc && peer.dc.readyState === 'open' && peer.ecdhKey) {
            try {
                const payload = await encryptMeta({ type: 'chat', text, ephemeral: isEphemeral, msgId: finalMsgId }, peer.ecdhKey);
                peer.dc.send(JSON.stringify({ type: 'chat-envelope', payload }));
                sentCount++;
            } catch (err) {
                console.error('Failed to encrypt chat', err);
            }
        }
    }

    if (sentCount === 0 && typeof socket !== 'undefined' && socket.connected) {
        socket.emit('chat-message', { text, ephemeral: isEphemeral, msgId: finalMsgId });
    }

    reportUserActivity(true);
    appendToChatLog('Me', text, false, isEphemeral, finalMsgId);
    if (document.getElementById('ephemeral-chat-checkbox')) {
        document.getElementById('ephemeral-chat-checkbox').checked = false;
    }
};

let hasAutoJoined = false;
function triggerAutoJoin() {
    if (hasAutoJoined) return;
    hasAutoJoined = true;

    const urlParams = new URL(window.location.href).searchParams;
    let autoWorkspaceId = urlParams.get('workspace');
    let autoGuard = urlParams.get('guard');
    const hasSavedWorkspace = !!localStorage.getItem('ys_workspace');
    const savedWorkspaceId = localStorage.getItem('ys_workspace');

    if (autoWorkspaceId) {
        let isCreatorFlag = false;
        window._pendingIsCreator = isCreatorFlag;

        if (!isCreatorFlag && window.uiShared && window.uiShared.CustomDialog) {
            window.uiShared.CustomDialog.confirm(
                'Spectator Mode Option',
                'Would you like to join this workspace as a Spectator? (Read-only mode: receive files but cannot send)'
            ).then((chosenSpectator) => {
                window.isSpectator = !!chosenSpectator;
                joinRoom(autoWorkspaceId, autoGuard, false);
            });
        } else {
            window.isSpectator = false;
            joinRoom(autoWorkspaceId, autoGuard, false);
        }
    }
}

if (socket.connected) {
    triggerAutoJoin();
} else {
    socket.once('connect', triggerAutoJoin);
}

socket.on('global-stats-updated', (stats) => {
    const gb = (stats.bytesTransferred / (1024 * 1024 * 1024)).toFixed(3);
    const count = stats.filesTransferred;

    if (typeof ui !== 'undefined' && document) {
        const globalBytesEl = document.getElementById('global-bytes');
        const globalCountEl = document.getElementById('global-count');

        if (globalBytesEl) globalBytesEl.textContent = `${gb} GB`;
        if (globalCountEl) globalCountEl.textContent = count;
    }
});

setInterval(() => {
    if (!roomId || roomId.startsWith('AIR-')) return;
    const scheduleConfig = JSON.parse(localStorage.getItem('ys_rooms_schedule') || '{}');
    const normalizedRoom = roomId.toUpperCase();
    const config = scheduleConfig[normalizedRoom] || scheduleConfig[roomId];
    if (!config || !config.open || !config.close || config.open === config.close) return;
    const { open, close } = config;
    if (typeof isCurrentTimeInSchedule === 'function' && !isCurrentTimeInSchedule(open, close)) {
        showToast('Workspace Closed', `Today's session (${open} – ${close}) has ended. The workspace will reopen tomorrow.`, 'info');
        if (typeof window.forceLeave === 'function') {
            animateVanishAndClear(true).then(() => window.forceLeave('schedule-expired'));
        }
    }
}, 30000);

window.addEventListener('leave-p2p-room', (e) => {
    const targetRoomId = e.detail && e.detail.roomId;
    if (!targetRoomId) return;

    const cleanTarget = targetRoomId.toString().trim().toUpperCase();
    const cleanRoom = (typeof roomId !== 'undefined' && roomId) ? roomId.toString().trim().toUpperCase() : '';
    const cleanSig = (typeof signalingId !== 'undefined' && signalingId) ? signalingId.toString().trim().toUpperCase() : '';

    if ((cleanRoom && (cleanTarget === cleanRoom || cleanRoom.includes(cleanTarget) || cleanTarget.includes(cleanRoom))) ||
        (cleanSig && (cleanTarget === cleanSig || cleanSig.includes(cleanTarget) || cleanTarget.includes(cleanSig)))) {
        if (typeof window.forceLeave === 'function') {
            window.forceLeave(true);
        }
    }
});

let inactivityGraceInterval = null;
function hideInactivityWarning() {
    if (ui.panels.inactivityModal) ui.panels.inactivityModal.style.display = 'none';
    if (inactivityGraceInterval) {
        clearInterval(inactivityGraceInterval);
        inactivityGraceInterval = null;
    }
}

function showInactivityWarning(graceMs) {
    hideInactivityWarning();
    if (typeof playProceduralSound === 'function') playProceduralSound('chime');
    if (ui.panels.inactivityModal) ui.panels.inactivityModal.style.display = 'flex';

    let secondsLeft = Math.max(0, Math.ceil(graceMs / 1000));
    const totalGrace = Math.max(1, secondsLeft);
    const countdownEl = document.getElementById('inactivity-countdown-text');
    const timerEl = document.getElementById('p2p-expiry-timer');
    const timerTextEl = document.getElementById('p2p-expiry-text');
    const svgRing = document.getElementById('inactivity-svg-ring');

    const renderCountdown = () => {
        const m = Math.floor(secondsLeft / 60);
        const s = Math.floor(secondsLeft % 60);
        const timeStr = m > 0
            ? `Inactive: ${m}m ${s.toString().padStart(2, '0')}s`
            : `Inactive: ${Math.max(0, secondsLeft)}s`;

        if (countdownEl) {
            if (m > 0) {
                countdownEl.textContent = `${m}m ${s.toString().padStart(2, '0')}s`;
                countdownEl.style.fontSize = '1.1rem';
            } else {
                countdownEl.textContent = Math.max(0, secondsLeft);
                countdownEl.style.fontSize = '1.5rem';
            }
        }
        if (timerEl) timerEl.style.display = 'inline-flex';
        if (timerTextEl) timerTextEl.textContent = timeStr;
        if (svgRing) {
            const pct = Math.max(0, (secondsLeft / totalGrace) * 100);
            svgRing.setAttribute('stroke-dasharray', `${pct}, 100`);
        }
    };

    renderCountdown();
    inactivityGraceInterval = setInterval(() => {
        secondsLeft--;
        renderCountdown();

        if (secondsLeft <= 0) {
            clearInterval(inactivityGraceInterval);
            inactivityGraceInterval = null;
            forceLeave('inactivity');
        }
    }, 1000);

    const backBtn = document.getElementById('inactivity-back-btn') || document.getElementById('inactivity-confirm-btn');
    if (backBtn) {
        backBtn.onclick = () => {
            bumpLocalInactivityDeadline();
            socket.emit('reset-inactivity');
            hideInactivityWarning();
            showToast('Welcome Back', 'Security timer has been reset.', 'success');
        };
    }
}

const activeTypers = new Set();
let typingDisplayTimeout = null;

function setPeerTyping(name, isTyping) {
    const indicator = document.getElementById('chat-typing-indicator');
    if (!indicator) return;
    if (isTyping) {
        activeTypers.add(name);
    } else {
        activeTypers.delete(name);
    }
    if (activeTypers.size > 0) {
        const namesArray = Array.from(activeTypers);
        let text = '';
        if (namesArray.length === 1) {
            text = `<strong>${namesArray[0]}</strong> is typing`;
        } else if (namesArray.length === 2) {
            text = `<strong>${namesArray[0]}</strong> and <strong>${namesArray[1]}</strong> are typing`;
        } else {
            text = `<strong>Several people</strong> are typing`;
        }
        indicator.innerHTML = `
            <div class="typing-bubble">
                <span class="typing-dot"></span>
                <span class="typing-dot"></span>
                <span class="typing-dot"></span>
            </div>
            <span class="typing-text">${text}...</span>
        `;
        indicator.style.display = 'flex';
        clearTimeout(typingDisplayTimeout);
        typingDisplayTimeout = setTimeout(() => {
            activeTypers.clear();
            indicator.style.display = 'none';
        }, 5000);
    } else {
        clearTimeout(typingDisplayTimeout);
        indicator.style.display = 'none';
    }
}
window.setPeerTyping = setPeerTyping;

socket.on('typing-start', (peerId, peerName) => {
    setPeerTyping(peerName || 'Someone', true);
});

socket.on('typing-stop', (peerId, peerName) => {
    setPeerTyping(peerName || 'Someone', false);
});

let lastActivityReport = 0;
const REPORT_THROTTLE = 30000;
function reportUserActivity(force = false) {
    const now = Date.now();
    if (force) {
        bumpLocalInactivityDeadline();
    }
    if (force || now - lastActivityReport > REPORT_THROTTLE) {
        lastActivityReport = now;
        if (typeof socket !== 'undefined' && socket.connected) {
            socket.emit('reset-inactivity');
        }
    }
}
window.reportUserActivity = reportUserActivity;

['mousedown', 'keydown', 'scroll', 'touchstart'].forEach(type => {
    window.addEventListener(type, () => {
        reportUserActivity();
        if (!audioContextEnabled) {
            audioContextEnabled = true;
            const nudge = document.getElementById('sound-nudge');
            if (nudge) nudge.style.display = 'none';
        }
    }, { passive: true });
});

document.addEventListener('DOMContentLoaded', () => {
    const attemptRestorePersistedTransfers = async (attempt = 0) => {
        const restored = await restorePersistedP2PTransfers();
        const hasPersistedState = Object.keys(loadP2PResumeState()).length > 0 || Object.keys(backfillSendResumeStateFromActivity()).length > 0;
        const hasVisibleTransfers = !!document.getElementById('transfers-container')?.children.length;
        if (hasPersistedState && !hasVisibleTransfers && attempt < 20) {
            setTimeout(() => { attemptRestorePersistedTransfers(attempt + 1); }, 300);
        }
    };

    setTimeout(() => {
        attemptRestorePersistedTransfers();
    }, 150);

    const zipCheck = document.getElementById('zip-bundle-checkbox');
    const zipArea = document.getElementById('zip-name-area');
    if (zipCheck && zipArea) {
        zipCheck.onchange = () => {
            zipArea.style.display = zipCheck.checked ? 'block' : 'none';
        };
    }

    setTimeout(() => {
        if (!audioContextEnabled) {
            const nudge = document.getElementById('sound-nudge');
            if (nudge) {
                nudge.style.display = 'flex';
                nudge.onclick = () => {
                    audioContextEnabled = true;
                    nudge.style.display = 'none';
                    if (typeof playProceduralSound === 'function') playProceduralSound('chime');
                };
            }
        }
    }, 2000);
});

window.restoreHostedTransferUI = async function (token, state) {
    const activeToken = token || localStorage.getItem('emit-active-hosted-token');
    const activeState = state || localStorage.getItem('emit-active-hosted-state');

    if (activeToken && activeState === 'finished') {
        const url = localStorage.getItem('emit-active-hosted-url');
        if (url) {
            const modal = document.getElementById('drop-modal');
            const dropForm = document.getElementById('drop-modal-form');
            const progressSection = document.getElementById('drop-modal-progress');
            const resultSection = document.getElementById('drop-modal-result');
            if (modal) modal.style.display = 'flex';
            if (modal) modal.classList.add('drop-modal--in-result');
            if (dropForm) dropForm.style.display = 'none';
            if (progressSection) progressSection.style.display = 'none';
            if (resultSection) {
                resultSection.style.display = 'block';
                const resultUrl = document.getElementById('drop-result-url');
                if (resultUrl) resultUrl.value = url;
                const copyBtn = document.getElementById('drop-copy-btn') || document.getElementById('copy-drop-btn');
                if (copyBtn) copyBtn.onclick = () => window.copyToClipboard(url).then(() => showToast('Copied', 'URL Copied', 'success'));
                const waitBtn = document.getElementById('drop-modal-wait') || document.getElementById('hosted-wait-btn');
                if (waitBtn) {
                    waitBtn.textContent = 'Close';
                    waitBtn.disabled = false;
                    waitBtn.onclick = () => {
                        if (modal) modal.style.display = 'none';
                        localStorage.removeItem('emit-active-hosted-token');
                        localStorage.removeItem('emit-active-hosted-state');
                        localStorage.removeItem('emit-active-hosted-url');
                    };
                }
            }
        }
    } else if (activeToken && activeState === 'active' && state === 'active') {
        const modal = document.getElementById('drop-modal');
        const dropForm = document.getElementById('drop-modal-form');
        const progressSection = document.getElementById('drop-modal-progress');
        const resultSection = document.getElementById('drop-modal-result');
        if (modal) modal.style.display = 'flex';
        if (dropForm) dropForm.style.display = 'none';
        if (resultSection) resultSection.style.display = 'none';

        if (progressSection) {
            progressSection.style.display = 'block';
            const filenames = JSON.parse(localStorage.getItem('emit-active-hosted-filenames') || '[]');
            const fileListHtml = filenames.length > 0 ? filenames.map(f => `
                <div class="resume-file-item">
                    <i class="fa-solid fa-file-arrow-up"></i>
                    <span>${f}</span>
                </div>
            `).join('') : '<div style="color:var(--text-muted);font-size:0.85rem;">No file info cached.</div>';

            const resumeInnerHTML = `
                <div style="text-align:center;padding:1.5rem 1rem;">
                    <div style="margin-bottom:0.8rem;font-weight:700;font-size:1.1rem;color:var(--text-pure);">Resume Interrupted Upload</div>
                    <div style="background:rgba(255,255,255,0.05);padding:1.2rem;border-radius:12px;margin-bottom:1.2rem;text-align:left;max-height:160px;overflow-y:auto;">
                        ${fileListHtml}
                    </div>
                    <button id="resume-action-btn" class="btn-pill btn-primary" style="width:100%;padding:0.8rem;font-weight:600;margin-bottom:0.8rem;">Resume Upload</button>
                    <div id="resume-error-msg" style="display:none;color:var(--accent-danger);font-size:0.82rem;margin-top:0.5rem;"></div>
                </div>
            `;

            const progressLabel = document.getElementById('drop-progress-label');
            if (progressLabel) {
                progressLabel.innerHTML = resumeInnerHTML;
            } else {
                progressSection.innerHTML = resumeInnerHTML;
            }

            const resumeBtn = document.getElementById('resume-action-btn');
            const errorMsg = document.getElementById('resume-error-msg');
            if (resumeBtn) {
                resumeBtn.onclick = async () => {
                    resumeBtn.disabled = true;
                    resumeBtn.textContent = 'Resuming...';
                    if (errorMsg) errorMsg.style.display = 'none';
                    try {
                        const cachedBlob = await window.getCachedHostedFile(activeToken);
                        if (cachedBlob) {
                            const filenames = JSON.parse(localStorage.getItem('emit-active-hosted-filenames') || '[]');
                            const fileName = filenames[0] || 'cached_file';
                            const fileToResume = cachedBlob instanceof File ? cachedBlob : new File([cachedBlob], fileName, { type: cachedBlob.type || 'application/octet-stream' });
                            window.resumeHostedDrop([fileToResume], activeToken);
                        } else {
                            if (errorMsg) { errorMsg.textContent = 'Resume failed: cached file not found.'; errorMsg.style.display = 'block'; }
                            resumeBtn.disabled = false;
                            resumeBtn.textContent = 'Resume Upload';
                        }
                    } catch (e) {
                        if (errorMsg) { errorMsg.textContent = 'Resume failed: error accessing cached upload.'; errorMsg.style.display = 'block'; }
                        resumeBtn.disabled = false;
                        resumeBtn.textContent = 'Resume Upload';
                    }
                };
            }
            const waitBtn = document.getElementById('drop-modal-wait') || document.getElementById('hosted-wait-btn');
            if (waitBtn) {
                waitBtn.textContent = 'Cancel';
                waitBtn.disabled = false;
                waitBtn.onclick = () => {
                    if (modal) modal.style.display = 'none';
                    localStorage.removeItem('emit-active-hosted-token');
                    localStorage.removeItem('emit-active-hosted-state');
                };
            }
        }
    }
};

const DB_NAME = 'EmitHostedCacheV2';
const STORE_NAME = 'files';
const P2P_SEND_CACHE_STORE = 'p2p-send-files';

async function getDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME);
        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME);
            }
            if (!db.objectStoreNames.contains(P2P_SEND_CACHE_STORE)) {
                db.createObjectStore(P2P_SEND_CACHE_STORE);
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

async function ensureDBStore(storeName) {
    const db = await getDB();
    if (db.objectStoreNames.contains(storeName)) {
        return db;
    }
    const nextVersion = db.version + 1;
    db.close();
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, nextVersion);
        request.onupgradeneeded = () => {
            const upgradeDb = request.result;
            if (!upgradeDb.objectStoreNames.contains(STORE_NAME)) {
                upgradeDb.createObjectStore(STORE_NAME);
            }
            if (!upgradeDb.objectStoreNames.contains(P2P_SEND_CACHE_STORE)) {
                upgradeDb.createObjectStore(P2P_SEND_CACHE_STORE);
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

async function cacheP2PSendFile(fileId, file) {
    if (!fileId || !file) return;
    const db = await ensureDBStore(P2P_SEND_CACHE_STORE);
    const tx = db.transaction(P2P_SEND_CACHE_STORE, 'readwrite');
    tx.objectStore(P2P_SEND_CACHE_STORE).put(file, fileId);
    return new Promise((resolve, reject) => {
        tx.oncomplete = () => {
            db.close();
            resolve();
        };
        tx.onerror = () => {
            db.close();
            reject(tx.error);
        };
    });
}

async function getCachedP2PSendFile(fileId) {
    if (!fileId) return null;
    const db = await ensureDBStore(P2P_SEND_CACHE_STORE);
    const tx = db.transaction(P2P_SEND_CACHE_STORE, 'readonly');
    const request = tx.objectStore(P2P_SEND_CACHE_STORE).get(fileId);
    return new Promise((resolve, reject) => {
        request.onsuccess = () => {
            const result = request.result || null;
            db.close();
            resolve(result);
        };
        request.onerror = () => {
            db.close();
            reject(request.error);
        };
    });
}

async function clearCachedP2PSendFile(fileId) {
    if (!fileId) return;
    const db = await ensureDBStore(P2P_SEND_CACHE_STORE);
    const tx = db.transaction(P2P_SEND_CACHE_STORE, 'readwrite');
    tx.objectStore(P2P_SEND_CACHE_STORE).delete(fileId);
    return new Promise((resolve, reject) => {
        tx.oncomplete = () => {
            db.close();
            resolve();
        };
        tx.onerror = () => {
            db.close();
            reject(tx.error);
        };
    });
}

window.cacheHostedFile = async (token, blob) => {
    const db = await getDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(blob, token);
    return new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
};

window.getCachedHostedFile = async (token) => {
    const db = await getDB();
    const tx = db.transaction(STORE_NAME, 'readonly');
    const request = tx.objectStore(STORE_NAME).get(token);
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
};

window.addEventListener('cancel-transfer', (e) => {
    const { fileId } = e.detail;
    let removed = false;
    clearPersistedP2PSendState(fileId);
    const queueIdx = p2pTransferQueue.findIndex(item => item.pendingId === fileId || item.fileId === fileId || (item.file && item.file._emitId === fileId));
    if (queueIdx !== -1) {
        p2pTransferQueue.splice(queueIdx, 1);
        const item = document.getElementById(`item-${fileId}`);
        if (item) item.remove();
        removed = true;
    }
    if (activeSends[fileId]) {
        activeSends[fileId].aborted = true;
        delete activeSends[fileId];
        clearPersistedTransferArtifacts(fileId);
        const item = document.getElementById(`item-${fileId}`);
        if (item) item.remove();
        removed = true;
        for (const id in peers) {
            const peer = peers[id];
            if (peer.dc && peer.dc.readyState === 'open') {
                peer.dc.send(JSON.stringify({ type: 'cancel-transfer', fileId }));
            }
        }
    }
    if (activeReceives[fileId]) {
        clearPersistedTransferArtifacts(fileId);
        if (directStreamHandles[fileId]) {
            try { if (directStreamHandles[fileId].writable) directStreamHandles[fileId].writable.abort(); } catch (e) { }
            delete directStreamHandles[fileId];
        }
        delete activeReceives[fileId];
        delete receiveBuffer[fileId];
        delete receivedChunks[fileId];
        const item = document.getElementById(`item-${fileId}`);
        if (item) item.remove();
        removed = true;
        for (const id in peers) {
            const peer = peers[id];
            if (peer.dc && peer.dc.readyState === 'open') {
                peer.dc.send(JSON.stringify({ type: 'cancel-transfer', fileId }));
            }
        }
    }
    if (!removed) {
        clearPersistedTransferArtifacts(fileId);
        const item = document.getElementById(`item-${fileId}`);
        if (item) item.remove();
    }
});

window.registerSocketListeners = function (socket, tabId) {
    socket.on('room-locked', () => {
        showToast('Workspace Full', 'This secure workspace has reached its participant limit (5).', 'error');
        window.closeTab(tabId);
    });
    socket.on('room-not-found', () => {
        showToast('Vault Not Found', 'Invalid code or the creator has not joined yet.', 'error');
        window.closeTab(tabId);
    });
    socket.on('room-expired', () => {
        showToast('Workspace Expired', 'This workspace was destroyed automatically.', 'warning');
        window.closeTab(tabId);
    });
    socket.on('secret-mismatch', () => {
        showToast('Incorrect Secret', 'The secret word for this workspace is incorrect. Please try again.', 'error');
        window.closeTab(tabId);
    });
    socket.on('chat-history', (history) => {
        history.forEach(msg => {
            if (msg.text == null || msg.text === '') return;
            window.appendToChatLog(msg.senderName || 'Peer', msg.text, false);
        });
    });
    socket.on('destruction-requested', (requesterName, reqPersistentId) => {
        if (window.activeTabId === tabId) {
            const modal = document.getElementById('destruction-request-modal');
            const nameSpan = document.getElementById('destruction-requester-name');
            if (modal) {
                if (nameSpan) nameSpan.textContent = requesterName;
                modal.style.display = 'flex';
                const rejectBtn = document.getElementById('destruction-reject-btn');
                const acceptBtn = document.getElementById('destruction-accept-btn');
                if (rejectBtn) rejectBtn.onclick = () => {
                    socket.emit('peer-destroy-reject');
                    modal.style.display = 'none';
                };
                if (acceptBtn) acceptBtn.onclick = () => {
                    modal.style.display = 'none';
                    socket.emit('peer-destroy-accept');
                };
            }
        }
    });
    socket.on('peer-destroyed-room', () => {
        if (typeof playProceduralSound === 'function') playProceduralSound('pop');
        showToast('Room Destroyed', 'The workspace has been permanently deleted.', 'warning');
        window.closeTab(tabId);
    });
    socket.on('chat-message', (msg) => {
        if (msg.senderId === socket.id) return;
        const peerName = msg.senderName || 'Peer';
        window.updateTabDOM(tabId, 'chat-log', (el) => {
            window.appendToChatLog(peerName, msg.text, false, !!msg.ephemeral, msg.msgId || null);
        });
        if (typeof playProceduralSound === 'function') playProceduralSound('pop');
    });
    socket.on('message-read', (msgId) => {
        const el = document.getElementById(msgId);
        if (el) el.remove();
    });
    socket.on('ecdh-public-key', async (theirPublicJwk, senderId) => {
        const state = window.tabStates[tabId];
        if (!state || !state.peers[senderId]) return;
        const sharedKey = await deriveSharedKey(theirPublicJwk, window._pendingPassphrase || '');
        state.peers[senderId].ecdhKey = sharedKey;
        state.peers[senderId].encryptReady = true;
        if (window.activeTabId === tabId) {
            const statusEl = document.getElementById(`peer-status-${senderId}`);
            if (statusEl) {
                statusEl.textContent = 'Encrypted';
                statusEl.classList.add('active-text');
            }
            showToast('Secured', `Private link with ${state.peers[senderId].name} ready.`, 'success');
        }
    });
    socket.on('peer-list', async (peerList) => {
        const state = window.tabStates[tabId];
        if (!state) return;
        const otherPeers = peerList.filter(p => p.id !== socket.id);
        const newPeers = {};
        otherPeers.forEach(p => {
            if (state.peers[p.id]) {
                newPeers[p.id] = state.peers[p.id];
            } else {
                newPeers[p.id] = { id: p.id, name: p.name, pc: null, dc: null, channel: null };
                initiateTabMeshOffer(tabId, p.id);
            }
        });
        state.peers = newPeers;
        if (window.activeTabId === tabId) {
            window.peers = newPeers;
            updatePeerListUI();
        }
    });
    socket.on('offer', async (offer, senderId, senderName) => {
        const state = window.tabStates[tabId];
        if (!state) return;
        if (!state.peers[senderId]) {
            state.peers[senderId] = { id: senderId, name: senderName, pc: null, dc: null, channel: null };
        }
        const pc = setupTabPeerConnection(tabId, senderId);
        state.peers[senderId].pc = pc;
        await pc.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.emit('answer', answer, state.signalingId, senderId);
    });
    socket.on('answer', async (answer, senderId) => {
        const state = window.tabStates[tabId];
        if (!state) return;
        const peer = state.peers[senderId];
        if (peer && peer.pc) {
            await peer.pc.setRemoteDescription(new RTCSessionDescription(answer));
        }
    });
    socket.on('ice-candidate', async (candidate, senderId) => {
        const state = window.tabStates[tabId];
        if (!state) return;
        const peer = state.peers[senderId];
        if (peer && peer.pc) {
            await peer.pc.addIceCandidate(new RTCIceCandidate(candidate));
        }
    });
    socket.on('chat-envelope', async (envelope, senderId) => {
        const state = window.tabStates[tabId];
        if (!state) return;
        const peer = state.peers[senderId];
        if (peer && peer.ecdhKey) {
            const plain = await decryptMeta(envelope, peer.ecdhKey);
            const peerName = peer.name || 'Peer';
            if (plain.type === 'chat') {
                window.updateTabDOM(tabId, 'chat-log', (el) => {
                    window.appendToChatLog(peerName, plain.text, false, !!plain.ephemeral, plain.msgId || null);
                });
                if (typeof playProceduralSound === 'function') playProceduralSound('pop');
            } else if (plain.type === 'typing') {
                if (window.activeTabId === tabId) {
                    const typingIndicator = document.getElementById('chat-typing-indicator');
                    if (typingIndicator) {
                        typingIndicator.textContent = `${peerName} is typing...`;
                        typingIndicator.style.display = plain.isTyping ? 'block' : 'none';
                    }
                }
            }
        }
    });
};

function initiateTabMeshOffer(tabId, targetId) {
    const state = window.tabStates[tabId];
    if (!state) return;
    const pc = setupTabPeerConnection(tabId, targetId);
    state.peers[targetId].pc = pc;
    const dc = pc.createDataChannel('fileTransfer');
    setupTabDataChannel(tabId, dc, targetId);
    state.peers[targetId].dc = dc;
    pc.createOffer().then(offer => {
        return pc.setLocalDescription(offer).then(() => {
            state.socket.emit('offer', offer, state.signalingId, targetId);
        });
    });
}

function setupTabPeerConnection(tabId, targetId) {
    const state = window.tabStates[tabId];
    const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
    pc.onicecandidate = (e) => {
        if (e.candidate && state.socket) {
            state.socket.emit('ice-candidate', e.candidate, state.signalingId, targetId);
        }
    };
    pc.ondatachannel = (e) => {
        setupTabDataChannel(tabId, e.channel, targetId);
    };
    return pc;
}

function setupTabDataChannel(tabId, dc, targetId) {
    const state = window.tabStates[tabId];
    dc.onopen = () => {
        state.peers[targetId].dc = dc;
        state.peers[targetId].channel = dc;
        if (window.myECDHKeyPair) {
            crypto.subtle.exportKey('jwk', window.myECDHKeyPair.publicKey).then(jwk => {
                state.socket.emit('ecdh-public-key', jwk, state.signalingId, targetId);
            });
        }
    };
    dc.onmessage = (e) => {

    };
}
