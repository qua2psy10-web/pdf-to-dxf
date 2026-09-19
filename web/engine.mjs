import { DxfWriter, Units, point3d, TextHorizontalAlignment } from '@tarikjabiri/dxf';

export const PT_TO_MM = 25.4 / 72;
export const MAX_ENTITIES = 300_000;
const IDENTITY = [1, 0, 0, 1, 0, 0];
export function multiply(a, b) {
  return [a[0]*b[0]+a[2]*b[1], a[1]*b[0]+a[3]*b[1],
    a[0]*b[2]+a[2]*b[3], a[1]*b[2]+a[3]*b[3],
    a[0]*b[4]+a[2]*b[5]+a[4], a[1]*b[4]+a[3]*b[5]+a[5]];
}
export function transform(m, x, y) { return [m[0]*x+m[2]*y+m[4], m[1]*x+m[3]*y+m[5]]; }
const same = (a,b) => a && b && Math.hypot(a[0]-b[0],a[1]-b[1]) < 1e-5;
const escapeXML = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const finite = point => point.every(Number.isFinite);

// PDF.js 6.3 returns compact DrawOPS streams, distinct from its top-level OPS.
export function decodePath(data, matrix, closeFill = false, closeLast = false) {
  if (!data || (!Array.isArray(data) && !ArrayBuffer.isView(data))) throw new Error('このPDFの図形形式を読み取れません。');
  const segments = [];
  let start = null, cursor = null;
  function close() {
    if (start && cursor && !same(start,cursor)) segments.push({type:'LINE',points:[cursor,start]});
    cursor = start;
  }
  for (let i=0; i<data.length;) {
    switch (data[i++]) {
      case 0:
        if (closeFill) close();
        start = cursor = transform(matrix,data[i++],data[i++]);
        break;
      case 1: {
        const end = transform(matrix,data[i++],data[i++]);
        if (cursor && !same(cursor,end)) segments.push({type:'LINE',points:[cursor,end]});
        cursor = end; break;
      }
      case 2: {
        const p1 = transform(matrix,data[i++],data[i++]);
        const p2 = transform(matrix,data[i++],data[i++]);
        const end = transform(matrix,data[i++],data[i++]);
        if (cursor) segments.push({type:'SPLINE',points:[cursor,p1,p2,end]});
        cursor = end; break;
      }
      case 3: {
        const q = transform(matrix,data[i++],data[i++]);
        const end = transform(matrix,data[i++],data[i++]);
        if (cursor) {
          const p1 = cursor.map((v,j)=>v+2/3*(q[j]-v));
          const p2 = end.map((v,j)=>v+2/3*(q[j]-v));
          segments.push({type:'SPLINE',points:[cursor,p1,p2,end]});
        }
        cursor = end; break;
      }
      case 4: close(); break;
      default: throw new Error('未対応の図形命令が含まれています。ローカル版での変換をお試しください。');
    }
    if (segments.length > MAX_ENTITIES) throw new Error('1ページ30万要素の上限を超えました。');
  }
  if (closeFill || closeLast) close();
  if (segments.some(s=>s.points.some(p=>!finite(p)))) throw new Error('図形の座標が不正です。');
  return segments;
}

