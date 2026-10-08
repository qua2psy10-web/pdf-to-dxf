import {traceRaster} from './trace.mjs';
import {convertArtwork} from './engine.mjs';
self.onmessage=({data})=> {
  try { self.postMessage({id:data.id,result:convertArtwork(data.raster?traceRaster(data.raster,data.options):data.art,data.options)}); }
  catch(error) { self.postMessage({id:data.id,error:error.message}); }
};
