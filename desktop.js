const refreshStatusButton = document.getElementById("refresh-status");
const refreshInfoButton = document.getElementById("refresh-info");
const takeScreenshotButton = document.getElementById("take-screenshot");
const deviceSelect = document.getElementById("device-select");
const adbStatusEl = document.getElementById("adb-status");
const scrcpyStatusEl = document.getElementById("scrcpy-status");
const deviceCountEl = document.getElementById("device-count");
const deviceInfoEl = document.getElementById("device-info");
const adbWarningEl = document.getElementById("adb-warning");
const screenshotPreview = document.getElementById("screenshot-preview");
const screenshotEmpty = document.getElementById("screenshot-empty");
const logList = document.getElementById("log-list");
const phoneQrEl = document.getElementById("phone-qr");
const phoneUrlEl = document.getElementById("phone-url");
const copyPhoneUrlButton = document.getElementById("copy-phone-url");
const phoneLinkStatusEl = document.getElementById("phone-link-status");

let lastStatus = null;
let phoneLaunchUrl = "";

refreshStatusButton.addEventListener("click", loadStatus);
refreshInfoButton.addEventListener("click", loadSelectedDeviceInfo);
takeScreenshotButton.addEventListener("click", loadScreenshot);
copyPhoneUrlButton.addEventListener("click", copyPhoneUrl);
deviceSelect.addEventListener("change", async () => {
  await loadSelectedDeviceInfo();
  clearScreenshot();
});

document.querySelectorAll(".action-button").forEach((button) => {
  button.addEventListener("click", async () => {
    const action = button.dataset.action;
    await runAction(action);
  });
});

loadStatus();
loadPhoneLaunchInfo();

async function loadPhoneLaunchInfo() {
  const fallbackUrl = new URL("./index.html", window.location.href).href;

  try {
    const info = await fetchJson("/api/server/info");
    const url = info.phoneUrl || fallbackUrl;
    renderPhoneLaunch(url, buildPhoneLaunchHint(url, info.localNetworkAvailable));
    return;
  } catch (error) {
    renderPhoneLaunch(fallbackUrl, buildPhoneLaunchHint(fallbackUrl, false));
  }
}

function renderPhoneLaunch(url, hint) {
  phoneLaunchUrl = url;
  phoneUrlEl.href = url;
  phoneUrlEl.textContent = url;
  phoneLinkStatusEl.textContent = hint;
  renderPhoneQr(url);
}

function renderPhoneQr(url) {
  phoneQrEl.innerHTML = "";

  if (!url || typeof QRCode !== "function") {
    phoneQrEl.textContent = "QR unavailable";
    return;
  }

  new QRCode(phoneQrEl, {
    text: url,
    width: 214,
    height: 214,
    colorDark: "#2d2416",
    colorLight: "#fffdf7",
    correctLevel: QRCode.CorrectLevel.M,
  });
}

function buildPhoneLaunchHint(url, hasLocalNetworkUrl) {
  if (hasLocalNetworkUrl && !isLocalOnlyHost(url)) {
    return "დასკანერე QR კოდი და ტელეფონზე ეს გვერდი მაშინვე გაიხსნება. ორივე მოწყობილობა ერთ Wi-Fi ქსელში უნდა იყოს.";
  }

  if (isLocalOnlyHost(url)) {
    return "ახლა ბმული localhost-ზეა. ტელეფონზე გასახსნელად გაუშვი python serve.py და ორივე მოწყობილობა ერთ Wi-Fi-ზე ამუშავე.";
  }

  return "თუ QR ვერ იმუშავებს, ქვემოთ მოცემული ბმული ხელითაც შეგიძლია გახსნა ტელეფონში.";
}

function isLocalOnlyHost(url) {
  try {
    const hostname = new URL(url).hostname;
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname === "[::1]";
  } catch {
    return true;
  }
}