/** Extract once BEFORE PDF canvas rendering. All output positions are page display points, y down. */
export function extractArtwork(opList, textContent, viewport, OPS, optionalContent = null) {
  const entities = [], warnings = new Set(), stack = [], visibility = [true];
  let state = {matrix:IDENTITY, color:'#000000', fill:'#000000', dash:[], dashPhase:0, strokeAlpha:1, fillAlpha:1, textMode:0};
  let images = 0, paths = 0, invisibleText = false;
  const fillOps = new Set([OPS.fill,OPS.eoFill,OPS.fillStroke,OPS.eoFillStroke,OPS.closeFillStroke,OPS.closeEOFillStroke]);
  const strokeOps = new Set([OPS.stroke,OPS.closeStroke,OPS.fillStroke,OPS.eoFillStroke,OPS.closeFillStroke,OPS.closeEOFillStroke]);
  const imageOps = new Set([OPS.paintImageXObject,OPS.paintInlineImageXObject,OPS.paintImageMaskXObject,OPS.paintImageMaskXObjectGroup,OPS.paintInlineImageXObjectGroup,OPS.paintImageXObjectRepeat,OPS.paintImageMaskXObjectRepeat,OPS.paintSolidColorImageMask]);
  const save = () => stack.push({...state, matrix:[...state.matrix],dash:[...state.dash]});
  const restore = () => { state = stack.pop() || state; };
  const add = entity => {
    if (entities.length >= MAX_ENTITIES) throw new Error('1ページ30万要素の上限を超えました。');
    entities.push(entity);
  };
  for (let i=0;i<opList.fnArray.length;i++) {
    const fn=opList.fnArray[i], args=opList.argsArray[i] || [];
    if (fn === OPS.beginMarkedContentProps) {
      const visible = args[0] !== 'OC' || !optionalContent || optionalContent.isVisible(args[1]);
      visibility.push(visibility.at(-1) && visible);
      if (!visible) warnings.add('非表示レイヤーを省略しました。非表示文字を避けるため文字の抽出も省略します。');
      if (!visible) invisibleText = true;
      continue;
    }
    if (fn === OPS.beginMarkedContent) { visibility.push(visibility.at(-1)); continue; }
    if (fn === OPS.endMarkedContent) { if (visibility.length>1) visibility.pop(); continue; }
    if (!visibility.at(-1)) continue;
    if (imageOps.has(fn)) { images++; continue; }
    switch (fn) {
      case OPS.save: save(); break;
      case OPS.restore: restore(); break;
      case OPS.transform: state.matrix=multiply(state.matrix,args); break;
      case OPS.setStrokeRGBColor: state.color=args[0]; break;
      case OPS.setFillRGBColor: state.fill=args[0]; break;
      case OPS.setStrokeTransparent: state.strokeAlpha=0; break;
      case OPS.setFillTransparent: state.fillAlpha=0; break;
      case OPS.setDash: state.dash=args[0]; state.dashPhase=args[1]; break;
      case OPS.setTextRenderingMode:
        state.textMode=args[0] & 3;
        if (state.textMode===3) invisibleText=true;
        break;
      case OPS.showText: case OPS.showSpacedText:
        if ((state.textMode===0 && !state.fillAlpha) || (state.textMode===1 && !state.strokeAlpha) ||
            (state.textMode===2 && !state.fillAlpha && !state.strokeAlpha)) invisibleText=true;
        break;
      case OPS.setGState:
        for (const [key,value] of args[0]) {
          if (key==='CA') state.strokeAlpha=value;
          if (key==='ca') state.fillAlpha=value;
          if (key==='D') { state.dash=value[0]; state.dashPhase=value[1]; }
          if (key==='SMask' && value) warnings.add('ソフトマスク・透明度による隠蔽は再現しません。');
        }
        break;
      case OPS.paintFormXObjectBegin:
        save();
        if (args[0]) state.matrix=multiply(state.matrix,args[0]);
        if (args[1]) warnings.add('クリッピングを含みます。隠れた線が出力される場合があります。');
        break;
      case OPS.paintFormXObjectEnd: restore(); break;
      case OPS.beginGroup:
        // Group matrices bound the compositing surface; child operators carry the actual transform.
        save(); warnings.add('透明グループの合成・クリッピングは完全には再現しません。'); break;
      case OPS.endGroup: restore(); break;
      case OPS.clip: case OPS.eoClip:
        warnings.add('クリッピングを含みます。隠れた線が出力される場合があります。'); break;
      case OPS.shadingFill: case OPS.setStrokeColorN: case OPS.setFillColorN:
        warnings.add('グラデーション・パターンは再現しません。'); break;
      case OPS.rawFillPath:
        warnings.add('最適化された塗りつぶしの一部を省略しました。'); break;
      case OPS.constructPath: {
        const paint=args[0], fill=fillOps.has(paint), stroke=strokeOps.has(paint);
        if ((!fill && !stroke) || (!stroke || !state.strokeAlpha) && (!fill || !state.fillAlpha)) break;
        const matrix=multiply(viewport.transform,state.matrix);
        const path=decodePath(args[1][0] || [],matrix,fill,[OPS.closeStroke,OPS.closeFillStroke,OPS.closeEOFillStroke].includes(paint));
        const color=stroke ? state.color : state.fill;
        const lineScale=Math.sqrt(Math.abs(matrix[0]*matrix[3]-matrix[1]*matrix[2]));
        const dash=stroke ? state.dash.map(v=>v*lineScale) : [];
        if (fill) warnings.add('塗りつぶしは輪郭線として出力します。白抜き・描画順による隠蔽は再現しません。');
        if (state.strokeAlpha<1 || state.fillAlpha<1) warnings.add('透明度は再現しません。');
        if (state.dashPhase) warnings.add('破線の開始位相は再現しません。');
        for (const segment of path) add({...segment,color:/^#[0-9a-f]{6}$/i.test(color)?color:'#000000',dash,
          layer:stroke?'PDF_LINES':'PDF_FILL_OUTLINES'});
        if (path.length) paths++;
        break;
      }
    }
  }
  if (images) warnings.add('画像部分は出力しません。スキャン図面の自動トレースには対応していません。');
  if (invisibleText) warnings.add('不可視文字を含むため、このページの文字は省略します。');
  let texts=0;
  if (!invisibleText) for (const item of textContent.items) {
    if (!item.str?.trim()) continue;
    const m=multiply(viewport.transform,item.transform);
    const fontSize=Math.hypot(m[2],m[3]);
    const length0=Math.hypot(item.transform[0],item.transform[1]);
    if (!fontSize || !length0) continue;
    const direction=[m[0]/Math.hypot(m[0],m[1]),m[1]/Math.hypot(m[0],m[1])];
    const advance=item.width * Math.hypot(m[0],m[1])/length0;
    const p=[m[4],m[5]], end=[p[0]+direction[0]*advance,p[1]+direction[1]*advance];
    if (!finite(p)||!finite(end)) continue;
    add({type:'TEXT',points:[p,end],fontSize,text:item.str.replace(/[\r\n\u0000]/g,' '),color:'#000000',layer:'PDF_TEXT',dash:[]});
    texts++;
    if (textContent.styles[item.fontName]?.vertical) warnings.add('縦書きの文字配置は近似になります。');
  }
  if (entities.some(e=>e.points.some(([x,y])=>x < -.1 || y < -.1 || x > viewport.width+.1 || y > viewport.height+.1))) warnings.add('用紙外の図形も出力されます。');
  return {entities,warnings:[...warnings],width:viewport.width,height:viewport.height,paths,texts,images};
}

