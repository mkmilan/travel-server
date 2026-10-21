// Disposable, loopback-only integration smoke. Never accepts a database URI.
// Usage: MONGOD_BINARY=/path/to/official/mongod node scripts/integration-smoke.cjs
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { mkdtemp, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { existsSync } = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const mongoose = require('mongoose');
const sharp = require('sharp');
const { once } = require('node:events');
const ROOT = path.resolve(__dirname, '..');
const FIXTURE_PASSWORD = 'disposable-fixture-password';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function freePort() {
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
function start(command, args, env) {
  const process = spawn(command, args, { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let logs = '';
  for (const stream of [process.stdout, process.stderr]) stream.on('data', chunk => { logs += chunk; });
  return { process, logs: () => logs };
}
async function stop(child) {
  if (!child || child.process.exitCode !== null) return;
  const closed = once(child.process, 'exit');
  child.process.kill('SIGTERM');
  await Promise.race([closed, sleep(5000)]);
  if (child.process.exitCode === null) { child.process.kill('SIGKILL'); await closed; }
}
async function main() {
  assert(process.env.MONGOD_BINARY, 'Set MONGOD_BINARY to an installed official mongod binary.');
  assert(!existsSync(path.join(ROOT, '.env')), 'Run in a clean checkout without .env so dotenv cannot import real settings.');
  const dir = await mkdtemp(path.join(tmpdir(), 'travel-integration-'));
  const mongoPort = await freePort(), apiPort = await freePort();
  const uri = `mongodb://127.0.0.1:${mongoPort}/travel_integration_fixture`;
  const base = `http://127.0.0.1:${apiPort}/api`;
  let mongo, app, passed = 0;
  const check = label => { passed++; console.log(`PASS ${label}`); };
  try {
    mongo = start(process.env.MONGOD_BINARY, ['--dbpath',dir,'--bind_ip','127.0.0.1','--port',String(mongoPort),'--nounixsocket','--wiredTigerCacheSizeGB','0.25'], { PATH: process.env.PATH });
    for(let i=0;i<100 && !mongo.logs().includes('Waiting for connections');i++) {
      if(mongo.process.exitCode !== null) throw Error(`Disposable Mongo failed: ${mongo.logs().slice(-1500)}`);
      await sleep(100);
    }
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
    const User = require('../models/User'), Trip = require('../models/Trip'), Recommendation = require('../models/Recommendation');
    await Promise.all([User.init(),Trip.init(),Recommendation.init()]);
    const owner = await User.create({username:'Fixture Owner',email:'owner@example.com',password:FIXTURE_PASSWORD,isEmailVerified:true});
    const stranger = await User.create({username:'Fixture Stranger',email:'stranger@example.com',password:FIXTURE_PASSWORD,isEmailVerified:true});
    const follower = await User.create({username:'Fixture Follower',email:'follower@example.com',password:FIXTURE_PASSWORD,isEmailVerified:true});
    await User.updateOne({_id:owner._id},{$set:{followers:[follower._id]}});
    app = start(process.execPath, ['-e', `const http=require('node:http');const original=http.Server.prototype.listen;http.Server.prototype.listen=function(port,...args){return original.call(this,port,'127.0.0.1',...args)};require('./server.js')`], {
      PATH:process.env.PATH, NODE_ENV:'development', PORT:String(apiPort), MONGO_URI:uri,
      JWT_SECRET:'disposable-integration-fixture-not-for-deployment', JWT_COOKIE_EXPIRE:'1',
      EMAIL_VERIFICATION_TOKEN_EXPIRE_MINUTES:'60', PASSWORD_RESET_TOKEN_EXPIRE_MINUTES:'60', FRONTEND_URL:'http://localhost:3000'
    });
    for(let i=0;i<100 && !app.logs().includes('MongoDB Connected');i++) {
      if(app.process.exitCode !== null) throw Error(`Application startup failed: ${app.logs().slice(-1500)}`);
      await sleep(100);
    }
    const request = async (url, options={}) => fetch(base+url, {...options, signal:AbortSignal.timeout(10000)});
    assert.equal((await request('')).status,200); check('actual Express app starts against disposable Mongo');
    const session = async email => {
      const csrfResponse=await request('/csrf-token');
      const csrf=(await csrfResponse.json()).csrfToken;
      const csrfCookie=csrfResponse.headers.getSetCookie().map(x=>x.split(';')[0]).join('; ');
      const response=await request('/auth/login',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf,Cookie:csrfCookie},body:JSON.stringify({email,password:FIXTURE_PASSWORD})});
      assert.equal(response.status,200,await response.clone().text());
      const data=await response.json();
      return {token:data.token,csrf,cookie:[csrfCookie,...response.headers.getSetCookie().map(x=>x.split(';')[0])].join('; ')};
    };
    const a=await session(owner.email), b=await session(stranger.email), f=await session(follower.email);
    const headers=s=>({Authorization:`Bearer ${s.token}`,Cookie:s.cookie,'X-CSRF-Token':s.csrf});
    assert.equal((await request('/auth/me',{headers:{Cookie:a.cookie}})).status,200);check('real bcrypt login and cookie authentication');
    assert.equal((await request('/auth/me')).status,401);check('unauthenticated API returns 401 rather than 500');
    const badLogin=await request('/auth/login',{method:'POST',headers:{...headers(a),'Content-Type':'application/json'},body:JSON.stringify({email:owner.email,password:'wrong-fixture-password'})});assert.equal(badLogin.status,401);check('invalid password returns 401');
    assert.equal((await request('/auth/me',{headers:{Authorization:`Bearer ${b.token}`}})).status,200);check('bearer authentication for mobile');
    assert.equal((await request('/auth/logout',{method:'POST',headers:{Cookie:a.cookie}})).status,403);check('CSRF rejects unsafe request without token');
    const register=await request('/auth/register',{method:'POST',headers:{...headers(a),'Content-Type':'application/json'},body:JSON.stringify({username:'Registered Fixture',email:'registered@example.com',password:FIXTURE_PASSWORD})});assert.equal(register.status,201,await register.clone().text());
    const verifyToken=app.logs().match(/Verification URL created: http:\/\/localhost:3000\/verify-email\/([a-f0-9]+)/)?.[1];assert(verifyToken,'Development email link must be generated without SMTP');assert.equal((await request('/auth/verifyemail/'+verifyToken)).status,200);const registered=await session('registered@example.com');assert(registered.token);check('register, development email verification, and login');
    assert.equal((await request('',{headers:{Origin:'http://localhost:3000.attacker.invalid'}})).status,403);check('CORS rejects lookalike origin');
    const allowed=await request('',{headers:{Origin:'http://localhost:3000'}});assert.equal(allowed.headers.get('access-control-allow-origin'),'http://localhost:3000');check('CORS allows exact development origin');
    const trip=await Trip.create({user:owner._id,title:'Synthetic private trip',format:'json',durationMillis:1000,distanceMeters:1,defaultTripVisibility:'private'});
    const image=await sharp({create:{width:2,height:2,channels:3,background:'#123456'}}).png().toBuffer();
    const form=new FormData();form.append('photos',new Blob([image],{type:'image/png'}),'fixture.png');
    const upload=await request(`/trips/${trip.id}/photos`,{method:'POST',headers:headers(a),body:form});
    assert.equal(upload.status,200,await upload.clone().text());
    const photoId=(await upload.json()).photoIds[0];assert(photoId);check('real Multer + Sharp + GridFS photo upload');
    const stored=await mongoose.connection.db.collection('gpxUploads.files').findOne({_id:new mongoose.Types.ObjectId(photoId)});
    assert.equal(stored.metadata.userId,owner.id);assert.equal(stored.metadata.tripId,trip.id);check('server-written owner/trip metadata');
    assert.equal((await request(`/photos/${photoId}`)).status,404);check('anonymous cannot read private image');
    assert.equal((await request(`/photos/${photoId}`,{headers:headers(b)})).status,404);check('other account cannot read private image');
    let ownPhoto=await request(`/photos/${photoId}`,{headers:headers(a)});assert.equal(ownPhoto.status,200);assert.equal(ownPhoto.headers.get('cache-control'),'private, no-store');assert((await ownPhoto.arrayBuffer()).byteLength>0);check('owner can stream private image without shared caching');
    await Trip.updateOne({_id:trip._id},{$set:{defaultTripVisibility:'followers_only'}});
    assert.equal((await request(`/photos/${photoId}`,{headers:headers(f)})).status,200);assert.equal((await request(`/photos/${photoId}`,{headers:headers(b)})).status,404);check('followers-only photo permissions');
    await Trip.updateOne({_id:trip._id},{$set:{defaultTripVisibility:'public'}});
    assert.equal((await request(`/photos/${photoId}`)).status,200);check('public photo remains accessible');
    await Trip.updateOne({_id:trip._id},{$set:{defaultTripVisibility:'private'}});
    const recBody={name:'Synthetic forged attachment',description:'Fixture only',latitude:0,longitude:0,primaryCategory:'OTHER',rating:3,photoIds:[photoId]};
    const attach=await request('/v2/recommendations',{method:'POST',headers:{...headers(b),'Content-Type':'application/json'},body:JSON.stringify(recBody)});
    assert.equal(attach.status,400);assert.equal(await Recommendation.countDocuments({user:stranger._id}),0);check('cross-account recommendation attachment rejected');
    const forged=await Recommendation.create({user:stranger._id,name:'Legacy forged fixture',description:'Synthetic record',rating:3,primaryCategory:'OTHER',location:{type:'Point',coordinates:[0,0]},photos:[photoId]});
    const deletion=await request(`/v2/recommendations/${forged.id}/photos/${photoId}`,{method:'DELETE',headers:headers(b)});
    // API may remove the attacker's own stale reference, but must retain the owner's file.
    assert.equal(deletion.status,200,await deletion.clone().text());assert(await mongoose.connection.db.collection('gpxUploads.files').findOne({_id:stored._id}));assert.deepEqual((await Recommendation.findById(forged.id)).photos,[]);check('forged reference cleanup preserves another account file');
    const bucket=new mongoose.mongo.GridFSBucket(mongoose.connection.db,{bucketName:'gpxUploads'});
    const gpx=bucket.openUploadStream('fixture.gpx',{contentType:'application/gpx+xml',metadata:{userId:owner.id,tripId:trip.id}});
    gpx.end(Buffer.from('<gpx version="1.1" creator="fixture"></gpx>'));await once(gpx,'finish');
    await Trip.updateOne({_id:trip._id},{$set:{gpxFileRef:String(gpx.id)}});
    assert.equal((await request(`/trips/${trip.id}/gpx`)).status,404);assert.equal((await request(`/trips/${trip.id}/gpx`,{headers:headers(b)})).status,404);assert.equal((await request(`/trips/${trip.id}/gpx`,{headers:headers(a)})).status,200);check('private GPX access restricted to owner');
    const deleteOwn=await request(`/trips/${trip.id}/photos/${photoId}`,{method:'DELETE',headers:headers(a)});assert.equal(deleteOwn.status,200,await deleteOwn.clone().text());assert.equal(await mongoose.connection.db.collection('gpxUploads.files').findOne({_id:stored._id}),null);check('owner can delete own file');
    // Public profile metadata must not reveal private trip locations/photos.
    const poi={name:'Private fixture POI',description:'Synthetic only',location:{type:'Point',coordinates:[4,50]},timestamp:new Date()};
    await Trip.updateOne({_id:trip._id},{$set:{defaultTripVisibility:'private',pointsOfInterest:[poi]}});
    for(const endpoint of [`/users/${owner.id}/pois`,`/users/${owner.id}/photos`,`/users/${owner.id}/recommendations`]) {
      const anonymous=await request(endpoint); assert.equal(anonymous.status,200,await anonymous.clone().text());
      assert.equal((await anonymous.json()).totalCount,0,endpoint+' must hide private sources');
    } check('anonymous profile metadata excludes private trips');
    const ownPois=await request(`/users/${owner.id}/pois`,{headers:headers(a)});assert.equal((await ownPois.json()).totalCount,1);check('owner retains private POI metadata');
    await Trip.updateOne({_id:trip._id},{$set:{defaultTripVisibility:'followers_only'}});
    const followerPois=await request(`/users/${owner.id}/pois`,{headers:headers(f)});assert.equal((await followerPois.json()).totalCount,1);
    const strangerPois=await request(`/users/${owner.id}/pois`,{headers:headers(b)});assert.equal((await strangerPois.json()).totalCount,0);check('profile POI metadata respects followers-only policy');
    const publicProfile=await request(`/users/${owner.id}`);assert.equal(Object.hasOwn(await publicProfile.json(),'settings'),false);check('public profile omits private settings');
    const forgedGpxTrip=await Trip.create({user:stranger._id,title:'Forged GPX reference',format:'json',durationMillis:1000,distanceMeters:1,defaultTripVisibility:'public',gpxFileRef:String(gpx.id)});
    assert.equal((await request(`/trips/${forgedGpxTrip.id}/gpx`)).status,404);check('forged public GPX reference cannot expose another owners file');
    const gpxXml='<gpx version="1.1"><trk><name>Integration GPX</name><trkseg><trkpt lat="50" lon="4"><time>2026-01-01T00:00:00Z</time></trkpt><trkpt lat="50.1" lon="4.1"><time>2026-01-01T00:01:00Z</time></trkpt></trkseg></trk></gpx>';
    const gpxCreate=await request('/trips',{method:'POST',headers:{...headers(a),'Content-Type':'application/json'},body:JSON.stringify({title:'Actual parser fixture',gpxString:gpxXml,defaultTripVisibility:'private'})});
    assert.equal(gpxCreate.status,201,await gpxCreate.clone().text());const createdGpx=await gpxCreate.json();
    const actualGpx=await request(`/trips/${createdGpx._id}/gpx`,{headers:headers(a)});assert.equal(actualGpx.status,200,await actualGpx.clone().text());assert.equal(await actualGpx.text(),gpxXml);
    assert.equal((await request(`/trips/${createdGpx._id}/gpx`,{headers:headers(b)})).status,404);check('actual GPX parser/upload writes metadata and authorized download succeeds');
    for(const suffix of ['comments','likers','recommendations']) {
      const endpoint=`/trips/${createdGpx._id}/${suffix}`;
      assert.equal((await request(endpoint)).status,404);
      assert.equal((await request(endpoint,{headers:headers(b)})).status,404);
      assert.equal((await request(endpoint,{headers:headers(a)})).status,200);
    }check('private trip comments, likers and recommendations enforce visibility');
    const privateRec=await Recommendation.create({user:owner._id,name:'Private recommendation fixture',description:'Synthetic',rating:3,primaryCategory:'OTHER',location:{type:'Point',coordinates:[4,50]},associatedTrip:createdGpx._id});
    for(const prefix of ['/recommendations','/v2/recommendations']) {
      assert.equal((await request(`${prefix}/${privateRec.id}`)).status,404);
      assert.equal((await request(`${prefix}/${privateRec.id}`,{headers:headers(a)})).status,200);
    }
    const anonymousRecs=await (await request('/recommendations')).json();assert(!anonymousRecs.some(rec=>rec._id===privateRec.id));
    const ownerRecs=await (await request('/recommendations',{headers:headers(a)})).json();assert(ownerRecs.some(rec=>rec._id===privateRec.id));check('direct and list recommendations inherit private trip policy');
    await Trip.updateOne({_id:createdGpx._id},{$set:{defaultTripVisibility:'followers_only'}});
    assert.equal((await request(`/recommendations/${privateRec.id}`,{headers:headers(f)})).status,200);
    assert.equal((await request(`/recommendations/${privateRec.id}`,{headers:headers(b)})).status,404);check('recommendation detail respects follower access');
    const forgedRec=await Recommendation.create({user:stranger._id,name:'Foreign association fixture',description:'Synthetic',rating:3,primaryCategory:'OTHER',location:{type:'Point',coordinates:[4,50]},associatedTrip:createdGpx._id});
    const forgedList=await (await request(`/v2/recommendations/user/${stranger.id}`,{headers:headers(b)})).json();assert(!JSON.stringify(forgedList).includes(forgedRec.id));check('v2 recommendation profile rejects foreign-trip association');
    await Trip.updateOne({_id:createdGpx._id},{$set:{defaultTripVisibility:'private'}});
    for(const endpoint of ['/search?q=OTHER&type=recommendations','/v2/search?q=OTHER&type=recommendations']) {
      const anonymousSearch=await request(endpoint);assert.equal(anonymousSearch.status,200,await anonymousSearch.clone().text());
      assert(!(await anonymousSearch.json()).some(rec=>rec._id===privateRec.id));
      const ownerSearch=await request(endpoint,{headers:headers(a)});assert.equal(ownerSearch.status,200,await ownerSearch.clone().text());
      assert((await ownerSearch.json()).some(rec=>rec._id===privateRec.id));
    }check('legacy and v2 search hide private recommendations but retain owner access');
    for(const endpoint of ['/search?q=Actual&type=trips','/v2/search?q=Actual&type=trips']) {
      const response=await request(endpoint);assert.equal(response.status,200,await response.clone().text());
      assert(!(await response.json()).some(item=>item._id===createdGpx._id));
    }check('search hides private trip metadata');
    for(const suffix of ['comments','like']) {
      const response=await request(`/trips/${createdGpx._id}/${suffix}`,{method:'POST',headers:{...headers(b),'Content-Type':'application/json'},body:JSON.stringify({text:'Unrelated account fixture'})});
      assert.equal(response.status,404);
    }
    const unchangedPrivate=await Trip.findById(createdGpx._id);assert.equal(unchangedPrivate.comments.length,0);assert.equal(unchangedPrivate.likes.length,0);check('unrelated account cannot comment on or like private trip');
    await Trip.updateOne({_id:createdGpx._id},{$set:{defaultTripVisibility:'followers_only'}});
    assert.equal((await request(`/trips/${createdGpx._id}/like`,{method:'POST',headers:headers(f)})).status,200);
    assert.equal((await request(`/trips/${createdGpx._id}/like`,{method:'POST',headers:headers(f)})).status,400);
    assert.equal((await request(`/trips/${createdGpx._id}/like`,{method:'DELETE',headers:headers(f)})).status,200);check('authorized follower can like and unlike visible trip');
    const logout=await request('/auth/logout',{method:'POST',headers:headers(a)});assert.equal(logout.status,200);assert(logout.headers.getSetCookie().some(x=>x.startsWith('token=none;')));check('logout sends replacement cookie');
    const loggedOutCookies=logout.headers.getSetCookie().map(x=>x.split(';')[0]).join('; ');assert.equal((await request('/auth/me',{headers:{Cookie:loggedOutCookies}})).status,401);check('logout replacement cookie no longer authenticates');
    console.log(`Integration result: ${passed} checks passed against real Mongo/Express/GridFS.`);
  } finally {
    await stop(app);
    if(mongoose.connection.readyState) await mongoose.disconnect();
    await stop(mongo);
    await rm(dir,{recursive:true,force:true});
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