async function copyPhoneUrl() {
  if (!phoneLaunchUrl) {
    return;
  }

  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(phoneLaunchUrl);
    } else {
      copyTextFallback(phoneLaunchUrl);
    }

    phoneLinkStatusEl.textContent = "ბმული დაკოპირდა. შეგიძლია ტელეფონში ჩასვა ან პირდაპირ QR-ით გახსნა.";
  } catch (error) {
    phoneLinkStatusEl.textContent = "კოპირება ვერ მოხერხდა, მაგრამ ბმული ქვემოთ ჩანს და QR კოდიც მზად არის.";
  }
}

function copyTextFallback(text) {
  const input = document.createElement("input");
  input.value = text;
  document.body.appendChild(input);
  input.select();
  document.execCommand("copy");
  document.body.removeChild(input);
}

async function loadStatus() {
  try {
    const status = await fetchJson("/api/adb/status");
    lastStatus = status;
    renderStatus(status);

    if (deviceSelect.value) {
      const stillExists = status.devices.some((device) => device.serial === deviceSelect.value);
      if (stillExists) {
        await loadSelectedDeviceInfo();
        return;
      }
    }

    const firstDevice = status.devices[0]?.serial || "";
    deviceSelect.value = firstDevice;
    if (firstDevice) {
      await loadSelectedDeviceInfo();
    } else {
      renderInfoCards([]);
    }
  } catch (error) {
    addLog("კავშირის შეცდომა", error.message, "error");
  }
}

function renderStatus(status) {
  adbStatusEl.textContent = status.adbAvailable ? "დაყენებულია" : "არ არის დაყენებული";
  scrcpyStatusEl.textContent = status.scrcpyAvailable ? "დაყენებულია" : "არ არის დაყენებული";
  deviceCountEl.textContent = String(status.devices.length);

  adbWarningEl.classList.toggle("hidden", Boolean(status.adbAvailable));

  const previousValue = deviceSelect.value;
  deviceSelect.innerHTML = `<option value="">აირჩიე მოწყობილობა</option>`;

  status.devices.forEach((device) => {
    const option = document.createElement("option");
    option.value = device.serial;
    const labelBits = [
      device.model || device.device || device.serial,
      device.state !== "device" ? `(${device.state})` : "",
      device.serial,
    ].filter(Boolean);
    option.textContent = labelBits.join(" ");
    deviceSelect.appendChild(option);
  });

  if (previousValue && status.devices.some((device) => device.serial === previousValue)) {
    deviceSelect.value = previousValue;
  }

  addLog(
    "ADB სტატუსი",
    status.adbAvailable
      ? `ნაპოვნია ${status.devices.length} მოწყობილობა.`
      : "ADB ჯერ PATH-ში არ ჩანს.",
    status.adbAvailable ? "info" : "error",
  );
}

async function loadSelectedDeviceInfo() {
  const serial = getSelectedSerial();
  if (!serial) {
    renderInfoCards([]);
    return;
  }

  try {
    const info = await fetchJson(`/api/device/info?serial=${encodeURIComponent(serial)}`);
    if (!info.ok) {
      throw new Error(info.message || "ინფორმაცია ვერ წამოვიღე.");
    }

    renderInfo(info);
    addLog("ინფორმაცია განახლდა", `${info.manufacturer || ""} ${info.model || serial}`.trim(), "success");
  } catch (error) {
    renderInfoCards([]);
    addLog("ინფორმაციის შეცდომა", error.message, "error");
  }
}

function renderInfo(info) {
  const battery = info.battery || {};
  const storage = info.storage || {};

  const cards = [
    ["მწარმოებელი", info.manufacturer || "უცნობი"],
    ["მოდელი", info.model || "უცნობი"],
    ["Android", [info.androidVersion, info.sdkVersion ? `(SDK ${info.sdkVersion})` : ""].filter(Boolean).join(" ") || "უცნობი"],
    ["Security Patch", info.securityPatch || "უცნობი"],
    ["ეკრანი", info.screenSize || "უცნობი"],
    ["Density", info.density || "უცნობი"],
    ["IP", info.ipAddress || "უცნობი"],
    ["Battery", battery.level != null ? `${battery.level}% / ${battery.status || "უცნობი"}` : "უცნობი"],
    ["Battery Temp", battery.temperatureC != null ? `${battery.temperatureC}°C` : "უცნობი"],
    ["Storage", storage.size ? `${storage.used || "?"} / ${storage.size} (${storage.usedPercent || "?"})` : "უცნობი"],
    ["Charging", battery.plugged || "უცნობი"],
    ["Health", battery.health || "უცნობი"],
  ];

  renderInfoCards(cards);
}

