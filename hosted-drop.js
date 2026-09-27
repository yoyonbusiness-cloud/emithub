
const CHUNKED_DROP_MAX_BYTES = 50 * 1024 * 1024 * 1024;
const HOSTED_CHUNK_SIZE_BYTES = 128 * 1024 * 1024;
const AES_GCM_TAG_BYTES = 16;
const IV_PREFIX_BYTES = 4;
const MEMORY_SAFE_DOWNLOAD_MAX_BYTES = 500 * 1024 * 1024;

async function generateDropKey() {
    return await crypto.subtle.generateKey(
        { name: 'AES-GCM', length: 256 },
        true,
        ['encrypt', 'decrypt']
    );
}

async function exportDropKey(key) {
    const raw = await crypto.subtle.exportKey('raw', key);
    return btoa(String.fromCharCode(...new Uint8Array(raw)));
}

function uint8ToB64Url(u8) {
    return btoa(String.fromCharCode(...u8)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64UrlToUint8(str) {
    let b64 = str.replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    return Uint8Array.from(atob(b64), c => c.charCodeAt(0));
}

async function importDropKey(b64, usages = ['decrypt']) {
    let raw;
    if (typeof b64 === 'string') {
        let normalized = b64.replace(/-/g, '+').replace(/_/g, '/');
        while (normalized.length % 4) normalized += '=';
        raw = Uint8Array.from(atob(normalized), c => c.charCodeAt(0));
    } else {
        raw = b64;
    }
    return await crypto.subtle.importKey('raw', raw, { name: 'AES-GCM', length: 256 }, false, usages);
}

window.loadHostedResumeState = function (token) {
    if (!token) return null;
    try {
        const raw = localStorage.getItem(`emit-resume-${token}`);
        return raw ? JSON.parse(raw) : null;
    } catch {
        return null;
    }
};

function saveHostedResumeState(token, state) {
    if (!token) return;
    try {
        localStorage.setItem(`emit-resume-${token}`, JSON.stringify(state));
    } catch {
    }
}

function clearHostedResumeState(token) {
    if (!token) return;
    try {
        localStorage.removeItem(`emit-resume-${token}`);
    } catch {
    }
}

function buildHostedResumeState(token, keyB64, ivPrefix4, chunkCount, uploadedChunks, file) {
    return {
        token,
        keyB64,
        ivPrefix4: uint8ToB64(ivPrefix4),
        chunkCount,
        chunks: Array.from(uploadedChunks),
        fileName: file?.name || '',
        fileSize: file?.size || 0
    };
}

function uint8ToB64(u8) {
    return btoa(String.fromCharCode(...u8));
}

function b64ToUint8(b64) {
    return Uint8Array.from(atob(b64), c => c.charCodeAt(0));
}

function deriveChunkIv(ivPrefix4, chunkIndex) {




    const iv = new Uint8Array(12);
    iv.set(ivPrefix4, 0);
    const dv = new DataView(iv.buffer);
    dv.setUint32(8, chunkIndex >>> 0, false);
    return iv;
}

async function createHostedUploadSession(file, durationMs, requestedToken = null) {
    const fd = new FormData();
    fd.append('name', file.name);
    fd.append('size', file.size.toString());
    fd.append('expiry', durationMs.toString());
    if (requestedToken) fd.append('token', requestedToken);

    const res = await fetch('/upload-session', { method: 'POST', body: fd });
    if (!res.ok) throw new Error('Failed to create upload session: ' + (await res.text()));
    return await res.json();
}

async function uploadHostedChunk({ token, index, cipherBuf, onProgress }) {
    const fd = new FormData();
    fd.append('token', token);
    fd.append('index', index.toString());
    fd.append('chunk', new Blob([cipherBuf]), `chunk-${index}.enc`);

    await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', '/upload-chunk');
        xhr.upload.onprogress = (e) => {
            if (!onProgress) return;
            if (!e.lengthComputable) return;
            onProgress(e.loaded, e.total);
        };
        xhr.onload = () => {
            if (xhr.status === 200) resolve();
            else reject(new Error('Chunk upload failed: ' + xhr.statusText));
        };
        xhr.onerror = () => reject(new Error('Network error during chunk upload'));
        xhr.send(fd);
    });
}

async function finalizeHostedUploadSession(token, payload = null, isCollection = false, burnOnDownload = false, options = {}) {
    const fd = new FormData();
    fd.append('token', token);
    if (payload) fd.append('payload', JSON.stringify(payload));
    if (isCollection) fd.append('isCollection', 'true');
    if (burnOnDownload) fd.append('burnOnDownload', 'true');
    if (options.totalSize) fd.append('totalSize', options.totalSize.toString());
    if (options.displayName) fd.append('displayName', options.displayName);
    const res = await fetch('/upload-finalize', { method: 'POST', body: fd });
    if (!res.ok) throw new Error('Failed to finalize upload: ' + (await res.text()));
    return await res.json();
}

async function fetchHostedDropInfo(token) {
    const res = await fetch(`/drop-info/${token}`, { cache: 'no-store' });
    if (!res.ok) throw new Error('Failed to load finalized drop info');
    return await res.json();
}

