from pathlib import Path
import shutil
import subprocess

import ezdxf
import pymupdf as fitz
import pytest

ROOT = Path(__file__).resolve().parents[1]
pytestmark = pytest.mark.skipif(not shutil.which('node') or not (ROOT/'node_modules').exists(), reason='npm ci is required for browser integration tests')


def test_browser_dxf_roundtrip_rotation_crop_and_curve(tmp_path):
    source = fitz.open()
    for rotation in (0, 90, 180, 270):
        page = source.new_page(width=200, height=300)
        page.draw_line((20, 30), (92, 30), color=(1, 0, 0))
        page.set_rotation(rotation)
    page = source.new_page(width=400, height=400)
    page.draw_line((100, 100), (200, 100))
    page.set_cropbox(fitz.Rect(50, 50, 350, 350))
    page = source.new_page(width=300, height=300)
    page.draw_bezier((20, 150), (50, 15), (200, 250), (270, 130))
    page.insert_text((20, 280), '日本語', fontname='japan')
    filename = tmp_path/'geometry.pdf'
    source.save(filename)
    subprocess.run(['node', str(ROOT/'tests/web/export-pdf.mjs'), str(filename), str(tmp_path)], check=True, cwd=ROOT)
    expected = [((20,270),(92,270)), ((270,180),(270,108)), ((180,30),(108,30)), ((30,20),(30,92)), ((50,250),(150,250))]
    factor = 25.4/72*100
    for i, (start,end) in enumerate(expected, 1):
        doc = ezdxf.readfile(tmp_path/f'p{i}.dxf')
        audit = doc.audit()
        assert not audit.errors and not audit.fixes
        assert doc.units == 4 and doc.dxfversion == 'AC1024'
        line = doc.modelspace().query('LINE')[0]
        assert tuple(line.dxf.start)[:2] == pytest.approx([n*factor for n in start], abs=.01)
        assert tuple(line.dxf.end)[:2] == pytest.approx([n*factor for n in end], abs=.01)
    doc = ezdxf.readfile(tmp_path/'p6.dxf')
    assert not doc.audit().errors
    spline = doc.modelspace().query('SPLINE')[0]
    assert list(spline.knots) == [0,0,0,0,1,1,1,1]
    assert tuple(spline.control_points[1])[:2] == pytest.approx((50*factor,285*factor))
    assert '日本語' in ''.join(e.dxf.text for e in doc.modelspace().query('TEXT'))
