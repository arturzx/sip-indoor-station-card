const DEFAULT_WEBRTC_CONFIG_URL = "/api/sip_indoor_station/webrtc/config";
const DEFAULT_WEBRTC_SESSION_URL = "/api/sip_indoor_station/webrtc/session";
const DEFAULT_WEBRTC_URL = "/api/sip_indoor_station/webrtc/ws";
const DEFAULT_CALL_HISTORY_URL = "/api/sip_indoor_station/call_history";
const DEFAULT_ENTITY_PREFIX = "door_station";

class SipIndoorStationCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._hass = null;
    this._config = null;
    this._pc = null;
    this._ws = null;
    this._localStream = null;
    this._audioConnected = false;
    this._audioConnecting = false;
    this._entities = {};
    this._entityErrors = new Set();
    this._state = {
      callState: "unknown",
      registered: false,
      ringing: false,
      inCall: false,
      doNotDisturb: false,
    };
  }

  setConfig(config) {
    if (!config.camera && !config.cameras && !config.advanced_camera_card) {
      throw new Error("camera, cameras, or advanced_camera_card is required");
    }
    const entityPrefix = config.entity_prefix || config.device || DEFAULT_ENTITY_PREFIX;
    this._config = {
      entity_prefix: entityPrefix,
      device: entityPrefix,
      show_controls: true,
      webrtc_config_url: DEFAULT_WEBRTC_CONFIG_URL,
      webrtc_session_url: DEFAULT_WEBRTC_SESSION_URL,
      webrtc_url: DEFAULT_WEBRTC_URL,
      history_path: null,
      history_badge_entity: null,
      ...config,
    };
    this._entities = {};
    this._entityErrors = new Set();
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    this._resolveEntities();
    this._updateState();
    this._syncAdvancedCameraCard();
    this._renderState();
  }

  disconnectedCallback() {
    this._disconnectAudio();
  }

  getCardSize() {
    return 4;
  }

  static getStubConfig() {
    return {
      type: "custom:sip-indoor-station-card",
      entity_prefix: DEFAULT_ENTITY_PREFIX,
      cameras: [{ camera_entity: "camera.front_door" }],
    };
  }

  _render() {
    if (!this.shadowRoot || !this._config) {
      return;
    }

    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: block;
          color: var(--primary-text-color);
        }

        ha-card {
          overflow: hidden;
        }

        advanced-camera-card {
          display: block;
          min-height: 180px;
        }

        .media {
          position: relative;
          overflow: hidden;
        }

        .controls {
          position: absolute;
          left: 0;
          right: 0;
          bottom: 0;
          z-index: 2;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: clamp(14px, 3vmin, 34px);
          padding: clamp(16px, 3vmin, 32px);
          background: linear-gradient(to top, rgba(0, 0, 0, 0.58), rgba(0, 0, 0, 0.28) 72%, rgba(0, 0, 0, 0));
          pointer-events: none;
        }

        .icon-button {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: clamp(72px, 15vmin, 120px);
          height: clamp(72px, 15vmin, 120px);
          border: 0;
          border-radius: 50%;
          color: white;
          background: rgba(32, 33, 36, 0.88);
          box-shadow: 0 6px 18px rgba(0, 0, 0, 0.28);
          cursor: pointer;
          pointer-events: auto;
          touch-action: manipulation;
        }

        .icon-button:hover {
          filter: brightness(1.12);
        }

        .icon-button[hidden] {
          display: none;
        }

        .icon-button ha-icon {
          --mdc-icon-size: clamp(34px, 6.2vmin, 56px);
        }

        .corner-button {
          position: absolute;
          bottom: clamp(12px, 2.5vmin, 24px);
          z-index: 4;
          width: clamp(48px, 9vmin, 72px);
          height: clamp(48px, 9vmin, 72px);
        }

        .corner-button.left {
          left: clamp(12px, 2.5vmin, 24px);
        }

        .corner-button.right {
          right: clamp(12px, 2.5vmin, 24px);
        }

        .corner-button ha-icon {
          --mdc-icon-size: clamp(24px, 4.5vmin, 34px);
        }

        .badge {
          position: absolute;
          top: -4px;
          right: -4px;
          display: none;
          align-items: center;
          justify-content: center;
          min-width: 18px;
          height: 18px;
          padding: 0 5px;
          border-radius: 999px;
          color: white;
          background: var(--error-color, #dc2626);
          font-size: 11px;
          font-weight: 600;
          line-height: 18px;
        }

        .badge.visible {
          display: inline-flex;
        }

        #answer {
          background: rgba(22, 163, 74, 0.94);
        }

        #reject,
        #hangup {
          background: rgba(220, 38, 38, 0.94);
        }

        #open-door {
          background: rgba(37, 99, 235, 0.94);
        }

        #history {
          color: white;
          background: rgba(32, 33, 36, 0.88);
        }

        #do-not-disturb {
          color: rgb(32, 33, 36);
          background: rgba(255, 255, 255, 0.94);
        }

        #do-not-disturb.active {
          color: white;
          background: rgba(220, 38, 38, 0.94);
        }

        .status {
          position: absolute;
          left: 50%;
          bottom: calc(clamp(72px, 15vmin, 120px) + clamp(22px, 4vmin, 42px));
          transform: translateX(-50%);
          z-index: 3;
          max-width: min(280px, calc(100% - 24px));
          padding: 5px 9px;
          border-radius: 999px;
          color: white;
          background: rgba(0, 0, 0, 0.5);
          font-size: 12px;
          line-height: 1.25;
          pointer-events: none;
        }

        .error {
          color: var(--error-color);
          background: rgba(0, 0, 0, 0.72);
        }

        .remote-audio {
          position: absolute;
          width: 1px;
          height: 1px;
          opacity: 0;
          pointer-events: none;
        }
      </style>
      <ha-card>
        <div class="media">
          <advanced-camera-card id="camera-card"></advanced-camera-card>
          <audio class="remote-audio" id="remote-audio" autoplay playsinline></audio>
          ${
            this._config.show_controls
              ? `<div class="controls">
                  <button class="icon-button" id="answer" title="Answer" aria-label="Answer">
                    <ha-icon icon="mdi:phone"></ha-icon>
                  </button>
                  <button class="icon-button" id="reject" title="Reject" aria-label="Reject">
                    <ha-icon icon="mdi:phone-cancel"></ha-icon>
                  </button>
                  <button class="icon-button" id="hangup" title="Hang up" aria-label="Hang up">
                    <ha-icon icon="mdi:phone-hangup"></ha-icon>
                  </button>
                  <button class="icon-button" id="open-door" title="Open door" aria-label="Open door">
                    <ha-icon icon="mdi:door-open"></ha-icon>
                  </button>
                </div>
                ${
                  this._config.history_path
                    ? `<button class="icon-button corner-button left" id="history" title="History" aria-label="History">
                        <ha-icon icon="mdi:history"></ha-icon>
                        <span class="badge" id="history-badge"></span>
                      </button>`
                    : ""
                }
                <button class="icon-button corner-button right" id="do-not-disturb" title="Do not disturb" aria-label="Do not disturb">
                  <ha-icon icon="mdi:bell-ring-outline"></ha-icon>
                </button>
                <div class="status" id="audio-status">Audio disconnected</div>`
              : ""
          }
        </div>
      </ha-card>
    `;

    this._wireControls();
    this._configureAdvancedCameraCard();
    this._renderState();
  }

  _wireControls() {
    this.shadowRoot.getElementById("answer")?.addEventListener("click", () => this._answerCall());
    this.shadowRoot.getElementById("reject")?.addEventListener("click", () => this._pressButton("reject_button"));
    this.shadowRoot.getElementById("hangup")?.addEventListener("click", () => this._pressButton("hangup_button"));
    this.shadowRoot.getElementById("open-door")?.addEventListener("click", () => this._pressButton("open_door_button"));
    this.shadowRoot.getElementById("do-not-disturb")?.addEventListener("click", () => this._toggleEntity("do_not_disturb_entity"));
    this.shadowRoot.getElementById("history")?.addEventListener("click", () => this._openHistory());
  }

  async _answerCall() {
    const status = this.shadowRoot.getElementById("audio-status");
    if (status) {
      status.textContent = "Requesting microphone...";
      status.classList.remove("error");
    }

    this._closeLocalStream();

    if (!globalThis.navigator?.mediaDevices?.getUserMedia) {
      this._showAudioError(new Error("Microphone is not supported on this device"));
      return;
    }

    try {
      this._localStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: 8000,
          channelCount: 1,
        },
        video: false,
      });
    } catch (error) {
      this._showAudioError(error);
      return;
    }

    this._primeRemoteAudioPlayback();

    const pressed = await this._pressButton("answer_button");
    if (!pressed) {
      this._closeLocalStream();
    }
  }

  _configureAdvancedCameraCard() {
    customElements.whenDefined("advanced-camera-card").then(() => {
      const cameraCard = this.shadowRoot.getElementById("camera-card");
      if (!cameraCard || typeof cameraCard.setConfig !== "function") {
        return;
      }

      cameraCard.setConfig(this._advancedCameraCardConfig());
      this._syncAdvancedCameraCard();
    });
  }

  _advancedCameraCardConfig() {
    if (this._config.advanced_camera_card) {
      return this._config.advanced_camera_card;
    }

    const {
      type: _type,
      device: _device,
      entity_prefix: _entityPrefix,
      camera,
      show_controls: _showControls,
      webrtc_url: _webrtcUrl,
      webrtc_config_url: _webrtcConfigUrl,
      webrtc_session_url: _webrtcSessionUrl,
      ice_servers: _iceServers,
      ice_candidates: _iceCandidates,
      ice_transport_policy: _iceTransportPolicy,
      history_path: _historyPath,
      history_badge_entity: _historyBadgeEntity,
      registered_entity: _registeredEntity,
      ringing_entity: _ringingEntity,
      in_call_entity: _inCallEntity,
      call_state_entity: _callStateEntity,
      answer_button: _answerButton,
      reject_button: _rejectButton,
      hangup_button: _hangupButton,
      open_door_button: _openDoorButton,
      do_not_disturb_entity: _doNotDisturbEntity,
      ...advancedCameraConfig
    } = this._config;

    if (!advancedCameraConfig.cameras && camera) {
      advancedCameraConfig.cameras = [typeof camera === "string" ? { camera_entity: camera } : camera];
    }

    return {
      type: "custom:advanced-camera-card",
      status_bar: { style: "none" },
      live: {
        controls: {
          builtin: false,
        },
        show_image_during_load: true,
      },
      menu: {
        style: "none",
      },
      profiles: ["low-performance"],
      ...advancedCameraConfig,
    };
  }

  _syncAdvancedCameraCard() {
    const cameraCard = this.shadowRoot?.getElementById("camera-card");
    if (cameraCard && this._hass) {
      cameraCard.hass = this._hass;
    }
  }

  _updateState() {
    if (!this._hass || !this._config) {
      return;
    }
    const previousCallState = this._state.callState;
    this._state.callState = this._entityState(this._entity("call_state_entity")) || "unknown";
    this._state.registered = this._entityState(this._entity("registered_entity")) === "on";
    this._state.ringing = this._entityState(this._entity("ringing_entity")) === "on";
    this._state.inCall = this._entityState(this._entity("in_call_entity")) === "on";
    this._state.doNotDisturb = this._entityState(this._entity("do_not_disturb_entity")) === "on";
    if (this._state.callState !== previousCallState) {
      this._syncAudioWithCallState();
    }
  }

  _renderState() {
    if (!this.shadowRoot) {
      return;
    }
    const showRingingControls = this._state.callState === "ringing";
    const showHangup = this._activeCallStates().includes(this._state.callState);
    this._setButtonVisible("answer", showRingingControls);
    this._setButtonVisible("reject", showRingingControls);
    this._setButtonVisible("hangup", showHangup);
    this._setButtonVisible("open-door", true);
    this._setButtonVisible("do-not-disturb", !!this._entity("do_not_disturb_entity"));
    this._setButtonActive("do-not-disturb", this._state.doNotDisturb);
    this._setButtonIcon("do-not-disturb", this._state.doNotDisturb ? "mdi:bell-remove-outline" : "mdi:bell-ring-outline");
    this._renderHistoryBadge();

    const audioStatus = this.shadowRoot.getElementById("audio-status");
    if (audioStatus) {
      audioStatus.textContent = this._audioConnected ? "Audio connected" : "Audio disconnected";
      audioStatus.classList.remove("error");
    }
  }

  _setButtonVisible(id, visible) {
    const button = this.shadowRoot.getElementById(id);
    if (button) {
      button.hidden = !visible;
    }
  }

  _setButtonActive(id, active) {
    const button = this.shadowRoot.getElementById(id);
    if (button) {
      button.classList.toggle("active", active);
    }
  }

  _setButtonIcon(id, icon) {
    const button = this.shadowRoot.getElementById(id);
    const iconElement = button?.querySelector("ha-icon");
    if (iconElement) {
      iconElement.setAttribute("icon", icon);
    }
  }

  async _pressButton(configKey) {
    const entityId = this._entity(configKey);
    if (!entityId || !this._hass) {
      this._logEntityError(configKey, "button entity is not resolved");
      return false;
    }
    const [domain, objectId] = entityId.split(".");
    if (domain !== "button" || !objectId) {
      this._logEntityError(configKey, `expected button entity, got ${entityId}`);
      return false;
    }
    try {
      await this._hass.callService("button", "press", { entity_id: entityId });
      return true;
    } catch (error) {
      console.error("[sip-indoor-station-card] button press failed", {
        key: configKey,
        entity_id: entityId,
        error,
      });
      this._showAudioError(error);
      return false;
    }
  }

  async _toggleEntity(configKey) {
    const entityId = this._entity(configKey);
    if (!entityId || !this._hass) {
      this._logEntityError(configKey, "toggle entity is not resolved");
      return false;
    }
    const [domain, objectId] = entityId.split(".");
    if (!["switch", "input_boolean"].includes(domain) || !objectId) {
      this._logEntityError(configKey, `expected switch or input_boolean entity, got ${entityId}`);
      return false;
    }
    try {
      await this._hass.callService(domain, "toggle", { entity_id: entityId });
      return true;
    } catch (error) {
      console.error("[sip-indoor-station-card] entity toggle failed", {
        key: configKey,
        entity_id: entityId,
        error,
      });
      return false;
    }
  }

  _openHistory() {
    const path = this._config?.history_path;
    if (!path) {
      return;
    }
    if (/^https?:\/\//.test(path)) {
      window.location.assign(path);
      return;
    }
    history.pushState(null, "", path);
    window.dispatchEvent(new Event("location-changed"));
  }

  _renderHistoryBadge() {
    const badge = this.shadowRoot?.getElementById("history-badge");
    if (!badge) {
      return;
    }
    const value = this._historyBadgeValue();
    badge.textContent = value || "";
    badge.classList.toggle("visible", !!value);
  }

  _historyBadgeValue() {
    const entityId = this._config?.history_badge_entity;
    if (!entityId || !this._hass?.states?.[entityId]) {
      return null;
    }
    const value = this._hass.states[entityId].state;
    if (!value || value === "0" || ["unknown", "unavailable"].includes(value)) {
      return null;
    }
    return String(value);
  }

  async _connectAudio() {
    if (this._audioConnected || this._audioConnecting || this._pc || this._ws || !this._localStream) {
      return;
    }
    this._audioConnecting = true;
    const status = this.shadowRoot.getElementById("audio-status");
    try {
      const webrtcSession = await this._createWebRtcSession();
      const iceConfig = await this._loadIceConfig(webrtcSession);
      this._pc = new RTCPeerConnection({
        iceServers: iceConfig.iceServers || [],
        iceTransportPolicy: iceConfig.iceTransportPolicy || "all",
      });
      this._localStream.getTracks().forEach((track) => this._pc.addTrack(track, this._localStream));

      this._pc.ontrack = (event) => {
        const audio = this._remoteAudioElement();
        if (!audio) {
          return;
        }
        audio.srcObject = event.streams[0];
        audio.play().catch((error) => this._showAudioError(error));
      };

      this._pc.onicecandidate = (event) => {
        if (event.candidate && this._ws?.readyState === WebSocket.OPEN) {
          this._ws.send(JSON.stringify({ type: "ice", candidate: event.candidate.toJSON() }));
        }
      };

      this._pc.onconnectionstatechange = () => {
        if (["failed", "disconnected", "closed"].includes(this._pc?.connectionState)) {
          this._disconnectAudio();
        }
      };

      this._ws = new WebSocket(await this._webrtcWebSocketUrl(webrtcSession));
      this._ws.onmessage = (event) => {
        this._handleWebRtcMessage(event.data).catch((error) => {
          this._showAudioError(error);
          this._disconnectAudio();
        });
      };
      await new Promise((resolve, reject) => {
        this._ws.onopen = resolve;
        this._ws.onerror = () => reject(new Error("WebRTC signaling WebSocket failed"));
      });

      const offer = await this._pc.createOffer();
      await this._pc.setLocalDescription(offer);
      this._ws.send(JSON.stringify({ type: "offer", sdp: offer.sdp }));

      if (status) {
        status.textContent = "Connecting audio...";
      }
    } catch (error) {
      this._showAudioError(error);
      this._disconnectAudio();
    } finally {
      this._audioConnecting = false;
    }
  }

  _syncAudioWithCallState() {
    const active = this._activeCallStates().includes(this._state.callState);
    if (active) {
      if (this._localStream) {
        this._connectAudio();
      }
      return;
    }

    if (this._audioConnected || this._pc || this._ws || this._localStream) {
      this._disconnectAudio();
    }
  }

  _activeCallStates() {
    return ["answered"];
  }

  async _handleWebRtcMessage(data) {
    const message = JSON.parse(data);
    if (message.type === "answer") {
      await this._pc.setRemoteDescription({ type: "answer", sdp: message.sdp });
      this._audioConnected = true;
      this._renderState();
      return;
    }
    if (message.type === "ice" && message.candidate) {
      await this._pc.addIceCandidate(message.candidate);
      return;
    }
    if (message.type === "error") {
      throw new Error(message.message || "WebRTC signaling error");
    }
  }

  async _loadIceConfig(webrtcSession) {
    const response = await fetch(this._webrtcHttpUrl(webrtcSession), {
      cache: "no-store",
      credentials: "include",
    });
    if (!response.ok) {
      return { iceServers: [] };
    }
    const config = await response.json();
    return {
      iceServers: config.iceServers || [],
      iceTransportPolicy: config.iceTransportPolicy || "all",
    };
  }

  _disconnectAudio() {
    if (this._ws) {
      try {
        this._ws.send(JSON.stringify({ type: "close" }));
      } catch (_error) {
        // Best effort close.
      }
      this._ws.close();
      this._ws = null;
    }
    if (this._pc) {
      this._pc.close();
      this._pc = null;
    }
    this._closeLocalStream();
    const audio = this._remoteAudioElement();
    if (audio) {
      audio.pause();
      audio.srcObject = null;
    }
    this._audioConnected = false;
    this._audioConnecting = false;
    this._renderState();
  }

  _closeLocalStream() {
    if (this._localStream) {
      this._localStream.getTracks().forEach((track) => track.stop());
      this._localStream = null;
    }
  }

  _remoteAudioElement() {
    const audio = this.shadowRoot?.getElementById("remote-audio");
    if (!audio) {
      return null;
    }
    audio.autoplay = true;
    audio.playsInline = true;
    audio.muted = false;
    audio.volume = 1;
    return audio;
  }

  _primeRemoteAudioPlayback() {
    const audio = this._remoteAudioElement();
    if (!audio) {
      return;
    }
    if (!audio.srcObject) {
      audio.srcObject = new MediaStream();
    }
    audio.play().catch(() => {
      // Some WebViews reject empty stream playback; the real stream will retry in ontrack.
    });
  }

  _showAudioError(error) {
    const status = this.shadowRoot.getElementById("audio-status");
    if (status) {
      status.textContent = error?.message || String(error);
      status.classList.add("error");
    }
  }

  _entityState(entityId) {
    return entityId ? this._hass?.states?.[entityId]?.state : undefined;
  }

  _entity(configKey) {
    if (this._entities[configKey]) {
      return this._entities[configKey];
    }

    this._entities[configKey] = this._resolveEntity(configKey);
    return this._entities[configKey];
  }

  _resolveEntities() {
    if (!this._hass || !this._config) {
      return;
    }

    for (const key of this._entityKeys()) {
      this._entities[key] = this._resolveEntity(key);
    }
  }

  _resolveEntity(configKey) {
    if (!this._hass || !this._config) {
      return null;
    }

    if (this._optionalEntityKeys().includes(configKey) && !this._config[configKey]) {
      return null;
    }

    if (this._config[configKey]) {
      const entityId = this._config[configKey];
      if (this._hass.states?.[entityId]) {
        return entityId;
      }
      this._logEntityError(configKey, `configured entity does not exist: ${entityId}`);
      return null;
    }

    const uniqueId = this._uniqueId(configKey);
    const registryEntity = this._entityByUniqueId(uniqueId);
    if (registryEntity) {
      return registryEntity;
    }

    const defaultEntity = this._defaultEntityId(configKey);
    if (defaultEntity && this._hass.states?.[defaultEntity]) {
      return defaultEntity;
    }

    this._logEntityError(
      configKey,
      `entity not found by unique_id=${uniqueId} or default entity_id=${defaultEntity}`,
    );
    return null;
  }

  _entityKeys() {
    return [
      "registered_entity",
      "ringing_entity",
      "in_call_entity",
      "call_state_entity",
      "answer_button",
      "reject_button",
      "hangup_button",
      "open_door_button",
      "do_not_disturb_entity",
    ];
  }

  _optionalEntityKeys() {
    return ["do_not_disturb_entity"];
  }

  _uniqueId(configKey) {
    const entityPrefix = this._entityPrefix();
    const suffixes = {
      registered_entity: "registered",
      ringing_entity: "ringing",
      in_call_entity: "in_call",
      call_state_entity: "call_state",
      answer_button: "answer",
      reject_button: "reject",
      hangup_button: "hang_up",
      open_door_button: "open_door",
      do_not_disturb_entity: "do_not_disturb",
    };
    return `${entityPrefix}_${suffixes[configKey]}`;
  }

  _defaultEntityId(configKey) {
    const entityPrefix = this._entityPrefix();
    const defaults = {
      registered_entity: `binary_sensor.${entityPrefix}_registered`,
      ringing_entity: `binary_sensor.${entityPrefix}_ringing`,
      in_call_entity: `binary_sensor.${entityPrefix}_in_call`,
      call_state_entity: `sensor.${entityPrefix}_call_state`,
      answer_button: `button.${entityPrefix}_answer`,
      reject_button: `button.${entityPrefix}_reject`,
      hangup_button: `button.${entityPrefix}_hang_up`,
      open_door_button: `button.${entityPrefix}_open_door`,
      do_not_disturb_entity: null,
    };
    return defaults[configKey];
  }

  _entityPrefix() {
    return this._config.entity_prefix || this._config.device || DEFAULT_ENTITY_PREFIX;
  }

  _entityByUniqueId(uniqueId) {
    const entities = this._hass?.entities || {};
    for (const [entityId, entity] of Object.entries(entities)) {
      if (entity?.unique_id === uniqueId) {
        return entityId;
      }
    }
    return null;
  }

  _logEntityError(configKey, message) {
    const key = `${configKey}:${message}`;
    if (this._entityErrors.has(key)) {
      return;
    }
    this._entityErrors.add(key);
    console.error("[sip-indoor-station-card] entity resolution failed", {
      key: configKey,
      entity_prefix: this._entityPrefix(),
      message,
    });
  }

  _websocketUrl(url) {
    if (url.startsWith("ws://") || url.startsWith("wss://")) {
      return url;
    }
    if (url.startsWith("http://") || url.startsWith("https://")) {
      const parsed = new URL(url);
      parsed.protocol = parsed.protocol === "https:" ? "wss:" : "ws:";
      return parsed.toString();
    }
    const scheme = window.location.protocol === "https:" ? "wss" : "ws";
    return `${scheme}://${window.location.host}${url}`;
  }

  async _createWebRtcSession() {
    if (!this._config.webrtc_session_url) {
      return null;
    }
    if (typeof this._hass?.callApi !== "function") {
      throw new Error("Home Assistant API is not available for WebRTC session");
    }
    const path = this._config.webrtc_session_url.replace(/^\/api\/?/, "");
    return this._hass.callApi("POST", path);
  }

  async _webrtcWebSocketUrl(webrtcSession) {
    return this._websocketUrl(webrtcSession?.ws_url || this._config.webrtc_url);
  }

  _webrtcHttpUrl(webrtcSession) {
    return webrtcSession?.config_url || this._config.webrtc_config_url;
  }

}