async function hostedDrop(file, onProgress, durationMs = 60 * 60 * 1000, nickname = '', options = {}) {
    if (!file) throw new Error('Missing file');
    if (file.size > CHUNKED_DROP_MAX_BYTES) {
        throw new Error(`File too large for hosted drop (max 50 GB). Use P2P for larger files.`);
    }

    const requestedToken = options.token || null;
    const existingResume = requestedToken ? loadHostedResumeState(requestedToken) : null;
    const key = existingResume?.keyB64 ? await importDropKey(existingResume.keyB64, ['encrypt', 'decrypt']) : await generateDropKey();
    const keyB64 = existingResume?.keyB64 || await exportDropKey(key);

    if (window.auditLog) auditLog(`🔒 Hosted-drop chunk encryption for "${file.name}"`);

    const session = await createHostedUploadSession(file, durationMs, requestedToken);
    const token = session.token;
    const chunkSize = session.chunkSize || HOSTED_CHUNK_SIZE_BYTES;
    const chunkCount = session.chunkCount;

    if (existingResume) {
        if (existingResume.fileName !== file.name || existingResume.fileSize !== file.size) {
            throw new Error('Resume failed: File mismatch. Please select the original file.');
        }
        if (existingResume.chunkCount !== chunkCount) {
            throw new Error('Resume failed: Chunk count mismatch. Try re-uploading.');
        }
    }

    if (typeof ActivityTracker !== 'undefined' && !options.skipActivity) {
        ActivityTracker.addHostedLink(token, {
            name: options.isCollection ? (nickname || 'Shared Workspace') : file.name,
            nickname: nickname,
            size: options.totalSize || file.size,
            durationMs,
            expiresAt: null,
            status: 'preparing',
            isCollection: options.isCollection
        });
    }

    const ivPrefix4 = existingResume?.ivPrefix4 ? b64ToUint8(existingResume.ivPrefix4) : crypto.getRandomValues(new Uint8Array(IV_PREFIX_BYTES));
    const payload = [1, keyB64, uint8ToB64(ivPrefix4), chunkSize, chunkCount];

    let completedChunks = 0;
    let uploadedChunks = new Set();
    let isResuming = false;

    const savedResume = loadHostedResumeState(token);
    if (savedResume && savedResume.chunkCount === chunkCount) {
        uploadedChunks = new Set(savedResume.chunks || []);
        completedChunks = uploadedChunks.size;
        isResuming = true;
    }

    if (session.partsReceived && Array.from(session.partsReceived).length > 0) {
        session.partsReceived.forEach(idx => uploadedChunks.add(idx));
        completedChunks = uploadedChunks.size;
        isResuming = true;
    }

    saveHostedResumeState(token, buildHostedResumeState(token, keyB64, ivPrefix4, chunkCount, uploadedChunks, file));

    if (isResuming) {
        if (typeof ActivityTracker !== 'undefined') ActivityTracker.setHostedLinkResuming(token, true);
        onProgress?.('resuming', (completedChunks / chunkCount) * 100, { chunkCount });
        if (window.auditLog) auditLog(`♻️ Resuming upload: ${completedChunks}/${chunkCount} chunks ready.`);
    }

    const MAX_CHUNKS_TOTAL = 64;
    const MAX_RETRIES = 5;
    if (!window._hostedActiveChunks) window._hostedActiveChunks = 0;

    let activeChunkProgress = {};
    let chunkRetries = {};
    const notifyGranularProgress = () => {
        let uploadedBytes = 0;
        uploadedChunks.forEach(idx => {
            const start = idx * chunkSize;
            const end = Math.min(start + chunkSize, file.size);
            uploadedBytes += (end - start);
        });
        for (const idx in activeChunkProgress) {
            uploadedBytes += activeChunkProgress[idx];
        }
        const totalPct = Math.min(100, (uploadedBytes / file.size) * 100);
        if (typeof ActivityTracker !== 'undefined') ActivityTracker.updateHostedLinkProgress(token, totalPct);
        onProgress?.('uploading', totalPct, { uploadedBytes, totalSize: file.size });
    };
    const uploadQueue = [];
    for (let i = 0; i < chunkCount; i++) {
        if (!uploadedChunks.has(i)) uploadQueue.push(i);
    }

    if (uploadQueue.length > 0) {
        const startupPct = completedChunks > 0 ? Math.max(1, (completedChunks / chunkCount) * 100) : 1;
        if (typeof ActivityTracker !== 'undefined') ActivityTracker.updateHostedLinkProgress(token, startupPct);
        onProgress?.('uploading', startupPct, { uploadedBytes: 0, totalSize: file.size });
    }

    async function processQueue() {
        while (uploadQueue.length > 0) {
            if (window._hostedActiveChunks >= MAX_CHUNKS_TOTAL) {
                await new Promise(r => setTimeout(r, 100));
                continue;
            }

            const i = uploadQueue.shift();
            window._hostedActiveChunks++;

            const start = i * chunkSize;
            const end = Math.min(start + chunkSize, file.size);
            const chunkBlob = file.slice(start, end);
            const iv = deriveChunkIv(ivPrefix4, i);

            (async () => {
                try {
                    const plainBuf = await chunkBlob.arrayBuffer();
                    const cipherBuf = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plainBuf);
                    await uploadHostedChunk({
                        token,
                        index: i,
                        cipherBuf,
                        onProgress: (loaded) => {
                            activeChunkProgress[i] = loaded;
                            notifyGranularProgress();
                        }
                    });

                    delete activeChunkProgress[i];
                    uploadedChunks.add(i);
                    saveHostedResumeState(token, buildHostedResumeState(token, keyB64, ivPrefix4, chunkCount, uploadedChunks, file));
                    completedChunks++;
                    notifyGranularProgress();
                    chunkRetries[i] = 0;
                } catch (err) {
                    chunkRetries[i] = (chunkRetries[i] || 0) + 1;
                    console.error('Chunk upload failed', err);
                    delete activeChunkProgress[i];
                    if (chunkRetries[i] < MAX_RETRIES) {
                        uploadQueue.push(i); // Retry
                    } else {
                        showToast && showToast('Resume Failed', `Chunk ${i + 1} failed after ${MAX_RETRIES} retries.`, 'error');
                        throw new Error(`Resume failed: Chunk ${i + 1} upload failed.`);
                    }
                } finally {
                    window._hostedActiveChunks--;
                    processQueue();
                }
            })();
        }
    }

    await processQueue();
    while (completedChunks < chunkCount) {
        await new Promise(r => setTimeout(r, 200));
    }

    clearHostedResumeState(token);
    if (typeof ActivityTracker !== 'undefined') ActivityTracker.setHostedLinkResuming(token, false);
    const finalizeResult = await finalizeHostedUploadSession(token, payload, !!options.isCollection, !!options.burnOnDownload, {
        totalSize: options.totalSize,
        displayName: options.displayName || nickname
    });
    const finalizedInfo = (finalizeResult && finalizeResult.expires)
        ? finalizeResult
        : await fetchHostedDropInfo(token);

    if (window.auditLog) auditLog(`✅ Chunked drop stored. Token: ${token}`);

    const rawKey = await crypto.subtle.exportKey('raw', key);
    const packedKeyBytes = new Uint8Array(rawKey.byteLength + ivPrefix4.byteLength);
    packedKeyBytes.set(new Uint8Array(rawKey), 0);
    packedKeyBytes.set(ivPrefix4, rawKey.byteLength);
    const compactKey = uint8ToB64Url(packedKeyBytes);

    const url = `${window.location.origin}/h/${token}#${compactKey}`;
    if (typeof ActivityTracker !== 'undefined') {
        ActivityTracker.updateHostedLinkUrl(token, url, finalizedInfo?.expires || null);
    }
    if (typeof recordStreakActivity === 'function') recordStreakActivity();
    return { url, token, keyB64, expires: finalizedInfo?.expires || null };
}

