import test from 'node:test';
import assert from 'node:assert/strict';
import {extract} from '../scripts/extract-links.mjs';
test('extract candidate and mirror without claiming playback',()=>{
 const h='<title>FTHTD-213</title><script>var source="https:\/\/surrit.com\/d20f4a25-16db-4cd0-86bd-c02ee44cfa98\/1080p\/video.m3u8";</script>';
 const x=extract(h,'https://missav.ws/vi/fthtd-213');
 assert.equal(x.code,'FTHTD-213');
 assert.equal(x.playlists.length,1);
 assert.match(x.mirrorCandidates[0],/^https:\/\/surrit\.mrstcdn\.store\//);
 assert.ok(x.notes.some(n=>n.includes('hypotheses')));
});
test('does not invent playlists for empty HTML',()=>assert.deepEqual(extract('<html></html>','https://missav.ws/vi/example-123').playlists,[]));
