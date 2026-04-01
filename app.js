const summaryEl = document.getElementById("device-summary");
const reportListEl = document.getElementById("report-list");
const runAllButton = document.getElementById("run-all");
const exportReportButton = document.getElementById("export-report");
const refreshInfoButton = document.getElementById("refresh-info");
const touchGrid = document.getElementById("touch-grid");
const cameraPreview = document.getElementById("camera-preview");
const screenOverlay = document.getElementById("screen-overlay");
const closeOverlayButton = document.getElementById("close-overlay");
const micLevel = document.getElementById("mic-level");
const secureContextWarning = document.getElementById("secure-context-warning");

const STORAGE_KEY = "phone-check-report";
const reportState = {};

let activeCameraStream = null;
let activeMicStream = null;
let activeMicAudioContext = null;
let audioContext = null;
let sensorListening = false;
let sensorTimeout = null;
let sensorMotionSeen = false;
let sensorOrientationSeen = false;

const tests = {
  battery: runBatteryTest,
  vibration: runVibrationTest,
  audio: runAudioTest,
  "camera-back": () => runCameraTest("environment"),
  "camera-front": () => runCameraTest("user"),
  microphone: runMicrophoneTest,
  sensors: runSensorsTest,
  "touch-reset": resetTouchGrid,
  "screen-red": () => runScreenTest("#cf2f25"),
  "screen-green": () => runScreenTest("#1f9d52"),
  "screen-blue": () => runScreenTest("#2358d8"),
  "screen-black": () => runScreenTest("#050505"),
  "screen-white": () => runScreenTest("#fafafa"),
  network: runNetworkTest,
  geolocation: runGeolocationTest,
};

document.querySelectorAll("[data-action]").forEach((button) => {
  button.addEventListener("click", async () => {
    const action = button.dataset.action;
    const handler = tests[action];
    if (!handler) {
      return;
    }

    try {
      await handler();
    } catch (error) {
      const mappedTest = action.startsWith("camera") ? "camera" : action.split("-")[0];
      setStatus(mappedTest, "error", error.message || "ტესტი ვერ შესრულდა.");
    }
  });
});

runAllButton.addEventListener("click", async () => {
  await runBatteryTest();
  await runVibrationTest();
  await runAudioTest();
  await runNetworkTest();
  await runSensorsTest();
});

exportReportButton.addEventListener("click", exportReport);
refreshInfoButton.addEventListener("click", renderSummary);
closeOverlayButton.addEventListener("click", closeScreenOverlay);
window.addEventListener("online", runNetworkTest);
window.addEventListener("offline", runNetworkTest);

window.addEventListener("beforeunload", () => {
  stopCameraStream();
  stopMicStream();
});

showSecureContextWarning();
syncSecureOnlyActions();
loadStoredReport();
renderSummary();
buildTouchGrid();
hydrateStatuses();
runNetworkTest();
setStatus("touch", "manual", "მონიშნე ყველა უჯრა თითით, რომ touch ზონები შეამოწმო.");

async function renderSummary() {
  const isLikelyMobile =
    Boolean(navigator.userAgentData?.mobile) ||
    /android|iphone|ipad|ipod|mobile/i.test(navigator.userAgent);
  const battery = await getBatteryInfo();
  const summary = [
    {
      label: "მოწყობილობა",
      value: isLikelyMobile ? "მობილური" : "დესკტოპი ან უცნობი ტიპი",
    },
    {
      label: "პლატფორმა",
      value: formatValue(navigator.userAgentData?.platform || navigator.platform),
    },
    {
      label: "ბრაუზერი",
      value: formatValue(navigator.userAgent),
    },
    {
      label: "ეკრანი",
      value: `${window.screen.width} x ${window.screen.height}`,
    },
    {
      label: "ტაჩი",
      value: `${navigator.maxTouchPoints || 0} შეხება`,
    },
    {
      label: "RAM",
      value: formatValue(navigator.deviceMemory ? `${navigator.deviceMemory} GB` : null),
    },
    {
      label: "CPU Threads",
      value: formatValue(navigator.hardwareConcurrency || null),
    },
    {
      label: "ქსელი",
      value: navigator.onLine ? "ონლაინ" : "ოფლაინ",
    },
    {
      label: "ბატარეა",
      value: battery.summary,
    },
  ];

  summaryEl.innerHTML = summary
    .map(
      (item) => `
        <div class="summary-card">
          <span>${escapeHtml(item.label)}</span>
          <strong>${escapeHtml(item.value)}</strong>
        </div>
      `,
    )
    .join("");
}

