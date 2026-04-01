from __future__ import annotations

import json
import os
import re
import shutil
import socket
import subprocess
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

ROOT = Path(__file__).resolve().parent
ACTION_LABELS = {
    "open_camera": "კამერის გახსნა",
    "open_settings": "პარამეტრების გახსნა",
    "open_wifi_settings": "Wi-Fi პარამეტრები",
    "wake_screen": "ეკრანის გაღვიძება",
    "go_home": "მთავარ ეკრანზე გადასვლა",
    "open_recents": "Recent apps",
    "volume_up": "ხმის აწევა",
    "volume_down": "ხმის დაწევა",
    "reboot": "გადატვირთვა",
    "launch_scrcpy": "scrcpy-ის გაშვება",
}


class AppHandler(SimpleHTTPRequestHandler):
    extensions_map = {
        **SimpleHTTPRequestHandler.extensions_map,
        ".css": "text/css; charset=utf-8",
        ".html": "text/html; charset=utf-8",
        ".js": "application/javascript; charset=utf-8",
        ".json": "application/json; charset=utf-8",
        ".webmanifest": "application/manifest+json; charset=utf-8",
    }

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def do_GET(self) -> None:
        parsed = urlparse(self.path)

        if parsed.path == "/api/server/info":
            self.send_json(get_server_info(self))
            return

        if parsed.path == "/api/adb/status":
            self.send_json(get_adb_status())
            return

        if parsed.path == "/api/device/info":
            query = parse_qs(parsed.query)
            serial = query.get("serial", [None])[0]
            self.send_json(get_device_info(serial))
            return

        if parsed.path == "/api/device/screenshot":
            query = parse_qs(parsed.query)
            serial = query.get("serial", [None])[0]
            self.send_screenshot(serial)
            return

        super().do_GET()

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path != "/api/device/action":
            self.send_error(HTTPStatus.NOT_FOUND)
            return

        payload = self.read_json_body()
        if payload is None:
            self.send_json(
                {
                    "ok": False,
                    "error": "invalid_json",
                    "message": "JSON body ვერ წავიკითხე.",
                },
                status=HTTPStatus.BAD_REQUEST,
            )
            return

        serial = payload.get("serial")
        action = payload.get("action")
        result = run_device_action(serial, action)
        status = HTTPStatus.OK if result.get("ok") else HTTPStatus.BAD_REQUEST
        self.send_json(result, status=status)

    def read_json_body(self) -> dict | None:
        try:
            content_length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            return None

        raw = self.rfile.read(content_length)
        if not raw:
            return {}

        try:
            return json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            return None

    def send_json(self, payload: dict, status: HTTPStatus = HTTPStatus.OK) -> None:
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def send_screenshot(self, serial: str | None) -> None:
        if not serial:
            self.send_json(
                {
                    "ok": False,
                    "error": "missing_serial",
                    "message": "მოწყობილობა არჩეული არ არის.",
                },
                status=HTTPStatus.BAD_REQUEST,
            )
            return

        if not adb_available():
            self.send_json(
                {
                    "ok": False,
                    "error": "adb_missing",
                    "message": "ADB ვერ მოიძებნა PATH-ში.",
                },
                status=HTTPStatus.BAD_REQUEST,
            )
            return

        result = adb_command(["exec-out", "screencap", "-p"], serial=serial, text=False, timeout=20)
        if result.returncode != 0 or not result.stdout:
            self.send_json(
                {
                    "ok": False,
                    "error": "screenshot_failed",
                    "message": clean_error(result.stderr) or "Screenshot ვერ ავიღე.",
                },
                status=HTTPStatus.BAD_REQUEST,
            )
            return

        data = bytes(result.stdout)
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "image/png")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


def get_adb_status() -> dict:
    return {
        "ok": True,
        "adbAvailable": adb_available(),
        "adbPath": shutil.which("adb"),
        "scrcpyAvailable": shutil.which("scrcpy") is not None,
        "scrcpyPath": shutil.which("scrcpy"),
        "devices": list_devices(),
    }


def get_server_info(handler: AppHandler) -> dict:
    port = handler.server.server_address[1]
    host_header = handler.headers.get("Host", "")
    if host_header:
        host_port = host_header.rsplit(":", 1)[-1]
        if host_port.isdigit():
            port = int(host_port)

    local_ip = guess_local_ip()
    request_origin = f"http://{host_header}" if host_header else f"http://localhost:{port}"
    local_network_available = local_ip != "127.0.0.1"
    lan_origin = f"http://{local_ip}:{port}"

    return {
        "ok": True,
        "port": port,
        "requestOrigin": request_origin,
        "localIp": local_ip,
        "localNetworkAvailable": local_network_available,
        "desktopUrl": f"{lan_origin}/desktop.html" if local_network_available else f"{request_origin}/desktop.html",
        "phoneUrl": f"{lan_origin}/index.html" if local_network_available else f"{request_origin}/index.html",
    }