export function pageInfo(art, number) {
  return {number,width_mm:+(art.width*PT_TO_MM).toFixed(2),height_mm:+(art.height*PT_TO_MM).toFixed(2),
    paths:art.paths,texts:art.texts,images:art.images,
    kind:art.paths?'vector':art.images?'image':art.texts?'text':'empty'};
}

export function convertArtwork(art, {scale=100,text=true,colors=true} = {}) {
  if (!Number.isFinite(scale) || scale<.001 || scale>100000) throw new Error('縮尺は0.001〜100000の数値で指定してください。');
  const entities=art.entities.filter(e=>text || e.type!=='TEXT');
  if (!entities.length) throw new Error('変換できる線・文字がありません。スキャン画像の自動トレースは未対応です。');
  const factor=PT_TO_MM*scale, writer=new DxfWriter();
  writer.setUnits(Units.Millimeters);
  writer.setVariable('$ACADVER',{1:'AC1024'});
  writer.setVariable('$DWGCODEPAGE',{3:'UTF-8'});
  writer.setVariable('$MEASUREMENT',{70:1});
  writer.setVariable('$INSBASE',{10:0,20:0,30:0});
  for (const name of ['PDF_LINES','PDF_FILL_OUTLINES','PDF_TEXT']) writer.addLayer(name,7,'Continuous');
  const point = p => point3d(p[0]*factor,(art.height-p[1])*factor,0);
  const counts={}, lineTypes=new Map();
  for (const e of entities) {
    const opts={layerName:e.layer};
    if (colors) opts.trueColor=String(parseInt(e.color.slice(1),16));
    if (e.dash?.length && e.dash.some(v=>v>0)) {
      let dash=e.dash.map(v=>Math.abs(v)*factor);
      if (dash.length%2) dash=[...dash,...dash];
      const key=JSON.stringify(dash);
      if (!lineTypes.has(key)) {
        const name=`PDF_DASH_${lineTypes.size+1}`;
        writer.addLType(name,'PDF dash',dash.map((v,i)=>i%2?-v:v));
        lineTypes.set(key,name);
      }
      opts.lineType=lineTypes.get(key);
    }
    if (e.type==='LINE') writer.addLine(point(e.points[0]),point(e.points[1]),opts);
    else if (e.type==='SPLINE') writer.addSpline({controlPoints:e.points.map(point),degreeCurve:3,knots:[0,0,0,0,1,1,1,1]},opts);
    else if (e.type==='TEXT') {
      const a=e.points[0],b=e.points[1],angle=-Math.atan2(b[1]-a[1],b[0]-a[0])*180/Math.PI;
      writer.addText(point(a),e.fontSize*factor*.75,e.text,{...opts,rotation:angle,
        ...(same(a,b)?{}:{horizontalAlignment:TextHorizontalAlignment.Fit,secondAlignmentPoint:point(b)})});
    }
    counts[e.type]=(counts[e.type] || 0)+1;
  }
  const warnings=[...art.warnings];
  if (counts.TEXT) warnings.push('文字は黒色・代替フォントで出力します。字体や文字間隔は元PDFと異なる場合があります。');
  warnings.push('線幅はCADの既定値になります。寸法・元のレイヤー・注釈は復元しません。');
  return {dxf:writer.stringify(),svg:artworkSVG({...art,entities},colors),
    report:{entities:entities.length,counts,warnings,width_mm:art.width*factor,height_mm:art.height*factor,scale}};
}

