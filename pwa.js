const installButtons = Array.from(document.querySelectorAll("[data-install-app]"));
const installStatusEls = Array.from(document.querySelectorAll("[data-install-status]"));

let deferredInstallPrompt = null;

const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
const isStandalone =
  window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
const secureInstallOrigin = window.isSecureContext || isLocalhost(window.location.hostname);

registerServiceWorker();
syncInstallUi();

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
  syncInstallUi();
  setInstallStatus("აპის დაყენება მზად არის. დააჭირე ღილაკს და დააყენე აპივით.");
});

window.addEventListener("appinstalled", () => {
  deferredInstallPrompt = null;
  setInstallStatus("აპი წარმატებით დაიყენა. შეგიძლია უკვე ჩვეულებრივი აპივით გახსნა.");
  syncInstallUi();
});

installButtons.forEach((button) => {
  button.addEventListener("click", async () => {
    if (isStandalone) {
      setInstallStatus("ეს ვერსია უკვე აპივით არის გახსნილი.");
      return;
    }

    if (deferredInstallPrompt) {
      deferredInstallPrompt.prompt();
      const result = await deferredInstallPrompt.userChoice;
      deferredInstallPrompt = null;
      setInstallStatus(
        result.outcome === "accepted"
          ? "ინსტალაცია დადასტურდა. რამდენიმე წამში აპი დაემატება მოწყობილობას."
          : "ინსტალაცია გაუქმდა. სურვილის შემთხვევაში ისევ შეგიძლია სცადო.",
      );
      syncInstallUi();
      return;
    }

    if (isIos && isSafari) {
      setInstallStatus("iPhone/iPad-ზე Safari-ში დააჭირე Share ღილაკს და მერე აირჩიე Add to Home Screen.");
      return;
    }

    setInstallStatus("Chrome ან Edge მენიუდან აირჩიე Install app ან Add to Home screen.");
  });
});

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    return;
  }

  if (!window.location.protocol.startsWith("http")) {
    return;
  }

  if (!secureInstallOrigin) {
    setInstallStatus("აპივით დაყენება ამ მისამართიდან ვერ ჩაირთვება. ტელეფონზე გამოიყენე HTTPS, ხოლო კომპიუტერზე localhost.");
    return;
  }

  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./service-worker.js").catch(() => {
      setInstallStatus("აპის დაყენება ამ ბრაუზერში სრულად ვერ ჩაირთო. სცადე Chrome ან Edge.");
    });
  });
}

function syncInstallUi() {
  if (!installButtons.length) {
    return;
  }

  if (isStandalone) {
    installButtons.forEach((button) => {
      button.disabled = true;
      button.textContent = "აპი დაყენებულია";
    });
    if (!installStatusEls.some((node) => node.textContent.trim())) {
      setInstallStatus("ეს გვერდი უკვე აპივით არის დაყენებული.");
    }
    return;
  }

  if (!secureInstallOrigin) {
    installButtons.forEach((button) => {
      button.disabled = true;
      button.textContent = "HTTPS სჭირდება";
    });
    return;
  }

  installButtons.forEach((button) => {
    button.disabled = false;
    button.textContent = deferredInstallPrompt ? "აპის დაყენება" : "დაყენების ინსტრუქცია";
  });

  if (installStatusEls.some((node) => node.textContent.trim())) {
    return;
  }

  if (isIos && isSafari) {
    setInstallStatus("iPhone/iPad-ზე Safari-დან შეგიძლია Share -> Add to Home Screen.");
    return;
  }

  if (deferredInstallPrompt) {
    setInstallStatus("შეგიძლია ეს გვერდი აპივით დააყენო როგორც ტელეფონზე, ისე კომპიუტერზე.");
    return;
  }

  setInstallStatus("პირველი გახსნის შემდეგ Chrome/Edge ხშირად გთავაზობს Install app ან Add to Home Screen ვარიანტს.");
}

function setInstallStatus(text) {
  installStatusEls.forEach((node) => {
    node.textContent = text;
  });
}

function isLocalhost(hostname) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname === "[::1]";
}
