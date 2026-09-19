import {convertArtwork} from './engine.mjs';
self.onmessage=({data})=> {
  try { self.postMessage({id:data.id,result:convertArtwork(data.art,data.options)}); }
  catch(error) { self.postMessage({id:data.id,error:error.message}); }
};