def get_device_info(serial: str | None) -> dict:
    validation = validate_serial(serial)
    if validation is not None:
        return validation

    model = shell_text(serial, ["shell", "getprop", "ro.product.model"])
    manufacturer = shell_text(serial, ["shell", "getprop", "ro.product.manufacturer"])
    android_version = shell_text(serial, ["shell", "getprop", "ro.build.version.release"])
    sdk_version = shell_text(serial, ["shell", "getprop", "ro.build.version.sdk"])
    security_patch = shell_text(serial, ["shell", "getprop", "ro.build.version.security_patch"])
    screen_size = shell_text(serial, ["shell", "wm", "size"])
    density = shell_text(serial, ["shell", "wm", "density"])
    battery_raw = shell_text(serial, ["shell", "dumpsys", "battery"], timeout=20)
    storage_raw = shell_text(serial, ["shell", "df", "/data"], timeout=20)
    ip_route = shell_text(serial, ["shell", "ip", "route"], timeout=20)

    battery = parse_battery(battery_raw)
    storage = parse_storage(storage_raw)

    return {
        "ok": True,
        "serial": serial,
        "model": clean_text(model),
        "manufacturer": clean_text(manufacturer),
        "androidVersion": clean_text(android_version),
        "sdkVersion": clean_text(sdk_version),
        "securityPatch": clean_text(security_patch),
        "screenSize": clean_text(screen_size),
        "density": clean_text(density),
        "ipAddress": extract_ip(ip_route),
        "battery": battery,
        "storage": storage,
        "raw": {
            "battery": clean_text(battery_raw),
            "storage": clean_text(storage_raw),
        },
    }


def run_device_action(serial: str | None, action: str | None) -> dict:
    validation = validate_serial(serial)
    if validation is not None:
        return validation

    if not action:
        return {
            "ok": False,
            "error": "missing_action",
            "message": "Action არ არის არჩეული.",
        }

    if action == "launch_scrcpy":
        if shutil.which("scrcpy") is None:
            return {
                "ok": False,
                "error": "scrcpy_missing",
                "message": "scrcpy დაყენებული არ არის.",
            }

        try:
            subprocess.Popen(["scrcpy", "-s", serial], cwd=ROOT)
        except OSError as error:
            return {
                "ok": False,
                "error": "scrcpy_failed",
                "message": f"scrcpy ვერ გაეშვა: {error}",
            }

        return {
            "ok": True,
            "message": "scrcpy გაეშვა.",
            "action": action,
        }

    command_map = {
        "open_camera": ["shell", "am", "start", "-a", "android.media.action.IMAGE_CAPTURE"],
        "open_settings": ["shell", "am", "start", "-a", "android.settings.SETTINGS"],
        "open_wifi_settings": ["shell", "am", "start", "-a", "android.settings.WIFI_SETTINGS"],
        "wake_screen": ["shell", "input", "keyevent", "224"],
        "go_home": ["shell", "input", "keyevent", "3"],
        "open_recents": ["shell", "input", "keyevent", "187"],
        "volume_up": ["shell", "input", "keyevent", "24"],
        "volume_down": ["shell", "input", "keyevent", "25"],
        "reboot": ["reboot"],
    }

    command = command_map.get(action)
    if command is None:
        return {
            "ok": False,
            "error": "unknown_action",
            "message": f"უცნობი action: {action}",
        }

    result = adb_command(command, serial=serial, text=True, timeout=30)
    if result.returncode != 0:
        return {
            "ok": False,
            "error": "adb_action_failed",
            "message": clean_error(result.stderr) or "ADB ბრძანება შეცდომით დასრულდა.",
            "action": action,
        }

    return {
        "ok": True,
        "message": f"{ACTION_LABELS.get(action, action)} შესრულდა.",
        "action": action,
        "stdout": clean_text(result.stdout),
    }


def validate_serial(serial: str | None) -> dict | None:
    if not adb_available():
        return {
            "ok": False,
            "error": "adb_missing",
            "message": "ADB ვერ მოიძებნა. ჯერ Android Platform Tools დააყენე.",
        }

    if not serial:
        return {
            "ok": False,
            "error": "missing_serial",
            "message": "მოწყობილობა არჩეული არ არის.",
        }

    devices = {device["serial"]: device for device in list_devices()}
    if serial not in devices:
        return {
            "ok": False,
            "error": "device_not_found",
            "message": "ეს მოწყობილობა აღარ ჩანს ADB-ში.",
        }

    state = devices[serial].get("state")
    if state != "device":
        return {
            "ok": False,
            "error": "device_not_ready",
            "message": f"მოწყობილობა ჯერ მზად არ არის: {state}. შეამოწმე USB debugging და RSA prompt.",
        }

    return None


