import io
import math
import xml.etree.ElementTree as ET

import ezdxf
import pymupdf as fitz
import pytest

from converter import Options, ConversionError, PT_TO_MM, convert_page, dxf_bytes, open_pdf, page_info, preview_svg
from sample import make_sample


def roundtrip(doc):
    restored = ezdxf.read(io.StringIO(dxf_bytes(doc).decode("utf-8")))
    assert not restored.audit().has_errors
    return restored


@pytest.mark.parametrize("rotation,expected_start,expected_end", [
    (0, (20, 270), (92, 270)),
    (90, (270, 180), (270, 108)),
    (180, (180, 30), (108, 30)),
    (270, (30, 20), (30, 92)),
])
def test_coordinates_rotation_units(rotation, expected_start, expected_end):
    source = fitz.open()
    page = source.new_page(width=200, height=300)
    page.draw_line((20, 30), (92, 30), color=(1, 0, 0))
    page.set_rotation(rotation)
    doc, report = convert_page(page, Options(scale=100))
    restored = roundtrip(doc)
    line = restored.modelspace().query("LINE")[0]
    assert tuple(line.dxf.start)[:2] == pytest.approx([v * PT_TO_MM * 100 for v in expected_start])
    assert tuple(line.dxf.end)[:2] == pytest.approx([v * PT_TO_MM * 100 for v in expected_end])
    assert (line.dxf.end - line.dxf.start).magnitude == pytest.approx(2540)
    assert restored.units == 4
    assert restored.dxfversion == "AC1024"
    assert line.dxf.true_color == 0xFF0000
    source.close()


def test_cropbox_origin():
    source = fitz.open()
    page = source.new_page(width=400, height=400)
    page.draw_line((100, 100), (200, 100))
    page.set_cropbox(fitz.Rect(50, 50, 350, 350))
    doc, _ = convert_page(page, Options(scale=1))
    line = doc.modelspace().query("LINE")[0]
    assert tuple(line.dxf.start)[:2] == pytest.approx((50 * PT_TO_MM, 250 * PT_TO_MM))


def test_cubic_curve_exact_geometry():
    source = fitz.open()
    page = source.new_page(width=300, height=300)
    points = [(20, 150), (50, 15), (200, 250), (270, 130)]
    page.draw_bezier(*points)
    doc, _ = convert_page(page, Options(scale=1))
    spline = roundtrip(doc).modelspace().query("SPLINE")[0]
    for t in (0, .125, .5, .9, 1):
        actual = spline.construction_tool().point(t)
        x = sum(math.comb(3, i) * (1-t)**(3-i) * t**i * p[0] for i, p in enumerate(points))
        y = sum(math.comb(3, i) * (1-t)**(3-i) * t**i * p[1] for i, p in enumerate(points))
        assert tuple(actual)[:2] == pytest.approx((x * PT_TO_MM, (300-y) * PT_TO_MM))


def test_text_japanese_and_rotation_and_options():
    source = fitz.open()
    page = source.new_page(width=300, height=300)
    page.draw_rect((20, 20, 100, 100), color=(0, 1, 0))
    page.insert_text((150, 200), "日本語図面", fontname="japan", fontsize=12, rotate=90)
    doc, _ = convert_page(page, Options(scale=50))
    text = roundtrip(doc).modelspace().query("TEXT")[0]
    assert text.dxf.text == "日本語図面"
    # FIT alignment uses two baseline points to encode the text direction.
    delta = text.dxf.align_point - text.dxf.insert
    assert delta.x == pytest.approx(0)
    assert delta.y > 0
    doc, _ = convert_page(page, Options(scale=50, text=False, colors=False))
    assert not doc.modelspace().query("TEXT")
    assert all(not e.dxf.hasattr("true_color") for e in doc.modelspace())
    assert doc.modelspace().query("LWPOLYLINE")[0].closed


def test_sample_calibration_and_svg():
    with open_pdf(make_sample()) as source:
        doc, report = convert_page(source[1], Options(scale=100))
        restored = roundtrip(doc)
        calibration = restored.modelspace().query("LINE")[0]
        assert (calibration.dxf.end - calibration.dxf.start).magnitude == pytest.approx(9000, abs=.02)
        assert report["counts"]["SPLINE"] == 4
        assert any(e.dxf.get("linetype", "CONTINUOUS") != "CONTINUOUS" for e in restored.modelspace())
        svg = preview_svg(restored, report["width_mm"], report["height_mm"])
        ET.fromstring(svg)
        assert "日本語" in svg.decode()


def test_scan_rejected_and_mixed_warned():
    source = fitz.open()
    page = source.new_page(width=200, height=200)
    pix = fitz.Pixmap(fitz.csRGB, fitz.IRect(0, 0, 10, 10), 0)
    pix.clear_with(255)
    page.insert_image((0, 0, 200, 200), pixmap=pix)
    assert page_info(page)["kind"] == "image"
    with pytest.raises(ConversionError, match="スキャン"):
        convert_page(page, Options())
    page.draw_line((20, 20), (80, 80))
    _, report = convert_page(page, Options())
    assert any("画像は出力しません" in w for w in report["warnings"])


@pytest.mark.parametrize("scale", [0, -1, float("nan"), float("inf"), 100001])
def test_bad_scale(scale):
    with pytest.raises(ConversionError):
        Options(scale=scale).validate()


def test_invalid_and_encrypted_pdf():
    with pytest.raises(ConversionError):
        open_pdf(b"not a PDF")
    source = fitz.open()
    source.new_page()
    data = source.tobytes(encryption=fitz.PDF_ENCRYPT_AES_256, owner_pw="owner", user_pw="secret")
    with pytest.raises(ConversionError, match="パスワード"):
        open_pdf(data)


def test_closed_path_and_clipping_warning():
    source = fitz.open()
    page = source.new_page(width=300, height=300)
    shape = page.new_shape()
    shape.draw_line((10, 10), (90, 10))
    shape.draw_line((90, 10), (80, 80))
    shape.finish(closePath=True)
    shape.commit()
    doc, _ = convert_page(page, Options())
    assert len(doc.modelspace().query("LINE")) == 3
    # Introduce a real clipping operator, not an API mock.
    xref = page.get_contents()[0]
    original = source.xref_stream(xref)
    source.update_stream(xref, b"q 0 0 50 50 re W n\n" + original + b"\nQ")
    _, report = convert_page(page, Options())
    assert any("クリッピング" in w for w in report["warnings"])


def test_fill_implicitly_closes_each_disconnected_subpath():
    source = fitz.open()
    page = source.new_page()
    shape = page.new_shape()
    shape.draw_polyline([(10, 10), (50, 10), (50, 50)])
    shape.draw_polyline([(100, 100), (140, 100), (140, 140)])
    shape.finish(fill=(.2, .2, .2), color=None, closePath=False)
    shape.commit()
    doc, report = convert_page(page, Options())
    assert len(doc.modelspace().query("LINE")) == 6
    assert all(e.dxf.layer == "PDF_FILL_OUTLINES" for e in doc.modelspace())
    assert any("塗りつぶし" in w for w in report["warnings"])
