#!/usr/bin/env python3
# Единая точка запуска: мини‑сервер + открытие браузера. База в браузере, Node не нужен.
import http.server
import os
import socket
import socketserver
import webbrowser

PORT = int(os.environ.get("PORT", "8080"))
ROOT = os.path.dirname(os.path.abspath(__file__))

os.chdir(ROOT)


class Handler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args) -> None:
        pass  # тише


def _collect_lan_ipv4() -> list[str]:
    """IP адреса в локальной сети, порядок: типичный default route, затем остальные."""
    found: list[str] = []
    seen: set[str] = set()
    # Часто наиболее «правильный» IP для обхода в сторону интернета
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.settimeout(0.3)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        if not ip.startswith("127."):
            seen.add(ip)
            found.append(ip)
    except OSError:
        pass
    # Доп. интерфейсы (Wi‑Fi + Ethernet, VPN и т.д.)
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET, socket.SOCK_STREAM):
            ip = info[4][0]
            if ip.startswith("127."):
                continue
            if ip not in seen:
                seen.add(ip)
                found.append(ip)
    except OSError:
        pass
    return found


def _print_entry_lines(port: int) -> None:
    """Три готовых URL для копирования: localhost, 127.0.0.1, IP в ЛС."""
    lan = _collect_lan_ipv4()
    lan_ip = lan[0] if lan else None
    a = f"http://127.0.0.1:{port}/"
    b = f"http://localhost:{port}/"
    c = f"http://{lan_ip}:{port}/" if lan_ip else None

    line = "─" * 62
    print()
    print(line)
    print("  Адреса (скопируйте целиком):")
    print()
    print("  1) ", a, sep="")
    print("  2) ", b, sep="")
    if c:
        print(f"  3) {c}    ← для телефонов и других ПК в той же Wi‑Fi/сети")
    else:
        print(
            "  3)  (IP в локальной сети не определён — раздача Wi‑Fi, другой ПК, VPN?)",
        )
    if len(lan) > 1:
        print()
        print("  Дополнительные IP этого компьютера (тот же порт):")
        for ip in lan[1:]:
            print(f"      http://{ip}:{port}/")
    print()
    print(line)
    print()


if __name__ == "__main__":
    _print_entry_lines(PORT)
    try:
        httpd = socketserver.TCPServer(("", PORT), Handler)
    except OSError as e:
        print(f"Порт {PORT} занят или недоступен: {e}")
        print("Укажите другой, например: PORT=8090 python3 start.py")
        raise SystemExit(1) from e
    with httpd:
        open_url = f"http://127.0.0.1:{PORT}/"
        print("Остановка: Ctrl+C")
        try:
            webbrowser.open(open_url)
        except OSError:
            pass
        httpd.serve_forever()