function buildTouchGrid() {
  const totalCells = 20;

  for (let index = 0; index < totalCells; index += 1) {
    const cell = document.createElement("button");
    cell.type = "button";
    cell.className = "touch-cell";
    cell.dataset.index = String(index);
    cell.setAttribute("aria-label", `Touch cell ${index + 1}`);

    const activate = () => {
      cell.classList.add("active");
      updateTouchStatus();
    };

    cell.addEventListener("pointerdown", activate);
    cell.addEventListener("pointerenter", (event) => {
      if (event.buttons > 0) {
        activate();
      }
    });

    touchGrid.appendChild(cell);
  }
}

function updateTouchStatus() {
  const total = touchGrid.querySelectorAll(".touch-cell").length;
  const active = touchGrid.querySelectorAll(".touch-cell.active").length;

  if (active === total) {
    setStatus("touch", "success", "ყველა touch ზონა დაფიქსირდა.");
    return;
  }

  setStatus("touch", "manual", `${active}/${total} უჯრა მონიშნულია.`);
}

function resetTouchGrid() {
  touchGrid.querySelectorAll(".touch-cell").forEach((cell) => {
    cell.classList.remove("active");
  });

  setStatus("touch", "manual", "ტესტი გასუფთავდა. თავიდან გაატარე თითი ყველა უჯრაზე.");
}

async function runBatteryTest() {
  setStatus("battery", "running", "ვკითხულობ ბატარეის სტატუსს...");
  const battery = await getBatteryInfo();

  if (!battery.supported) {
    setStatus("battery", "manual", "ამ ბრაუზერში Battery API მიუწვდომელია.");
    return;
  }

  setStatus(
    "battery",
    "success",
    `დონე: ${battery.level}. სტატუსი: ${battery.charging}.`,
  );
  renderSummary();
}

async function getBatteryInfo() {
  if (!("getBattery" in navigator)) {
    return {
      supported: false,
      summary: "მიუწვდომელია",
    };
  }

  try {
    const battery = await navigator.getBattery();
    return {
      supported: true,
      level: `${Math.round(battery.level * 100)}%`,
      charging: battery.charging ? "იტენება" : "არ იტენება",
      summary: `${Math.round(battery.level * 100)}% / ${battery.charging ? "იტენება" : "არ იტენება"}`,
    };
  } catch {
    return {
      supported: false,
      summary: "ვერ წაიკითხა",
    };
  }
}

async function runVibrationTest() {
  setStatus("vibration", "running", "ვიბრაციის ტესტი მიმდინარეობს...");

  if (!("vibrate" in navigator)) {
    setStatus("vibration", "manual", "Vibration API ამ მოწყობილობაზე მიუწვდომელია.");
    return;
  }

  navigator.vibrate([200, 100, 200]);
  setStatus("vibration", "manual", "ტელეფონმა უნდა ივიბრიროს. თუ იგრძენი, ტესტი წარმატებულია.");
}

async function runAudioTest() {
  setStatus("audio", "running", "ვუშვებ მოკლე ტონს სპიკერისთვის...");

  try {
    if (!audioContext) {
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }

    if (audioContext.state === "suspended") {
      await audioContext.resume();
    }

    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = 880;
    gain.gain.setValueAtTime(0.0001, audioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.12, audioContext.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, audioContext.currentTime + 0.7);
    oscillator.connect(gain);
    gain.connect(audioContext.destination);
    oscillator.start();
    oscillator.stop(audioContext.currentTime + 0.75);

    setStatus("audio", "manual", "თუ მკაფიო ტონი გაიგე, სპიკერი მუშაობს.");
  } catch (error) {
    setStatus("audio", "error", `სპიკერის ტესტი ვერ გაეშვა: ${error.message}`);
  }
}

