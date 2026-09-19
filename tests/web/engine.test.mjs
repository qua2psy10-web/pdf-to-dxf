import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {getDocument,OPS} from 'pdfjs-dist/legacy/build/pdf.mjs';
import {decodePath,extractArtwork,convertArtwork,multiply,PT_TO_MM} from '../../web/engine.mjs';

const viewport={width:300,height:200,transform:[1,0,0,-1,0,200]};
const emptyText={items:[],styles:{}};
function extract(fnArray,argsArray,text=emptyText) { return extractArtwork({fnArray,argsArray},text,viewport,OPS); }

test('PDF cubic Bezier control points survive coordinate transforms',()=> {
  const matrix=multiply(viewport.transform,[2,0,0,2,10,20]);
  const segments=decodePath([0,1,2,2,3,4,5,6,7,8],matrix);
  assert.equal(segments[0].type,'SPLINE');
  assert.deepEqual(segments[0].points,[[12,176],[16,172],[20,168],[24,164]]);
});

test('filled disjoint subpaths close separately, strokes stay open',()=> {
  const data=[0,0,0,1,10,0,1,10,10,0,20,20,1,30,20,1,30,30];
  assert.equal(decodePath(data,[1,0,0,1,0,0],true).length,6);
  assert.equal(decodePath(data,[1,0,0,1,0,0],false).length,4);
});

test('graphics save/restore and form transforms do not leak',()=> {
  const path=[OPS.stroke,[new Float32Array([0,0,0,1,72,0])],[0,0,72,0]];
  const art=extract([OPS.save,OPS.transform,OPS.constructPath,OPS.restore,OPS.paintFormXObjectBegin,OPS.constructPath,OPS.paintFormXObjectEnd,OPS.constructPath],
    [[],[2,0,0,2,5,10],path,[],[[1,0,0,1,20,30],[0,0,100,100]],path,[],path]);
  assert.deepEqual(art.entities.map(e=>e.points[0]),[[5,190],[20,170],[0,200]]);
  assert.equal(art.entities[0].points[1][0],149);
});

test('clipping-only path and transparent stroke do not become geometry',()=> {
  const p=new Float32Array([0,0,0,1,72,0]);
  const art=extract([OPS.clip,OPS.constructPath,OPS.setGState,OPS.constructPath],
    [[],[OPS.endPath,[p],[0,0,72,0]],[[['CA',0]]],[OPS.stroke,[p],[0,0,72,0]]]);
  assert.equal(art.entities.length,0);
  assert.ok(art.warnings.some(w=>w.includes('クリッピング')));
});

test('images alone never produce a fake DXF',()=> {
  const art=extract([OPS.paintImageXObject],[['image',200,100]]);
  assert.equal(art.images,1);
  assert.throws(()=>convertArtwork(art),/スキャン/);
});

test('invisible OCR text is omitted',()=> {
  const art=extract([OPS.setTextRenderingMode],[[3]],{items:[{str:'OCR',transform:[10,0,0,10,20,20],width:20,fontName:'f'}],styles:{f:{}}});
  assert.equal(art.texts,0);
  assert.ok(art.warnings.some(w=>w.includes('不可視')));
});

test('invalid scales rejected before serializing',()=> {
  for(const scale of [0,-1,NaN,Infinity,100001]) assert.throws(()=>convertArtwork({entities:[]},{scale}),/縮尺/);
});

test('real Japanese PDF: calibration length, text, cubic curves and monochrome',async()=> {
  const task=getDocument({data:new Uint8Array(await readFile(new URL('../../examples/サンプル図面.pdf',import.meta.url))),
    cMapUrl:fileURLToPath(new URL('../../node_modules/pdfjs-dist/cmaps/',import.meta.url)),cMapPacked:true,
    standardFontDataUrl:fileURLToPath(new URL('../../node_modules/pdfjs-dist/standard_fonts/',import.meta.url))});
  try {
    const doc=await task.promise, page=await doc.getPage(2);
    const art=extractArtwork(await page.getOperatorList(),await page.getTextContent(),page.getViewport({scale:1}),OPS);
    const line=art.entities.find(e=>e.type==='LINE');
    assert.ok(Math.abs(Math.hypot(line.points[1][0]-line.points[0][0],line.points[1][1]-line.points[0][1])*PT_TO_MM*100-9000)<.02);
    const result=convertArtwork(art,{scale:100});
    assert.equal(result.report.counts.SPLINE,4);
    assert.ok(result.dxf.includes('寸法・曲線テスト'));
    assert.ok(result.svg.includes('rotate(-90)'));
    const mono=convertArtwork(art,{scale:50,text:false,colors:false});
    assert.equal(mono.report.counts.TEXT,undefined);
    assert.equal(mono.report.width_mm,result.report.width_mm/2);
    assert.ok(!mono.dxf.includes('\n420\n'));
  } finally { await task.destroy(); }
});

test('SVG text is escaped and cannot inject markup',()=> {
  const art={width:100,height:100,warnings:[],entities:[{type:'TEXT',points:[[5,10],[90,10]],fontSize:12,text:'<script>alert(1)</script>',color:'#000000',layer:'PDF_TEXT'}]};
  assert.ok(!convertArtwork(art).svg.includes('<script>'));
});