export function artworkSVG(art, colors=true) {
  const num=v=>Number(v.toFixed(5));
  const xy=p=>`${num(p[0])},${num(p[1])}`;
  const out=[`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${num(art.width)} ${num(art.height)}"><rect width="100%" height="100%" fill="white"/>`];
  for (const e of art.entities) {
    const color=colors?e.color:'#000000';
    if (e.type==='TEXT') {
      const [a,b]=e.points,angle=Math.atan2(b[1]-a[1],b[0]-a[0])*180/Math.PI;
      const length=Math.hypot(b[0]-a[0],b[1]-a[1]);
      out.push(`<text transform="translate(${xy(a)}) rotate(${num(angle)})" font-family="Arial,Hiragino Kaku Gothic ProN,sans-serif" font-size="${num(e.fontSize)}" fill="${color}"${length?` textLength="${num(length)}" lengthAdjust="spacingAndGlyphs"`:''}>${escapeXML(e.text)}</text>`);
    } else {
      const d=e.type==='LINE'?`M${xy(e.points[0])}L${xy(e.points[1])}`:`M${xy(e.points[0])}C${e.points.slice(1).map(xy).join(' ')}`;
      out.push(`<path d="${d}" fill="none" stroke="${color}" stroke-width="0.8" vector-effect="non-scaling-stroke"${e.dash?.length?` stroke-dasharray="${e.dash.map(num).join(',')}"`:''}/>`);
    }
  }
  return out.join('\n')+'</svg>';
}