if (!customElements.get("sip-indoor-station-card")) {
  customElements.define("sip-indoor-station-card", SipIndoorStationCard);
}

class SipIndoorStationHistoryCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._hass = null;
    this._config = null;
    this._history = [];
    this._loading = false;
    this._error = null;
    this._selectedId = null;
    this._loaded = false;
    this._lastCallId = undefined;
    this._lastMissedCallId = undefined;
  }

  setConfig(config) {
    const entityPrefix = config.entity_prefix || config.device || DEFAULT_ENTITY_PREFIX;
    this._config = {
      title: "Intercom history",
      limit: 20,
      entity_prefix: entityPrefix,
      device: entityPrefix,
      call_history_url: DEFAULT_CALL_HISTORY_URL,
      last_call_entity: `sensor.${entityPrefix}_last_call`,
      last_missed_call_entity: `sensor.${entityPrefix}_last_missed_call`,
      ...config,
    };
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._config) {
      return;
    }
    if (!this._loaded) {
      this._loaded = true;
      this._lastCallId = this._summaryEntityId(this._config.last_call_entity);
      this._lastMissedCallId = this._summaryEntityId(this._config.last_missed_call_entity);
      this._loadHistory();
      return;
    }
    this._refreshOnSummaryEntityChange();
  }

  getCardSize() {
    return Math.min(Math.max(this._history.length + 1, 2), 6);
  }

  static getStubConfig() {
    return {
      type: "custom:sip-indoor-station-history-card",
      entity_prefix: DEFAULT_ENTITY_PREFIX,
      limit: 20,
    };
  }

  _refreshOnSummaryEntityChange() {
    const lastCallId = this._summaryEntityId(this._config.last_call_entity);
    const lastMissedCallId = this._summaryEntityId(this._config.last_missed_call_entity);
    if (lastCallId === this._lastCallId && lastMissedCallId === this._lastMissedCallId) {
      return;
    }
    this._lastCallId = lastCallId;
    this._lastMissedCallId = lastMissedCallId;
    this._loadHistory();
  }

  _summaryEntityId(entityId) {
    return this._hass?.states?.[entityId]?.attributes?.id || null;
  }

  async _loadHistory() {
    if (!this._hass || !this._config || this._loading) {
      return;
    }
    this._loading = true;
    this._error = null;
    this._render();
    try {
      const payload = await this._callHistoryApi("GET", `?limit=${encodeURIComponent(this._config.limit)}`);
      const calls = Array.isArray(payload?.calls) ? payload.calls : [];
      this._history = calls.filter((entry) => entry && typeof entry === "object");
      if (this._selectedId && !this._history.some((entry) => entry.id === this._selectedId)) {
        this._selectedId = null;
      }
    } catch (error) {
      this._error = error?.message || String(error);
    } finally {
      this._loading = false;
      this._render();
    }
  }

  async _deleteEntry(entry, event) {
    event?.stopPropagation();
    if (!entry?.id) {
      return;
    }
    try {
      await this._callHistoryApi("DELETE", `/${encodeURIComponent(entry.id)}`);
      this._history = this._history.filter((item) => item.id !== entry.id);
      if (this._selectedId === entry.id) {
        this._selectedId = null;
      }
      this._render();
    } catch (error) {
      this._error = error?.message || String(error);
      this._render();
    }
  }

  async _callHistoryApi(method, suffix = "") {
    const baseUrl = this._config.call_history_url.replace(/\/$/, "");
    const apiPath = `${baseUrl}${suffix}`.replace(/^\/api\/?/, "");
    if (typeof this._hass?.callApi === "function") {
      return this._hass.callApi(method, apiPath);
    }
    const response = await fetch(`/api/${apiPath}`, {
      method,
      cache: "no-store",
      credentials: "include",
    });
    if (!response.ok) {
      throw new Error(`${method} ${baseUrl} failed: ${response.status}`);
    }
    return response.json();
  }

  _render() {
    if (!this.shadowRoot || !this._config) {
      return;
    }
    const selected = this._selectedEntry();
    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: block;
          color: var(--primary-text-color);
        }

        ha-card {
          overflow: hidden;
        }

        .header {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: 12px;
          padding: 16px 16px 10px;
        }

        .preview-header {
          justify-content: space-between;
        }

        .title {
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          font-size: 18px;
          font-weight: 500;
        }

        .preview-title {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 14px;
          min-width: 0;
          flex: 1;
        }

        .preview-title .date {
          text-align: right;
        }

        .refresh {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 40px;
          height: 40px;
          border: 0;
          border-radius: 50%;
          color: var(--secondary-text-color);
          background: transparent;
          cursor: pointer;
        }

        .refresh:hover,
        .delete:hover,
        .back:hover {
          background: var(--secondary-background-color);
        }

        .state {
          padding: 18px 16px 20px;
          color: var(--secondary-text-color);
          text-align: center;
        }

        .error {
          color: var(--error-color);
        }

        .list {
          display: flex;
          flex-direction: column;
          padding: 0 8px 8px;
        }

        .row {
          display: grid;
          grid-template-columns: 28px minmax(120px, 1fr) 64px 40px;
          gap: 10px;
          align-items: center;
          min-height: 72px;
          padding: 8px;
          border: 0;
          border-radius: 8px;
          color: inherit;
          background: transparent;
          text-align: left;
          cursor: pointer;
        }

        .row:hover {
          background: var(--secondary-background-color);
        }

        .date {
          min-width: 0;
          font-size: 14px;
          line-height: 1.3;
        }

        .date .time {
          display: block;
          font-weight: 500;
        }

        .date .day {
          display: block;
          color: var(--secondary-text-color);
          font-size: 12px;
        }

        .status {
          display: inline-flex;
          align-items: center;
          justify-content: flex-start;
          gap: 6px;
          min-width: 0;
          color: var(--secondary-text-color);
          font-size: 13px;
          text-transform: capitalize;
        }

        .status ha-icon {
          --mdc-icon-size: 20px;
          flex: 0 0 auto;
          color: var(--state-icon-color);
        }

        .status-icon {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 28px;
          color: var(--state-icon-color);
        }

        .status-icon ha-icon {
          --mdc-icon-size: 22px;
        }

        .status.missed ha-icon,
        .status.failed ha-icon,
        .status-icon.missed ha-icon,
        .status-icon.failed ha-icon {
          color: var(--error-color);
        }

        .status.answered ha-icon,
        .status-icon.answered ha-icon {
          color: var(--success-color, #16a34a);
        }

        .status.rejected ha-icon,
        .status-icon.rejected ha-icon {
          color: var(--warning-color, #d97706);
        }

        .thumbnail {
          width: 64px;
          height: 48px;
          overflow: hidden;
          border-radius: 6px;
          background: var(--secondary-background-color);
        }

        .thumbnail img,
        .large-snapshot img {
          display: block;
          width: 100%;
          height: 100%;
          object-fit: cover;
        }

        .placeholder {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 100%;
          height: 100%;
          color: var(--disabled-text-color);
        }

        .placeholder ha-icon {
          --mdc-icon-size: 24px;
        }

        .delete,
        .back {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 40px;
          height: 40px;
          border: 0;
          border-radius: 50%;
          color: var(--secondary-text-color);
          background: transparent;
          cursor: pointer;
        }

        .delete ha-icon,
        .back ha-icon,
        .refresh ha-icon {
          --mdc-icon-size: 22px;
        }

        .detail {
          padding: 0 16px 16px;
        }

        .detail-top {
          display: flex;
          align-items: center;
          gap: 10px;
          margin-bottom: 12px;
        }

        .large-snapshot {
          aspect-ratio: 16 / 9;
          overflow: hidden;
          margin-bottom: 14px;
          border-radius: 8px;
          background: var(--secondary-background-color);
        }

        .detail-meta {
          display: grid;
          gap: 10px;
        }

        .timestamps {
          display: grid;
          gap: 8px;
          margin-top: 14px;
          padding-top: 14px;
          border-top: 1px solid var(--divider-color);
        }

        .timestamp {
          display: grid;
          grid-template-columns: 92px 1fr;
          gap: 12px;
          font-size: 13px;
        }

        .timestamp .label {
          color: var(--secondary-text-color);
        }

        @media (max-width: 420px) {
          .row {
            grid-template-columns: 26px 1fr 56px 40px;
            gap: 8px;
          }

          .status span {
            display: none;
          }

          .thumbnail {
            width: 56px;
            height: 42px;
          }

          .preview-title {
            gap: 8px;
          }
        }
      </style>
      <ha-card>
        ${
          selected
            ? this._detailTemplate(selected)
            : `<div class="header">
                <button class="refresh" id="refresh" title="Refresh" aria-label="Refresh">
                  <ha-icon icon="mdi:refresh"></ha-icon>
                </button>
              </div>
              ${this._contentTemplate()}`
        }
      </ha-card>
    `;
    this._wireHistoryControls();
  }

  _contentTemplate() {
    if (this._loading && this._history.length === 0) {
      return `<div class="state">Loading history...</div>`;
    }
    if (this._error) {
      return `<div class="state error">${this._escape(this._error)}</div>`;
    }
    if (this._history.length === 0) {
      return `<div class="state">No calls yet</div>`;
    }
    return `<div class="list">${this._history.map((entry) => this._rowTemplate(entry)).join("")}</div>`;
  }

  _rowTemplate(entry) {
    return `
      <button class="row" data-entry-id="${this._escape(entry.id || "")}" aria-label="${this._escape(this._statusLabel(entry.status))}">
        ${this._statusIconTemplate(entry.status)}
        ${this._dateTemplate(entry.started_at, true)}
        ${this._snapshotTemplate(entry, "thumbnail")}
        <span class="delete" data-delete-id="${this._escape(entry.id || "")}" title="Delete" aria-label="Delete">
          <ha-icon icon="mdi:delete-outline"></ha-icon>
        </span>
      </button>
    `;
  }

  _detailTemplate(entry) {
    return `
      <div class="header preview-header">
        <button class="back" id="back" title="Back" aria-label="Back">
          <ha-icon icon="mdi:arrow-left"></ha-icon>
        </button>
        <div class="preview-title">
          ${this._dateTemplate(entry.started_at, true)}
          ${this._statusTemplate(entry.status)}
        </div>
        <button class="delete" data-delete-id="${this._escape(entry.id || "")}" title="Delete" aria-label="Delete">
          <ha-icon icon="mdi:delete-outline"></ha-icon>
        </button>
      </div>
      <div class="detail">
        ${this._snapshotTemplate(entry, "large-snapshot")}
        <div class="timestamps">
          ${this._timestampTemplate("Started", entry.started_at)}
          ${this._timestampTemplate("Answered", entry.answered_at)}
          ${this._timestampTemplate("Ended", entry.ended_at)}
        </div>
      </div>
    `;
  }

  _dateTemplate(value, dateFirst = false) {
    const date = this._formatDate(value);
    const primary = dateFirst ? date.day : date.time;
    const secondary = dateFirst ? date.time : date.day;
    return `
      <div class="date">
        <span class="time">${this._escape(primary)}</span>
        <span class="day">${this._escape(secondary)}</span>
      </div>
    `;
  }

  _statusTemplate(status) {
    const normalized = this._statusLabel(status);
    return `
      <div class="status ${this._escape(normalized)}">
        <ha-icon icon="${this._statusIcon(normalized)}"></ha-icon>
        <span>${this._escape(normalized)}</span>
      </div>
    `;
  }

  _statusIconTemplate(status) {
    const normalized = this._statusLabel(status);
    return `
      <div class="status-icon ${this._escape(normalized)}" title="${this._escape(normalized)}" aria-label="${this._escape(normalized)}">
        <ha-icon icon="${this._statusIcon(normalized)}"></ha-icon>
      </div>
    `;
  }

  _snapshotTemplate(entry, className) {
    if (!entry?.has_snapshot || !entry?.id) {
      return `
        <div class="${className}">
          <div class="placeholder"><ha-icon icon="mdi:image-off-outline"></ha-icon></div>
        </div>
      `;
    }
    const src = entry.snapshot_url || `${this._config.call_history_url.replace(/\/$/, "")}/${encodeURIComponent(entry.id)}/snapshot`;
    return `
      <div class="${className}">
        <img src="${this._escape(src)}" alt="">
      </div>
    `;
  }

  _timestampTemplate(label, value) {
    return `
      <div class="timestamp">
        <div class="label">${this._escape(label)}</div>
        <div>${this._escape(value ? this._formatFullDate(value) : "-")}</div>
      </div>
    `;
  }

  _wireHistoryControls() {
    this.shadowRoot.getElementById("refresh")?.addEventListener("click", () => this._loadHistory());
    this.shadowRoot.getElementById("back")?.addEventListener("click", () => {
      this._selectedId = null;
      this._render();
    });
    this.shadowRoot.querySelectorAll("[data-entry-id]").forEach((row) => {
      row.addEventListener("click", () => {
        this._selectedId = row.dataset.entryId;
        this._render();
      });
    });
    this.shadowRoot.querySelectorAll("[data-delete-id]").forEach((button) => {
      button.addEventListener("click", (event) => {
        const entry = this._history.find((item) => item.id === button.dataset.deleteId);
        this._deleteEntry(entry, event);
      });
    });
  }

  _selectedEntry() {
    if (!this._selectedId) {
      return null;
    }
    return this._history.find((entry) => entry.id === this._selectedId) || null;
  }

  _formatDate(value) {
    const date = this._parseDate(value);
    if (!date) {
      return { time: "-", day: "" };
    }
    return {
      time: new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(date),
      day: new Intl.DateTimeFormat(undefined, { year: "numeric", month: "short", day: "2-digit" }).format(date),
    };
  }

  _formatFullDate(value) {
    const date = this._parseDate(value);
    if (!date) {
      return "-";
    }
    return new Intl.DateTimeFormat(undefined, {
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).format(date);
  }

  _parseDate(value) {
    if (!value) {
      return null;
    }
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  _statusLabel(status) {
    return String(status || "unknown").replace(/_/g, " ");
  }

  _statusIcon(status) {
    const icons = {
      answered: "mdi:phone-check",
      ended: "mdi:phone-hangup",
      failed: "mdi:phone-alert",
      missed: "mdi:phone-missed",
      rejected: "mdi:phone-cancel",
      ringing: "mdi:phone-ring",
    };
    return icons[status] || "mdi:phone";
  }

  _escape(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
}

if (!customElements.get("sip-indoor-station-history-card")) {
  customElements.define("sip-indoor-station-history-card", SipIndoorStationHistoryCard);
}

window.customCards = window.customCards || [];
window.customCards.push({
  type: "sip-indoor-station-card",
  name: "SIP Indoor Station Card",
  description: "Camera, call controls, and WebRTC audio for SIP Indoor Station",
  preview: false,
});
window.customCards.push({
  type: "sip-indoor-station-history-card",
  name: "SIP Indoor Station History Card",
  description: "Call history browser for SIP Indoor Station",
  preview: false,
});

console.info("%c SIP Indoor Station Cards %c v0.1.42 ", "color: white; background: #0f766e; font-weight: bold;", "color: #0f766e; background: white; font-weight: bold;");
