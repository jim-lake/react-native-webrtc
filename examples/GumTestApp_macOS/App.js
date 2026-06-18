/**
 * Sample React Native App for macOS - WebRTC Offer/Answer Test
 */

import React, {useState, useRef} from 'react';
import {
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  mediaDevices,
  RTCPeerConnection,
  RTCSessionDescription,
  RTCIceCandidate,
  RTCView,
} from 'react-native-webrtc';

const configuration = {iceServers: [{urls: 'stun:stun.l.google.com:19302'}]};

const App = () => {
  console.log('[App] render');
  const [enableVideo, setEnableVideo] = useState(true);
  const [enableAudio, setEnableAudio] = useState(true);
  const [localOffer, setLocalOffer] = useState('');
  const [remoteOfferInput, setRemoteOfferInput] = useState('');
  const [localAnswer, setLocalAnswer] = useState('');
  const [localStream, setLocalStream] = useState(null);
  const [remoteStream, setRemoteStream] = useState(null);
  const [status, setStatus] = useState('');

  const pcRef = useRef(null);
  const iceCandidatesRef = useRef([]);
  const gatheredRef = useRef(false);

  const finishGathering = (pc) => {
    console.log('finishGathering: called, already gathered=', gatheredRef.current);
    if (gatheredRef.current) return;
    gatheredRef.current = true;
    const desc = pc.localDescription;
    console.log('finishGathering: localDescription=', desc?.type, 'sdp length=', desc?.sdp?.length);
    if (!desc) {
      console.log('finishGathering: no local description, aborting');
      return;
    }
    const payload = JSON.stringify({
      sdp: desc,
      candidates: iceCandidatesRef.current,
    });
    console.log('finishGathering: gathered', iceCandidatesRef.current.length, 'candidates, payload length=', payload.length);
    console.log('finishGathering: desc.type=', desc.type, 'calling setState now');
    if (desc.type === 'offer') {
      console.log('finishGathering: setting localOffer');
      setLocalOffer(payload);
      setLocalAnswer('');
    } else {
      console.log('finishGathering: setting localAnswer');
      setLocalAnswer(payload);
      setLocalOffer('');
    }
    console.log('finishGathering: setting status');
    setStatus('Ready - ' + iceCandidatesRef.current.length + ' candidates');
  };

  const createPeerConnection = () => {
    console.log('createPeerConnection: creating with config', JSON.stringify(configuration));
    const pc = new RTCPeerConnection(configuration);
    console.log('createPeerConnection: created, signalingState=', pc.signalingState, 'iceGatheringState=', pc.iceGatheringState, 'iceConnectionState=', pc.iceConnectionState);

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        console.log('onicecandidate: got candidate, protocol=', event.candidate.protocol, 'type=', event.candidate.type, 'address=', event.candidate.address);
        iceCandidatesRef.current.push(event.candidate);
        if (pc._scheduleFinish) pc._scheduleFinish();
      } else {
        console.log('onicecandidate: null candidate (gathering complete signal)');
        finishGathering(pc);
      }
    };

    pc.onicegatheringstatechange = () => {
      const state = pc.iceGatheringState;
      console.log('onicegatheringstatechange:', state);
      setStatus('ICE gathering: ' + state);
      if (state === 'complete') {
        finishGathering(pc);
      }
    };

    pc.oniceconnectionstatechange = () => {
      const state = pc.iceConnectionState;
      console.log('oniceconnectionstatechange:', state);
      setStatus('ICE connection: ' + state);
    };

    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      console.log('onconnectionstatechange:', state);
      setStatus('Connection: ' + state);
    };

    pc.onsignalingstatechange = () => {
      const state = pc.signalingState;
      console.log('onsignalingstatechange:', state);
      setStatus('Signaling: ' + state);
    };

    pc.onicecandidateerror = (event) => {
      console.log('onicecandidateerror:', JSON.stringify(event));
      setStatus('ICE error: ' + (event.errorText || event.errorCode || JSON.stringify(event)));
    };

    pc.onnegotiationneeded = () => {
      console.log('onnegotiationneeded fired');
    };

    pc.ondatachannel = (event) => {
      console.log('ondatachannel:', event.channel?.label);
    };

    pc.ontrack = (event) => {
      console.log('ontrack: kind=', event.track?.kind, 'streams=', event.streams?.length);
      if (event.streams && event.streams[0]) {
        setRemoteStream(event.streams[0]);
      }
    };

    pcRef.current = pc;
    iceCandidatesRef.current = [];
    gatheredRef.current = false;

    // On macOS, ICE gathering complete event may never fire.
    // Use a debounce: finish 2s after the last candidate arrives.
    let candidateTimer = null;
    const scheduleFinish = () => {
      if (candidateTimer) clearTimeout(candidateTimer);
      candidateTimer = setTimeout(() => {
        console.log('ICE debounce: no new candidates for 2s, finishing');
        finishGathering(pc);
      }, 2000);
    };
    // Start timer immediately in case no candidates arrive at all
    scheduleFinish();
    pc._scheduleFinish = scheduleFinish;

    return pc;
  };

  const createOffer = async () => {
    try {
      setStatus('Creating offer...');
      console.log('createOffer: start, enableVideo=', enableVideo, 'enableAudio=', enableAudio);
      const pc = createPeerConnection();
      console.log('createOffer: peer connection created');

      if (enableVideo || enableAudio) {
        console.log('createOffer: requesting getUserMedia');
        const stream = await mediaDevices.getUserMedia({
          video: enableVideo,
          audio: enableAudio,
        });
        console.log('createOffer: got stream, tracks:', stream.getTracks().length);
        setLocalStream(stream);
        stream.getTracks().forEach((track) => {
          console.log('createOffer: adding track', track.kind, track.id);
          pc.addTrack(track, stream);
        });
      } else {
        console.log('createOffer: no media requested, creating data channel for ICE');
        pc.createDataChannel('dummy');
      }

      console.log('createOffer: calling createOffer');
      const offer = await pc.createOffer();
      console.log('createOffer: offer created, type=', offer.type, 'sdp length=', offer.sdp?.length);
      console.log('createOffer: calling setLocalDescription');
      await pc.setLocalDescription(offer);
      console.log('createOffer: setLocalDescription done, signalingState=', pc.signalingState, 'iceGatheringState=', pc.iceGatheringState);
      setStatus('Offer created, gathering ICE candidates...\nSignaling: ' + pc.signalingState + '\nICE gathering: ' + pc.iceGatheringState);
    } catch (e) {
      console.error('createOffer ERROR:', e);
      setStatus('Error: ' + e.message);
    }
  };

  const createAnswer = async () => {
    try {
      if (!remoteOfferInput) {
        setStatus('Paste a remote offer first');
        return;
      }
      setStatus('Creating answer...');
      console.log('createAnswer: start');
      let parsed;
      try {
        parsed = JSON.parse(remoteOfferInput);
      } catch (parseErr) {
        console.error('createAnswer: JSON parse failed:', parseErr);
        setStatus('Error: invalid JSON - ' + parseErr.message);
        return;
      }
      const {sdp, candidates} = parsed;
      console.log('createAnswer: parsed remote, sdp type=', sdp?.type, 'candidates=', candidates?.length);

      const pc = createPeerConnection();
      console.log('createAnswer: peer connection created');

      // Add local media if enabled
      if (enableVideo || enableAudio) {
        console.log('createAnswer: requesting getUserMedia');
        const stream = await mediaDevices.getUserMedia({
          video: enableVideo,
          audio: enableAudio,
        });
        console.log('createAnswer: got stream, tracks:', stream.getTracks().length);
        setLocalStream(stream);
        stream.getTracks().forEach((track) => {
          console.log('createAnswer: adding track', track.kind, track.id);
          pc.addTrack(track, stream);
        });
      }

      console.log('createAnswer: calling setRemoteDescription');
      await pc.setRemoteDescription(new RTCSessionDescription(sdp));
      console.log('createAnswer: setRemoteDescription done, signalingState=', pc.signalingState);

      // Add remote ICE candidates
      console.log('createAnswer: adding', candidates.length, 'remote ICE candidates');
      for (const candidate of candidates) {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      }
      console.log('createAnswer: all remote candidates added');

      console.log('createAnswer: calling createAnswer');
      const answer = await pc.createAnswer();
      console.log('createAnswer: answer created, type=', answer.type, 'sdp length=', answer.sdp?.length);
      console.log('createAnswer: calling setLocalDescription');
      await pc.setLocalDescription(answer);
      console.log('createAnswer: setLocalDescription done, signalingState=', pc.signalingState, 'iceGatheringState=', pc.iceGatheringState);
      setStatus('Answer created, gathering ICE candidates...\nSignaling: ' + pc.signalingState + '\nICE gathering: ' + pc.iceGatheringState);
    } catch (e) {
      console.error('createAnswer ERROR:', e);
      setStatus('Error: ' + e.message);
    }
  };

  const connect = async () => {
    try {
      if (!pcRef.current) {
        setStatus('Create an offer or answer first');
        console.log('connect: no peer connection');
        return;
      }
      if (!remoteOfferInput) {
        setStatus('Paste remote offer/answer first');
        console.log('connect: no remote input');
        return;
      }

      console.log('connect: start');
      const pc = pcRef.current;
      console.log('connect: current signalingState=', pc.signalingState, 'iceConnectionState=', pc.iceConnectionState, 'connectionState=', pc.connectionState);

      let parsed;
      try {
        parsed = JSON.parse(remoteOfferInput);
      } catch (parseErr) {
        console.error('connect: JSON parse failed:', parseErr);
        setStatus('Error: invalid JSON - ' + parseErr.message);
        return;
      }
      const {sdp, candidates} = parsed;
      console.log('connect: parsed remote, sdp type=', sdp?.type, 'candidates=', candidates?.length);

      if (!pc.remoteDescription) {
        console.log('connect: calling setRemoteDescription');
        await pc.setRemoteDescription(new RTCSessionDescription(sdp));
        console.log('connect: setRemoteDescription done, signalingState=', pc.signalingState);
      } else {
        console.log('connect: remoteDescription already set, skipping');
      }

      console.log('connect: adding', candidates.length, 'remote ICE candidates');
      for (const candidate of candidates) {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      }
      console.log('connect: all remote candidates added');
      console.log('connect: iceConnectionState=', pc.iceConnectionState, 'connectionState=', pc.connectionState);

      setStatus('Connecting...\nICE connection: ' + pc.iceConnectionState + '\nConnection: ' + pc.connectionState);
    } catch (e) {
      console.error('connect ERROR:', e);
      setStatus('Error: ' + e.message);
    }
  };

  const reset = () => {
    console.log('reset: clearing all state');
    if (pcRef.current) {
      pcRef.current.close();
    }
    if (localStream) {
      localStream.release();
    }
    pcRef.current = null;
    iceCandidatesRef.current = [];
    gatheredRef.current = false;
    setLocalStream(null);
    setRemoteStream(null);
    setLocalOffer('');
    setLocalAnswer('');
    setRemoteOfferInput('');
    setStatus('');
  };

  return (
    <SafeAreaView style={styles.body}>
      <ScrollView contentContainerStyle={styles.container}>
        {/* Video views */}
        <View style={styles.videoContainer}>
          <View style={styles.videoWrapper}>
            {localStream ? (
              <RTCView streamURL={localStream.toURL()} style={styles.video} />
            ) : (
              <Text style={styles.videoPlaceholder}>Local Video</Text>
            )}
          </View>
          <View style={styles.videoWrapper}>
            {remoteStream ? (
              <RTCView streamURL={remoteStream.toURL()} style={styles.video} />
            ) : (
              <Text style={styles.videoPlaceholder}>Remote Video</Text>
            )}
          </View>
        </View>

        {/* Switches */}
        <View style={styles.row}>
          <View style={styles.switchRow}>
            <Text style={styles.text}>Enable Video</Text>
            <View style={styles.switchBox}>
              <Switch value={enableVideo} onValueChange={setEnableVideo} trackColor={{false: '#ccc', true: '#2563eb'}} thumbColor="#fff" />
            </View>
          </View>
          <View style={[styles.switchRow, styles.spacer]}>
            <Text style={styles.text}>Enable Audio</Text>
            <View style={styles.switchBox}>
              <Switch value={enableAudio} onValueChange={setEnableAudio} trackColor={{false: '#ccc', true: '#2563eb'}} thumbColor="#fff" />
            </View>
          </View>
        </View>

        {/* Create Offer */}
        <View style={styles.row}>
          <TouchableOpacity style={styles.button} onPress={createOffer}>
            <Text style={styles.buttonText}>Create Offer</Text>
          </TouchableOpacity>
        </View>

        {/* Local Offer/Answer (read-only, copyable) */}
        <Text style={styles.label}>Local Offer/Answer (copy this):</Text>
        <TextInput
          style={styles.textBox}
          value={localOffer || localAnswer}
          editable={false}
          multiline
          selectTextOnFocus
        />

        {/* Remote input */}
        <Text style={styles.label}>Paste Remote Offer/Answer:</Text>
        <TextInput
          style={styles.textBox}
          value={remoteOfferInput}
          onChangeText={setRemoteOfferInput}
          multiline
          placeholder="Paste remote offer or answer JSON here"
        />

        {/* Create Answer & Connect */}
        <View style={styles.row}>
          <TouchableOpacity style={styles.button} onPress={createAnswer}>
            <Text style={styles.buttonText}>Create Answer</Text>
          </TouchableOpacity>
          <View style={{width: 12}} />
          <TouchableOpacity style={[styles.button, styles.buttonGreen]} onPress={connect}>
            <Text style={styles.buttonText}>Connect</Text>
          </TouchableOpacity>
          <View style={{width: 12}} />
          <TouchableOpacity style={[styles.button, styles.buttonRed]} onPress={reset}>
            <Text style={styles.buttonText}>Reset</Text>
          </TouchableOpacity>
        </View>

        {/* Status */}
        {status ? <Text style={styles.status}>{status}</Text> : null}
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  body: {
    backgroundColor: '#ffffff',
    flex: 1,
  },
  container: {
    padding: 16,
    alignItems: 'flex-start',
  },
  videoContainer: {
    flexDirection: 'row',
    height: 200,
    marginBottom: 12,
    alignSelf: 'stretch',
  },
  videoWrapper: {
    flex: 1,
    backgroundColor: '#1a1a2e',
    marginHorizontal: 4,
    borderRadius: 4,
    justifyContent: 'center',
    alignItems: 'center',
  },
  video: {
    ...StyleSheet.absoluteFillObject,
  },
  videoPlaceholder: {
    color: '#888',
    fontSize: 14,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 8,
  },
  spacer: {
    marginLeft: 16,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  switchBox: {
    backgroundColor: '#e2e2e2',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#999',
    padding: 2,
  },
  text: {
    color: '#111',
    marginRight: 8,
  },
  label: {
    marginTop: 12,
    marginBottom: 4,
    fontWeight: '600',
    color: '#111',
  },
  textBox: {
    borderWidth: 1,
    borderColor: '#999',
    borderRadius: 4,
    padding: 8,
    height: 100,
    fontFamily: 'Menlo',
    fontSize: 11,
    color: '#111',
    backgroundColor: '#f9f9f9',
    alignSelf: 'stretch',
  },
  status: {
    marginTop: 12,
    color: '#333',
    fontStyle: 'italic',
  },
  button: {
    backgroundColor: '#2563eb',
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 6,
  },
  buttonGreen: {
    backgroundColor: '#16a34a',
  },
  buttonRed: {
    backgroundColor: '#dc2626',
  },
  buttonText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 14,
  },
});

export default App;
