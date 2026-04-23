#!/usr/bin/env python3
# Единая точка запуска: мини‑сервер + открытие браузера. База в браузере, Node не нужен.
# Сборка .exe: см. attestation.spec и build_windows.cmd (PyInstaller).
import http.server
import ipaddress
import os
import re
import socket
import socketserver
import subprocess
import sys
import webbrowser
from pathlib import Path

PORT = int(os.environ.get("PORT", "8080"))


def _application_dir() -> Path:
    if getattr(sys, "frozen", False):
        return Path(getattr(sys, "_MEIPASS", Path(sys.executable).resolve().parent))
    return Path(__file__).resolve().parent


ROOT = str(_application_dir())
os.chdir(ROOT)


class Handler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args) -> None:
        pass  # тише


def _is_private_unicast(ip: str) -> bool:
    try:
        a = ipaddress.IPv4Address(ip)
    except ValueError:
        return False
    if a.is_multicast or a.is_reserved or a.is_unspecified or a.is_loopback:
        return False
    return a.is_private


def _from_ifconfig_text(text: str) -> list[str]:
    out: list[str] = []
    for m in re.finditer(
        r"\b(?:inet|inet addr)\s+(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})",
        text,
    ):
        s = m.group(1)
        if _is_private_unicast(s):
            out.append(s)
    return out


def _collect_lan_ipv4() -> list[str]:
    """Только настоящие адреса ЛС; в консоли не используем 127.0.0.1."""
    found: list[str] = []
    seen: set[str] = set()

    def add(ip: str) -> None:
        if ip in seen or not _is_private_unicast(ip):
            return
        seen.add(ip)
        found.append(ip)

    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.settimeout(0.3)
        s.connect(("8.8.8.8", 80))
        add(s.getsockname()[0])
        s.close()
    except OSError:
        pass

    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET, socket.SOCK_STREAM):
            add(info[4][0])
    except OSError:
        pass

    if sys.platform == "darwin":
        for iface in ("en0", "en1"):
            try:
                r = subprocess.run(
                    ["/usr/sbin/ipconfig", "getifaddr", iface],
                    capture_output=True,
                    text=True,
                    timeout=2,
                )
                t = (r.stdout or "").strip()
                if t:
                    add(t)
            except (OSError, subprocess.TimeoutExpired):
                pass

    for cmd in (["/sbin/ifconfig"], ["ifconfig"]):
        try:
            r = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=2,
            )
            for ip in _from_ifconfig_text((r.stdout or "") + (r.stderr or "")):
                add(ip)
        except (OSError, subprocess.TimeoutExpired, FileNotFoundError):
            pass

    if sys.platform == "win32":
        _kw: dict = {}
        if hasattr(subprocess, "CREATE_NO_WINDOW"):
            _kw["creationflags"] = subprocess.CREATE_NO_WINDOW
        try:
            r = subprocess.run(
                ["ipconfig"],
                capture_output=True,
                text=True,
                timeout=6,
                **_kw,
            )
            for ip in _from_windows_ipconfig((r.stdout or "") + (r.stderr or "")):
                add(ip)
        except (OSError, subprocess.TimeoutExpired, FileNotFoundError):
            pass

    return _sort_lan_by_preference(found)


def _is_windows_ipconfig_skip_line(line: str) -> bool:
    """
    Строка ipconfig не про IP этого ПК: шлюз, DNS, DHCP-сервер (часто 192.168.0.1 = роутер).
    """
    s = line.casefold()
    for needle in (
        "default gateway",
        "dns servers",
        "список dns",
        "dhcp server",
        "wins",
    ):
        if needle in s:
            return True
    for needle in (
        "dns-сервер",
        "сервер dhcp",
    ):
        if needle in s:
            return True
    # RU: «Основной шлюз» — без "IPv4" в этой же строке
    if "шлюз" in s and "ipv4" not in s and "ip-" not in s:
        return True
    if "основн" in s and "шлюз" in s and "ipv4" not in s:
        return True
    if "сервер" in s and "dns" in s and "шлюз" not in s:
        return True
    return False