function triggerDustExplosion(element, particleCount = 40) {
    if (!element) return;
    element.classList.add('vanish-sand');
    const rect = element.getBoundingClientRect();
    for (let i = 0; i < particleCount; i++) {
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
}

function triggerFullPageExplosion() {
    if (typeof playProceduralSound === 'function') playProceduralSound('chime');
    const children = Array.from(document.body.children).filter(el => {
        const tag = el.tagName.toLowerCase();
        return tag !== 'script' && tag !== 'style';
    });

    children.forEach(child => {
        triggerDustExplosion(child, 60);
    });
}

async function receiveHostedDrop() {
    const params = new URLSearchParams(window.location.search);
    let token = params.get('t');
    if (!token) {
        const match = window.location.pathname.match(/^\/h\/([a-zA-Z0-9_-]+)/);
        if (match) token = match[1];
    }
    const hash = window.location.hash || '';
    if (!token) return false;

    let meta;
    try {
        const r = await fetch(`/drop-info/${token}`);
        if (!r.ok) throw new Error('expired');
        meta = await r.json();
    } catch {
        if (typeof window.showDropDeletedState === 'function') {
            window.showDropDeletedState();
        } else {
            if (typeof triggerFullPageExplosion === 'function') triggerFullPageExplosion();
            setTimeout(() => {
                window.location.href = '/';
            }, 1200);
        }
        return true;
    }

    let fragPayload = null;
    let keyB64 = null;
    let ivB64 = null;

    if (hash.startsWith('#key=')) {
        try { fragPayload = JSON.parse(decodeURIComponent(hash.slice(5))); } catch { fragPayload = null; }
    } else if (hash.startsWith('#k=')) {
        const rawHashKey = hash.slice(3);
        try {
            const packed = b64UrlToUint8(rawHashKey);
            if (packed.length >= 36) {
                keyB64 = uint8ToB64(packed.slice(0, 32));
                ivB64 = uint8ToB64(packed.slice(32, 36));
                fragPayload = [1, keyB64, ivB64];
            } else {
                keyB64 = uint8ToB64(packed.slice(0, 32));
            }
        } catch { }
    } else if (hash.length > 1) {
        const rawHashKey = hash.slice(1);
        try {
            const packed = b64UrlToUint8(rawHashKey);
            if (packed.length >= 36) {
                keyB64 = uint8ToB64(packed.slice(0, 32));
                ivB64 = uint8ToB64(packed.slice(32, 36));
                fragPayload = [1, keyB64, ivB64];
            } else if (packed.length === 32) {
                keyB64 = uint8ToB64(packed);
            }
        } catch { }
    }

    if (!fragPayload && meta.payload) {
        try { fragPayload = typeof meta.payload === 'string' ? JSON.parse(meta.payload) : meta.payload; } catch { fragPayload = meta.payload; }
    }

    const isChunked = !!(meta.mode === 'chunked' || (fragPayload && (
        (fragPayload.v === 1 && fragPayload.k && fragPayload.iv) ||
        (Array.isArray(fragPayload) && fragPayload[0] === 1)
    )));

    if (!keyB64) {
        const rawFrag = hash.startsWith('#key=') ? decodeURIComponent(hash.slice(5)) : '';
        keyB64 = isChunked ? (Array.isArray(fragPayload) ? fragPayload[1] : (fragPayload ? fragPayload.k : rawFrag)) : rawFrag;
    }
    if (!ivB64 && fragPayload) {
        ivB64 = Array.isArray(fragPayload) ? fragPayload[2] : fragPayload.iv;
    }

    const statusEl = document.getElementById('drop-status');
    const downloadBtn = document.getElementById('drop-download-btn');
    const filenameEl = document.getElementById('drop-filename');
    const sizeEl = document.getElementById('drop-size');
    const expiryTimerEl = document.getElementById('expiry-timer');
    const expiryTextEl = document.getElementById('expiry-text');
    const directionEl = document.getElementById('drop-direction-indicator');
    const statusTextEl = document.getElementById('drop-status-text');

    const mainIconEl = document.getElementById('drop-main-icon');

    const applyMeta = (nextMeta) => {
        meta = nextMeta;
        const isCol = !!(meta.isCollection || (meta.filename && meta.filename.endsWith('.json')));
        if (isCol && mainIconEl) {
            mainIconEl.innerHTML = '<i class="fa-solid fa-layer-group"></i>';
        }
        if (filenameEl) {
            if (isCol) {
                if (meta.displayName) {
                    filenameEl.textContent = meta.displayName;
                } else if (meta.filename) {
                    const cleanName = meta.filename.replace(/\.json$/i, '');
                    filenameEl.textContent = (cleanName === 'collection' || cleanName === 'workspace') ? 'Shared Workspace' : cleanName;
                } else {
                    filenameEl.textContent = 'Shared Workspace';
                }
            } else {
                filenameEl.textContent = meta.filename;
            }
        }
        if (sizeEl) {
            if (isCol && meta.totalSize) {
                sizeEl.textContent = typeof uiShared !== 'undefined' && uiShared.formatBytes ? uiShared.formatBytes(meta.totalSize) : `${(meta.totalSize / 1e6).toFixed(2)} MB`;
            } else if (isCol) {
                sizeEl.textContent = 'Workspace Collection';
            } else {
                sizeEl.textContent = typeof uiShared !== 'undefined' && uiShared.formatBytes ? uiShared.formatBytes(meta.size) : `${(meta.size / 1e6).toFixed(2)} MB`;
            }
        }
        if (directionEl && statusTextEl) {
            let iconClass = '';
            let label = '';
            if (meta.status === 'uploading') {
                iconClass = 'hosted-direction-icon';
                directionEl.style.backgroundImage = 'var(--hosted-indicator-upload)';
                label = 'Uploading…';
            } else if (meta.status === 'downloadable' || meta.status === 'ready') {
                iconClass = 'hosted-direction-icon';
                directionEl.style.backgroundImage = 'var(--hosted-indicator-download)';
                label = 'Ready to Download';
            } else if (meta.status === 'downloading') {
                iconClass = 'hosted-direction-icon';
                directionEl.style.backgroundImage = 'var(--hosted-indicator-download)';
                label = 'Downloading…';
            } else {
                iconClass = 'hosted-direction-icon';
                directionEl.style.backgroundImage = 'var(--hosted-indicator-download)';
                label = 'Waiting…';
            }
            directionEl.className = iconClass;
            statusTextEl.textContent = label;
        } else if (statusEl) {
            statusEl.textContent = meta.status === 'uploading'
                ? 'Preparing secure download…'
                : 'Decryption happens in your browser.';
        }
    };

    applyMeta(meta);

    let timerHandle = null;
    let pollHandle = null;
    let dropClosed = false;

    const closeDropPage = () => {
        if (dropClosed) return;
        dropClosed = true;
        if (timerHandle) clearTimeout(timerHandle);
        if (pollHandle) clearTimeout(pollHandle);
        if (typeof window.showDropDeletedState === 'function') {
            window.showDropDeletedState();
        } else {
            window.location.replace('/');
        }
    };

    const pollDropInfo = async () => {
        if (dropClosed) return;
        try {
            const r = await fetch(`/drop-info/${token}`, { cache: 'no-store' });
            if (!r.ok) {
                closeDropPage();
                return;
            }
            const nextMeta = await r.json();
            applyMeta(nextMeta);
        } catch {
            closeDropPage();
            return;
        }
        pollHandle = setTimeout(pollDropInfo, 1000);
    };


    function updateTimer() {
        if (dropClosed) return;
        if (!meta.expires) {
            if (expiryTextEl) expiryTextEl.textContent = 'Preparing secure download…';
            if (expiryTimerEl) expiryTimerEl.style.display = 'inline-flex';
            timerHandle = setTimeout(updateTimer, 1000);
            return;
        }

        const diff = meta.expires - Date.now();
        if (diff <= 0) {
            if (expiryTextEl) expiryTextEl.textContent = 'Expired';
            closeDropPage();
            return;
        }

        if (window.uiShared && typeof window.uiShared.formatExpiryCountdown === 'function') {
            expiryTextEl.textContent = 'Expires in ' + window.uiShared.formatExpiryCountdown(diff);
        } else {
            const totalSeconds = Math.max(0, Math.ceil(diff / 1000));
            const h = Math.floor(totalSeconds / 3600);
            const m = Math.floor((totalSeconds % 3600) / 60);
            const s = totalSeconds % 60;
            if (h > 0) {
                if (m > 0) {
                    expiryTextEl.textContent = `Expires in ${h} hr${h > 1 ? 's' : ''} ${m} min${m > 1 ? 's' : ''}`;
                } else {
                    expiryTextEl.textContent = `Expires in ${h} hr${h > 1 ? 's' : ''}`;
                }
            } else if (m > 0) {
                expiryTextEl.textContent = `Expires in ${m} min${m > 1 ? 's' : ''}`;
            } else {
                expiryTextEl.textContent = `Expires in ${s} sec${s > 1 ? 's' : ''}`;
            }
        }
        if (expiryTimerEl) expiryTimerEl.style.display = 'inline-flex';

        timerHandle = setTimeout(updateTimer, 1000);
    }
    updateTimer();
    pollDropInfo();

    const detailedTimerCheckbox = document.getElementById('settings-detailed-timer');
    if (detailedTimerCheckbox) {
        detailedTimerCheckbox.addEventListener('change', () => {
            updateTimer();
        });
    }
    window.addEventListener('storage', (e) => {
        if (e.key === 'ys_detailed_timer') {
            updateTimer();
        }
    });

    const isLargeChunked = isChunked && meta.size > MEMORY_SAFE_DOWNLOAD_MAX_BYTES;
    if (isLargeChunked) {
        if (statusEl) statusEl.textContent = 'Large file requires picking location to stream safely.';
    }

    if (meta.isCollection || (meta.filename && meta.filename.endsWith('.json'))) {
        try {
            const collectionKey = await importDropKey(keyB64);
            let rawJson = null;

            if (isChunked && meta.chunkCount) {
                const cChunkCount = meta.chunkCount;
                const cIvB64 = Array.isArray(fragPayload) ? fragPayload[2] : fragPayload.iv;
                const cIvPrefix4 = b64ToUint8(cIvB64);
                const cParts = [];

                for (let ci = 0; ci < cChunkCount; ci++) {
                    const cResp = await fetch(`/download-chunk/${token}/${ci}`);
                    if (!cResp.ok) throw new Error('chunk fetch failed');
                    const cCipherBuf = await cResp.arrayBuffer();
                    const cIv = deriveChunkIv(cIvPrefix4, ci);
                    const cPlain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: cIv }, collectionKey, cCipherBuf);
                    cParts.push(new Uint8Array(cPlain));
                }

                const totalLen = cParts.reduce((s, p) => s + p.length, 0);
                const merged = new Uint8Array(totalLen);
                let off = 0;
                for (const p of cParts) {
                    merged.set(p, off);
                    off += p.length;
                }
                rawJson = new TextDecoder().decode(merged);
            } else {
                const cResp = await fetch(`/download/${token}`);
                if (!cResp.ok) throw new Error('fetch failed');
                const cPackedBuf = await cResp.arrayBuffer();
                const cIv = new Uint8Array(cPackedBuf, 0, 12);
                const cCipher = cPackedBuf.slice(12);
                const cPlain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: cIv }, collectionKey, cCipher);
                rawJson = new TextDecoder().decode(cPlain);
            }
            const collectionJson = JSON.parse(rawJson);
            if (collectionJson && Array.isArray(collectionJson.files)) {
                const card = document.querySelector('.card');
                if (card) {
                    card.style.maxWidth = '640px';
                }
                if (mainIconEl) {
                    mainIconEl.innerHTML = '<i class="fa-solid fa-layer-group"></i>';
                }
                const totalFilesCount = collectionJson.files.length;
                const totalCalculatedBytes = collectionJson.files.reduce((acc, f) => acc + (f.size || 0), 0);
                const totalSizeFormatted = typeof uiShared !== 'undefined' && uiShared.formatBytes ? uiShared.formatBytes(totalCalculatedBytes) : `${(totalCalculatedBytes / (1024 * 1024)).toFixed(2)} MB`;
                const rawName = collectionJson.name || (meta.displayName || '') || (meta.filename ? meta.filename.replace(/\.json$/i, '') : '') || 'Shared Workspace';
                const cleanName = (rawName === 'collection' || rawName === 'workspace') ? 'Shared Workspace' : rawName;
                const finalDisplayName = cleanName.includes(`(${totalFilesCount} files)`) ? cleanName : `${cleanName} (${totalFilesCount} files)`;

                if (filenameEl) filenameEl.textContent = finalDisplayName;
                if (sizeEl) sizeEl.textContent = `${totalFilesCount} files · ${totalSizeFormatted}`;
                if (statusEl) statusEl.textContent = 'Each file is decrypted locally in your browser.';
                const collectionDiv = document.getElementById('collection-list');
                const itemsDiv = document.getElementById('collection-items');
                const countBadge = document.getElementById('collection-count-badge');
                const dlAllHeaderBtn = document.getElementById('collection-download-all-btn');

                if (downloadBtn) {
                    downloadBtn.style.display = 'inline-flex';
                    downloadBtn.innerHTML = `<i class="fa-solid fa-arrow-down"></i> Download All (${totalFilesCount} Files)`;
                }

                async function downloadCollectionItem(file, onProgress) {
                    const fileUrl = new URL(file.url, window.location.origin);
                    let fileToken = file.token || fileUrl.searchParams.get('t');
                    if (!fileToken) {
                        const match = fileUrl.pathname.match(/\/h\/([a-zA-Z0-9_-]+)/);
                        if (match) fileToken = match[1];
                    }
                    let fileKeyB64 = null;
                    let fileIvB64 = null;
                    const fileHash = fileUrl.hash || '';
                    if (fileHash.startsWith('#key=')) {
                        try {
                            const fileRawFrag = decodeURIComponent(fileHash.slice(5));
                            const fileFrag = JSON.parse(fileRawFrag);
                            fileKeyB64 = Array.isArray(fileFrag) ? fileFrag[1] : fileFrag.k;
                            fileIvB64 = Array.isArray(fileFrag) ? fileFrag[2] : fileFrag.iv;
                        } catch { }
                    } else if (fileHash.length > 1) {
                        const rawKeyPart = fileHash.replace(/^#(k=)?/, '');
                        try {
                            const packed = b64UrlToUint8(rawKeyPart);
                            if (packed.length >= 36) {
                                fileKeyB64 = uint8ToB64(packed.slice(0, 32));
                                fileIvB64 = uint8ToB64(packed.slice(32, 36));
                            } else {
                                fileKeyB64 = uint8ToB64(packed);
                            }
                        } catch { }
                    }
                    const fileKey = await importDropKey(fileKeyB64);

                    const fileInfoResp = await fetch(`/drop-info/${fileToken}`);
                    if (!fileInfoResp.ok) throw new Error('File expired or not found');
                    const fileMeta = await fileInfoResp.json();

                    let fileBlob;
                    if (fileMeta.mode === 'chunked' && fileMeta.chunkCount) {
                        const fIvPrefix4 = b64ToUint8(fileIvB64);
                        const fParts = [];
                        for (let fi = 0; fi < fileMeta.chunkCount; fi++) {
                            if (onProgress) onProgress(fi + 1, fileMeta.chunkCount);
                            const fResp = await fetch(`/download-chunk/${fileToken}/${fi}`);
                            if (!fResp.ok) throw new Error('Chunk failed');
                            const fCipherBuf = await fResp.arrayBuffer();
                            const fIv = deriveChunkIv(fIvPrefix4, fi);
                            const fPlain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fIv }, fileKey, fCipherBuf);
                            fParts.push(new Blob([fPlain]));
                        }
                        fileBlob = new Blob(fParts);
                    } else {
                        if (onProgress) onProgress(1, 1);
                        const fResp = await fetch(`/download/${fileToken}`);
                        if (!fResp.ok) throw new Error('Download failed');
                        const fPackedBuf = await fResp.arrayBuffer();
                        const fIv = new Uint8Array(fPackedBuf, 0, 12);
                        const fCipher = fPackedBuf.slice(12);
                        const fPlain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fIv }, fileKey, fCipher);
                        fileBlob = new Blob([fPlain]);
                    }

                    const fA = document.createElement('a');
                    const blobUrl = URL.createObjectURL(fileBlob);
                    fA.href = blobUrl;
                    fA.download = fileMeta.filename || file.name || 'download';
                    document.body.appendChild(fA);
                    fA.click();
                    setTimeout(() => {
                        fA.remove();
                        URL.revokeObjectURL(blobUrl);
                    }, 20000);
                }

                let isDownloadingAll = false;
                async function downloadAllCollectionFiles() {
                    if (isDownloadingAll) return;
                    isDownloadingAll = true;

                    if (downloadBtn) {
                        downloadBtn.disabled = true;
                        downloadBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Downloading all files...';
                    }
                    if (dlAllHeaderBtn) {
                        dlAllHeaderBtn.disabled = true;
                        dlAllHeaderBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Downloading...';
                    }

                    let successCount = 0;
                    const totalFiles = collectionJson.files.length;

                    for (let i = 0; i < totalFiles; i++) {
                        const file = collectionJson.files[i];
                        const itemEl = itemsDiv ? itemsDiv.children[i] : null;
                        const dlBtn = itemEl ? itemEl.querySelector('.collection-dl-btn') : null;

                        if (downloadBtn) {
                            downloadBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Downloading ${i + 1}/${totalFiles}: ${file.name}`;
                        }
                        if (dlAllHeaderBtn) {
                            dlAllHeaderBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> ${i + 1}/${totalFiles}`;
                        }
                        if (statusEl) {
                            statusEl.textContent = `Downloading file ${i + 1} of ${totalFiles}: ${file.name}...`;
                        }
                        if (dlBtn) {
                            dlBtn.disabled = true;
                            dlBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
                        }

                        try {
                            await downloadCollectionItem(file, (part, total) => {
                                if (total > 1) {
                                    if (dlBtn) dlBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> ${part}/${total}`;
                                    if (downloadBtn) downloadBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> File ${i + 1}/${totalFiles} (${part}/${total})`;
                                }
                            });
                            if (dlBtn) {
                                dlBtn.innerHTML = '<i class="fa-solid fa-check"></i>';
                                dlBtn.style.background = 'var(--accent-emerald)';
                            }
                            successCount++;
                            if (typeof playProceduralSound === 'function') playProceduralSound('pop');
                        } catch (err) {
                            if (dlBtn) {
                                dlBtn.innerHTML = '<i class="fa-solid fa-xmark"></i>';
                                dlBtn.style.background = 'var(--accent-red, #ef4444)';
                                dlBtn.disabled = false;
                            }
                        }

                        if (i < totalFiles - 1) {
                            await new Promise(r => setTimeout(r, 400));
                        }
                    }

                    if (downloadBtn) {
                        if (successCount === totalFiles) {
                            downloadBtn.innerHTML = '<i class="fa-solid fa-check"></i> All Files Downloaded';
                            downloadBtn.style.background = 'var(--accent-emerald)';
                        } else {
                            downloadBtn.disabled = false;
                            downloadBtn.innerHTML = `<i class="fa-solid fa-rotate-right"></i> Retry Failed (${successCount}/${totalFiles} saved)`;
                        }
                    }
                    if (dlAllHeaderBtn) {
                        if (successCount === totalFiles) {
                            dlAllHeaderBtn.innerHTML = '<i class="fa-solid fa-check"></i> Downloaded';
                            dlAllHeaderBtn.style.background = 'var(--accent-emerald)';
                        } else {
                            dlAllHeaderBtn.disabled = false;
                            dlAllHeaderBtn.innerHTML = '<i class="fa-solid fa-rotate-right"></i> Retry';
                        }
                    }
                    if (statusEl) {
                        if (successCount === totalFiles) {
                            statusEl.textContent = `✓ All ${totalFiles} files downloaded successfully.`;
                        } else {
                            statusEl.textContent = `Downloaded ${successCount} of ${totalFiles} files.`;
                        }
                    }

                    if (meta.burnOnDownload && successCount === totalFiles) {
                        fetch('/drop-burn', { method: 'POST', body: new URLSearchParams({ token }) }).catch(() => {});
                        const card = document.querySelector('.card') || document.body;
                        if (typeof triggerDustExplosion === 'function') triggerDustExplosion(card);
                        if (statusEl) statusEl.textContent = '🔥 Burned: This link has self-destructed.';
                        if (downloadBtn) {
                            downloadBtn.disabled = true;
                            downloadBtn.innerHTML = '🔥 Burned';
                            downloadBtn.style.background = 'var(--accent-danger, #ef4444)';
                        }
                        if (dlAllHeaderBtn) {
                            dlAllHeaderBtn.disabled = true;
                            dlAllHeaderBtn.innerHTML = '🔥 Burned';
                            dlAllHeaderBtn.style.background = 'var(--accent-danger, #ef4444)';
                        }
                    }

                    isDownloadingAll = false;
                }

                if (downloadBtn) {
                    downloadBtn.onclick = downloadAllCollectionFiles;
                }
                if (dlAllHeaderBtn) {
                    dlAllHeaderBtn.onclick = downloadAllCollectionFiles;
                }

                if (collectionDiv && itemsDiv) {
                    collectionDiv.style.display = 'block';
                    if (countBadge) countBadge.textContent = collectionJson.files.length;
                    itemsDiv.innerHTML = '';
                    collectionJson.files.forEach((file, index) => {
                        const item = document.createElement('div');
                        item.className = 'collection-item';
                        item.setAttribute('data-index', index.toString());

                        const ext = file.name.split('.').pop().toLowerCase();
                        let icon = 'fa-file';
                        if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext)) icon = 'fa-file-image';
                        else if (['mp4', 'webm', 'mov'].includes(ext)) icon = 'fa-file-video';
                        else if (['mp3', 'wav', 'ogg'].includes(ext)) icon = 'fa-file-audio';
                        else if (['pdf'].includes(ext)) icon = 'fa-file-pdf';
                        else if (['zip', 'rar', '7z'].includes(ext)) icon = 'fa-file-zipper';

                        const sizeStr = file.size ? (typeof uiShared !== 'undefined' && uiShared.formatBytes ? uiShared.formatBytes(file.size) : (file.size / (1024 * 1024)).toFixed(2) + ' MB') : 'Size unknown';

                        item.innerHTML = `
                            <div class="file-info">
                                <div class="file-icon"><i class="fa-solid ${icon}"></i></div>
                                <div class="file-details">
                                    <div class="collection-name">${file.name}</div>
                                    <div class="file-meta">${sizeStr}</div>
                                </div>
                            </div>
                            <button class="btn-pill btn-primary btn-sm collection-dl-btn" style="padding: 0.6rem 1.2rem; font-size: 0.8rem;">
                                <i class="fa-solid fa-download"></i>
                            </button>
                        `;
                        const dlBtn = item.querySelector('.collection-dl-btn');
                        dlBtn.onclick = async () => {
                            dlBtn.disabled = true;
                            dlBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
                            try {
                                await downloadCollectionItem(file, (part, total) => {
                                    if (total > 1) {
                                        dlBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> ${part}/${total}`;
                                    }
                                });
                                dlBtn.innerHTML = '<i class="fa-solid fa-check"></i>';
                                dlBtn.style.background = 'var(--accent-emerald)';
                                if (typeof playProceduralSound === 'function') playProceduralSound('pop');
                            } catch (err) {
                                dlBtn.innerHTML = '<i class="fa-solid fa-xmark"></i>';
                                dlBtn.style.background = 'var(--accent-red, #ef4444)';
                                dlBtn.disabled = false;
                            }
                        };
                        itemsDiv.appendChild(item);
                    });
                }
                return true;
            }
        } catch (e) {
        }
    }

    downloadBtn?.addEventListener('click', async () => {
        downloadBtn.disabled = true;
        downloadBtn.textContent = isChunked ? 'Preparing...' : 'Downloading...';

        const key = await importDropKey(keyB64);

        if (!isChunked || !meta.chunkCount) {
            downloadBtn.textContent = 'Downloading...';
            const resp = await fetch(`/download/${token}`);
            const packedBuf = await resp.arrayBuffer();

            downloadBtn.textContent = 'Decrypting...';
            const iv = new Uint8Array(packedBuf, 0, 12);
            const cipher = packedBuf.slice(12);
            let plain;
            try {
                plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, cipher);
            } catch {
                downloadBtn.textContent = 'Decryption failed';
                return;
            }

            const blob = new Blob([plain]);
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = meta.filename;
            a.click();
            downloadBtn.textContent = '✓ Downloaded';
            if (typeof playProceduralSound === 'function') playProceduralSound('pop');
            if (meta.burnOnDownload) {
                fetch('/drop-burn', { method: 'POST', body: new URLSearchParams({ token }) }).catch(() => {});
                const card = document.querySelector('.drop-card') || document.querySelector('.sleek-card') || document.body;
                if (typeof triggerDustExplosion === 'function') triggerDustExplosion(card);
                if (statusEl) statusEl.textContent = '🔥 Burned: This link has self-destructed.';
                downloadBtn.disabled = true;
                downloadBtn.textContent = '🔥 Burned';
                downloadBtn.style.background = 'var(--accent-danger, #ef4444)';
            }
            return;
        }

        const chunkSize = meta.size > 0 ? (meta.chunkSize || (Array.isArray(fragPayload) ? fragPayload[3] : fragPayload.cs) || HOSTED_CHUNK_SIZE_BYTES) : HOSTED_CHUNK_SIZE_BYTES;
        const chunkCount = meta.chunkCount;
        const ivB64 = Array.isArray(fragPayload) ? fragPayload[2] : fragPayload.iv;
        const ivPrefix4 = b64ToUint8(ivB64);

        const canStreamToDisk = typeof window.showSaveFilePicker === 'function';
        const useBlob = meta.size <= MEMORY_SAFE_DOWNLOAD_MAX_BYTES || !canStreamToDisk;

        if (!useBlob && !canStreamToDisk) {
            downloadBtn.disabled = true;
            if (statusEl) statusEl.textContent = 'File is too large to download without streaming support (File System Access API).';
            return;
        }

        let writable = null;
        let parts = null;
        try {
            if (!useBlob) {
                downloadBtn.textContent = 'High-Speed Stream Mode';
                if (statusEl) statusEl.textContent = 'Large file: Please select a save location to stream directly to disk...';
                const handle = await window.showSaveFilePicker({ suggestedName: meta.filename });
                writable = await handle.createWritable();
            } else {
                parts = [];
            }

            for (let i = 0; i < chunkCount; i++) {
                downloadBtn.textContent = `Downloading ${i + 1}/${chunkCount}...`;
                if (statusEl) statusEl.textContent = `Decrypting ${i + 1}/${chunkCount}...`;

                const resp = await fetch(`/download-chunk/${token}/${i}`);
                if (!resp.ok) throw new Error('Failed to download chunk ' + i);
                const cipherBuf = await resp.arrayBuffer();

                downloadBtn.textContent = `Decrypting ${i + 1}/${chunkCount}...`;
                if (statusEl) statusEl.textContent = `Decrypting ${i + 1}/${chunkCount}...`;

                const iv = deriveChunkIv(ivPrefix4, i);
                let plainBuf;
                try {
                    plainBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, cipherBuf);
                } catch {
                    downloadBtn.textContent = 'Decryption failed';
                    return;
                }

                if (writable) {
                    await writable.write(new Uint8Array(plainBuf));
                } else {
                    parts.push(new Blob([plainBuf]));
                }
            }

            if (writable) await writable.close();

            if (!writable) {
                const blob = new Blob(parts);
                const a = document.createElement('a');
                a.href = URL.createObjectURL(blob);
                a.download = meta.filename;
                a.click();
            }

            downloadBtn.textContent = '✓ Downloaded';
            if (typeof playProceduralSound === 'function') playProceduralSound('pop');
            if (statusEl) statusEl.textContent = '✓ Download complete.';
            if (meta.burnOnDownload) {
                fetch('/drop-burn', { method: 'POST', body: new URLSearchParams({ token }) }).catch(() => {});
                const card = document.querySelector('.drop-card') || document.querySelector('.sleek-card') || document.body;
                if (typeof triggerDustExplosion === 'function') triggerDustExplosion(card);
                if (statusEl) statusEl.textContent = '🔥 Burned: This link has self-destructed.';
                downloadBtn.disabled = true;
                downloadBtn.textContent = '🔥 Burned';
                downloadBtn.style.background = 'var(--accent-danger, #ef4444)';
            }
        } catch (e) {
            if (e.name === 'AbortError') {
                downloadBtn.disabled = false;
                downloadBtn.textContent = 'Download (Interrupted)';
                if (statusEl) statusEl.textContent = 'Download cancelled by user.';
                return;
            }
            console.error('Download failed', e);
            downloadBtn.textContent = '❌ Download Failed';
            if (statusEl) statusEl.textContent = 'Error: ' + e.message;
            downloadBtn.disabled = false;
        } finally {
            try {
                if (writable) await writable.close();
            } catch {
            }
        }
    });

    return true;
}

async function resumeHostedDrop(files, token) {
    if (!files || !files.length || !token) throw new Error('Missing file or token to resume');
    return await hostedDrop(files[0], null, 60 * 60 * 1000, '', { token });
}

window.hostedDrop = hostedDrop;
window.resumeHostedDrop = resumeHostedDrop;
window.receiveHostedDrop = receiveHostedDrop;
