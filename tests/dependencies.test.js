const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const express = require('express');
const cookieParser = require('cookie-parser');
const csrf = require('@dr.pogodin/csurf').default;
const gpx = require('gpx-parse');
const { once } = require('node:events');

test('maintained CSRF middleware preserves token contract and rejects query/body/wrong-session tokens', async () => {
 const app=express(); app.use(express.json());app.use(cookieParser());
 app.use(csrf({cookie:{key:'_csrf',httpOnly:true,sameSite:'lax'},value:req=>req.headers['x-csrf-token']}));
 app.get('/token',(req,res)=>res.json({csrfToken:req.csrfToken()}));
 app.post('/change',(req,res)=>res.json({ok:true}));
 app.use((err,req,res,next)=>res.status(err.code==='EBADCSRFTOKEN'?403:500).end());
 const server=app.listen(0,'127.0.0.1');await once(server,'listening');
 const base=`http://127.0.0.1:${server.address().port}`;
 try {
  const response=await fetch(base+'/token');const {csrfToken}=await response.json();
  const cookie=response.headers.getSetCookie()[0].split(';')[0];
  assert.equal((await fetch(base+'/change',{method:'POST',headers:{Cookie:cookie,'X-CSRF-Token':csrfToken}})).status,200);
  for(const path of ['/change','/change?_csrf='+csrfToken]) assert.equal((await fetch(base+path,{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify({_csrf:csrfToken})})).status,403);
  const other=await fetch(base+'/token');const otherCookie=other.headers.getSetCookie()[0].split(';')[0];
  assert.equal((await fetch(base+'/change',{method:'POST',headers:{Cookie:otherCookie,'X-CSRF-Token':csrfToken}})).status,403);
 }finally{await new Promise(resolve=>server.close(resolve));}
});
test('production CSRF cookie uses host prefix and header-only extraction',()=>{
 const source=fs.readFileSync('server.js','utf8');
 assert.match(source,/__Host-travel-csrf/); assert.match(source,/value: \(req\) => req.headers\["x-csrf-token"\]/);
});
test('patched XML parser retains GPX tracks, timestamps, and waypoints',async()=>{
 const xml='<?xml version="1.0"?><gpx version="1.1"><wpt lat="50.0" lon="4.0"><name>Fixture waypoint</name></wpt><trk><name>Fixture</name><trkseg><trkpt lat="50.0" lon="4.0"><ele>10</ele><time>2026-01-01T00:00:00Z</time></trkpt><trkpt lat="50.1" lon="4.1"><ele>12</ele><time>2026-01-01T00:01:00Z</time></trkpt></trkseg></trk></gpx>';
 const data=await new Promise((resolve,reject)=>gpx.parseGpx(xml,(error,result)=>error?reject(error):resolve(result)));
 assert.equal(data.tracks[0].segments[0].length,2);assert.equal(data.waypoints[0].name,'Fixture waypoint');assert.equal(data.tracks[0].segments[0][0].lat,50);
 assert.equal(new Date(data.tracks[0].segments[0][1].time).toISOString(),'2026-01-01T00:01:00.000Z');
});
test('XML parser resists prototype mutation and rejects malformed input',async()=>{
 const xml2js=require(require.resolve('xml2js', {paths:[require.resolve('gpx-parse')]}));
 const parsed=await xml2js.parseStringPromise('<root><__proto__><polluted>true</polluted></__proto__></root>');
 assert.equal({}.polluted,undefined); assert(Object.hasOwn(parsed.root,'__proto__'));
 await assert.rejects(xml2js.parseStringPromise('<gpx><trk></gpx>'));
});

test('updated Nodemailer composes mail offline without an SMTP connection', async()=> {
 const mailer=require('nodemailer').createTransport({streamTransport:true,buffer:true,newline:'unix'});
 const result=await mailer.sendMail({from:'fixture@example.com',to:'recipient@example.com',subject:'Fixture only',text:'No delivery'});
 assert.match(result.message.toString(),/Subject: Fixture only/);assert.match(result.message.toString(),/No delivery/);
});
