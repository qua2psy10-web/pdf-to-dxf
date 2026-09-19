import io
import json
import time
import zipfile

import ezdxf
import pymupdf as fitz
import pytest

from app import app, FILES, TTL
from sample import make_sample


@pytest.fixture
def client():
    FILES.clear()
    app.config["TESTING"] = True
    with app.test_client() as client:
        yield client
    FILES.clear()


def upload(client, data=None):
    response = client.post("/api/upload", data={"file": (io.BytesIO(data or make_sample()), "図面.pdf")}, headers={"X-Trace-Client": "1"})
    assert response.status_code == 200
    return response.json["id"]


def test_upload_preview_and_export_zip(client):
    key = upload(client)
    assert client.get(f"/api/files/{key}/page?page=2").json["number"] == 2
    image = client.get(f"/api/files/{key}/preview?page=1")
    assert image.status_code == 200 and image.data.startswith(b"\x89PNG")
    image = client.get(f"/api/files/{key}/preview?page=2&mode=dxf")
    assert image.status_code == 200 and b"<svg" in image.data
    response = client.get(f"/api/files/{key}/export?page=2&scale=100")
    doc = ezdxf.read(io.StringIO(response.data.decode()))
    assert not doc.audit().has_errors
    assert "attachment" in response.headers["Content-Disposition"]
    response = client.get(f"/api/files/{key}/export?all=1")
    with zipfile.ZipFile(io.BytesIO(response.data)) as archive:
        assert len(archive.namelist()) == 3
        report = json.loads(archive.read("変換結果.json"))
        assert [r["page"] for r in report] == [1, 2]
        for filename in archive.namelist():
            if filename.endswith(".dxf"):
                assert not ezdxf.read(io.StringIO(archive.read(filename).decode())).audit().has_errors


def test_invalid_inputs_and_local_origin(client):
    assert client.post("/api/sample").status_code == 403
    assert client.post("/api/sample", headers={"X-Trace-Client": "1", "Origin": "https://example.com"}).status_code == 403
    assert client.get("/", headers={"Host": "malicious.example"}).status_code == 400
    key = upload(client)
    for query in ["page=0", "page=3", "page=invalid", "scale=nan", "scale=-1", "scale=no"]:
        response = client.get(f"/api/files/{key}/export?{query}")
        assert response.status_code == 400 and response.json["error"]
    FILES[key].created = time.monotonic() - TTL - 1
    assert client.get(f"/api/files/{key}/page").status_code == 400


def test_all_pages_skip_empty_with_report(client):
    source = fitz.open(stream=make_sample(), filetype="pdf")
    source.new_page()
    key = upload(client, source.tobytes())
    response = client.get(f"/api/files/{key}/export?all=1")
    assert response.headers["X-Trace-Skipped"] == "1"
    with zipfile.ZipFile(io.BytesIO(response.data)) as archive:
        report = json.loads(archive.read("変換結果.json"))
        assert "error" in report[2]
        assert len([name for name in archive.namelist() if name.endswith(".dxf")]) == 2


def test_empty_document_never_returns_blank_dxf(client):
    source = fitz.open()
    source.new_page()
    key = upload(client, source.tobytes())
    assert client.get(f"/api/files/{key}/export").status_code == 400
    assert client.get(f"/api/files/{key}/export?all=1").status_code == 400