async function runCameraTest(facingMode) {
  setStatus("camera", "running", "კამერის ჩართვას ვცდილობ...");
  stopCameraStream();

  if (!hasMediaDevices()) {
    setStatus("camera", "error", "კამერის API მიუწვდომელია ამ ბრაუზერში.");
    return;
  }

  if (!ensureSecureContext("camera")) {
    return;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode,
      },
      audio: false,
    });

    activeCameraStream = stream;
    cameraPreview.srcObject = stream;
    const cameraLabel =
      stream.getVideoTracks()[0]?.label || (facingMode === "user" ? "წინა კამერა" : "უკანა კამერა");
    setStatus("camera", "manual", `${cameraLabel} ჩაირთო. შეამოწმე სურათის სისუფთავე და ფოკუსი.`);
  } catch (error) {
    setStatus("camera", "error", mapMediaError(error));
  }
}

function stopCameraStream() {
  if (!activeCameraStream) {
    return;
  }

  activeCameraStream.getTracks().forEach((track) => track.stop());
  activeCameraStream = null;
  cameraPreview.srcObject = null;
}

async function runMicrophoneTest() {
  setStatus("microphone", "running", "მიკროფონის ნებართვას ველოდები...");
  stopMicStream();

  if (!hasMediaDevices()) {
    setStatus("microphone", "error", "მიკროფონის API მიუწვდომელია ამ ბრაუზერში.");
    return;
  }

  if (!ensureSecureContext("microphone")) {
    return;
  }

  try {
    activeMicStream = await navigator.mediaDevices.getUserMedia({
      video: false,
      audio: true,
    });

    activeMicAudioContext = new (window.AudioContext || window.webkitAudioContext)();
    const analyser = activeMicAudioContext.createAnalyser();
    analyser.fftSize = 256;
    const source = activeMicAudioContext.createMediaStreamSource(activeMicStream);
    source.connect(analyser);

    const data = new Uint8Array(analyser.frequencyBinCount);
    let maxLevel = 0;
    let frameCount = 0;

    const updateMeter = () => {
      if (!activeMicStream) {
        micLevel.style.width = "0%";
        return;
      }

      analyser.getByteFrequencyData(data);
      const average = data.reduce((sum, value) => sum + value, 0) / data.length;
      maxLevel = Math.max(maxLevel, average);
      micLevel.style.width = `${Math.min(100, average)}%`;
      frameCount += 1;

      if (frameCount < 90) {
        requestAnimationFrame(updateMeter);
      } else {
        const status = maxLevel > 12 ? "success" : "manual";
        const text =
          maxLevel > 12
            ? "მიკროფონი რეაგირებს ხმაზე."
            : "ნებართვა არის, მაგრამ ხმაურის დონე დაბალია. ილაპარაკე ახლოს და ისევ სცადე.";
        setStatus("microphone", status, text);
        window.setTimeout(stopMicStream, 400);
      }
    };

    setStatus("microphone", "running", "ილაპარაკე ეკრანთან ახლოს რამდენიმე წამი...");
    updateMeter();
  } catch (error) {
    micLevel.style.width = "0%";
    setStatus("microphone", "error", mapMediaError(error));
  }
}

function stopMicStream() {
  if (!activeMicStream) {
    if (activeMicAudioContext) {
      activeMicAudioContext.close();
      activeMicAudioContext = null;
    }
    return;
  }

  activeMicStream.getTracks().forEach((track) => track.stop());
  activeMicStream = null;
  micLevel.style.width = "0%";
  if (activeMicAudioContext) {
    activeMicAudioContext.close();
    activeMicAudioContext = null;
  }
}

