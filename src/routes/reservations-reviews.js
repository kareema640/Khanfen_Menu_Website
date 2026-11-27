'use strict';

const express = require('express');
const { z } = require('zod');
const { query, withTransaction } = require('../db/pool');
const { AppError } = require('../utils/errors');
const { requireOwner } = require('../middleware/auth');

const router = express.Router();
const reservationSchema = z.object({ guests:z.string().regex(/^(?:[1-7]|8\+)$/), date:z.string().regex(/^\d{4}-\d{2}-\d{2}$/), time:z.string().regex(/^\d{1,2}:[0-5]0$/), fullName:z.string().trim().min(2).max(120), phone:z.string().trim().min(7).max(30), email:z.string().trim().email().max(254), specialRequests:z.string().trim().max(1000).optional().default(''), occasion:z.string().trim().max(80).optional().default(''), preOrder:z.array(z.object({id:z.string().min(1).max(120),qty:z.number().int().min(1).max(50)})).max(30).optional().default([]) });
const reviewSchema = z.object({name:z.string().trim().min(2).max(120),email:z.string().trim().email().max(254).optional().or(z.literal('')),rating:z.number().int().min(1).max(5),review:z.string().trim().min(20).max(500),photoDataUrl:z.string().max(7_100_000).optional().default(''),clientRequestId:z.string().trim().min(12).max(128)});
const timeToMinutes = value => { const [h,m]=String(value).slice(0,5).split(':').map(Number); return h*60+m; };
const toSlot = mins => `${Math.floor(mins/60)}:${String(mins%60).padStart(2,'0')}`;

async function getAvailability(client,date) {
  const d=new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) throw new AppError(400,'Valid date is required.','INVALID_DATE');
  const weekday=d.getUTCDay();
  const [hoursResult,settingsResult]=await Promise.all([
    client.query(`SELECT opens_at::text,closes_at::text,is_closed FROM restaurant_hours WHERE weekday=$1`,[weekday]),
    client.query(`SELECT reservation_slot_minutes AS slot_minutes,reservation_duration_minutes AS duration,max_reservations_per_slot AS capacity FROM restaurant_settings WHERE id=1`)
  ]);
  const hours=hoursResult.rows[0]; const settings=settingsResult.rows[0];
  if (!hours||hours.is_closed) return {slots:[],unavailableSlots:[]};
  const open=timeToMinutes(hours.opens_at); const close=timeToMinutes(hours.closes_at);
  const slots=[];
  for(let m=open;m<close;m+=Number(settings.slot_minutes)) slots.push(toSlot(m));
  const busy=await client.query(`SELECT reservation_time::text AS starts,duration_minutes FROM reservations WHERE reservation_date=$1 AND status IN ('pending','confirmed')`,[date]);
  const unavailableSlots=[];
  for(const slot of slots) {
    const start=timeToMinutes(slot); const end=start+Number(settings.duration);
    if(end>close) { unavailableSlots.push(slot); continue; }
    const overlapping=busy.rows.filter(row=>{
      const bStart=timeToMinutes(row.starts), bEnd=bStart+Number(row.duration_minutes);
      return bStart<end && bEnd>start;
    }).length;
    if(overlapping>=Number(settings.capacity)) unavailableSlots.push(slot);
  }
  return {slots,unavailableSlots};
}

