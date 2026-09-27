const hostedLinkResuming = {};
const dismissedHostedLinks = {};


function setHostedLinkResuming(token, isResuming) {
  hostedLinkResuming[token] = !!isResuming;
  ActivityTracker.notifyUpdate();
}


const p2pTransferResuming = {};


function setP2PTransferResuming(fileId, isResuming) {
  p2pTransferResuming[fileId] = !!isResuming;
  ActivityTracker.notifyUpdate();
}

const ActivityTracker = {
  state: {
    p2pRooms: {},
    hostedLinks: {},
    transfers: {}
  },

  panelRefs: {
    actionSelection: null,
    activityContainer: null
  },

  updateCallbacks: [],

  init(actionSelectionPanel) {
    this.panelRefs.actionSelection = actionSelectionPanel;

    if (this._saveTimeout) {
      clearTimeout(this._saveTimeout);
      this._saveTimeout = null;
    }

    this.state.p2pRooms = {};
    this.state.hostedLinks = {};
    this.state.transfers = {};

    try {
      const savedHosted = JSON.parse(localStorage.getItem('emit-hosted-links') || '{}');
      Object.entries(savedHosted).forEach(([token, link]) => {
        this.state.hostedLinks[token] = link;
      });
    } catch (e) { }

    try {
      const savedRooms = JSON.parse(localStorage.getItem('emit-p2p-rooms') || '{}');
      Object.entries(savedRooms).forEach(([roomId, room]) => {
        this.state.p2pRooms[roomId] = room;
      });
    } catch (e) { }

    try {
      const savedTransfers = JSON.parse(localStorage.getItem('emit-p2p-transfers') || '{}');
      Object.entries(savedTransfers).forEach(([fileId, transfer]) => {
        this.state.transfers[fileId] = transfer;
      });
    } catch (e) { }

    this.setupPanelStructure();
    this.verifyHostedLinks();
    this.setupStorageListener();

    if (this.hasActivity()) {
      this.notifyUpdate();
    }
  },

  setupStorageListener() {
    window.addEventListener('storage', (e) => {
      if (e.key === 'emit-hosted-links') {
        try {
          const saved = JSON.parse(e.newValue || '{}');
          const savedTokens = new Set(Object.keys(saved));
          let hasPendingAnims = false;
          Object.keys(this.state.hostedLinks).forEach(token => {
            if (!savedTokens.has(token)) {
              const el = document.getElementById(`activity-hosted-${token}`);
              if (el && !el.classList.contains('vanish-sand')) {
                hasPendingAnims = true;
                if (typeof playProceduralSound === 'function') playProceduralSound('pop');
                el.classList.add('vanish-sand');
                setTimeout(() => {
                  delete this.state.hostedLinks[token];
                  this.renderPanel();
                }, 800);
              } else {
                delete this.state.hostedLinks[token];
              }
            }
          });

          Object.entries(saved).forEach(([token, link]) => {
            if (!dismissedHostedLinks[token]) {
              this.state.hostedLinks[token] = link;
            }
          });
          if (!hasPendingAnims) {
            this.renderPanel();
          }
        } catch (e) { }
      } else if (e.key === 'emit-p2p-rooms') {
        try {
          const saved = JSON.parse(e.newValue || '{}');
          const savedRooms = new Set(Object.keys(saved));
          let hasPendingAnims = false;
          Object.keys(this.state.p2pRooms).forEach(roomId => {
            if (!savedRooms.has(roomId)) {
              const el = document.getElementById(`activity-room-${roomId}`);
              if (el && !el.classList.contains('vanish-sand')) {
                hasPendingAnims = true;
                if (typeof playProceduralSound === 'function') playProceduralSound('pop');
                el.classList.add('vanish-sand');
                setTimeout(() => {
                  delete this.state.p2pRooms[roomId];
                  this.renderPanel();
                }, 800);
              } else {
                delete this.state.p2pRooms[roomId];
              }
            }
          });

          Object.entries(saved).forEach(([roomId, room]) => {
            this.state.p2pRooms[roomId] = room;
          });
          if (!hasPendingAnims) {
            this.renderPanel();
          }
        } catch (e) { }
      } else if (e.key === 'emit-p2p-transfers') {
        try {
          const saved = JSON.parse(e.newValue || '{}');
          const savedTransfers = new Set(Object.keys(saved));
          let hasPendingAnims = false;
          Object.keys(this.state.transfers).forEach(fileId => {
            if (!savedTransfers.has(fileId)) {
              const el = document.getElementById(`activity-transfer-${fileId}`);
              if (el && !el.classList.contains('vanish-sand')) {
                hasPendingAnims = true;
                if (typeof playProceduralSound === 'function') playProceduralSound('pop');
                el.classList.add('vanish-sand');
                setTimeout(() => {
                  delete this.state.transfers[fileId];
                  this.renderPanel();
                }, 800);
              } else {
                delete this.state.transfers[fileId];
              }
            }
          });

          Object.entries(saved).forEach(([fileId, transfer]) => {
            this.state.transfers[fileId] = transfer;
          });
          if (!hasPendingAnims) {
            this.renderPanel();
          }
        } catch (e) { }
      }
    });

    if (this._timerInterval) clearInterval(this._timerInterval);
    this._timerInterval = setInterval(() => {
      this.tickTimers();
    }, 1000);
  },

  verifyHostedLinks() {
    const tokens = Object.keys(this.state.hostedLinks);
    if (tokens.length === 0) return;

    const verificationPromises = tokens
      .filter(token => !dismissedHostedLinks[token])
      .map(token =>
        fetch(`/drop-info/${token}`)
          .then(async (res) => {
            if (!res.ok || res.status === 404) {
              return { token, exists: false, info: null };
            }
            const info = await res.json().catch(() => null);
            return { token, exists: true, info };
          })
          .catch(() => ({
            token,
            exists: true,
            info: null
          }))
      );

    Promise.all(verificationPromises).then(results => {
      let hasChanges = false;
      results.forEach(result => {
        const current = this.state.hostedLinks[result.token];
        if (!current) return;

        if (!result.exists) {
          delete this.state.hostedLinks[result.token];
          hasChanges = true;
          return;
        }

        if (result.info) {
          if (result.info.status && current.status !== result.info.status) {
            current.status = result.info.status;
            hasChanges = true;
          }
          if (result.info.status === 'uploading') {
            if (current.expiresAt !== null) {
              current.expiresAt = null;
              hasChanges = true;
            }
          } else if (result.info.expires && current.expiresAt !== result.info.expires) {
            current.expiresAt = result.info.expires;
            hasChanges = true;
          }
          if (!current.size && result.info.size) {
            current.size = result.info.size;
            hasChanges = true;
          }
          if (!current.name && result.info.filename) {
            current.name = result.info.filename;
            hasChanges = true;
          }
        }
      });

      if (hasChanges) {
        this.saveImmediate();
        this.renderPanel();
      }
    }).catch(() => {
    });
  },

  forceRefresh() {
    try {
      const saved = JSON.parse(localStorage.getItem('emit-hosted-links') || '{}');
      this.state.hostedLinks = saved;
    } catch (e) {
      this.state.hostedLinks = {};
    }

    this.renderPanel();
  },

  tickTimers() {
    if (!this.hasActivity()) return;

    Object.entries(this.state.p2pRooms).forEach(([roomId, room]) => {
      const el = document.getElementById(`p2p-time-${roomId}`);
      if (el) el.textContent = this.formatUptime(Date.now() - room.createdAt);
    });

    Object.entries(this.state.hostedLinks).forEach(([token, link]) => {
      if (dismissedHostedLinks[token]) return;
      if (link.status !== 'ready' || !link.expiresAt) return;
      const timeLeft = link.expiresAt - Date.now();
      if (timeLeft <= 0) {
        this.removeHostedLink(token);
      } else {
        const el = document.getElementById(`hosted-time-${token}`);
        if (el) {
          if (window.uiShared && typeof window.uiShared.formatExpiryCountdown === 'function') {
            el.textContent = 'Expires in ' + window.uiShared.formatExpiryCountdown(timeLeft);
          } else {
            el.textContent = 'Expires in ' + this.formatTimeRemaining(timeLeft);
          }
        }
      }
    });
  },

  setupPanelStructure() {
    const panel = this.panelRefs.actionSelection;
    if (!panel) return;

    let container = panel.querySelector('.activity-tracker-container');
    if (!container) {
      container = document.createElement('div');
      container.className = 'activity-tracker-container';
      container.style.display = 'none';
      panel.appendChild(container);
    }
    this.panelRefs.activityContainer = container;
  },

  addP2PRoom(roomId, options = {}) {
    this.state.p2pRooms[roomId] = {
      name: options.name || roomId,
      createdAt: Date.now(),
      peers: options.peers || []
    };
    this.notifyUpdate();
  },

  updateP2PRoom(roomId, peers = []) {
    if (this.state.p2pRooms[roomId]) {
      this.state.p2pRooms[roomId].peers = peers;
      this.notifyUpdate();
    }
  },

  removeP2PRoom(roomId) {
    delete this.state.p2pRooms[roomId];
    this.saveImmediate();
    this.updateCallbacks.forEach(cb => {
      try { cb(this.getState()); } catch (e) { }
    });
    this.renderPanel();
  },

  addHostedLink(token, options = {}) {
    if (!this.panelRefs.actionSelection) {
      const panel = document.getElementById('action-selection-panel');
      if (panel) this.init(panel);
    }
    this.state.hostedLinks[token] = {
      name: options.name || 'Hosted Link',
      nickname: options.nickname || '',
      size: options.size || 0,
      createdAt: Date.now(),
      durationMs: options.durationMs || null,
      expiresAt: options.expiresAt || options.expires || null,
      progress: options.progress || 0,
      url: options.url || '',
      status: options.status || 'ready'
    };
    this.notifyUpdate();
    this.saveImmediate();
  },

  updateHostedLinkUrl(token, url, expires) {
    if (this.state.hostedLinks[token]) {
      this.state.hostedLinks[token].url = url;
      this.state.hostedLinks[token].expiresAt = (expires !== undefined && expires !== null) ? expires : null;
      this.state.hostedLinks[token].status = 'ready';
      this.state.hostedLinks[token].progress = 100;
      this.notifyUpdate();
      this.saveImmediate();
    }
  },

  updateHostedLinkProgress(token, progress) {
    if (this.state.hostedLinks[token]) {
      const p = Math.min(100, Math.max(0, progress));
      const displayP = p > 0 && p < 1 ? 1 : Math.round(p);
      this.state.hostedLinks[token].progress = p;
      if (p > 0 && this.state.hostedLinks[token].status !== 'ready') {
        this.state.hostedLinks[token].status = 'uploading';
      }

      const el = document.getElementById(`activity-hosted-${token}`);
      if (el) {
        const fill = el.querySelector('.progress-bar-fill');
        if (fill) fill.style.width = `${Math.max(displayP, p)}%`;

        const text = el.querySelector('.progress-text');
        if (text) text.textContent = `${displayP}% Uploaded`;

        if (p >= 100 && this.state.hostedLinks[token].status !== 'ready') {
          this.notifyUpdate();
        }
      }
      this.saveThrottled();
    }
  },

  removeHostedLink(token) {
    delete this.state.hostedLinks[token];
    this.saveImmediate();
    this.updateCallbacks.forEach(cb => {
      try { cb(this.getState()); } catch (e) { }
    });
    this.renderPanel();
  },

  addTransfer(fileId, options = {}) {
    const existing = this.state.transfers[fileId] || {};
    this.state.transfers[fileId] = {
      name: options.name || existing.name || 'File',
      nickname: options.nickname || existing.nickname || '',
      size: options.size ?? existing.size ?? 0,
      roomId: options.roomId || existing.roomId || null,
      direction: options.direction || existing.direction || 'unknown',
      progress: options.progress ?? existing.progress ?? 0,
      speed: options.speed ?? existing.speed ?? 0,
      eta: options.eta ?? existing.eta ?? '',
      paused: options.paused !== undefined ? !!options.paused : !!existing.paused,
      pausedLabel: options.pausedLabel ?? existing.pausedLabel ?? '',
      speedHistory: existing.speedHistory || new Array(20).fill(0)
    };
    this.notifyUpdate();
  },

  updateTransfer(fileId, data = {}) {
    if (this.state.transfers[fileId]) {
      const t = this.state.transfers[fileId];
      if (data.progress !== undefined) t.progress = data.progress;
      if (data.speed !== undefined) t.speed = data.speed;
      if (data.direction !== undefined) t.direction = data.direction;
      if (data.roomId !== undefined) t.roomId = data.roomId;
      if (data.name !== undefined) t.name = data.name;
      if (data.nickname !== undefined) t.nickname = data.nickname;
      if (data.size !== undefined) t.size = data.size;
      if (data.paused !== undefined) t.paused = data.paused;
      if (data.pausedLabel !== undefined) t.pausedLabel = data.pausedLabel;
      if (data.rawSpeed !== undefined) {
        if (!t.speedHistory) t.speedHistory = new Array(20).fill(0);
        t.speedHistory.push(data.rawSpeed);
        if (t.speedHistory.length > 20) {
          t.speedHistory.shift();
        }
      }
      if (data.eta !== undefined) t.eta = data.eta;


      const el = document.getElementById(`activity-transfer-${fileId}`);
      if (el && this.panelRefs.activityContainer && this.panelRefs.activityContainer.style.display !== 'none') {
        const fill = el.querySelector('.progress-bar-fill');
        if (fill) fill.style.width = `${t.progress}%`;

        const displayPct = t.progress >= 10 || t.progress === 0 ? Math.round(t.progress) : t.progress.toFixed(1);
        const text = el.querySelector('.progress-text');
        if (text) text.textContent = `${displayPct}%`;

        const details = el.querySelector('.activity-item-details .detail-text');
        if (details) {
          const speedStr = t.speed ? ` | ${t.speed}` : '';
          const etaStr = t.eta ? ` | ETA: ${t.eta}` : '';
          details.textContent = `${this.formatBytes(t.size)}${speedStr}${etaStr}`;
        }

        const icon = el.querySelector('.activity-item-icon i');
        if (icon) {
          icon.classList.toggle('fa-arrow-down', t.direction === 'download');
          icon.classList.toggle('fa-arrow-up', t.direction !== 'download');
        }

        const badge = el.querySelector('.badge-direction');
        if (badge) {
          badge.textContent = t.direction === 'download' ? 'Downloading' : 'Uploading';
        }


        const oldGraph = el.querySelector('.speed-graph');
        if (t.speedHistory.length > 0) {
          const newGraphHtml = this.renderSpeedGraph(t.speedHistory);
          const temp = document.createElement('div');
          temp.innerHTML = newGraphHtml;
          if (temp.firstElementChild) {
            if (oldGraph) {
              el.replaceChild(temp.firstElementChild, oldGraph);
            } else {
              const progressEl = el.querySelector('.activity-progress');
              if (progressEl) {
                el.insertBefore(temp.firstElementChild, progressEl);
              } else {
                el.appendChild(temp.firstElementChild);
              }
            }
          }
        }
      } else {
        this.saveThrottled();
      }
    }
  },

  removeTransfer(fileId) {
    delete this.state.transfers[fileId];
    this.notifyUpdate();
  },

  clearAllTransfers() {
    const transferIds = Object.keys(this.state.transfers);
    if (transferIds.length === 0) return;
    transferIds.forEach(fileId => {
      const el = document.getElementById(`activity-transfer-${fileId}`);
      if (el) {
        if (typeof playProceduralSound === 'function') playProceduralSound('pop');
        el.classList.add('vanish-sand');
      }
    });
    setTimeout(() => {
      transferIds.forEach(fileId => {
        delete this.state.transfers[fileId];
      });
      this.notifyUpdate();
    }, 800);
  },

  hasActivity() {
    return Object.keys(this.state.p2pRooms).length > 0 ||
      Object.keys(this.state.hostedLinks).length > 0 ||
      Object.keys(this.state.transfers).length > 0;
  },

  getState() {
    return {
      p2pRooms: this.state.p2pRooms,
      hostedLinks: this.state.hostedLinks,
      transfers: this.state.transfers
    };
  },

  onUpdate(callback) {
    this.updateCallbacks.push(callback);
  },

  notifyUpdate() {
    this.saveThrottled();
    this.updateCallbacks.forEach(cb => {
      try { cb(this.getState()); } catch (e) { console.error('Activity callback error:', e); }
    });
    this.renderPanel();
  },

  saveImmediate() {
    if (this._saveTimeout) {
      clearTimeout(this._saveTimeout);
      this._saveTimeout = null;
    }
    try {
      const hostedSave = {};
      Object.entries(this.state.hostedLinks).forEach(([token, link]) => {
        if (!dismissedHostedLinks[token]) {
          hostedSave[token] = link;
        }
      });
      try {
        localStorage.setItem('emit-hosted-links', JSON.stringify(hostedSave));
      } catch (e) {
        console.error('localStorage error (emit-hosted-links):', e);
      }

      const p2pRoomsSave = {};
      Object.entries(this.state.p2pRooms).forEach(([roomId, room]) => {
        p2pRoomsSave[roomId] = room;
      });
      try {
        localStorage.setItem('emit-p2p-rooms', JSON.stringify(p2pRoomsSave));
      } catch (e) {
        console.error('localStorage error (emit-p2p-rooms):', e);
      }

      const transfersSave = {};
      Object.entries(this.state.transfers).forEach(([fileId, transfer]) => {
        transfersSave[fileId] = transfer;
      });
      try {
        localStorage.setItem('emit-p2p-transfers', JSON.stringify(transfersSave));
      } catch (e) {
        console.error('localStorage error (emit-p2p-transfers):', e);
      }
    } catch (e) { }
  },

  _saveTimeout: null,
  saveThrottled() {
    if (this._saveTimeout) return;
    this._saveTimeout = setTimeout(() => {
      try {
        const hostedSave = {};
        Object.entries(this.state.hostedLinks).forEach(([token, link]) => {
          if (!dismissedHostedLinks[token]) {
            hostedSave[token] = link;
          }
        });
        localStorage.setItem('emit-hosted-links', JSON.stringify(hostedSave));

        const p2pRoomsSave = {};
        Object.entries(this.state.p2pRooms).forEach(([roomId, room]) => {
          p2pRoomsSave[roomId] = room;
        });
        localStorage.setItem('emit-p2p-rooms', JSON.stringify(p2pRoomsSave));

        const transfersSave = {};
        Object.entries(this.state.transfers).forEach(([fileId, transfer]) => {
          transfersSave[fileId] = transfer;
        });
        localStorage.setItem('emit-p2p-transfers', JSON.stringify(transfersSave));
      } catch (e) { }
      this._saveTimeout = null;
    }, 1000);
  },

  renderPanel() {
    let panel = this.panelRefs.actionSelection;
    if (!panel) {
      panel = document.getElementById('action-selection-panel');
      if (panel) this.panelRefs.actionSelection = panel;
    }
    if (!panel) return;

    let container = this.panelRefs.activityContainer;
    if (!container) {
      container = panel.querySelector('.activity-tracker-container');
      if (!container) {
        this.setupPanelStructure();
        container = panel.querySelector('.activity-tracker-container');
      }
      if (container) this.panelRefs.activityContainer = container;
    }
    if (!container) return;



    const hasActivity = this.hasActivity();
    const trackerBody = document.getElementById('activity-tracker-body');
    const trackerTab = document.getElementById('activity-tab-tracker');
    const isTrackerActive = trackerTab && trackerTab.classList.contains('active');

    if (!isTrackerActive) {
      container.style.display = 'none';
      if (trackerBody) trackerBody.style.display = 'none';
      return;
    }

    if (!hasActivity) {
      if (trackerBody) trackerBody.style.display = 'block';
      container.style.display = 'none';
      return;
    }

    if (trackerBody) trackerBody.style.display = 'none';
    container.style.display = 'flex';
    container.innerHTML = this.renderActivityContent();
  },

  renderActivityContent() {
    const sections = [];

    const p2pCount = Object.keys(this.state.p2pRooms).length;
    if (p2pCount > 0) {
      sections.push(this.renderP2PRoomsSection());
    }

    const hostedCount = Object.keys(this.state.hostedLinks).length;
    if (hostedCount > 0) {
      sections.push(this.renderHostedLinksSection());
    }

    return `
      <div class="activity-content">
        ${sections.join('')}
      </div>
    `;
  },

  renderP2PRoomsSection() {
    const rooms = Object.entries(this.state.p2pRooms);
    if (rooms.length === 0) return '';

    const roomItems = rooms.map(([roomId, room]) => {
      const peerCount = room.peers ? room.peers.length : 0;
      const peerNames = room.peers ? room.peers.map(p => (typeof p === 'string' ? p : (p.name || 'User'))).join(', ') : '';
      const uptime = this.formatUptime(Date.now() - room.createdAt);


      return `
        <div class="activity-item clickable" onclick="ActivityTracker.switchToRoom('${this.escapeHtml(roomId)}')" id="activity-room-${roomId}">
          <div class="activity-item-header">
            <div class="activity-item-icon activity-icon-p2p">
              <i class="fa-solid fa-network-wired"></i>
            </div>
            <div class="activity-item-info">
              <div class="activity-item-title">${this.escapeHtml(room.name || roomId)}</div>
              <div class="activity-item-details">
                <span class="detail-badge">${peerCount} ${peerCount === 1 ? 'PEER' : 'PEERS'}</span>
                <span class="detail-text" id="p2p-time-${this.escapeHtml(roomId)}">${uptime}</span>
              </div>
            </div>
            <div class="activity-item-actions">
              <button class="btn-item-action danger" onclick="event.stopPropagation(); ActivityTracker.handleRoomAction('${this.escapeHtml(roomId)}')" title="Leave Room">
                <i class="fa-solid fa-door-open"></i>
              </button>
            </div>
          </div>
        </div>
      `;

    }).join('');

    return `
      <div class="activity-section">
        <div class="activity-section-header">
          <div style="display:flex; align-items:center;">
            <i class="fa-solid fa-server"></i>
            <span class="section-title">P2P Rooms <span class="section-count">${rooms.length}</span></span>
          </div>
        </div>
        <div class="activity-section-items">
          ${roomItems}
        </div>
      </div>
    `;
  },

  renderHostedLinksSection() {
    const links = Object.entries(this.state.hostedLinks).filter(([token]) => !dismissedHostedLinks[token]);
    if (links.length === 0) return '';

    const linkItems = links.map(([token, link]) => {
      const isReady = link.status === 'ready';
      const timeRemaining = isReady && link.expiresAt ? this.formatTimeRemaining(link.expiresAt - Date.now()) : '';
      const sizeStr = this.formatBytes(link.size);
      const rawProgress = Math.min(100, Math.max(0, Number(link.progress) || 0));
      const progress = rawProgress > 0 && rawProgress < 1 ? 1 : Math.round(rawProgress);
      const isResuming = hostedLinkResuming[token];

      const displayName = link.nickname || link.name || 'Secure Transfer';

      return `
        <div class="activity-item clickable" id="activity-hosted-${token}" onclick="if(!event.target.closest('button')) ActivityTracker.reopenHostedTransfer('${this.escapeHtml(token)}')">
          <div class="activity-item-header">
            <div class="activity-item-icon activity-icon-hosted">
              <i class="fa-solid fa-link"></i>
            </div>
            <div class="activity-item-info">
              <div class="activity-item-title">
                ${link.url ? `<a href="${link.url}" target="_blank" class="activity-item-link" onclick="event.stopPropagation()">${this.escapeHtml(displayName)}</a>` : `<span class="activity-item-title-link">${this.escapeHtml(displayName)}</span>`}
              </div>
              <div class="activity-item-details">
                <span class="detail-text">${sizeStr}</span>
                ${isReady ? (link.expiresAt ? `<span class="detail-text" id="hosted-time-${this.escapeHtml(token)}">Expires in ${timeRemaining}</span>` : `<span class="detail-text">Ready</span>`) : `<span class="detail-text">${link.status === 'preparing' ? 'Preparing...' : (link.status === 'uploading' ? 'Uploading...' : 'Finalizing...')}</span>`}
              </div>
            </div>
            <div class="activity-item-actions">
              <button class="btn-item-action danger" onclick="event.stopPropagation(); ActivityTracker.handleHostedAction('${this.escapeHtml(token)}')" title="Delete Link">
                <i class="fa-solid fa-trash-can"></i>
              </button>
            </div>
          </div>
          ${isResuming ? `<div class='resuming-indicator'>Resuming transfer...</div>` : ''}
          ${isReady ? '<div class="activity-status-badge success"><i class="fa-solid fa-check"></i> Ready to Share</div>' : `
            <div class="activity-progress">
              <div class="progress-bar-bg">
                <div class="progress-bar-fill" style="width: ${progress}%"></div>
              </div>
              <span class="progress-text">${progress}% Uploaded</span>
            </div>
          `}
        </div>
      `;
    }).join('');

    return `
      <div class="activity-section">
        <div class="activity-section-header">
          <div style="display:flex; align-items:center;">
            <i class="fa-solid fa-link"></i>
            <span class="section-title">Hosted Links <span class="section-count">${links.length}</span></span>
          </div>
        </div>
        <div class="activity-section-items">
          ${linkItems}
        </div>
      </div>
    `;
  },

  renderTransfersSection() {
    const transfers = Object.entries(this.state.transfers);
    if (transfers.length === 0) return '';

    const transferItems = transfers.map(([fileId, transfer]) => {
      const rawProgress = transfer.progress || 0;
      const displayPct = rawProgress >= 10 || rawProgress === 0 ? Math.round(rawProgress) : rawProgress.toFixed(1);
      const directionIcon = transfer.direction === 'download' ? 'fa-arrow-down' : 'fa-arrow-up';
      const directionLabel = transfer.direction === 'download' ? 'Downloading' : 'Uploading';
      const speedStr = transfer.speed ? ` | ${transfer.speed}` : '';
      const etaStr = transfer.eta ? ` | ETA: ${transfer.eta}` : '';
      const isResuming = p2pTransferResuming[fileId];
      const isPaused = !!transfer.paused;
      const speedHistory = transfer.speedHistory || [];
      const displayName = transfer.nickname || transfer.name || 'Secure Transfer';

      return `
        <div class="activity-item ${isPaused ? 'paused-transfer-activity' : ''}" id="activity-transfer-${fileId}">
          <div class="activity-item-header">
            <div class="activity-item-icon activity-icon-transfer">
              <i class="fa-solid ${directionIcon}"></i>
            </div>
            <div class="activity-item-info">
              <div class="activity-item-title">${this.escapeHtml(displayName)}</div>
              <div class="activity-item-details">
                <span class="badge-direction">${directionLabel}</span>
                <span class="detail-text">${this.formatBytes(transfer.size)}${speedStr}${etaStr}</span>
              </div>
            </div>
            <div class="activity-item-actions">
              <button class="btn-item-action danger" onclick="ActivityTracker.handleTransferAction('${this.escapeHtml(fileId)}')" title="Cancel Transfer">
                <i class="fa-solid fa-trash-can"></i>
              </button>
            </div>
          </div>
          ${isPaused ? `<div class='resuming-indicator'><i class="fa-solid fa-pause"></i> Paused — ${this.escapeHtml(transfer.pausedLabel || 'waiting')}</div>` : ''}
          ${isResuming ? `<div class='resuming-indicator'>Resuming transfer...</div>` : ''}
          ${speedHistory.length > 0 ? this.renderSpeedGraph(speedHistory) : ''}
          <div class="activity-progress">
            <div class="progress-bar-bg">
              <div class="progress-bar-fill" style="width: ${rawProgress}%"></div>
            </div>
            <span class="progress-text">${displayPct}%</span>
          </div>
        </div>
      `;
    }).join('');

    return `
      <div class="activity-section">
        <div class="activity-section-header">
          <div style="display:flex; align-items:center;">
            <i class="fa-solid fa-arrows-up-down"></i>
            <span class="section-title">Transfers <span class="section-count">${transfers.length}</span></span>
          </div>
        </div>
        <div class="activity-section-items">
          ${transferItems}
        </div>
      </div>
    `;
  },

  setupEventListeners() {
    const container = this.panelRefs.activityContainer;
    if (!container) return;

    container.addEventListener('click', (e) => {
      const btn = e.target.closest('.activity-close-btn');
      if (!btn) return;

      const type = btn.dataset.type;
      const id = btn.dataset.id;

      if (type === 'p2p') {
        this.handleP2PRoomClose(id);
      } else if (type === 'hosted') {
        this.handleHostedLinkClose(id);
      } else if (type === 'transfer') {
        this.handleTransferClose(id);
      }
    });
  },

  async handleRoomAction(roomId) {
    if (await window.uiShared.CustomDialog.confirm('Leave Workspace?', 'Close connection and remove this room from activity?')) {
      this.handleRoomClose(roomId);
    }
  },
  async handleHostedAction(token) {
    if (await window.uiShared.CustomDialog.confirm('Delete Link?', 'Remove this file from our servers immediately?')) {
      this.handleHostedLinkClose(token);
    }
  },
  cancelHostedLinkOnServer(token) {
    if (typeof socket !== 'undefined' && socket.emit) {
      socket.emit('cancel-drop', token);
    }
    const fd = new FormData();
    fd.append('token', token);
    fetch('/drop-cancel', { method: 'POST', body: fd }).catch(() => { });
  },
  animateHostedLinkRemoval(token) {
    const el = document.getElementById(`activity-hosted-${token}`);
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const ghost = el.cloneNode(true);
    ghost.id = `activity-hosted-ghost-${token}`;
    ghost.style.position = 'fixed';
    ghost.style.left = `${rect.left}px`;
    ghost.style.top = `${rect.top}px`;
    ghost.style.width = `${rect.width}px`;
    ghost.style.height = `${rect.height}px`;
    ghost.style.margin = '0';
    ghost.style.zIndex = '9999';
    ghost.style.pointerEvents = 'none';
    document.body.appendChild(ghost);
    ghost.classList.add('vanish-sand');
    setTimeout(() => {
      ghost.remove();
    }, 800);
  },
  reopenHostedTransfer(token) {
    const link = this.state.hostedLinks[token];
    if (!link) return;

    localStorage.setItem('emit-active-hosted-token', token);
    localStorage.setItem('emit-active-hosted-state', link.status === 'ready' ? 'finished' : 'active');
    if (link.url) localStorage.setItem('emit-active-hosted-url', link.url);

    if (link.status !== 'ready' && typeof window.showHostedLiveUploadModal === 'function' && window.showHostedLiveUploadModal(token)) {
      return;
    }

    if (typeof window.restoreHostedTransferUI === 'function') {
      window.restoreHostedTransferUI(token, link.status === 'ready' ? 'finished' : 'active');
    }
  },
  async handleTransferAction(fileId) {
    if (await window.uiShared.CustomDialog.confirm('Cancel Transfer?', 'Stop this file transfer?')) {
      this.handleTransferClose(fileId);
    }
  },

  handleRoomClose(targetRoomId) {
    const el = document.getElementById(`activity-room-${targetRoomId}`);
    const performClose = () => {
      this.removeP2PRoom(targetRoomId);
      const activeRoomId = (typeof roomId !== 'undefined' && roomId) ? roomId : null;
      const activeSignalingId = (typeof signalingId !== 'undefined' && signalingId) ? signalingId : null;
      const cleanTarget = targetRoomId.toString().trim().toUpperCase();
      const cleanRoom = activeRoomId ? activeRoomId.toString().trim().toUpperCase() : '';
      const cleanSig = activeSignalingId ? activeSignalingId.toString().trim().toUpperCase() : '';
      const isCurrentActiveRoom = (cleanRoom && (cleanTarget === cleanRoom || cleanRoom.includes(cleanTarget) || cleanTarget.includes(cleanRoom))) ||
        (cleanSig && (cleanTarget === cleanSig || cleanSig.includes(cleanTarget) || cleanTarget.includes(cleanSig)));
      if (isCurrentActiveRoom && typeof window.forceLeave === 'function') {
        window.forceLeave(true);
      } else {
        if (typeof window.showScreen === 'function') window.showScreen('room');
      }
    };
    if (el) {
      if (typeof playProceduralSound === 'function') playProceduralSound('pop');
      el.classList.add('vanish-sand');
      setTimeout(performClose, 800);
    } else {
      performClose();
    }
  },

  handleHostedLinkClose(token) {
    dismissedHostedLinks[token] = true;

    if (localStorage.getItem('emit-active-hosted-token') === token) {
      localStorage.removeItem('emit-active-hosted-token');
      localStorage.removeItem('emit-active-hosted-state');
      localStorage.removeItem('emit-active-hosted-url');
      localStorage.removeItem('emit-active-hosted-filenames');
    }

    if (typeof playProceduralSound === 'function') playProceduralSound('pop');
    this.animateHostedLinkRemoval(token);
    this.cancelHostedLinkOnServer(token);
    this.removeHostedLink(token);
    delete dismissedHostedLinks[token];

    try {
      const saved = JSON.parse(localStorage.getItem('emit-hosted-links') || '{}');
      delete saved[token];
      localStorage.setItem('emit-hosted-links', JSON.stringify(saved));
    } catch (e) { }
  },

  switchToRoom(targetRoomId) {
    const activeRoomId = typeof roomId !== 'undefined' ? roomId : null;
    const activeSignalingId = typeof signalingId !== 'undefined' ? signalingId : null;
    if (targetRoomId === activeRoomId || targetRoomId === activeSignalingId) {
      if (typeof showScreen === 'function') {
        showScreen('room');
      }
    } else {
      window.location.href = `/?workspace=${targetRoomId}`;
    }
  },

  handleTransferClose(fileId) {
    const el = document.getElementById(`activity-transfer-${fileId}`);
    if (el) {
      if (typeof playProceduralSound === 'function') playProceduralSound('pop');
      el.classList.add('vanish-sand');
      setTimeout(() => {
        this.removeTransfer(fileId);
        window.dispatchEvent(new CustomEvent('cancel-transfer', { detail: { fileId } }));
      }, 800);
    } else {
      this.removeTransfer(fileId);
      window.dispatchEvent(new CustomEvent('cancel-transfer', { detail: { fileId } }));
    }
  },

  formatUptime(ms) {
    const seconds = Math.floor(ms / 1000);
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    return `${hours}h ago`;
  },

  formatTimeRemaining(ms) {
    if (window.uiShared && typeof window.uiShared.formatExpiryCountdown === 'function') {
      return window.uiShared.formatExpiryCountdown(ms);
    }
    if (ms <= 0) return 'Expired';
    const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;

    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${s.toString().padStart(2, '0')}s`;
    return `${s}s`;
  },

  formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return (bytes / Math.pow(k, i)).toFixed(2) + ' ' + sizes[i];
  },

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  },

  renderSpeedGraph(speedHistory = []) {
    if (!speedHistory || speedHistory.length === 0) return '';
    const maxSpeed = Math.max(...speedHistory, 1024 * 1024);
    const bars = speedHistory.map(speed => {
      const height = Math.max((speed / maxSpeed) * 100, 4);
      return `<div class="speed-bar" style="height: ${height}%; flex: 1;"></div>`;
    }).join('');
    return `<div class="speed-graph">${bars}</div>`;
  }
};

window.ActivityTracker = ActivityTracker;
window.ActivityTracker.setHostedLinkResuming = setHostedLinkResuming;
window.ActivityTracker.setP2PTransferResuming = setP2PTransferResuming;
