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


def _role_urls(base: str) -> tuple[str, str, str]:
    b = base.rstrip("/")
    return (
        f"{b}/#/admin",
        f"{b}/#/teacher",
        f"{b}/#/journal",
    )


def _print_lan_for_others(port: int) -> None:
    """Ссылки для учителей/завуча: только адреса в ЛС с нужным hash (не localhost)."""
    lan = _collect_lan_ipv4()
    line = "─" * 64
    print()
    print(line)
    print("  Ссылки для других устройств в вашей сети (копируйте и отправляйте):")
    print()
    if not lan:
        print("  (IP в локальной сети не найден: проверьте Wi‑Fi / VPN. Без IP коллеги")
        print("   с другого ПК не подключатся — раздайте сеть с этого компьютера или")
        print("   укажите IP вручную, подставляя пути /#/admin, /#/teacher, /#/journal)")
        print()
        print(line)
        print()
        return

    for idx, ip in enumerate(lan):
        base = f"http://{ip}:{port}"
        a_admin, a_teacher, a_journal = _role_urls(base)
        if len(lan) > 1:
            print(f"  {'─' * 6}  {ip}  {'─' * 40}")
        else:
            print(f"  IP в вашей сети:  {ip}")
        print()
        print("  Админ (завуч, сводка, импорт XML):")
        print("   ", a_admin)
        print()
        print("  Предметники (ввод по предмету):")
        print("   ", a_teacher)
        print()
        print("  Классы (журнал класса):")
        print("   ", a_journal)
        if idx < len(lan) - 1:
            print()
    print()
    print(line)
    print()


def _print_local_only(port: int) -> None:
    a, t, j = _role_urls(f"http://127.0.0.1:{port}")
    print("  С этого компьютера (тест, не открывайте на телефоне по этим):")
    print("   ", a)
    print("   ", t)
    print("   ", j)
    print("   то же с localhost:  http://localhost:{port}/#/…".format(port=port))
    print()


if __name__ == "__main__":
    _print_lan_for_others(PORT)
    _print_local_only(PORT)
    try:
        httpd = socketserver.TCPServer(("", PORT), Handler)
    except OSError as e:
        print(f"Порт {PORT} занят или недоступен: {e}")
        print("Укажите другой, например: PORT=8090 python3 start.py")
        raise SystemExit(1) from e
    with httpd:
        open_url = f"http://127.0.0.1:{PORT}/#/teacher"
        print("Остановка: Ctrl+C")
        try:
            webbrowser.open(open_url)
        except OSError:
            pass
        httpd.serve_forever()
