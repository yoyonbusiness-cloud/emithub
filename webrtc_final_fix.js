if (typeof initiatePeerConnection === 'undefined') {
    window.initiatePeerConnection = async function(targetId) {
        console.log('FIX: Initiating peer connection to', targetId);
        
        if (!peers[targetId]) {
            peers[targetId] = { id: targetId, name: 'Peer', pc: null, dc: null, channel: null };
        }
        
        const peer = peers[targetId];
        
        if (peer.pc) {
            try { peer.pc.close(); } catch (e) {}
            peer.pc = null;
            peer.dc = null;
            peer.channel = null;
        }
        
        const pc = new RTCPeerConnection({
            iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
        });
        
        peer.pc = pc;
        
        const dc = pc.createDataChannel('fileTransfer', { ordered: true });
        
        dc.onopen = () => {
            console.log('FIX: Data channel opened');
            peer.dc = dc;
            peer.channel = dc;
            
            if (typeof showToast === 'function') {
                showToast('Connected', 'Direct peer link established', 'success');
            }
        };
        
        dc.onclose = () => {
            console.log('FIX: Data channel closed');
            if (peer.channel === dc) {
                peer.channel = null;
                peer.dc = null;
            }
        };
        
        pc.onicecandidate = (e) => {
            if (e.candidate && socket && signalingId) {
                socket.emit('ice-candidate', e.candidate, signalingId, targetId);
            }
        };
        
        try {
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            
            if (socket && signalingId) {
                socket.emit('offer', pc.localDescription, signalingId, targetId);
            }
        } catch (err) {
            console.log('FIX: Error creating offer:', err);
        }
        
        return pc;
    };
}

console.log('FIX: webrtc.js fixes applied');