async function runSensorsTest() {
  setStatus("sensors", "running", "სენსორების მონაცემებს ველოდები...");
  sensorMotionSeen = false;
  sensorOrientationSeen = false;

  if (sensorListening) {
    clearTimeout(sensorTimeout);
  } else {
    const permissionResult = await requestSensorPermission();
    if (!permissionResult.granted) {
      setStatus("sensors", "error", permissionResult.message);
      return;
    }

    window.addEventListener("devicemotion", handleDeviceMotion);
    window.addEventListener("deviceorientation", handleDeviceOrientation);
    sensorListening = true;
  }

  sensorTimeout = window.setTimeout(() => {
    if (sensorMotionSeen || sensorOrientationSeen) {
      setStatus(
        "sensors",
        "success",
        "სენსორებიდან მონაცემები მივიღეთ. გადაატრიალე და შეარხიე ტელეფონი მნიშვნელობების სანახავად.",
      );
    } else {
      setStatus(
        "sensors",
        "manual",
        "სენსორების API მიუწვდომელია ან ბრაუზერი ზღუდავს მათ. სცადე სხვა ბრაუზერით.",
      );
    }
  }, 2500);
}

async function requestSensorPermission() {
  const motionPermission =
    typeof DeviceMotionEvent !== "undefined" && typeof DeviceMotionEvent.requestPermission === "function"
      ? DeviceMotionEvent.requestPermission()
      : Promise.resolve("granted");
  const orientationPermission =
    typeof DeviceOrientationEvent !== "undefined" &&
    typeof DeviceOrientationEvent.requestPermission === "function"
      ? DeviceOrientationEvent.requestPermission()
      : Promise.resolve("granted");

  try {
    const [motion, orientation] = await Promise.all([motionPermission, orientationPermission]);
    const granted = motion === "granted" || orientation === "granted";
    return {
      granted,
      message: granted ? "" : "სენსორებზე წვდომა არ დამტკიცდა.",
    };
  } catch {
    return {
      granted: false,
      message: "სენსორების ნებართვა ვერ მივიღეთ.",
    };
  }
}

function handleDeviceMotion(event) {
  const acceleration = event.accelerationIncludingGravity || event.acceleration;
  if (!acceleration) {
    return;
  }

  sensorMotionSeen = true;
  document.getElementById("motion-x").textContent = formatNumber(acceleration.x);
  document.getElementById("motion-y").textContent = formatNumber(acceleration.y);
  document.getElementById("motion-z").textContent = formatNumber(acceleration.z);
}

function handleDeviceOrientation(event) {
  sensorOrientationSeen = true;
  document.getElementById("orientation-a").textContent = formatNumber(event.alpha);
  document.getElementById("orientation-b").textContent = formatNumber(event.beta);
  document.getElementById("orientation-c").textContent = formatNumber(event.gamma);
}

async function runNetworkTest() {
  setStatus("network", "running", "ქსელის ინფორმაციას ვკითხულობ...");

  const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  const parts = [navigator.onLine ? "ონლაინ" : "ოფლაინ"];

  if (connection) {
    if (connection.effectiveType) {
      parts.push(`ტიპი: ${connection.effectiveType}`);
    }
    if (connection.downlink) {
      parts.push(`სიჩქარე: ${connection.downlink} Mbps`);
    }
    if (connection.rtt) {
      parts.push(`RTT: ${connection.rtt} ms`);
    }
  } else {
    parts.push("დეტალური ქსელის API მიუწვდომელია.");
  }

  setStatus("network", navigator.onLine ? "success" : "manual", parts.join(". ") + ".");
  renderSummary();
}

async function runGeolocationTest() {
  setStatus("network", "running", "GPS/ლოკაციის ნებართვას ველოდები...");

  if (!navigator.geolocation) {
    setStatus("network", "error", "Geolocation API ამ ბრაუზერში მიუწვდომელია.");
    return;
  }

  if (!ensureSecureContext("geolocation")) {
    return;
  }

  navigator.geolocation.getCurrentPosition(
    (position) => {
      const { latitude, longitude, accuracy } = position.coords;
      setStatus(
        "network",
        "success",
        `ლოკაცია დაფიქსირდა. Lat: ${latitude.toFixed(5)}, Lon: ${longitude.toFixed(5)}, Accuracy: ${Math.round(accuracy)}m.`,
      );
    },
    (error) => {
      setStatus("network", "error", mapLocationError(error));
    },
    {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 0,
    },
  );
}

