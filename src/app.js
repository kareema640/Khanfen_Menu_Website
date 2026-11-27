'use strict';

require('dotenv').config();
const express=require('express');
const session=require('express-session');
const helmet=require('helmet');
const rateLimit=require('express-rate-limit');
const path=require('node:path');
const fs=require('node:fs');
const {Pool}=require('pg');
const {getPool,query}=require('./db/pool');
const {router:catalogAuth}=require('./routes/catalog-auth');
const {router:orders}=require('./routes/orders');
const {router:reservationsReviews}=require('./routes/reservations-reviews');
const admin=require('./routes/admin');
const {errorHandler}=require('./middleware/error-handler');
const {AppError}=require('./utils/errors');

const root=path.resolve(__dirname,'..');
const app=express();
app.disable('x-powered-by');
app.set('trust proxy',process.env.TRUST_PROXY ? Number(process.env.TRUST_PROXY) : 1);
app.use(helmet({contentSecurityPolicy:false,crossOriginEmbedderPolicy:false}));
app.use(express.json({limit:'8mb',strict:true}));

const cookieSecure=String(process.env.SESSION_COOKIE_SECURE||'false')==='true';
const sameSite=String(process.env.SESSION_COOKIE_SAMESITE||'lax').toLowerCase();
if(!['lax','strict','none'].includes(sameSite)) throw new Error('SESSION_COOKIE_SAMESITE must be lax, strict, or none.');
if(sameSite==='none'&&!cookieSecure) throw new Error('SameSite=None requires SESSION_COOKIE_SECURE=true.');
if(process.env.NODE_ENV==='production'&&(!process.env.SESSION_SECRET||process.env.SESSION_SECRET.length<32)) throw new Error('Production requires a SESSION_SECRET with at least 32 characters.');
const sessionSecret=process.env.SESSION_SECRET&&process.env.SESSION_SECRET.length>=32?process.env.SESSION_SECRET:require('node:crypto').randomBytes(32).toString('hex');
let sessionStore;
if(process.env.DATABASE_URL){
  const PgStore=require('connect-pg-simple')(session);
  sessionStore=new PgStore({pool:getPool(),tableName:'sessions',createTableIfMissing:false,disableTouch:true,pruneSessionInterval:60});
}
app.use(session({name:'khanfem.sid',secret:sessionSecret,store:sessionStore,resave:false,saveUninitialized:false,rolling:true,cookie:{httpOnly:true,secure:cookieSecure,sameSite,maxAge:(Number(process.env.SESSION_MAX_AGE_DAYS)||7)*86400000,path:'/'}}));

const limiter=options=>rateLimit({windowMs:options.windowMs||15*60_000,limit:options.limit||60,standardHeaders:'draft-8',legacyHeaders:false,message:{error:'Too many requests. Please try again shortly.',code:'RATE_LIMITED'}});
const authLimiter=limiter({limit:10});
const checkoutLimiter=limiter({windowMs:10*60_000,limit:15});
const publicWriteLimiter=limiter({windowMs:10*60_000,limit:20});
const api=express.Router();
api.use((req,res,next)=>{
  if(!['GET','HEAD','OPTIONS'].includes(req.method)){
    const origin=req.get('Origin');
    if(origin){
      const expected=process.env.APP_ORIGIN?new URL(process.env.APP_ORIGIN).origin:`${req.protocol}://${req.get('host')}`;
      if(origin!==expected) return next(new AppError(403,'Request origin is not allowed.','INVALID_ORIGIN'));
    }
  }
  next();
});
api.get('/health',async(_req,res)=>{await query('SELECT 1');res.json({ok:true,database:'connected'});});
api.use('/auth/login',authLimiter);
api.use('/auth/signup',authLimiter);
api.post('/orders',checkoutLimiter);
api.post('/reservations',publicWriteLimiter);
api.post('/reviews',publicWriteLimiter);
api.use(catalogAuth);
api.use(orders);
api.use(reservationsReviews);
api.use(admin);
api.get('/maps-config',(_req,res)=>res.json({mapsEnabled:Boolean(process.env.GOOGLE_MAPS_API_KEY),branch:{name:'Khanfem · Nasr City',address:'Nasr City, Cairo, Egypt',phone:'+201067182487',lat:30.0561,lng:31.3301}}));
api.get('/geocode',async(req,res)=>{
  const address=String(req.query.address||'').trim();
  if(!address) throw new AppError(400,'Address is required.','INVALID_ADDRESS');
  const key=process.env.GOOGLE_MAPS_API_KEY;
  if(!key) return res.json({location:null,quotaExceeded:false});
  const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),3500);
  try{
    const url=`https://geocode.googleapis.com/v4/geocode/address/${encodeURIComponent(address)}?regionCode=eg`;
    const response=await fetch(url,{headers:{'X-Goog-Api-Key':key,'X-Goog-FieldMask':'results.placeId,results.location,results.formattedAddress'},signal:controller.signal});
    const data=await response.json().catch(()=>({}));
    if(!response.ok) return res.json({location:null,quotaExceeded:response.status===429});
    const first=data.results?.[0];const lat=Number(first?.location?.latitude),lng=Number(first?.location?.longitude);
    return res.json({location:Number.isFinite(lat)&&Number.isFinite(lng)?{lat,lng,formattedAddress:first.formattedAddress||address,placeId:first.placeId||''}:null,quotaExceeded:false});
  }catch{return res.json({location:null,quotaExceeded:false});}finally{clearTimeout(timer);}
});
app.use('/api',api);

// Serve database-generated catalog data as the legacy-compatible window.MENU script.
app.get('/js/data.js',async(_req,res,next)=>{
  try{
    const {catalogData}=require('./routes/catalog-auth');
    const data=await catalogData();
    res.type('application/javascript').set('Cache-Control','no-store').send(`window.MENU=${JSON.stringify(data).replace(/</g,'\\u003c')};`);
  }catch(error){next(error);}
});

const publicDirectories=new Set(['assets','css','js','public','uploads','fonts','images']);
const pageFiles=new Set(fs.readdirSync(root).filter(file=>file.endsWith('.html')));
app.use((req,res,next)=>{
  let pathname;
  try{pathname=decodeURIComponent(req.path);}catch{return res.status(400).end();}
  const segments=pathname.split('/').filter(Boolean);
  if(pathname==='/'||pageFiles.has(path.basename(pathname))) return next();
  if(segments.length&&publicDirectories.has(segments[0])) return next();
  return res.status(404).json({error:'Not found.',code:'NOT_FOUND'});
});
app.get('/',(_req,res)=>res.sendFile(path.join(root,'index.html')));
app.use(express.static(root,{dotfiles:'deny',index:false,maxAge:process.env.NODE_ENV==='production'?'1h':0}));
app.use((req,res,next)=>{if(req.path.startsWith('/api/'))return next(new AppError(404,'API route not found.','NOT_FOUND'));return res.status(404).send('Not found');});
app.use(errorHandler);

module.exports=app;
