import test from 'node:test';
import assert from 'node:assert/strict';
import {traceRaster} from '../../web/trace.mjs';
import {convertArtwork} from '../../web/engine.mjs';
function raster(w,h,ink) {
 const data=new Uint8ClampedArray(w*h*4).fill(255);
 for(let y=0;y<h;y++) for(let x=0;x<w;x++) if(ink(x,y)) data.fill(0,(y*w+x)*4,(y*w+x)*4+3);
 return {data,width:w,height:h,pageWidth:w*2,pageHeight:h*2};
}
test('rectangle outline uses page units, removes speck and exports real DXF',()=>{
 const art=traceRaster(raster(20,10,(x,y)=>(x>=3&&x<13&&y>=2&&y<7)||(x===18&&y===8)));
 assert.equal(art.entities.length,4);
 assert.deepEqual(art.entities[0].points,[[6,4],[26,4]]);
 const result=convertArtwork(art,{scale:100});
 assert.equal(result.report.counts.LINE,4);
 assert.match(result.dxf,/ENTITIES/);
});
test('holes stay open and full-page edges are preserved',()=>{
 const art=traceRaster(raster(10,10,(x,y)=>x<2||x>=8||y<2||y>=8));
 assert.equal(art.entities.length,8);
});
test('white and transparent pages produce actionable error',()=>{
 assert.throws(()=>traceRaster(raster(10,10,()=>false)),/輪郭が見つかりません/);
 const r=raster(10,10,()=>true); for(let i=3;i<r.data.length;i+=4)r.data[i]=0;
 assert.throws(()=>traceRaster(r),/輪郭が見つかりません/);
});
test('threshold actually controls faint lines',()=>{
 const r=raster(10,10,(x,y)=>x>=3&&x<=6&&y>=3&&y<=6);
 for(let i=0;i<r.data.length;i+=4)if(r.data[i]===0)r.data.fill(200,i,i+3);
 assert.throws(()=>traceRaster(r,{threshold:180}),/輪郭が見つかりません/);
 assert.equal(traceRaster(r,{threshold:220}).entities.length,4);
});
