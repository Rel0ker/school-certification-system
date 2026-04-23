#!/usr/bin/env python3
# Единая точка запуска: мини‑сервер + открытие браузера. База в браузере, Node не нужен.
import http.server
import ipaddress
import os
import re
import socket
import socketserver
import subprocess
import sys
import webbrowser

PORT = int(os.environ.get("PORT", "8080"))
ROOT = os.path.dirname(os.path.abspath(__file__))

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

    return _sort_lan_by_preference(found)


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


def _role_urls(base: str) -> tuple[str, str, str]:
    b = base.rstrip("/")
    return (
        f"{b}/#/admin",
        f"{b}/#/teacher",
        f"{b}/#/journal",
    )


def _print_lan_for_others(port: int, private: list[str]) -> None:
    line = "─" * 64
    print()
    print(line)
    print("  Скопируйте и разошлите (IP локальной сети, не 127.0.0.1):")
    print()
    if not private:
        print("  (Не удалось определить IP вроде 192.168.x.x — включите Wi‑Fi / Ethernet,")
        print("   перезапустите. До этого браузер откроется на этом ПК с запасной ссылкой.)")
        print()
        print(line)
        print()
        return

    for idx, ip in enumerate(private):
        base = f"http://{ip}:{port}"
        a_admin, a_teacher, a_journal = _role_urls(base)
        if len(private) > 1:
            print(f"  {'─' * 6}  {ip}  {'─' * 40}")
        else:
            print(f"  IP (локальная сеть):  {ip}")
        print()
        print("  Админ (завуч, сводка, импорт XML):")
        print("   ", a_admin)
        print()
        print("  Предметники (ввод по предмету):")
        print("   ", a_teacher)
        print()
        print("  Классы (журнал класса):")
        print("   ", a_journal)
        if idx < len(private) - 1:
            print()
    if private and not any(p.startswith("192.168.") for p in private):
        print()
        print("  (Обычно дома 192.168.x.x; у вас другая частная сеть — ссылки выше корректны.)")
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
        print("Укажите другой, например: PORT=8090 python3 start.py")
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
