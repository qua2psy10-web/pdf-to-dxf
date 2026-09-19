from __future__ import annotations

from collections import OrderedDict
from dataclasses import dataclass
import io
import json
import os
from pathlib import Path
import secrets
import time
from urllib.parse import urlparse
import zipfile

from flask import Flask, jsonify, request, send_file
from werkzeug.exceptions import HTTPException
import pymupdf as fitz

from converter import ConversionError, Options, open_pdf, page_info, convert_page, dxf_bytes, preview_svg
from sample import make_sample

ROOT = Path(__file__).resolve().parent
app = Flask(__name__, static_folder=str(ROOT / "static"), static_url_path="/static")
app.config["MAX_CONTENT_LENGTH"] = 50 * 1024 * 1024
app.config["TRUSTED_HOSTS"] = ["localhost", "127.0.0.1"]


@dataclass
class StoredPDF:
    data: bytes
    filename: str
    created: float


FILES: OrderedDict[str, StoredPDF] = OrderedDict()
TTL = 3600
MAX_STORED_BYTES = 200 * 1024 * 1024


def prune():
    for key in list(FILES):
        if time.monotonic() - FILES[key].created > TTL:
            del FILES[key]


def store(data, filename):
    prune()
    while FILES and (len(FILES) >= 8 or sum(len(f.data) for f in FILES.values()) + len(data) > MAX_STORED_BYTES):
        FILES.popitem(last=False)
    key = secrets.token_urlsafe(24)
    FILES[key] = StoredPDF(data, filename, time.monotonic())
    return key


@app.before_request
def local_only():
    if request.method in ("POST", "DELETE"):
        origin = request.headers.get("Origin")
        if request.headers.get("X-Trace-Client") != "1" or (origin and urlparse(origin).netloc != request.host):
            return jsonify(error="このアプリの画面から操作してください。"), 403


@app.after_request
def headers(response):
    response.headers["Cache-Control"] = "no-store"
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["Content-Security-Policy"] = "default-src 'self'; img-src 'self' blob:; style-src 'self'; script-src 'self'; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'"
    return response


@app.errorhandler(ConversionError)
def conversion_error(error):
    return jsonify(error=str(error)), 400


@app.errorhandler(413)
def too_large(error):
    return jsonify(error="ファイルが大きすぎます。50MB以下のPDFを選択してください。"), 413


@app.errorhandler(Exception)
def unexpected(error):
    if isinstance(error, HTTPException):
        return jsonify(error=error.description), error.code
    app.logger.exception("PDF conversion failed")
    return jsonify(error="処理に失敗しました。別のPDFで試すか、ターミナルのエラーを確認してください。"), 500


@app.get("/")
def index():
    return app.send_static_file("index.html")


@app.get("/api/health")
def health():
    return jsonify(app="trace-pdf-dxf", version="1.0.0")


@app.post("/api/upload")
def upload():
    upload = request.files.get("file")
    if not upload or not upload.filename:
        raise ConversionError("PDFファイルを選択してください。")
    filename = Path(upload.filename.replace("\\", "/")).name
    return register(upload.read(), filename)


@app.post("/api/sample")
def sample():
    return register(make_sample(), "サンプル図面.pdf")


def register(data, filename):
    with open_pdf(data) as source:
        count = len(source)
        first = page_info(source[0])
    key = store(data, filename)
    return jsonify(id=key, name=filename, pages=count, first=first)


def stored(key):
    prune()
    file = FILES.get(key)
    if file is None:
        raise ConversionError("PDFの保持期限が切れました。もう一度ファイルを選択してください。")
    return file


def page_number(source):
    try:
        number = int(request.args.get("page", "1"))
    except ValueError:
        raise ConversionError("ページ番号が正しくありません。")
    if not 1 <= number <= len(source):
        raise ConversionError("指定したページは存在しません。")
    return number - 1


def options():
    try:
        value = float(request.args.get("scale", "100"))
    except ValueError:
        raise ConversionError("縮尺は数値で指定してください。")
    value = Options(value, request.args.get("text", "1") == "1", request.args.get("colors", "1") == "1")
    value.validate()
    return value


@app.get("/api/files/<key>/page")
def info(key):
    with open_pdf(stored(key).data) as source:
        return jsonify(page_info(source[page_number(source)]))


@app.get("/api/files/<key>/preview")
def preview(key):
    with open_pdf(stored(key).data) as source:
        page = source[page_number(source)]
        if request.args.get("mode") == "dxf":
            doc, report = convert_page(page, options())
            data = preview_svg(doc, report["width_mm"], report["height_mm"])
            return send_file(io.BytesIO(data), mimetype="image/svg+xml")
        zoom = min(2, 1800 / max(page.rect.width, page.rect.height))
        data = page.get_pixmap(matrix=fitz.Matrix(zoom, zoom), alpha=False).tobytes("png")
        return send_file(io.BytesIO(data), mimetype="image/png")


@app.get("/api/files/<key>/report")
def report(key):
    with open_pdf(stored(key).data) as source:
        _, result = convert_page(source[page_number(source)], options())
        return jsonify(result)


@app.get("/api/files/<key>/export")
def export(key):
    file = stored(key)
    opt = options()
    stem = Path(file.filename).stem or "drawing"
    with open_pdf(file.data) as source:
        if request.args.get("all") != "1":
            number = page_number(source)
            doc, result = convert_page(source[number], opt)
            return send_file(io.BytesIO(dxf_bytes(doc)), as_attachment=True,
                             download_name=f"{stem}_p{number + 1}.dxf", mimetype="application/dxf")
        buffer = io.BytesIO()
        reports = []
        successes = 0
        with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            for number in range(len(source)):
                try:
                    doc, result = convert_page(source[number], opt)
                    archive.writestr(f"{stem}_p{number + 1}.dxf", dxf_bytes(doc))
                    reports.append(result)
                    successes += 1
                except ConversionError as error:
                    reports.append({"page": number + 1, "error": str(error)})
            archive.writestr("変換結果.json", json.dumps(reports, ensure_ascii=False, indent=2))
        if not successes:
            raise ConversionError("全ページで変換できる要素が見つかりません。スキャン画像は自動トレースできません。")
        buffer.seek(0)
        response = send_file(buffer, as_attachment=True, download_name=f"{stem}_DXF.zip", mimetype="application/zip")
        response.headers["X-Trace-Exported"] = str(successes)
        response.headers["X-Trace-Skipped"] = str(len(source) - successes)
        return response


if __name__ == "__main__":
    # PyMuPDF does not support multithreaded use: run requests serially.
    app.run(host="127.0.0.1", port=int(os.environ.get("TRACE_PORT", "8765")), threaded=False, debug=False)
