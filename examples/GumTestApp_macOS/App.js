/**
 * Sample React Native App for macOS - WebRTC Offer/Answer Test
 */

import React, { useState, useRef, useCallback } from "react";
import {
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import {
  mediaDevices,
  RTCPeerConnection,
  RTCSessionDescription,
  RTCIceCandidate,
  RTCView,
} from "react-native-webrtc";

const configuration = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
};

const App = () => {
  const [enableVideo, setEnableVideo] = useState(true);
  const [enableAudio, setEnableAudio] = useState(true);
  const [localOffer, setLocalOffer] = useState("");
  const [remoteAnswerInput, setRemoteAnswerInput] = useState("");
  const [remoteOfferInput, setRemoteOfferInput] = useState("");
  const [localAnswer, setLocalAnswer] = useState("");
  const [localStream, setLocalStream] = useState(null);
  const [remoteStream, setRemoteStream] = useState(null);
  const [dataInput, setDataInput] = useState("");
  const [dataOutput, setDataOutput] = useState("");
  const [connectionStatus, setConnectionStatus] = useState("Idle");
  const [log, setLog] = useState("");

  const pcRef = useRef(null);
  const iceCandidatesRef = useRef([]);
  const gatheredRef = useRef(false);
  const sendChannelRef = useRef(null);
  const logRef = useRef("");

  const addLog = useCallback((msg) => {
    const ts = new Date().toLocaleTimeString();
    const line = `[${ts}] ${msg}\n`;
    logRef.current += line;
    setLog(logRef.current);
  }, []);

  const finishGathering = (pc) => {
    addLog("finishGathering called, already=" + gatheredRef.current);
    if (gatheredRef.current) return;
    gatheredRef.current = true;
    const desc = pc.localDescription;
    if (!desc) {
      addLog("finishGathering: no localDescription");
      return;
    }
    const payload = JSON.stringify({
      sdp: desc,
      candidates: iceCandidatesRef.current,
    });
    addLog("Gathered " + iceCandidatesRef.current.length + " candidates");
    if (desc.type === "offer") {
      setLocalOffer(payload);
      setConnectionStatus("Waiting for remote answer");
    } else {
      setLocalAnswer(payload);
      setConnectionStatus("Waiting for offerer to connect");
    }
  };

  const createPeerConnection = () => {
    addLog("Creating RTCPeerConnection");
    const pc = new RTCPeerConnection(configuration);

    // Always create a data channel for sending
    const sendChannel = pc.createDataChannel("data");
    sendChannelRef.current = sendChannel;
    sendChannel.onopen = () => addLog("Send data channel open");
    sendChannel.onclose = () => addLog("Send data channel closed");
    sendChannel.onerror = (e) =>
      addLog("Send data channel error: " + e.message);

    // Receive data channel from remote
    pc.ondatachannel = (event) => {
      addLog("Received data channel: " + event.channel.label);
      const recvChannel = event.channel;
      recvChannel.onmessage = (msg) => {
        addLog("Data received: " + msg.data);
        setDataOutput((prev) => prev + msg.data + "\n");
      };
      recvChannel.onopen = () => addLog("Receive data channel open");
      recvChannel.onclose = () => addLog("Receive data channel closed");
    };

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        addLog("ICE candidate: " + (event.candidate.type || "unknown"));
        iceCandidatesRef.current.push(event.candidate);
        if (pc._scheduleFinish) pc._scheduleFinish();
      } else {
        addLog("ICE gathering: null candidate (complete)");
        finishGathering(pc);
      }
    };

    pc.onicegatheringstatechange = () => {
      addLog("ICE gathering state: " + pc.iceGatheringState);
      if (pc.iceGatheringState === "complete") {
        finishGathering(pc);
      }
    };

    pc.oniceconnectionstatechange = () => {
      addLog("ICE connection: " + pc.iceConnectionState);
    };

    pc.onconnectionstatechange = () => {
      addLog("Connection: " + pc.connectionState);
      const state = pc.connectionState;
      if (state === "connected") setConnectionStatus("Connected");
      else if (state === "connecting") setConnectionStatus("Connecting...");
      else if (state === "failed") setConnectionStatus("Failed");
      else if (state === "disconnected") setConnectionStatus("Disconnected");
      else if (state === "closed") setConnectionStatus("Closed");
    };

    pc.onsignalingstatechange = () => {
      addLog("Signaling: " + pc.signalingState);
    };

    pc.onicecandidateerror = (event) => {
      addLog("ICE error: " + (event.errorText || event.errorCode || ""));
    };

    pc.onnegotiationneeded = () => {
      addLog("Negotiation needed");
    };

    pc.ontrack = (event) => {
      addLog("Remote track: " + event.track?.kind);
      if (event.streams && event.streams[0]) {
        setRemoteStream(event.streams[0]);
      }
    };

    pcRef.current = pc;
    iceCandidatesRef.current = [];
    gatheredRef.current = false;

    // Debounce for ICE gathering completion
    let candidateTimer = null;
    const scheduleFinish = () => {
      if (candidateTimer) clearTimeout(candidateTimer);
      candidateTimer = setTimeout(() => {
        addLog("ICE debounce timeout, finishing");
        finishGathering(pc);
      }, 2000);
    };
    scheduleFinish();
    pc._scheduleFinish = scheduleFinish;

    return pc;
  };

  const createOffer = async () => {
    addLog("Button: Create Offer");
    try {
      const pc = createPeerConnection();

      if (enableVideo || enableAudio) {
        addLog(
          "Requesting getUserMedia video=" +
            enableVideo +
            " audio=" +
            enableAudio,
        );
        const stream = await mediaDevices.getUserMedia({
          video: enableVideo,
          audio: enableAudio,
        });
        setLocalStream(stream);
        stream.getTracks().forEach((track) => pc.addTrack(track, stream));
        addLog("Added " + stream.getTracks().length + " tracks");
      }

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      addLog("Offer created, waiting for ICE...");
    } catch (e) {
      addLog("ERROR createOffer: " + e.message);
    }
  };

  const createAnswer = async () => {
    addLog("Button: Create Answer");
    try {
      if (!remoteOfferInput) {
        addLog("No remote offer pasted");
        return;
      }
      let parsed;
      try {
        parsed = JSON.parse(remoteOfferInput);
      } catch (e) {
        addLog("ERROR: invalid JSON - " + e.message);
        return;
      }
      const { sdp, candidates } = parsed;
      addLog("Parsed remote offer, " + candidates.length + " candidates");

      const pc = createPeerConnection();

      if (enableVideo || enableAudio) {
        const stream = await mediaDevices.getUserMedia({
          video: enableVideo,
          audio: enableAudio,
        });
        setLocalStream(stream);
        stream.getTracks().forEach((track) => pc.addTrack(track, stream));
        addLog("Added " + stream.getTracks().length + " tracks");
      }

      await pc.setRemoteDescription(new RTCSessionDescription(sdp));
      addLog("Remote description set");

      for (const candidate of candidates) {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      }
      addLog("Added " + candidates.length + " remote ICE candidates");

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      addLog("Answer created, waiting for ICE...");
    } catch (e) {
      addLog("ERROR createAnswer: " + e.message);
    }
  };

  const connect = async () => {
    addLog("Button: Connect");
    try {
      if (!pcRef.current) {
        addLog("No peer connection");
        return;
      }
      if (!remoteAnswerInput) {
        addLog("No remote answer pasted");
        return;
      }
      let parsed;
      try {
        parsed = JSON.parse(remoteAnswerInput);
      } catch (e) {
        addLog("ERROR: invalid JSON - " + e.message);
        return;
      }
      const { sdp, candidates } = parsed;
      const pc = pcRef.current;
      addLog("Parsed remote answer, " + candidates.length + " candidates");

      if (!pc.remoteDescription) {
        await pc.setRemoteDescription(new RTCSessionDescription(sdp));
        addLog("Remote description set");
      }

      for (const candidate of candidates) {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      }
      addLog("Added " + candidates.length + " remote ICE candidates");
      addLog("Connecting... ICE=" + pc.iceConnectionState);
    } catch (e) {
      addLog("ERROR connect: " + e.message);
    }
  };

  const sendData = () => {
    addLog("Button: Send Data");
    if (
      !sendChannelRef.current ||
      sendChannelRef.current.readyState !== "open"
    ) {
      addLog("Data channel not open");
      return;
    }
    if (!dataInput) {
      addLog("Nothing to send");
      return;
    }
    sendChannelRef.current.send(dataInput);
    addLog("Sent: " + dataInput);
    setDataInput("");
  };

  const reset = () => {
    addLog("Button: Reset");
    if (pcRef.current) pcRef.current.close();
    if (localStream) localStream.release();
    pcRef.current = null;
    sendChannelRef.current = null;
    iceCandidatesRef.current = [];
    gatheredRef.current = false;
    setLocalStream(null);
    setRemoteStream(null);
    setLocalOffer("");
    setLocalAnswer("");
    setRemoteOfferInput("");
    setRemoteAnswerInput("");
    setDataInput("");
    setDataOutput("");
    setConnectionStatus("Idle");
  };

  return (
    <SafeAreaView style={styles.body}>
      <View style={styles.mainRow}>
        {/* Left + Right signaling panels */}
        <View style={styles.content}>
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
                <RTCView
                  streamURL={remoteStream.toURL()}
                  style={styles.video}
                />
              ) : (
                <Text style={styles.videoPlaceholder}>Remote Video</Text>
              )}
            </View>
          </View>

          {/* Controls row */}
          <View style={styles.row}>
            <View style={styles.switchRow}>
              <Text style={styles.text}>Video</Text>
              <View style={styles.switchBox}>
                <Switch
                  value={enableVideo}
                  onValueChange={setEnableVideo}
                  trackColor={{ false: "#ccc", true: "#2563eb" }}
                  thumbColor="#fff"
                />
              </View>
            </View>
            <View style={[styles.switchRow, { marginLeft: 12 }]}>
              <Text style={styles.text}>Audio</Text>
              <View style={styles.switchBox}>
                <Switch
                  value={enableAudio}
                  onValueChange={setEnableAudio}
                  trackColor={{ false: "#ccc", true: "#2563eb" }}
                  thumbColor="#fff"
                />
              </View>
            </View>
            <View style={{ marginLeft: 12 }}>
              <TouchableOpacity
                style={[styles.button, styles.buttonRed]}
                onPress={reset}
              >
                <Text style={styles.buttonText}>Reset</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Signaling panels */}
          <View style={styles.statusBar}>
            <Text style={styles.statusText}>Status: {connectionStatus}</Text>
          </View>
          <View style={styles.panelsRow}>
            {/* Left panel: Offerer side */}
            <View style={styles.panel}>
              <TouchableOpacity style={styles.button} onPress={createOffer}>
                <Text style={styles.buttonText}>Create Offer</Text>
              </TouchableOpacity>
              <Text style={styles.label}>Local Offer (copy this):</Text>
              <TextInput
                style={[styles.textBox, styles.readonlyBox]}
                value={localOffer}
                editable={false}
                multiline
                selectTextOnFocus
                placeholderTextColor="#999"
                placeholder="Offer will appear here..."
              />
              <Text style={styles.label}>Paste Remote Answer:</Text>
              <TextInput
                style={styles.textBox}
                value={remoteAnswerInput}
                onChangeText={setRemoteAnswerInput}
                multiline
                placeholder="Paste answer JSON here"
              />
              <TouchableOpacity
                style={[styles.button, styles.buttonGreen, { marginTop: 8 }]}
                onPress={connect}
              >
                <Text style={styles.buttonText}>Connect</Text>
              </TouchableOpacity>
            </View>

            {/* Vertical divider */}
            <View style={styles.divider} />

            {/* Right panel: Answerer side */}
            <View style={styles.panel}>
              <Text style={styles.label}>Paste Remote Offer:</Text>
              <TextInput
                style={styles.textBox}
                value={remoteOfferInput}
                onChangeText={setRemoteOfferInput}
                multiline
                placeholder="Paste offer JSON here"
              />
              <TouchableOpacity
                style={[styles.button, { marginTop: 8 }]}
                onPress={createAnswer}
              >
                <Text style={styles.buttonText}>Create Answer</Text>
              </TouchableOpacity>
              <Text style={styles.label}>Local Answer (copy this):</Text>
              <TextInput
                style={[styles.textBox, styles.readonlyBox]}
                value={localAnswer}
                editable={false}
                multiline
                selectTextOnFocus
                placeholderTextColor="#999"
                placeholder="Answer will appear here..."
              />
            </View>
          </View>

          {/* Data channel */}
          <View style={styles.panelsRow}>
            <View style={styles.panel}>
              <Text style={styles.label}>Data Input:</Text>
              <View style={styles.row}>
                <TextInput
                  style={[styles.textBox, { height: 36, flex: 1 }]}
                  value={dataInput}
                  onChangeText={setDataInput}
                  placeholder="Type message..."
                />
                <TouchableOpacity
                  style={[styles.button, { marginLeft: 8 }]}
                  onPress={sendData}
                >
                  <Text style={styles.buttonText}>Send</Text>
                </TouchableOpacity>
              </View>
            </View>
            <View style={styles.divider} />
            <View style={styles.panel}>
              <Text style={styles.label}>Data Output:</Text>
              <TextInput
                style={[styles.textBox, styles.readonlyBox, { height: 60 }]}
                value={dataOutput}
                editable={false}
                multiline
                selectTextOnFocus
                placeholderTextColor="#999"
                placeholder="Received data appears here..."
              />
            </View>
          </View>
        </View>

        {/* Log panel on the right */}
        <View style={styles.logPanel}>
          <Text style={styles.logTitle}>Log</Text>
          <ScrollView style={styles.logScroll}>
            <TextInput
              style={styles.logText}
              value={log}
              editable={false}
              multiline
              selectTextOnFocus
            />
          </ScrollView>
        </View>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  body: {
    backgroundColor: "#ffffff",
    flex: 1,
  },
  mainRow: {
    flex: 1,
    flexDirection: "row",
  },
  content: {
    flex: 1,
    padding: 12,
  },
  videoContainer: {
    flexDirection: "row",
    height: 160,
    marginBottom: 8,
  },
  videoWrapper: {
    flex: 1,
    backgroundColor: "#1a1a2e",
    marginHorizontal: 4,
    borderRadius: 4,
    justifyContent: "center",
    alignItems: "center",
  },
  video: {
    flex: 1,
    width: "100%",
  },
  videoPlaceholder: {
    color: "#888",
    fontSize: 13,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    marginVertical: 4,
  },
  switchRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  switchBox: {
    backgroundColor: "#e2e2e2",
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "#999",
    padding: 2,
  },
  text: {
    color: "#111",
    marginRight: 6,
    fontSize: 13,
  },
  label: {
    marginTop: 8,
    marginBottom: 2,
    fontWeight: "600",
    color: "#111",
    fontSize: 12,
  },
  panelsRow: {
    flexDirection: "row",
    marginTop: 8,
  },
  statusBar: {
    marginTop: 8,
    paddingVertical: 6,
    paddingHorizontal: 10,
    backgroundColor: "#1a1a2e",
    borderRadius: 4,
    alignSelf: "stretch",
  },
  statusText: {
    color: "#4ade80",
    fontWeight: "700",
    fontSize: 13,
  },
  panel: {
    flex: 1,
  },
  divider: {
    width: 1,
    backgroundColor: "#ccc",
    marginHorizontal: 12,
  },
  textBox: {
    borderWidth: 1,
    borderColor: "#999",
    borderRadius: 4,
    padding: 6,
    height: 80,
    fontFamily: "Menlo",
    fontSize: 10,
    color: "#111",
    backgroundColor: "#fff",
  },
  readonlyBox: {
    backgroundColor: "#f0f0f0",
    color: "#666",
  },
  button: {
    backgroundColor: "#2563eb",
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 5,
    alignSelf: "flex-start",
    marginTop: 4,
  },
  buttonGreen: {
    backgroundColor: "#16a34a",
  },
  buttonRed: {
    backgroundColor: "#dc2626",
  },
  buttonText: {
    color: "#fff",
    fontWeight: "600",
    fontSize: 12,
  },
  logPanel: {
    width: 400,
    borderLeftWidth: 1,
    borderLeftColor: "#ccc",
    backgroundColor: "#fafafa",
    padding: 8,
  },
  logTitle: {
    fontWeight: "700",
    fontSize: 12,
    color: "#333",
    marginBottom: 4,
  },
  logScroll: {
    flex: 1,
  },
  logText: {
    fontFamily: "Menlo",
    fontSize: 9,
    color: "#333",
    lineHeight: 14,
  },
});

export default App;