router.get('/reservations/availability',async(req,res)=>{
  const date=String(req.query.date||'');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new AppError(400,'Valid date (YYYY-MM-DD) is required.','INVALID_DATE');
  const result=await getAvailability({query},date);
  res.json({date,...result});
});
router.post('/reservations',async(req,res)=>{
  const input=reservationSchema.parse(req.body);
  if(input.date<new Date().toISOString().slice(0,10)) throw new AppError(400,'Reservation date cannot be in the past.','INVALID_DATE');
  const partySize=input.guests==='8+'?8:Number(input.guests);
  const reference=`KF-${require('node:crypto').randomBytes(3).toString('hex').toUpperCase()}`;
  const reservation=await withTransaction(async client=>{
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1),0)',[input.date]);
    const avail=await getAvailability(client,input.date);
    if(!avail.slots.includes(input.time)||avail.unavailableSlots.includes(input.time)) throw new AppError(409,'This time is no longer available. Choose another time.','SLOT_UNAVAILABLE');
    const setting=(await client.query(`SELECT reservation_duration_minutes,max_party_size,currency_code FROM restaurant_settings WHERE id=1`)).rows[0];
    if(partySize>Number(setting.max_party_size)) throw new AppError(400,'Party size exceeds the restaurant limit.','PARTY_TOO_LARGE');
    const ids=[...new Set(input.preOrder.map(item=>item.id))];
    const products=ids.length?await client.query(`SELECT id,legacy_id,name,price::float8 AS price FROM products WHERE legacy_id=ANY($1::text[]) AND is_active AND is_available FOR SHARE`,[ids]):{rows:[]};
    const productMap=new Map(products.rows.map(item=>[item.legacy_id,item]));
    if(productMap.size!==ids.length) throw new AppError(400,'One or more pre-order items are unavailable.','PRODUCT_UNAVAILABLE');
    let total=0; const priced=input.preOrder.map(line=>{const p=productMap.get(line.id);const lineTotal=Math.round(Number(p.price)*line.qty*100)/100;total+=lineTotal;return {p,line,lineTotal};});
    const inserted=await client.query(`INSERT INTO reservations(reservation_number,user_id,customer_name,customer_phone,customer_email,party_size,party_size_label,reservation_date,reservation_time,duration_minutes,special_requests,occasion,pre_order_total)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,[reference,req.session?.user?.id||null,input.fullName,input.phone,input.email,partySize,input.guests,input.date,input.time,setting.reservation_duration_minutes,input.specialRequests,input.occasion,total]);
    for(const line of priced) await client.query(`INSERT INTO reservation_items(reservation_id,product_id,product_legacy_id,product_name_snapshot,quantity,unit_price,line_total) VALUES($1,$2,$3,$4,$5,$6,$7)`,[inserted.rows[0].id,line.p.id,line.p.legacy_id,line.p.name,line.line.qty,line.p.price,line.lineTotal]);
    return {...inserted.rows[0],preOrder:priced.map(({p,line,lineTotal})=>({id:p.legacy_id,name:p.name,qty:line.qty,unitPrice:Number(p.price),lineTotal})),preOrderTotal:total};
  });
  res.status(201).json({reservation:{reservationNumber:reservation.reservation_number,guests:reservation.party_size_label,date:reservation.reservation_date.toISOString().slice(0,10),time:String(reservation.reservation_time).slice(0,5),fullName:reservation.customer_name,phone:reservation.customer_phone,email:reservation.customer_email,specialRequests:reservation.special_requests,occasion:reservation.occasion,preOrder:reservation.preOrder,preOrderTotal:Number(reservation.preOrderTotal),status:reservation.status,createdAt:reservation.created_at}});
});

router.get('/reviews',async(_req,res)=>{
  const [reviews,stats]=await Promise.all([
    query(`SELECT id,customer_name AS name,rating,review_text AS review,CASE WHEN photo_data IS NULL THEN photo_url ELSE '/api/reviews/'||id::text||'/photo' END AS "photoUrl",created_at AS "createdAt" FROM reviews WHERE moderation_status='approved' AND is_demo=FALSE ORDER BY created_at DESC LIMIT 50`),
    query(`SELECT count(*)::int AS count,round(avg(rating)::numeric,2)::float8 AS average FROM reviews WHERE moderation_status='approved' AND is_demo=FALSE`)
  ]);
  res.json({reviews:reviews.rows,stats:{count:stats.rows[0].count,average:Number(stats.rows[0].average||0)}});
});
router.post('/reviews',async(req,res)=>{
  const input=reviewSchema.parse(req.body); const key=`customer-review:${input.clientRequestId}`;
  let bytes=null,mime=null;
  if(input.photoDataUrl){
    const match=/^data:(image\/(?:jpeg|png));base64,([A-Za-z0-9+/=]+)$/.exec(input.photoDataUrl);
    if(!match) throw new AppError(400,'Uploaded images must be JPG or PNG.','INVALID_IMAGE');
    bytes=Buffer.from(match[2],'base64'); mime=match[1];
    if(bytes.length>5*1024*1024) throw new AppError(400,'Image must be no larger than 5 MB.','IMAGE_TOO_LARGE');
  }
  const inserted=await query(`INSERT INTO reviews(customer_name,customer_email,rating,review_text,moderation_status,idempotency_key,photo_mime,photo_data,photo_bytes)
    VALUES($1,$2,$3,$4,'pending',$5,$6,$7,$8) ON CONFLICT(idempotency_key) DO NOTHING RETURNING id,customer_name AS name,rating,review_text AS review,created_at AS "createdAt",moderation_status AS status`,[input.name,input.email||null,input.rating,input.review,key,mime,bytes,bytes?.length||null]);
  let review=inserted.rows[0];
  if(!review){const existing=await query(`SELECT id,customer_name AS name,rating,review_text AS review,created_at AS "createdAt",moderation_status AS status FROM reviews WHERE idempotency_key=$1`,[key]);review=existing.rows[0];}
  res.status(inserted.rowCount?201:200).json({review:{...review,photoUrl:bytes?`/api/reviews/${review.id}/photo`:null}});
});
router.get('/reviews/:id/photo',async(req,res)=>{
  const result=await query(`SELECT photo_mime,photo_data FROM reviews WHERE id=$1 AND moderation_status='approved' AND is_demo=FALSE`,[req.params.id]);
  if(!result.rowCount||!result.rows[0].photo_data) throw new AppError(404,'Review photo not found.','NOT_FOUND');
  res.set('Content-Type',result.rows[0].photo_mime).set('Cache-Control','public, max-age=3600').send(result.rows[0].photo_data);
});

module.exports={router,getAvailability};
