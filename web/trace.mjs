// Binary raster outlines. Pixel boundaries preserve holes; no invented centre lines.
export function traceRaster({data,width,height,pageWidth,pageHeight}, {threshold=180,minPixels=4}={}) {
  if (!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width*height>5_000_000||data.length!==width*height*4) throw new Error('画像のサイズが上限を超えています。');
  if (!Number.isFinite(threshold)||threshold<1||threshold>254) throw new Error('読み取りの濃さは1〜254で指定してください。');
  const mask=new Uint8Array(width*height), queue=new Int32Array(width*height);
  for(let i=0;i<mask.length;i++) {
    const a=data[i*4+3]/255;
    const grey=(.2126*data[i*4]+.7152*data[i*4+1]+.0722*data[i*4+2])*a+255*(1-a);
    mask[i]=grey<threshold?1:0;
  }
  // Remove isolated specks, using four-connected components.
  for(let i=0;i<mask.length;i++) if(mask[i]===1) {
    let head=0,tail=1;queue[0]=i;mask[i]=2;
    while(head<tail) {
      const p=queue[head++],x=p%width;
      for(const n of [x?p-1:-1,x<width-1?p+1:-1,p-width,p+width]) if(n>=0&&n<mask.length&&mask[n]===1) {mask[n]=2;queue[tail++]=n;}
    }
    if(tail<minPixels) for(let j=0;j<tail;j++) mask[queue[j]]=0;
  }
  const entities=[],sx=pageWidth/width,sy=pageHeight/height;
  const add=(a,b)=> {
    if(entities.length>=300_000) throw new Error('輪郭が多すぎます。読み取りの濃さを下げるか、ページを切り抜いてください。');
    entities.push({type:'LINE',points:[[a[0]*sx,a[1]*sy],[b[0]*sx,b[1]*sy]],color:'#000000',layer:'PDF_FILL_OUTLINES'});
  };
  const ink=(x,y)=>x>=0&&x<width&&y>=0&&y<height&&mask[y*width+x]!==0;
  for(let y=0;y<=height;y++) {
    let start=-1;
    for(let x=0;x<=width;x++) {
      const edge=x<width&&ink(x,y-1)!==ink(x,y);
      if(edge&&start<0) start=x;
      if(!edge&&start>=0) {add([start,y],[x,y]);start=-1;}
    }
  }
  for(let x=0;x<=width;x++) {
    let start=-1;
    for(let y=0;y<=height;y++) {
      const edge=y<height&&ink(x-1,y)!==ink(x,y);
      if(edge&&start<0) start=y;
      if(!edge&&start>=0) {add([x,start],[x,y]);start=-1;}
    }
  }
  if(!entities.length) throw new Error('輪郭が見つかりません。読み取りの濃さを上げてください。');
  return {width:pageWidth,height:pageHeight,entities,paths:entities.length,texts:0,images:0,warnings:[
    'スキャンの黒い部分を輪郭線として近似しました。太い線は両側の輪郭になります。中心線・円弧・寸法・文字データは復元しません。',
    '文字も輪郭になります。「文字を含める」「線の色を保持」はトレース結果には適用されません。',
    '長辺最大2200ピクセルで読み取ります。細線の欠落・斜線の段差・汚れの混入があります。DXFプレビューとCADで既知の寸法を照合してください。'
  ]};
}