async function runScreenTest(color) {
  setStatus("screen", "manual", `ეკრანი შეივსო ფერით ${color}. შეამოწმე dead pixel და backlight.`);
  screenOverlay.classList.remove("hidden");
  screenOverlay.style.background = color;

  if (document.documentElement.requestFullscreen && !document.fullscreenElement) {
    try {
      await document.documentElement.requestFullscreen();
    } catch {
      // Fullscreen is best-effort only.
    }
  }
}

async function closeScreenOverlay() {
  screenOverlay.classList.add("hidden");
  if (document.fullscreenElement && document.exitFullscreen) {
    try {
      await document.exitFullscreen();
    } catch {
      // Ignore fullscreen exit failure.
    }
  }
}

function setStatus(testName, status, message) {
  const normalizedTestName = normalizeTestName(testName);
  reportState[normalizedTestName] = {
    status,
    message,
    updatedAt: new Date().toLocaleString("ka-GE"),
  };
  persistReport();
  applyStatusToUi(normalizedTestName, reportState[normalizedTestName]);
  renderReport();
}

function applyStatusToUi(testName, state) {
  const badge = document.querySelector(`[data-test="${testName}"] .status-badge`);
  const result = document.querySelector(`[data-result="${testName}"]`);

  if (badge) {
    badge.className = `status-badge ${state.status}`;
    badge.textContent = statusToLabel(state.status);
  }

  if (result) {
    result.textContent = state.message;
  }
}

function renderReport() {
  const names = [
    "battery",
    "vibration",
    "audio",
    "camera",
    "microphone",
    "sensors",
    "touch",
    "screen",
    "network",
  ];

  reportListEl.innerHTML = names
    .map((name) => {
      const state = reportState[name] || {
        status: "pending",
        message: "ტესტი ჯერ არ გაშვებულა.",
        updatedAt: "-",
      };

      return `
        <div class="report-item">
          <strong>${escapeHtml(reportLabel(name))}</strong>
          <div class="status-badge ${state.status}">${escapeHtml(statusToLabel(state.status))}</div>
          <p>${escapeHtml(state.message)}</p>
          <small>განახლდა: ${escapeHtml(state.updatedAt)}</small>
        </div>
      `;
    })
    .join("");
}

