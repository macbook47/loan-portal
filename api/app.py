"""
loan-api: backend for the Loan Portal demo (dummy data, no database).

Endpoints
  GET  /health                 200 when ready, 503 while warming up or draining
  GET  /api/info               which pod answered, version, uptime
  GET  /api/products           loan products with interest rates
  POST /api/simulate           monthly installment for amount/tenor/product
  GET  /api/applications       applications submitted to THIS pod (in memory)
  POST /api/applications       submit an application

Env vars
  PORT               listen port (default 9000)
  STARTUP_DELAY_SEC  simulated warm-up before /health turns 200 (default 5)
  LATENCY_MS         extra delay on /api calls (default 0)
  ERROR_RATE         fraction of /api calls answering 500 (default 0)
"""
import json
import os
import random
import signal
import socket
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

POD = os.environ.get("HOSTNAME", socket.gethostname())
STARTED = time.time()
VERSION = "v1"

PRODUCTS = [
    {"code": "KUR", "name": "Kredit Usaha Mikro", "annual_rate_pct": 6.0, "max_tenor_months": 36},
    {"code": "KPR", "name": "Home Loan", "annual_rate_pct": 8.5, "max_tenor_months": 240},
    {"code": "KTA", "name": "Personal Loan", "annual_rate_pct": 12.0, "max_tenor_months": 60},
]

state = {"ready": False, "seq": 0}
applications = []
lock = threading.Lock()


def installment(amount, annual_rate_pct, months):
    """Standard annuity: equal monthly payments."""
    r = annual_rate_pct / 100 / 12
    if r == 0:
        return amount / months
    return amount * r / (1 - (1 + r) ** -months)


def warm_up():
    delay = float(os.environ.get("STARTUP_DELAY_SEC", "5") or 0)
    print(f"warming up for {delay}s", flush=True)
    time.sleep(delay)
    state["ready"] = True
    print("ready", flush=True)


class Handler(BaseHTTPRequestHandler):
    server_version = "loan-api/" + VERSION

    def log_message(self, fmt, *args):
        print(f"{self.command} {self.path} {args[1] if len(args) > 1 else ''}", flush=True)

    def reply(self, code, body):
        data = json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("X-Served-By", POD)
        self.end_headers()
        self.wfile.write(data)

    def body(self):
        n = int(self.headers.get("Content-Length", 0) or 0)
        try:
            return json.loads(self.rfile.read(n) or b"{}")
        except ValueError:
            return {}

    def injected_failure(self):
        ms = int(os.environ.get("LATENCY_MS", "0") or 0)
        if ms > 0:
            time.sleep(ms / 1000)
        rate = float(os.environ.get("ERROR_RATE", "0") or 0)
        if rate > 0 and random.random() < rate:
            self.reply(500, {"error": "injected failure (ERROR_RATE)", "pod": POD})
            return True
        return False

    def do_GET(self):
        if self.path == "/health":
            ok = state["ready"]
            return self.reply(200 if ok else 503, {"status": "UP" if ok else "NOT_READY"})
        if not self.path.startswith("/api/"):
            return self.reply(404, {"error": "not found"})
        if self.injected_failure():
            return None
        if self.path == "/api/info":
            return self.reply(200, {"service": "loan-api", "pod": POD, "version": VERSION,
                                    "uptime_sec": int(time.time() - STARTED)})
        if self.path == "/api/products":
            return self.reply(200, {"items": PRODUCTS, "pod": POD})
        if self.path == "/api/applications":
            with lock:
                items = list(reversed(applications[-20:]))
            return self.reply(200, {"items": items, "pod": POD})
        return self.reply(404, {"error": "not found"})

    def do_POST(self):
        if self.path not in ("/api/simulate", "/api/applications"):
            return self.reply(404, {"error": "not found"})
        if self.injected_failure():
            return None
        req = self.body()
        product = next((p for p in PRODUCTS if p["code"] == req.get("product")), None)
        try:
            amount = int(req.get("amount", 0))
            months = int(req.get("tenor_months", 0))
        except (TypeError, ValueError):
            amount = months = 0
        if not product or amount <= 0 or not 1 <= months <= product["max_tenor_months"]:
            return self.reply(400, {"error": "need product (KUR/KPR/KTA), amount > 0 and a valid tenor_months"})
        monthly = round(installment(amount, product["annual_rate_pct"], months))
        result = {"product": product["code"], "amount": amount, "tenor_months": months,
                  "annual_rate_pct": product["annual_rate_pct"], "monthly_installment": monthly,
                  "total_payment": monthly * months, "pod": POD}
        if self.path == "/api/simulate":
            return self.reply(200, result)
        name = str(req.get("applicant", "")).strip()[:60]
        if not name:
            return self.reply(400, {"error": "applicant name is required"})
        with lock:
            state["seq"] += 1
            app_id = f"APP-{POD[-5:]}-{state['seq']:05d}"
            record = {**result, "id": app_id, "applicant": name, "status": "SUBMITTED",
                      "submitted_at": time.strftime("%Y-%m-%dT%H:%M:%S")}
            applications.append(record)
        return self.reply(201, record)


def main():
    port = int(os.environ.get("PORT", "9000"))
    server = ThreadingHTTPServer(("0.0.0.0", port), Handler)
    server.daemon_threads = True

    def on_sigterm(signum, frame):
        print("SIGTERM: not ready, draining 5s", flush=True)
        state["ready"] = False
        threading.Thread(target=lambda: (time.sleep(5), server.shutdown()), daemon=True).start()

    signal.signal(signal.SIGTERM, on_sigterm)
    threading.Thread(target=warm_up, daemon=True).start()
    print(f"loan-api on :{port} pod={POD}", flush=True)
    server.serve_forever()
    print("stopped cleanly", flush=True)


if __name__ == "__main__":
    main()