def _is_windows_ipconfig_ipv4_address_line(line: str) -> bool:
    """
    Похоже на штатную строку с IPv4-адресом интерфейса, а не на маску/шлюз.
    en + ru, частые варианты Windows 10/11.
    """
    t = line
    if re.search(
        r"(?i)IPv4[\s.·-]*[Aa]ddress|IPv4-адрес|Адрес[\s.·]*IPv4|IP-адреса?\s*IPv4",
        t,
    ):
        return True
    if re.search(r"(?i)IPv4[\s.·-]*адрес", t):
        return True
    return False


def _from_windows_ipconfig(text: str) -> list[str]:
    """
    Только IP этого компьютера. Раньше из всего вывода цеплялся, например, 192.168.0.1 с
    «Default Gateway».
    """
    out: list[str] = []

    def extract_from_line(line: str, bucket: list[str]) -> None:
        for m in re.finditer(
            r"(?<![\d.])(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})(?![\d.])",
            line,
        ):
            s = m.group(1)
            if _is_private_unicast(s) and s not in bucket:
                bucket.append(s)

    for line in text.splitlines():
        if _is_windows_ipconfig_skip_line(line):
            continue
        if not _is_windows_ipconfig_ipv4_address_line(line):
            continue
        extract_from_line(line, out)
    if out:
        return out
    for line in text.splitlines():
        if _is_windows_ipconfig_skip_line(line):
            continue
        # запас: без «IPv4» в подписи, но после фильтра шлюза/DNS
        extract_from_line(line, out)
    return out


def _sort_lan_by_preference(ips: list[str]) -> list[str]:
    """Сначала 192.168.x.x, затем 10.x, затем 172.16–31.x."""
    u = list(dict.fromkeys(ips))

    def key(ip: str) -> tuple:
        if ip.startswith("192.168."):
            return (0, ip)
        if ip.startswith("10."):
            return (1, ip)
        if re.match(r"^172\.(1[6-9]|2\d|3[01])\.", ip):
            return (2, ip)
        return (3, ip)

    return sorted(u, key=key)


def _role_urls(base: str) -> tuple[str, str]:
    b = base.rstrip("/")
    return (
        f"{b}/#/admin",
        f"{b}/",
    )


def _print_lan_for_others(port: int, private: list[str]) -> None:
    line = "─" * 64
    print()
    print(line)
    print("  Адреса для входа в систему:")
    print()
    if not private:
        print("  (Не удалось определить IP — включите Wi‑Fi / Ethernet,")
        print("   перезапустите. До этого браузер откроется на этом ПК с запасной ссылкой.)")
        print()
        print(line)
        print()
        return

    for idx, ip in enumerate(private):
        base = f"http://{ip}:{port}"
        a_admin, a_teacher = _role_urls(base)
        if len(private) > 1:
            print(f"  {'─' * 6}  {ip}  {'─' * 40}")
        else:
            print(f"  IP (локальная сеть):  {ip}")
        print()
        print("  Админ (завуч, сводка, импорт XML):")
        print("   ", a_admin)
        print()
        print("  Предметники (ввод по предмету, ввод классного журнала):")
        print("   ", a_teacher)
        if idx < len(private) - 1:
            print()
    print()
    print(line)
    print()


if __name__ == "__main__":
    lan = _collect_lan_ipv4()
    _print_lan_for_others(PORT, lan)
    first_lan = lan[0] if lan else None
    try:
        httpd = socketserver.TCPServer(("", PORT), Handler)
    except OSError as e:
        print(f"Порт {PORT} занят или недоступен: {e}")
        if sys.platform == "win32":
            print("Укажите другой:  set PORT=8090  и снова запустите SchoolAttestation.exe")
        else:
            print("Укажите другой:  PORT=8090 python3 start.py")
        raise SystemExit(1) from e
    with httpd:
        open_url = (
            f"http://{first_lan}:{PORT}/#/teacher"
            if first_lan
            else f"http://127.0.0.1:{PORT}/#/teacher"
        )
        print("Остановка: Ctrl+C")
        try:
            webbrowser.open(open_url)
        except OSError:
            pass
        httpd.serve_forever()
