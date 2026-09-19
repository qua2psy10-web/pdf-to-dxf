"""Start TRACE on localhost and open the browser; reuse an existing TRACE server."""
import os
import socket
import sys
import threading
import urllib.request
import webbrowser

port = int(os.environ.get("TRACE_PORT", "8765"))
url = f"http://127.0.0.1:{port}"
try:
    with urllib.request.urlopen(url + "/api/health", timeout=1) as response:
        existing = b'"trace-pdf-dxf"' in response.read()
except Exception:
    existing = False
if existing:
    webbrowser.open(url)
    print("TRACEは起動済みです。ブラウザを開きました。")
    sys.exit(0)
try:
    with socket.socket() as check:
        check.bind(("127.0.0.1", port))
except OSError:
    sys.exit(f"ポート{port}は使用中です。TRACE_PORT=8766 を指定して再起動してください。")

from app import app
print(f"TRACE: {url}\n終了するには、このターミナルで Control + C を押してください。", flush=True)
threading.Timer(1, lambda: webbrowser.open(url)).start()
app.run(host="127.0.0.1", port=port, threaded=False, debug=False)