function exportReport() {
  const content = {
    exportedAt: new Date().toISOString(),
    summary: {
      secureContext: window.isSecureContext,
      href: window.location.href,
      userAgent: navigator.userAgent,
      platform: navigator.userAgentData?.platform || navigator.platform,
      screen: {
        width: window.screen.width,
        height: window.screen.height,
      },
    },
    results: reportState,
  };

  const blob = new Blob([JSON.stringify(content, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "phone-diagnostics-report.json";
  link.click();
  URL.revokeObjectURL(url);
}

function mapMediaError(error) {
  const messages = {
    NotAllowedError: "ნებართვა არ დამტკიცდა.",
    NotFoundError: "შესაბამისი კამერა ან მიკროფონი ვერ მოიძებნა.",
    NotReadableError: "მოწყობილობა დაკავებულია სხვა აპით ან ვერ გაიხსნა.",
    OverconstrainedError: "არჩეული კამერის რეჟიმი მიუწვდომელია ამ მოწყობილობაზე.",
  };

  return messages[error.name] || `მედია ტესტი ვერ შესრულდა: ${error.message}`;
}

function mapLocationError(error) {
  const messages = {
    1: "ლოკაციის ნებართვა უარყოფილია.",
    2: "ლოკაცია ვერ განისაზღვრა.",
    3: "ლოკაციის პასუხს დიდი დრო დასჭირდა.",
  };

  return messages[error.code] || "ლოკაციის ტესტი ვერ შესრულდა.";
}

function statusToLabel(status) {
  const labels = {
    pending: "მოლოდინი",
    running: "მიმდინარეობს",
    success: "კარგია",
    manual: "ხელით შეამოწმე",
    error: "შეცდომა",
  };

  return labels[status] || status;
}

function reportLabel(name) {
  const labels = {
    battery: "ბატარეა",
    vibration: "ვიბრაცია",
    audio: "სპიკერი",
    camera: "კამერა",
    microphone: "მიკროფონი",
    sensors: "სენსორები",
    touch: "Touch ეკრანი",
    screen: "ეკრანი",
    network: "ქსელი და GPS",
  };

  return labels[name] || name;
}

function normalizeTestName(name) {
  if (name.startsWith("camera")) {
    return "camera";
  }
  if (name.startsWith("screen")) {
    return "screen";
  }
  if (name.startsWith("touch")) {
    return "touch";
  }
  if (name.startsWith("geo")) {
    return "network";
  }
  return name;
}

function formatNumber(value) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "-";
  }

  return value.toFixed(2);
}

function formatValue(value) {
  if (value === null || value === undefined || value === "") {
    return "მიუწვდომელია";
  }

  return String(value);
}

function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function showSecureContextWarning() {
  if (window.isSecureContext) {
    secureContextWarning.classList.add("hidden");
    return;
  }

  secureContextWarning.innerHTML = `
    ეს გვერდი ახლა გახსნილია დაუცველი მისამართიდან <strong>${escapeHtml(window.location.origin)}</strong>.
    ტელეფონზე ამ რეჟიმში ჩვეულებრივ იმუშავებს ეკრანი, touch, ვიბრაცია, სპიკერი და ნაწილი სენსორების,
    მაგრამ კამერა, მიკროფონი და GPS სრულად იმუშავებს მხოლოდ <strong>HTTPS</strong>-ზე.
    აპივით დაყენება კომპიუტერზე <strong>localhost</strong>-იდან შეგიძლია, ხოლო ტელეფონზე ამისთვისაც HTTPS ან სანდო დომენი დაგჭირდება.
  `;
  secureContextWarning.classList.remove("hidden");
}

function syncSecureOnlyActions() {
  const secureOnlyButtons = [
    '[data-action="camera-back"]',
    '[data-action="camera-front"]',
    '[data-action="microphone"]',
    '[data-action="geolocation"]',
  ];

  secureOnlyButtons.forEach((selector) => {
    const button = document.querySelector(selector);
    if (!button) {
      return;
    }

    const originalLabel = button.dataset.originalLabel || button.textContent.trim();
    button.dataset.originalLabel = originalLabel;

    if (window.isSecureContext) {
      button.disabled = false;
      button.textContent = originalLabel;
      button.removeAttribute("title");
      return;
    }

    button.disabled = true;
    button.textContent = `${originalLabel} · HTTPS`;
    button.title = "ეს ფუნქცია ტელეფონზე სრულად იმუშავებს მხოლოდ HTTPS-ზე.";
  });
}

function ensureSecureContext(target) {
  if (window.isSecureContext) {
    return true;
  }

  const messages = {
    camera: "კამერის ტესტს https ან localhost სჭირდება.",
    microphone: "მიკროფონის ტესტს https ან localhost სჭირდება.",
    geolocation: "GPS ტესტს https ან localhost სჭირდება.",
  };
  const mappedTarget = target === "geolocation" ? "network" : target;
  setStatus(mappedTarget, "error", messages[target] || "ამ ტესტს უსაფრთხო გარემო სჭირდება.");
  return false;
}

function hasMediaDevices() {
  return Boolean(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
}

function loadStoredReport() {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return;
    }

    const parsed = JSON.parse(raw);
    Object.entries(parsed).forEach(([name, state]) => {
      reportState[name] = state;
    });
  } catch {
    window.sessionStorage.removeItem(STORAGE_KEY);
  }
}

function hydrateStatuses() {
  Object.entries(reportState).forEach(([name, state]) => {
    applyStatusToUi(name, state);
  });
}

function persistReport() {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(reportState));
  } catch {
    // Ignore storage write failures.
  }
}