def adb_available() -> bool:
    return shutil.which("adb") is not None


def adb_command(
    args: list[str],
    *,
    serial: str | None = None,
    text: bool,
    timeout: int = 15,
) -> subprocess.CompletedProcess:
    command = ["adb"]
    if serial:
        command.extend(["-s", serial])
    command.extend(args)

    return subprocess.run(
        command,
        cwd=ROOT,
        capture_output=True,
        text=text,
        timeout=timeout,
        check=False,
    )


def shell_text(serial: str | None, args: list[str], timeout: int = 15) -> str:
    result = adb_command(args, serial=serial, text=True, timeout=timeout)
    if result.returncode != 0:
        return clean_error(result.stderr)
    return clean_text(result.stdout)


def list_devices() -> list[dict]:
    if not adb_available():
        return []

    result = adb_command(["devices", "-l"], serial=None, text=True, timeout=15)
    if result.returncode != 0:
        return []

    devices = []
    lines = result.stdout.splitlines()
    for raw_line in lines[1:]:
        line = raw_line.strip()
        if not line:
            continue

        parts = line.split()
        serial = parts[0]
        state = parts[1] if len(parts) > 1 else "unknown"
        details = {}
        for part in parts[2:]:
            if ":" not in part:
                continue
            key, value = part.split(":", 1)
            details[key] = value

        devices.append(
            {
                "serial": serial,
                "state": state,
                "model": details.get("model"),
                "device": details.get("device"),
                "transportId": details.get("transport_id"),
            }
        )

    return devices


def parse_battery(text: str) -> dict:
    level = extract_first_int(text, r"level:\s*(\d+)")
    temperature_raw = extract_first_int(text, r"temperature:\s*(\d+)")
    plugged = extract_first_int(text, r"plugged:\s*(\d+)")
    health = extract_first_int(text, r"health:\s*(\d+)")
    status = extract_first_int(text, r"status:\s*(\d+)")

    plugged_map = {
        0: "არა",
        1: "AC",
        2: "USB",
        4: "Wireless",
    }
    status_map = {
        1: "უცნობი",
        2: "იტენება",
        3: "სრულად დატენილია",
        4: "არ იტენება",
        5: "დამუხტვის შეცდომა",
    }
    health_map = {
        1: "უცნობი",
        2: "კარგი",
        3: "გადახურება",
        4: "მკვდარი",
        5: "over-voltage",
        6: "unspecified failure",
        7: "ცივი",
    }

    return {
        "level": level,
        "status": status_map.get(status, "უცნობი"),
        "health": health_map.get(health, "უცნობი"),
        "plugged": plugged_map.get(plugged, "უცნობი"),
        "temperatureC": round(temperature_raw / 10, 1) if temperature_raw is not None else None,
    }


def parse_storage(text: str) -> dict:
    lines = [line for line in text.splitlines() if line.strip()]
    if len(lines) < 2:
        return {
            "filesystem": None,
            "size": None,
            "used": None,
            "available": None,
            "usedPercent": None,
        }

    columns = lines[1].split()
    if len(columns) < 5:
        return {
            "filesystem": None,
            "size": None,
            "used": None,
            "available": None,
            "usedPercent": None,
        }

    return {
        "filesystem": columns[0],
        "size": columns[1],
        "used": columns[2],
        "available": columns[3],
        "usedPercent": columns[4],
    }


def extract_ip(text: str) -> str | None:
    match = re.search(r"\bsrc\s+(\d+\.\d+\.\d+\.\d+)", text)
    return match.group(1) if match else None


def extract_first_int(text: str, pattern: str) -> int | None:
    match = re.search(pattern, text)
    if not match:
        return None
    try:
        return int(match.group(1))
    except ValueError:
        return None


def clean_text(value: str | bytes | None) -> str:
    if value is None:
        return ""
    if isinstance(value, bytes):
        return value.decode("utf-8", errors="replace").replace("\r", "").strip()
    return value.replace("\r", "").strip()


def clean_error(value: str | bytes | None) -> str:
    text = clean_text(value)
    return text or ""


def guess_local_ip() -> str:
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
            sock.connect(("8.8.8.8", 80))
            return sock.getsockname()[0]
    except OSError:
        return "127.0.0.1"


def main() -> None:
    port = int(os.environ.get("PORT", "8000"))
    server = ThreadingHTTPServer(("0.0.0.0", port), AppHandler)
    local_ip = guess_local_ip()

    print(f"Phone Control server: http://localhost:{port}")
    print(f"Local network URL: http://{local_ip}:{port}")
    print("Desktop control page: /desktop.html")
    print("Note: Android control actions need ADB and USB debugging.")
    print("Press Ctrl+C to stop.")

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping server...")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
