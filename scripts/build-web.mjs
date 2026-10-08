import {build} from 'esbuild';
import {cp,mkdir,readFile,rm,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const root=fileURLToPath(new URL('../',import.meta.url));
const dest=path.join(root,'dist');
await rm(dest,{recursive:true,force:true});
await mkdir(path.join(dest,'vendor'),{recursive:true});
for(const name of ['style.css','icon.svg']) await cp(path.join(root,'static',name),path.join(dest,name));
for(const name of ['pdf.mjs','pdf.worker.mjs']) await cp(path.join(root,'node_modules/pdfjs-dist/legacy/build',name),path.join(dest,'vendor',name));
for(const name of ['cmaps','standard_fonts','wasm']) await cp(path.join(root,'node_modules/pdfjs-dist',name),path.join(dest,'vendor',name),{recursive:true});
await cp(path.join(root,'examples/サンプル図面.pdf'),path.join(dest,'sample.pdf'));
await writeFile(path.join(dest,'.nojekyll'),'');
let html=await readFile(path.join(root,'static/index.html'),'utf8');
html=html.replaceAll('/static/','./').replace('href="/"','href="./"')
  .replace('<script src="./app.js" defer></script>','<script type="module" src="./app.js"></script>')
  .replace('ローカル処理</span>','ブラウザ内処理</span>');
html=html.replace('<div class="field-row"><label for="output-pages">', `<div class="field-row"><label for="trace-mode">スキャン変換</label><select id="trace-mode"><option value="auto">自動（画像PDF）</option><option value="all">ページ全体をトレース</option><option value="off">トレースしない</option></select></div>
<div class="field-row"><label for="trace-threshold">読み取りの濃さ</label><select id="trace-threshold"><option value="120">薄く（汚れを抑える）</option><option value="180" selected>標準</option><option value="220">濃く（薄い線を拾う）</option></select></div>
<p class="field-help">スキャンは白黒の輪郭に変換します。文字も輪郭になり、太い線は二重線になります。</p>
<div class="field-row"><label for="output-pages">`)
.replace('ベクトルPDFに対応。スキャン画像の自動トレースには対応していません。','ベクトルPDF・スキャンPDFに対応。スキャンは輪郭の近似変換です。')
.replace('PDFの線と文字を抽出し、DXFに変換します。','PDFの線・文字やスキャン図面の輪郭を、DXFに変換します。');
html=html.replace(/<div class="limits">[\s\S]*?<\/div><\/details>/,
  `<div class="limits"><p>PDFの読込・変換・保存は、お使いのブラウザ内で行います。選択したPDFをサーバーへ送信しません。PDFはこのタブのメモリだけで扱い、タブを閉じると破棄されます。1ファイル50MB・200ページまでです。</p><p>直線・輪郭はLINE、ベジェ曲線はSPLINE、文字はTEXTとして出力します。文字は黒色・代替フォント、線幅はCADの既定値になります。スキャンPDFは長辺最大2200ピクセルで白黒の輪郭に近似し、文字も輪郭になります。中心線やOCR文字は復元しません。元のレイヤーや寸法オブジェクト、注釈、画像そのもの、塗りつぶし、クリッピングや透明度は完全には再現しません。不可視文字を含むページでは文字を省略します。</p><p>図面の縮尺を指定し、CADで既知の寸法と照合してください。印刷時の拡大・縮小や複数縮尺が混在する図面には補正が必要です。変換できないページはZIPからスキップし、理由を変換結果.jsonに記録します。ZIPの合計出力サイズは100MBまでです。最新版のChrome・Edge・Firefox・Safariをご利用ください。</p><p><a href="https://github.com/qua2psy10-web/pdf-to-dxf" target="_blank" rel="noopener noreferrer">ソースコード・使い方</a> · <a href="./THIRD_PARTY_NOTICES.txt" target="_blank" rel="noopener noreferrer">使用ライブラリ</a></p></div></details>`);
html=html.replace('</head>','<meta http-equiv="Content-Security-Policy" content="default-src \'self\'; script-src \'self\' \'wasm-unsafe-eval\'; worker-src \'self\' blob:; style-src \'self\' \'unsafe-inline\'; img-src \'self\' blob: data:; font-src \'self\' blob: data:; connect-src \'self\'; object-src \'none\'; base-uri \'self\'; form-action \'none\'">\n</head>');
await writeFile(path.join(dest,'index.html'),html);
// Reuse the proven interface. Only its explicit request adapter changes; window.fetch is untouched.
let source=await readFile(path.join(root,'static/app.js'),'utf8');
source='import {localRequest} from "./web/service.mjs";\n'+source.replaceAll('await fetch(', 'await localRequest(');
source+='\nwindow.addEventListener("trace-progress", event => status(event.detail));\n';
await build({stdin:{contents:source,resolveDir:root,sourcefile:'web-entry.mjs'},bundle:true,format:'esm',target:'es2022',
  outfile:path.join(dest,'app.js'),external:['./vendor/pdf.mjs'],minify:true,legalComments:'eof'});
await build({entryPoints:[path.join(root,'web/convert-worker.mjs')],bundle:true,format:'esm',target:'es2022',
  outfile:path.join(dest,'convert-worker.js'),minify:true,legalComments:'eof'});
const licenses=[['PDF.js','pdfjs-dist/LICENSE'],['DXF writer','@tarikjabiri/dxf/LICENSE.md'],['fflate','fflate/LICENSE']];
const notices=[];
for(const [name,file] of licenses) notices.push(`${name}\n${await readFile(path.join(root,'node_modules',file),'utf8')}`);
await writeFile(path.join(dest,'THIRD_PARTY_NOTICES.txt'),notices.join('\n\n====================\n\n'));
console.log('Built browser-only TRACE in dist/ (no backend or PDF uploads).');
