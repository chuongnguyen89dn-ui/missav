import http from 'node:http';

const originalCreateServer = http.createServer.bind(http);
const TEST_ID = 'javhd:dsod-044-test';
const TEST_HLS = 'https://stream4.javhdz.today/universal-stream-hls/f8d4829651b46962abb1652dd557b9185cdff94e/playlist.m3u8';
const SOURCE_PAGE = 'https://www.javhd.today/vi/368572/mosaic-dsod-044-welfare-full-erection-addiction-hidamari-garden-riho-a-medical-care-worker-devotedly-manages-the-release-of-a-sexually-insatiable-elderly-man-suffering-from-severe-ejaculation-addiction-shishido-riho/';
const cors = {'access-control-allow-origin':'*','access-control-allow-methods':'GET, HEAD, OPTIONS','access-control-allow-headers':'*'};
const testMeta = {
  id: TEST_ID,
  type: 'movie',
  name: 'JAVHD TEST · DSOD-044',
  description: 'JAVHD direct HLS test. Quét catalog chỉ bắt đầu sau khi mục này phát thành công.',
  posterShape: 'poster',
  language: 'Tiếng Nhật'
};
const testStreams = [{
  name: 'JAVHD · Myserver HLS TEST',
  title: 'HLS trực tiếp · stream4.javhdz.today',
  url: TEST_HLS,
  behaviorHints: {
    notWebReady: true,
    proxyHeaders: {request: {
      Referer: SOURCE_PAGE,
      Origin: 'https://www.javhd.today',
      'User-Agent': 'Mozilla/5.0'
    }}
  }
}];
function sendJson(res,data,status=200){
  const body=JSON.stringify(data);
  res.writeHead(status,{...cors,'content-type':'application/json; charset=utf-8','content-length':Buffer.byteLength(body),'cache-control':'no-store'});
  res.end(body);
}
http.createServer = function patchedCreateServer(handler,...rest){
  return originalCreateServer(async (req,res)=>{
    const path=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    if(req.method==='OPTIONS'){res.writeHead(204,cors);return res.end();}
    if(path==='/manifest.json'){
      return sendJson(res,{
        id:'community.missav.hls.test',version:'0.4.1-javhd-test',name:'MissAV 1080p',
        description:'MissAV addon + isolated JAVHD HLS playback test',
        resources:['catalog','meta','stream'],types:['movie'],
        catalogs:[
          {type:'movie',id:'missav-1080',name:'MissAV · Verified 1080p'},
          {type:'movie',id:'ikisoda',name:'ikisoda'},
          {type:'movie',id:'javhd-test',name:'JAVHD · TEST 1 PHIM'}
        ],
        idPrefixes:['missav:','ikisoda:','javhd:']
      });
    }
    if(path==='/catalog/movie/javhd-test.json') return sendJson(res,{metas:[testMeta]});
    if(path===`/meta/movie/${TEST_ID}.json`) return sendJson(res,{meta:testMeta});
    if(path===`/stream/movie/${TEST_ID}.json`) return sendJson(res,{streams:testStreams});
    return handler(req,res);
  },...rest);
};
