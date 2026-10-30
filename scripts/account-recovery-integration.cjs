// Disposable loopback database and synthetic SMTP only. Never accepts a DB URI.
const assert = require('node:assert/strict');
const {spawn} = require('node:child_process');
const {mkdtemp, rm} = require('node:fs/promises');
const {existsSync} = require('node:fs');
const {tmpdir} = require('node:os');
const path = require('node:path');
const net = require('node:net');
const mongoose = require('mongoose');
const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function main() {
 assert(process.env.MONGOD_BINARY, 'Provide official MONGOD_BINARY');
 assert(!existsSync(path.join(__dirname, '../.env')), 'Do not load live environment');
 const dir = await mkdtemp(path.join(tmpdir(), 'travel-account-recovery-'));
 const portServer = net.createServer(); await new Promise(r => portServer.listen(0, '127.0.0.1', r));
 const port = portServer.address().port; await new Promise(r => portServer.close(r));
 const mongo = spawn(process.env.MONGOD_BINARY, ['--dbpath', dir, '--bind_ip', '127.0.0.1', '--port', String(port), '--nounixsocket', '--wiredTigerCacheSizeGB', '0.25'], {env:{PATH:process.env.PATH}, stdio:['ignore','pipe','pipe']});
 let logs=''; mongo.stdout.on('data', c => logs+=c); mongo.stderr.on('data', c => logs+=c);
 let server;
 try {
  for(let i=0;i<100 && !logs.includes('Waiting for connections');i++) { assert.equal(mongo.exitCode,null,logs); await sleep(100); }
  await mongoose.connect(`mongodb://127.0.0.1:${port}/account_recovery_fixture`, {serverSelectionTimeoutMS:5000});
  Object.assign(process.env, {NODE_ENV:'test',JWT_SECRET:'public-fixture-not-a-real-secret',JWT_COOKIE_EXPIRE:'1',FRONTEND_URL:'https://example.invalid',EMAIL_VERIFICATION_TOKEN_EXPIRE_MINUTES:'60'});
  const deliveries=[]; let smtpFails=false;
  const mailPath=require.resolve('../utils/sendEmail');
  require.cache[mailPath]={id:mailPath,filename:mailPath,loaded:true,exports:async message=>{deliveries.push(message);if(smtpFails)throw Error('Synthetic ambiguous SMTP failure');}};
  const User=require('../models/User'); await User.init();
  const express=require('express'); const app=express(); app.use(express.json()); app.use(require('cookie-parser')()); app.use('/users',require('../routes/userRoutes')); app.use('/auth',require('../routes/authRoutes'));
  const {protectOptional}=require('../middleware/authMiddleware');
  app.get('/optional',protectOptional,(req,res)=>res.json({id:req.user?String(req.user._id):null}));
  app.use((err,req,res,next)=>res.status(res.statusCode>=400?res.statusCode:500).json({message:err.message}));
  server=app.listen(0,'127.0.0.1'); await new Promise(r=>server.once('listening',r));
  const base=`http://127.0.0.1:${server.address().port}`;
  async function call(route,method='GET',body,token) {const res=await fetch(base+route,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(10000)});return {status:res.status,body:await res.json()};}
  const email='traveller+route@example.technology', password='fixture-password';
  smtpFails=true;
  let result=await call('/auth/register','POST',{username:'Traveller',email,password}); assert.equal(result.status,503); assert.match(result.body.message,/account was created/);
  let user=await User.findOne({email}).select('+emailVerificationToken +emailVerificationExpires +emailVerificationLastSentAt');
  assert(user.emailVerificationToken);assert(user.emailVerificationExpires>Date.now());
  const firstToken=deliveries[0].text.split('/').pop();
  assert.equal(user.emailVerificationToken,crypto.createHash('sha256').update(firstToken).digest('hex'));
  // Incorrect password neither reveals unverified state nor triggers email.
  result=await call('/auth/login','POST',{email,password:'wrong-password'});assert.equal(result.status,401);assert.equal(deliveries.length,1);
  smtpFails=false;
  result=await call('/auth/login','POST',{email,password});assert.equal(result.status,403);assert.match(result.body.message,/one minute/);assert.equal(deliveries.length,1);
  // The link potentially delivered before SMTP failure remains usable.
  result=await call('/auth/verifyemail/'+firstToken);assert.equal(result.status,200);const legacyToken=result.body.token;
  assert.equal((await call('/auth/me','GET',null,legacyToken)).status,200);
  // Existing stranded account has no token: two concurrent logins send once.
  await User.updateOne({_id:user._id},{$set:{isEmailVerified:false},$unset:{emailVerificationLastSentAt:'',emailVerificationToken:'',emailVerificationExpires:''}});
  const attempts=await Promise.all([call('/auth/login','POST',{email,password}),call('/auth/login','POST',{email,password})]);
  assert(attempts.every(r=>r.status===403));assert.equal(deliveries.length,2);
  assert.equal((await call('/auth/verifyemail/'+firstToken)).status,400);
  const currentToken=deliveries[1].text.split('/').pop();assert.equal((await call('/auth/verifyemail/'+currentToken)).status,200);
  assert.equal((await call('/auth/verifyemail/'+currentToken)).status,400);
  // Simulate an emailed reset token, never send real mail.
  const resetToken='synthetic-reset-token';
  await User.updateOne({_id:user._id},{$set:{passwordResetToken:crypto.createHash('sha256').update(resetToken).digest('hex'),passwordResetExpires:new Date(Date.now()+60000)}});
  assert.equal((await call('/auth/resetpassword/'+resetToken,'PUT',{password:'short'})).status,400);
  assert.equal((await call('/auth/resetpassword/not-the-token','PUT',{password:'new-fixture-password'})).status,400);
  await User.updateOne({_id:user._id},{$set:{passwordResetExpires:new Date(Date.now()-1000)}});
  assert.equal((await call('/auth/resetpassword/'+resetToken,'PUT',{password:'new-fixture-password'})).status,400);
  assert.equal((await call('/auth/me','GET',null,legacyToken)).status,200);
  await User.updateOne({_id:user._id},{$set:{passwordResetExpires:new Date(Date.now()+60000)}});
  const resets=await Promise.all([call('/auth/resetpassword/'+resetToken,'PUT',{password:'new-fixture-password'}),call('/auth/resetpassword/'+resetToken,'PUT',{password:'new-fixture-password'})]);
  assert.deepEqual(resets.map(r=>r.status).sort(),[200,400]);
  assert.equal((await call('/auth/resetpassword/'+resetToken,'PUT',{password:'another-password'})).status,400);
  assert.equal((await call('/auth/me','GET',null,legacyToken)).status,401);
  assert.equal((await call('/optional','GET',null,legacyToken)).body.id,null);
  assert.equal((await call('/auth/login','POST',{email,password})).status,401);
  const login=await call('/auth/login','POST',{email,password:'new-fixture-password'});assert.equal(login.status,200);assert(jwt.decode(login.body.token).sessionVersion);
  assert.equal((await call('/auth/me','GET',null,login.body.token)).status,200);
  assert.equal((await call('/optional','GET',null,login.body.token)).body.id,String(user._id));
  const profileResponse=await fetch(base+'/users/me',{method:'PUT',headers:{'Content-Type':'application/json',Cookie:`token=${login.body.token}`},body:JSON.stringify({bio:'Synthetic profile update'})});
  assert.equal(profileResponse.status,200); const profile=await profileResponse.json();
  assert.equal(profile.token,login.body.token); assert.equal(profile.sessionVersion,undefined);
  assert.equal((await call('/auth/me','GET',null,profile.token)).status,200);
  user=await User.findById(user._id).select('+password +sessionVersion +passwordResetToken');assert(await user.matchPassword('new-fixture-password'));assert.equal(user.passwordResetToken,undefined);
  console.log('PASS: SMTP-failure recovery, retained delivery token, credential gate, atomic resend cooldown, legacy sessions, single-use verification, concurrent reset/replay, password hashing and required/optional session revocation');
 } finally {
  if(server)await new Promise(r=>server.close(r));
  await mongoose.disconnect();
  if(mongo.exitCode===null){mongo.kill('SIGTERM');await new Promise(r=>mongo.once('exit',r));}
  await rm(dir,{recursive:true,force:true});
 }
}
main().catch(err=>{console.error(err);process.exitCode=1;});