function renderInfoCards(cards) {
  if (!cards.length) {
    deviceInfoEl.innerHTML = `
      <div class="summary-card">
        <span>სტატუსი</span>
        <strong>მოწყობილობა ჯერ არ არის არჩეული ან ინფორმაცია მიუწვდომელია.</strong>
      </div>
    `;
    return;
  }

  deviceInfoEl.innerHTML = cards
    .map(
      ([label, value]) => `
        <div class="summary-card">
          <span>${escapeHtml(label)}</span>
          <strong>${escapeHtml(value)}</strong>
        </div>
      `,
    )
    .join("");
}

async function runAction(action) {
  const serial = getSelectedSerial();
  if (!serial) {
    addLog("ქმედება ვერ შესრულდა", "ჯერ მოწყობილობა აირჩიე.", "error");
    return;
  }

  try {
    const result = await fetchJson("/api/device/action", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ serial, action }),
    });

    if (!result.ok) {
      throw new Error(result.message || "ქმედება ვერ შესრულდა.");
    }

    addLog("ქმედება შესრულდა", result.message, "success");

    if (action === "launch_scrcpy") {
      return;
    }

    await loadSelectedDeviceInfo();
  } catch (error) {
    addLog("ქმედების შეცდომა", error.message, "error");
  }
}

async function loadScreenshot() {
  const serial = getSelectedSerial();
  if (!serial) {
    addLog("Screenshot", "ჯერ მოწყობილობა აირჩიე.", "error");
    return;
  }

  const url = `/api/device/screenshot?serial=${encodeURIComponent(serial)}&t=${Date.now()}`;
  screenshotPreview.onload = () => {
    screenshotPreview.classList.remove("hidden");
    screenshotEmpty.classList.add("hidden");
    addLog("Screenshot", "ეკრანის სურათი წარმატებით მივიღეთ.", "success");
  };
  screenshotPreview.onerror = async () => {
    clearScreenshot();
    try {
      const response = await fetch(url);
      const text = await response.text();
      const message = tryExtractMessage(text) || "Screenshot ვერ მივიღე.";
      addLog("Screenshot შეცდომა", message, "error");
    } catch (error) {
      addLog("Screenshot შეცდომა", error.message, "error");
    }
  };
  screenshotPreview.src = url;
}

function clearScreenshot() {
  screenshotPreview.removeAttribute("src");
  screenshotPreview.classList.add("hidden");
  screenshotEmpty.classList.remove("hidden");
}

function getSelectedSerial() {
  return deviceSelect.value || "";
}

function addLog(title, message, kind) {
  const item = document.createElement("div");
  item.className = "log-item";

  const label = kind === "error" ? "შეცდომა" : kind === "success" ? "კარგია" : "ინფო";
  item.innerHTML = `
    <strong>${escapeHtml(title)} <span class="status-badge ${badgeClass(kind)}">${escapeHtml(label)}</span></strong>
    <p>${escapeHtml(message)}</p>
    <small>${escapeHtml(new Date().toLocaleString("ka-GE"))}</small>
  `;

  logList.prepend(item);

  while (logList.children.length > 8) {
    logList.removeChild(logList.lastChild);
  }
}

function badgeClass(kind) {
  if (kind === "error") {
    return "error";
  }
  if (kind === "success") {
    return "success";
  }
  return "manual";
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.message || `Request failed with ${response.status}`);
  }
  return data;
}

function tryExtractMessage(text) {
  try {
    const parsed = JSON.parse(text);
    return parsed.message;
  } catch {
    return "";
  }
}

function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
