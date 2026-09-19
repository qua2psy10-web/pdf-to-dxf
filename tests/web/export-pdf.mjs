// Cross-runtime integration helper used by pytest, with disposable output directories.
import {readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {getDocument,OPS} from 'pdfjs-dist/legacy/build/pdf.mjs';
import {extractArtwork,convertArtwork} from '../../web/engine.mjs';
const [source,destination]=process.argv.slice(2);
const task=getDocument({data:new Uint8Array(await readFile(source)),
  cMapUrl:fileURLToPath(new URL('../../node_modules/pdfjs-dist/cmaps/',import.meta.url)),cMapPacked:true,
  standardFontDataUrl:fileURLToPath(new URL('../../node_modules/pdfjs-dist/standard_fonts/',import.meta.url))});
try {
  const doc=await task.promise;
  for(let p=1;p<=doc.numPages;p++) {
    const page=await doc.getPage(p);
    const art=extractArtwork(await page.getOperatorList({annotationMode:0}),await page.getTextContent(),page.getViewport({scale:1}),OPS);
    const result=convertArtwork(art,{scale:100});
    await writeFile(`${destination}/p${p}.dxf`,result.dxf);
  }
} finally { await task.destroy(); }
