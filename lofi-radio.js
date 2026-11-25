(function () {
    var ctx = null;
    var masterGain = null;

    var STATIONS = [
        {
            title: 'Cozy Afternoon',
            subtitle: 'Track 01 · Warm Sunlit Keys',
            chords: [
                { notes: [261.63, 329.63, 392.00, 493.88, 587.33], root: 65.41 },
                { notes: [220.00, 261.63, 329.63, 392.00, 493.88], root: 55.00 },
                { notes: [174.61, 261.63, 329.63, 392.00, 523.25], root: 43.65 },
                { notes: [196.00, 246.94, 293.66, 329.63, 392.00], root: 49.00 }
            ],
            type: 'sine',
            filterFreq: 1100,
            arpRate: 350
        },
        {
            title: 'Coffee & Books',
            subtitle: 'Track 02 · Sweet Cafe Bossa',
            chords: [
                { notes: [220.00, 261.63, 293.66, 349.23, 440.00], root: 73.42 },
                { notes: [196.00, 246.94, 293.66, 329.63, 349.23], root: 49.00 },
                { notes: [261.63, 329.63, 392.00, 493.88, 523.25], root: 65.41 },
                { notes: [220.00, 277.18, 329.63, 349.23, 440.00], root: 55.00 }
            ],
            type: 'triangle',
            filterFreq: 950,
            arpRate: 0
        },
        {
            title: 'Rainy Window',
            subtitle: 'Track 03 · Daydreaming Piano',
            chords: [
                { notes: [261.63, 329.63, 392.00, 523.25, 659.25], root: 43.65 },
                { notes: [246.94, 293.66, 329.63, 392.00, 493.88], root: 49.00 },
                { notes: [246.94, 293.66, 329.63, 392.00, 440.00], root: 41.20 },
                { notes: [220.00, 261.63, 329.63, 392.00, 523.25], root: 55.00 }
            ],
            type: 'sine',
            filterFreq: 1250,
            arpRate: 380
        },
        {
            title: 'Sunday Morning',
            subtitle: 'Track 04 · Soul & Sunshine',
            chords: [
                { notes: [233.08, 293.66, 349.23, 440.00, 523.25], root: 58.27 },
                { notes: [233.08, 311.13, 392.00, 466.16, 523.25], root: 77.78 },
                { notes: [196.00, 261.63, 311.13, 392.00, 466.16], root: 65.41 },
                { notes: [261.63, 349.23, 392.00, 466.16, 523.25], root: 43.65 }
            ],
            type: 'triangle',
            filterFreq: 1050,
            arpRate: 420
        },
        {
            title: 'Stargaze Lofi',
            subtitle: 'Track 05 · Dreamy Cloudscapes',
            chords: [
                { notes: [277.18, 349.23, 415.30, 523.25, 622.25], root: 69.30 },
                { notes: [207.65, 261.63, 311.13, 415.30, 523.25], root: 51.91 },
                { notes: [233.08, 277.18, 349.23, 415.30, 523.25], root: 58.27 },
                { notes: [185.00, 277.18, 349.23, 440.00, 523.25], root: 46.25 }
            ],
            type: 'sine',
            filterFreq: 1300,
            arpRate: 300
        }
    ];

    var currentStationIdx = 0;
    var chordIdx = 0;
    var chordNodes = [];
    var arpInterval = null;
    var vinylNode = null;
    var rainNode = null;
    var vinylGain = null;
    var rainGain = null;
    var playing = false;

    function ensureCtx() {
        if (!ctx) {
            ctx = new (window.AudioContext || window.webkitAudioContext)();
            masterGain = ctx.createGain();
            masterGain.gain.value = 0.55;
            masterGain.connect(ctx.destination);
        }
        if (ctx.state === 'suspended') ctx.resume();
    }

    function makeChordNodes(chordObj, station) {
        var nodes = [];
        var notes = chordObj.notes;

        notes.forEach(function (freq, i) {
            var osc = ctx.createOscillator();
            var gain = ctx.createGain();
            var filter = ctx.createBiquadFilter();

            osc.type = station.type || 'sine';
            osc.frequency.value = freq;

            filter.type = 'lowpass';
            filter.frequency.value = station.filterFreq + (Math.random() * 100);
            filter.Q.value = 0.8;

            gain.gain.setValueAtTime(0, ctx.currentTime);
            gain.gain.linearRampToValueAtTime(0.075 - (i * 0.008), ctx.currentTime + 0.9);

            osc.connect(filter);
            filter.connect(gain);
            gain.connect(masterGain);
            osc.start();
            nodes.push({ osc: osc, gain: gain });
        });

        if (chordObj.root) {
            var bassOsc = ctx.createOscillator();
            var bassGain = ctx.createGain();
            var bassFilter = ctx.createBiquadFilter();

            bassOsc.type = 'sine';
            bassOsc.frequency.value = chordObj.root;

            bassFilter.type = 'lowpass';
            bassFilter.frequency.value = 160;

            bassGain.gain.setValueAtTime(0, ctx.currentTime);
            bassGain.gain.linearRampToValueAtTime(0.12, ctx.currentTime + 0.8);

            bassOsc.connect(bassFilter);
            bassFilter.connect(bassGain);
            bassGain.connect(masterGain);
            bassOsc.start();
            nodes.push({ osc: bassOsc, gain: bassGain });
        }

        if (station.arpRate > 0) {
            startArpeggio(notes, station);
        }

        return nodes;
    }

    function startArpeggio(notes, station) {
        if (arpInterval) clearInterval(arpInterval);
        var arpIdx = 0;
        arpInterval = setInterval(function () {
            if (!playing || !ctx) return;
            var freq = notes[arpIdx % notes.length];
            arpIdx++;

            var arpOsc = ctx.createOscillator();
            var arpGain = ctx.createGain();
            var arpFilter = ctx.createBiquadFilter();

            arpOsc.type = 'triangle';
            arpOsc.frequency.value = freq * 1.5;
            arpFilter.type = 'lowpass';
            arpFilter.frequency.value = 1600;
            arpFilter.Q.value = 1.0;

            arpGain.gain.setValueAtTime(0.028, ctx.currentTime);
            arpGain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.45);

            arpOsc.connect(arpFilter);
            arpFilter.connect(arpGain);
            arpGain.connect(masterGain);

            arpOsc.start();
            arpOsc.stop(ctx.currentTime + 0.5);
        }, station.arpRate);
    }

    function stopArpeggio() {
        if (arpInterval) {
            clearInterval(arpInterval);
            arpInterval = null;
        }
    }

    function releaseChordNodes(nodes) {
        nodes.forEach(function (n) {
            try {
                n.gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 2.0);
                n.osc.stop(ctx.currentTime + 2.2);
            } catch (e) { }
        });
    }

    function scheduleNextChord() {
        if (!playing) return;
        var st = STATIONS[currentStationIdx];
        var delay = 5200 + Math.random() * 1800;
        window._lofichordtimer = setTimeout(function () {
            releaseChordNodes(chordNodes);
            chordIdx = (chordIdx + 1) % st.chords.length;
            chordNodes = makeChordNodes(st.chords[chordIdx], st);
            scheduleNextChord();
        }, delay);
    }

    function makeNoise(amplitude, filterType, filterFreq, filterQ, loopSecs) {
        var bufLen = Math.floor(ctx.sampleRate * loopSecs);
        var buf = ctx.createBuffer(1, bufLen, ctx.sampleRate);
        var data = buf.getChannelData(0);
        for (var i = 0; i < bufLen; i++) data[i] = (Math.random() * 2 - 1) * amplitude;
        var src = ctx.createBufferSource();
        src.buffer = buf;
        src.loop = true;
        var gainNode = ctx.createGain();
        var flt = ctx.createBiquadFilter();
        flt.type = filterType;
        flt.frequency.value = filterFreq;
        flt.Q.value = filterQ;
        src.connect(flt);
        flt.connect(gainNode);
        gainNode.connect(masterGain);
        src.start();
        return { src: src, gain: gainNode };
    }

    function startVinyl() {
        if (vinylNode) return;
        var n = makeNoise(0.016, 'bandpass', 3200, 0.5, 2);
        vinylNode = n.src;
        vinylGain = n.gain;
        vinylGain.gain.value = 0.16;
    }

    function stopVinyl() {
        if (vinylNode) { try { vinylNode.stop(); } catch (e) { } vinylNode = null; }
    }

    function startRain() {
        if (rainNode) return;
        var n = makeNoise(0.06, 'lowpass', 650, 0.4, 3);
        rainNode = n.src;
        rainGain = n.gain;
        rainGain.gain.value = 0.20;
    }

    function stopRain() {
        if (rainNode) { try { rainNode.stop(); } catch (e) { } rainNode = null; }
    }

    var tickerTimers = {};

    function runTicker(el) {
        var id = el.id;
        if (tickerTimers[id]) {
            clearTimeout(tickerTimers[id]);
            clearInterval(tickerTimers[id + '_iv']);
        }
        el.style.transition = 'none';
        el.style.transform = 'translateX(0px)';
        el.offsetWidth;
        var wrapper = el.parentElement;
        if (!wrapper) return;
        var overflow = el.scrollWidth - wrapper.clientWidth;
        if (overflow <= 0) return;
        var scroll = function () {
            el.style.transition = 'transform 2.2s cubic-bezier(0.45, 0, 0.55, 1)';
            el.style.transform = 'translateX(-' + overflow + 'px)';
            tickerTimers[id] = setTimeout(function () {
                el.style.transition = 'transform 1.8s cubic-bezier(0.45, 0, 0.55, 1)';
                el.style.transform = 'translateX(0px)';
                tickerTimers[id] = setTimeout(scroll, 2800);
            }, 2400);
        };
        tickerTimers[id] = setTimeout(scroll, 1200);
    }

    function updateTrackUI() {
        var st = STATIONS[currentStationIdx];
        var titleEl = document.getElementById('lofi-track-title');
        var subEl = document.getElementById('lofi-track-sub');
        if (titleEl) {
            titleEl.style.transition = 'none';
            titleEl.style.transform = 'translateX(0px)';
            titleEl.textContent = st.title;
            titleEl.offsetWidth;
            runTicker(titleEl);
        }
        if (subEl) {
            subEl.style.transition = 'none';
            subEl.style.transform = 'translateX(0px)';
            subEl.textContent = st.subtitle;
            subEl.offsetWidth;
            runTicker(subEl);
        }
    }

    function startProceduralEngine() {
        var st = STATIONS[currentStationIdx];
        chordNodes = makeChordNodes(st.chords[chordIdx], st);
        startVinyl();
        startRain();
        scheduleNextChord();
        updateTrackUI();
    }

    function stopProceduralEngine() {
        clearTimeout(window._lofichordtimer);
        stopArpeggio();
        releaseChordNodes(chordNodes);
        chordNodes = [];
        stopVinyl();
        stopRain();
    }

    var rainAnimId = null;
    var rainCanvas = null;
    var rainCtx = null;
    var drops = [];
    var ripples = [];
    var fireflies = [];
    var bokehOrbs = [];
    var mouseX = -999;
    var mouseY = -999;

    function initRainCanvas() {
        rainCanvas = document.getElementById('lofi-rain-canvas');
        if (!rainCanvas) return;
        rainCtx = rainCanvas.getContext('2d');
        resizeRainCanvas();
        window.removeEventListener('resize', resizeRainCanvas);
        window.addEventListener('resize', resizeRainCanvas);

        window.removeEventListener('mousemove', onRainMouseMove);
        window.addEventListener('mousemove', onRainMouseMove);

        drops = [];
        for (var i = 0; i < 90; i++) {
            drops.push({
                x: Math.random() * window.innerWidth,
                y: Math.random() * window.innerHeight,
                len: 15 + Math.random() * 25,
                speed: 12 + Math.random() * 10,
                opacity: 0.15 + Math.random() * 0.35,
                width: 1 + Math.random() * 1.5
            });
        }

        ripples = [];
        for (var j = 0; j < 18; j++) {
            ripples.push({
                x: Math.random() * window.innerWidth,
                y: Math.random() * window.innerHeight,
                r: Math.random() * 4 + 1,
                maxR: 12 + Math.random() * 16,
                opacity: 0.1 + Math.random() * 0.35,
                speed: 0.2 + Math.random() * 0.3
            });
        }

        fireflies = [];
        for (var f = 0; f < 26; f++) {
            fireflies.push({
                x: Math.random() * window.innerWidth,
                y: Math.random() * window.innerHeight,
                radius: 1.2 + Math.random() * 2.2,
                vx: (Math.random() - 0.5) * 0.5,
                vy: -0.2 - Math.random() * 0.4,
                alpha: Math.random() * 0.5 + 0.2
            });
        }

        bokehOrbs = [];
        for (var b = 0; b < 10; b++) {
            bokehOrbs.push({
                x: Math.random() * window.innerWidth,
                y: Math.random() * window.innerHeight,
                radius: 40 + Math.random() * 70,
                vx: (Math.random() - 0.5) * 0.3,
                vy: (Math.random() - 0.5) * 0.3,
                alpha: 0.03 + Math.random() * 0.05
            });
        }
    }

    function onRainMouseMove(e) {
        mouseX = e.clientX;
        mouseY = e.clientY;
    }

    function resizeRainCanvas() {
        if (!rainCanvas) return;
        rainCanvas.width = window.innerWidth;
        rainCanvas.height = window.innerHeight;
    }

    function renderRain() {
        if (!rainCanvas || !rainCtx) return;
        var isPink = document.documentElement.classList.contains('lofi-mood-pink');
        var isRoom = document.documentElement.classList.contains('lofi-mood-room');
        rainCtx.clearRect(0, 0, rainCanvas.width, rainCanvas.height);

        for (var b = 0; b < bokehOrbs.length; b++) {
            var bo = bokehOrbs[b];
            bo.x += bo.vx;
            bo.y += bo.vy;
            if (bo.x < -bo.radius) bo.x = rainCanvas.width + bo.radius;
            if (bo.x > rainCanvas.width + bo.radius) bo.x = -bo.radius;
            if (bo.y < -bo.radius) bo.y = rainCanvas.height + bo.radius;
            if (bo.y > rainCanvas.height + bo.radius) bo.y = -bo.radius;

            var orbGrad = rainCtx.createRadialGradient(bo.x, bo.y, 0, bo.x, bo.y, bo.radius);
            var orbColor = isPink ? 'rgba(244, 114, 182, ' : (isRoom ? 'rgba(52, 211, 153, ' : 'rgba(129, 140, 248, ');
            orbGrad.addColorStop(0, orbColor + bo.alpha + ')');
            orbGrad.addColorStop(1, 'transparent');

            rainCtx.beginPath();
            rainCtx.fillStyle = orbGrad;
            rainCtx.arc(bo.x, bo.y, bo.radius, 0, Math.PI * 2);
            rainCtx.fill();
        }

        var dropColor = isPink ? 'rgba(244, 114, 182, ' : (isRoom ? 'rgba(167, 243, 208, ' : 'rgba(129, 140, 248, ');
        var rippleColor = isPink ? 'rgba(251, 207, 232, ' : (isRoom ? 'rgba(110, 231, 183, ' : 'rgba(199, 210, 254, ');

        for (var i = 0; i < drops.length; i++) {
            var d = drops[i];

            var distToMouse = Math.hypot(d.x - mouseX, d.y - mouseY);
            var isWiped = distToMouse < 90;

            if (!isWiped) {
                rainCtx.beginPath();
                rainCtx.moveTo(d.x, d.y);
                rainCtx.lineTo(d.x - 3, d.y + d.len);
                rainCtx.strokeStyle = dropColor + d.opacity + ')';
                rainCtx.lineWidth = d.width;
                rainCtx.lineCap = 'round';
                rainCtx.stroke();
            }

            d.y += d.speed;
            d.x -= 1.5;

            if (d.y > rainCanvas.height) {
                d.y = -d.len;
                d.x = Math.random() * (rainCanvas.width + 100);
            }
        }

        for (var k = 0; k < ripples.length; k++) {
            var rp = ripples[k];
            var distM = Math.hypot(rp.x - mouseX, rp.y - mouseY);
            if (distM >= 80) {
                rainCtx.beginPath();
                rainCtx.arc(rp.x, rp.y, rp.r, 0, Math.PI * 2);
                rainCtx.strokeStyle = rippleColor + rp.opacity + ')';
                rainCtx.lineWidth = 1;
                rainCtx.stroke();
            }

            rp.r += rp.speed;
            rp.opacity -= 0.004;

            if (rp.opacity <= 0 || rp.r >= rp.maxR) {
                rp.x = Math.random() * rainCanvas.width;
                rp.y = Math.random() * rainCanvas.height;
                rp.r = 1;
                rp.maxR = 10 + Math.random() * 16;
                rp.opacity = 0.2 + Math.random() * 0.3;
            }
        }

        for (var f = 0; f < fireflies.length; f++) {
            var ff = fireflies[f];
            ff.x += ff.vx;
            ff.y += ff.vy;
            if (ff.y < -10) ff.y = rainCanvas.height + 10;
            if (ff.x < -10) ff.x = rainCanvas.width + 10;
            if (ff.x > rainCanvas.width + 10) ff.x = -10;

            rainCtx.beginPath();
            rainCtx.arc(ff.x, ff.y, ff.radius, 0, Math.PI * 2);
            var glow = isPink ? 'rgba(251, 191, 36, ' : (isRoom ? 'rgba(245, 158, 11, ' : 'rgba(224, 231, 255, ');
            rainCtx.fillStyle = glow + Math.max(0.1, Math.min(0.7, ff.alpha)) + ')';
            rainCtx.shadowBlur = 6;
            rainCtx.shadowColor = isPink ? '#f59e0b' : (isRoom ? '#6366f1' : '#818cf8');
            rainCtx.fill();
            rainCtx.shadowBlur = 0;
        }

        if (mouseX > 0 && mouseY > 0) {
            rainCtx.beginPath();
            var glowGrad = rainCtx.createRadialGradient(mouseX, mouseY, 10, mouseX, mouseY, 90);
            glowGrad.addColorStop(0, isPink ? 'rgba(244, 114, 182, 0.08)' : (isRoom ? 'rgba(52, 211, 153, 0.08)' : 'rgba(129, 140, 248, 0.08)'));
            glowGrad.addColorStop(1, 'transparent');
            rainCtx.fillStyle = glowGrad;
            rainCtx.arc(mouseX, mouseY, 90, 0, Math.PI * 2);
            rainCtx.fill();
        }

        rainAnimId = requestAnimationFrame(renderRain);
    }

    function startRainCanvas() {
        if (!rainCanvas) initRainCanvas();
        if (!rainCanvas) return;
        rainCanvas.style.display = 'block';
        if (!rainAnimId) {
            renderRain();
        }
    }

    function stopRainCanvas() {
        if (rainAnimId) {
            cancelAnimationFrame(rainAnimId);
            rainAnimId = null;
        }
        if (rainCanvas) {
            rainCanvas.style.display = 'none';
            if (rainCtx) rainCtx.clearRect(0, 0, rainCanvas.width, rainCanvas.height);
        }
        stopAurora();
    }

    var auroraCanvas = null;
    var auroraCtx = null;
    var auroraAnimId = null;
    var auroraTime = 0;

    function initAurora() {
        auroraCanvas = document.getElementById('lofi-aurora-canvas');
        if (!auroraCanvas) return;
        auroraCtx = auroraCanvas.getContext('2d');
        auroraCanvas.width = window.innerWidth;
        auroraCanvas.height = window.innerHeight;
        window.addEventListener('resize', function () {
            if (auroraCanvas) {
                auroraCanvas.width = window.innerWidth;
                auroraCanvas.height = window.innerHeight;
            }
        });
    }

    function renderAurora() {
        if (!auroraCanvas || !auroraCtx) return;
        var isPink = document.documentElement.classList.contains('lofi-mood-pink');
        auroraTime += 0.008;
        var w = auroraCanvas.width;
        var h = auroraCanvas.height;
        auroraCtx.clearRect(0, 0, w, h);

        var blobs = [
            { cx: 0.18 + 0.14 * Math.sin(auroraTime * 0.7), cy: 0.60 + 0.12 * Math.cos(auroraTime * 0.5), rx: 0.42, ry: 0.28, a: 0.08 },
            { cx: 0.78 + 0.12 * Math.cos(auroraTime * 0.6), cy: 0.35 + 0.10 * Math.sin(auroraTime * 0.8), rx: 0.36, ry: 0.24, a: 0.06 },
            { cx: 0.48 + 0.15 * Math.sin(auroraTime * 0.4), cy: 0.78 + 0.08 * Math.cos(auroraTime * 0.9), rx: 0.48, ry: 0.22, a: 0.05 },
            { cx: 0.85 + 0.08 * Math.cos(auroraTime * 1.1), cy: 0.70 + 0.14 * Math.sin(auroraTime * 0.6), rx: 0.32, ry: 0.22, a: 0.05 }
        ];

        blobs.forEach(function (b) {
            var cx = b.cx * w;
            var cy = b.cy * h;
            var rx = b.rx * w;
            var ry = b.ry * h;

            auroraCtx.save();
            auroraCtx.scale(1, ry / rx);
            var grad = auroraCtx.createRadialGradient(cx, cy * rx / ry, 0, cx, cy * rx / ry, rx);

            if (isPink) {
                grad.addColorStop(0, 'rgba(244, 114, 182, ' + b.a + ')');
                grad.addColorStop(0.45, 'rgba(168, 85, 247, ' + (b.a * 0.6) + ')');
                grad.addColorStop(1, 'transparent');
            } else {
                grad.addColorStop(0, 'rgba(56, 189, 248, ' + b.a + ')');
                grad.addColorStop(0.45, 'rgba(14, 165, 233, ' + (b.a * 0.6) + ')');
                grad.addColorStop(1, 'transparent');
            }

            auroraCtx.fillStyle = grad;
            auroraCtx.beginPath();
            auroraCtx.arc(cx, cy * rx / ry, rx, 0, Math.PI * 2);
            auroraCtx.fill();
            auroraCtx.restore();
        });

        auroraAnimId = requestAnimationFrame(renderAurora);
    }

    function startAurora() {
        if (!auroraCanvas) initAurora();
        if (!auroraCanvas) return;
        auroraCanvas.style.display = 'block';
        if (!auroraAnimId) renderAurora();
    }

    function stopAurora() {
        if (auroraAnimId) {
            cancelAnimationFrame(auroraAnimId);
            auroraAnimId = null;
        }
        if (auroraCanvas) {
            auroraCanvas.style.display = 'none';
            if (auroraCtx) auroraCtx.clearRect(0, 0, auroraCanvas.width, auroraCanvas.height);
        }
    }

    window.LoFiRadio = {
        play: function () {
            ensureCtx();
            playing = true;
            startProceduralEngine();
            var player = document.getElementById('lofi-radio-player');
            if (player) player.classList.add('playing');
        },
        pause: function () {
            playing = false;
            stopProceduralEngine();
            var player = document.getElementById('lofi-radio-player');
            if (player) player.classList.remove('playing');
        },
        next: function () {
            currentStationIdx = (currentStationIdx + 1) % STATIONS.length;
            chordIdx = 0;
            updateTrackUI();
            if (playing) {
                stopProceduralEngine();
                startProceduralEngine();
            }
            if (typeof showToast === 'function') {
                showToast('Station Changed', STATIONS[currentStationIdx].title + ' — ' + STATIONS[currentStationIdx].subtitle, 'info');
            }
        },
        setVolume: function (v) {
            ensureCtx();
            masterGain.gain.linearRampToValueAtTime(Math.max(0, Math.min(1, v)), ctx.currentTime + 0.1);
        },
        setVinylLevel: function (v) {
            if (vinylGain) vinylGain.gain.linearRampToValueAtTime(Math.max(0, Math.min(1, v)), ctx.currentTime + 0.1);
        },
        setRainLevel: function (v) {
            if (rainGain) rainGain.gain.linearRampToValueAtTime(Math.max(0, Math.min(1, v)), ctx.currentTime + 0.1);
        },
        isPlaying: function () { return playing; },
        getCurrentStation: function () { return STATIONS[currentStationIdx]; },
        startRainCanvas: function () {
            startRainCanvas();
            startAurora();
        },
        stopRainCanvas: function () {
            stopRainCanvas();
            stopAurora();
        },
        toggleMood: function () {
            var el = document.documentElement;
            var isPink = el.classList.toggle('lofi-mood-pink');
            var nextMood = isPink ? 'pink' : 'blue';

            try {
                localStorage.setItem('emit-lofi-mood', nextMood);
            } catch (e) { }
            return nextMood;
        }
    };
})();