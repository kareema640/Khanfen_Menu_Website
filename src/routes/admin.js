'use strict';

const express=require('express');
const {z}=require('zod');
const {query,withTransaction}=require('../db/pool');
const {AppError}=require('../utils/errors');
const {requireOwner}=require('../middleware/auth');
const router=express.Router();
router.use('/admin',requireOwner);
const productSchema=z.object({id:z.string().trim().min(1).max(120).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),name:z.string().trim().min(2).max(160),description:z.string().max(2000).optional().default(''),category:z.string().min(1).max(80),price:z.number().finite().min(0).max(100000),image:z.string().max(500).optional().nullable(),available:z.boolean().optional().default(true),active:z.boolean().optional().default(true),featured:z.boolean().optional().default(false)});
const transitions={pending:['confirmed','cancelled'],confirmed:['preparing','cancelled'],preparing:['ready_for_pickup','out_for_delivery','cancelled'],ready_for_pickup:['completed','cancelled'],out_for_delivery:['delivered','cancelled'],delivered:['completed'],completed:[],cancelled:[]};

router.get('/admin/overview',async(_req,res)=>{
  const [counts,revenue,bestsellers,catSales,reservations,rating]=await Promise.all([
    query(`SELECT order_status AS status,count(*)::int AS count FROM orders WHERE is_demo=FALSE GROUP BY order_status`),
    query(`SELECT COALESCE(sum(total_amount),0)::float8 AS total,COALESCE(sum(total_amount) FILTER(WHERE created_at>=date_trunc('day',now())),0)::float8 AS today,COALESCE(sum(total_amount) FILTER(WHERE created_at>=now()-interval '30 days'),0)::float8 AS last30 FROM orders WHERE is_demo=FALSE AND payment_status='paid' AND order_status NOT IN('cancelled')`),
    query(`SELECT oi.product_legacy_id AS id,oi.product_name_snapshot AS name,sum(oi.quantity)::int AS quantity,sum(oi.line_total)::float8 AS sales FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE o.is_demo=FALSE AND o.order_status<>'cancelled' AND o.payment_status NOT IN('failed','refunded') GROUP BY oi.product_legacy_id,oi.product_name_snapshot ORDER BY quantity DESC LIMIT 8`),
    query(`SELECT c.name AS category,sum(oi.quantity)::int AS quantity,sum(oi.line_total)::float8 AS sales FROM order_items oi JOIN orders o ON o.id=oi.order_id JOIN products p ON p.id=oi.product_id JOIN categories c ON c.id=p.category_id WHERE o.is_demo=FALSE AND o.order_status<>'cancelled' AND o.payment_status NOT IN('failed','refunded') GROUP BY c.id,c.name ORDER BY sales DESC`),
    query(`SELECT count(*)::int AS upcoming FROM reservations WHERE reservation_date>=current_date AND status IN('pending','confirmed') AND is_demo=FALSE`),
    query(`SELECT count(*)::int AS count,round(avg(rating)::numeric,2)::float8 AS average FROM reviews WHERE moderation_status='approved' AND is_demo=FALSE`)
  ]);
  const statusCounts=Object.fromEntries(counts.rows.map(row=>[row.status,row.count]));
  res.json({orders:{total:Object.values(statusCounts).reduce((a,b)=>a+b,0),byStatus:statusCounts},revenue:revenue.rows[0],bestSellers:bestsellers.rows,reservationCount:reservations.rows[0].upcoming,categorySales:catSales.rows,rating:{count:rating.rows[0].count,average:Number(rating.rows[0].average||0)}});
});
router.get('/admin/reports',async(req,res)=>{
  const from=String(req.query.from||'').slice(0,10); const to=String(req.query.to||'').slice(0,10);
  if((from&&!/^\d{4}-\d{2}-\d{2}$/.test(from))||(to&&!/^\d{4}-\d{2}-\d{2}$/.test(to))) throw new AppError(400,'Dates must use YYYY-MM-DD.','INVALID_DATE_RANGE');
  const daily=await query(`SELECT day,placed_orders AS orders,paid_orders AS "paidOrders",paid_revenue::float8 AS revenue,pending_cash_value::float8 AS "pendingCashValue" FROM reporting_daily_sales WHERE ($1='' OR day >= $1::date) AND ($2='' OR day <= $2::date) ORDER BY day`,[from,to]);
  const summarize=(step,label)=>{const grouped=new Map();for(const row of daily.rows){const day=row.day instanceof Date?row.day.toISOString().slice(0,10):String(row.day).slice(0,10);const date=new Date(`${day}T00:00:00Z`);let key;if(step==='day')key=day;else if(step==='week'){const weekday=(date.getUTCDay()+6)%7;date.setUTCDate(date.getUTCDate()-weekday);key=date.toISOString().slice(0,10);}else key=`${date.getUTCFullYear()}-${String(date.getUTCMonth()+1).padStart(2,'0')}`;const item=grouped.get(key)||{[label]:key,orders:0,paidOrders:0,revenue:0,pendingCashValue:0};item.orders+=row.orders;item.paidOrders+=row.paidOrders;item.revenue+=row.revenue;item.pendingCashValue+=row.pendingCashValue;grouped.set(key,item);}return [...grouped.values()];};
  res.json({revenueDefinition:'Paid, non-demo orders excluding cancellations; pending cash value is reported separately.',daily:daily.rows,weekly:summarize('week','weekStarting'),monthly:summarize('month','month')});
});
router.get('/admin/orders',async(req,res)=>{
  const status=String(req.query.status||''); const type=String(req.query.fulfillment||''); const search=String(req.query.q||'').trim().slice(0,120); const from=String(req.query.from||'').slice(0,10);const to=String(req.query.to||'').slice(0,10);
  const result=await query(`SELECT o.id,o.order_number AS "orderNumber",o.customer_name AS "customerName",o.customer_phone AS phone,o.fulfillment,o.order_status AS status,o.payment_status AS "paymentStatus",o.payment_method AS "paymentMethod",o.subtotal::float8,o.discount_amount::float8 AS discount,o.delivery_fee::float8 AS fee,o.total_amount::float8 AS total,o.delivery_address AS address,o.customer_notes AS notes,o.created_at AS "createdAt",COALESCE(json_agg(json_build_object('name',i.product_name_snapshot,'qty',i.quantity,'unitPrice',i.unit_price,'lineTotal',i.line_total)) FILTER(WHERE i.id IS NOT NULL),'[]') AS items FROM orders o LEFT JOIN order_items i ON i.order_id=o.id WHERE o.is_demo=FALSE AND ($1='' OR o.order_status=$1) AND ($2='' OR o.fulfillment=$2) AND ($3='' OR o.order_number ILIKE '%'||$3||'%' OR o.customer_name ILIKE '%'||$3||'%' OR o.customer_phone ILIKE '%'||$3||'%') AND ($4='' OR o.created_at::date >= $4::date) AND ($5='' OR o.created_at::date <= $5::date) GROUP BY o.id ORDER BY o.created_at DESC LIMIT 200`,[status,type,search,from,to]);
  res.json({orders:result.rows});
});
router.get('/admin/orders/:id',async(req,res)=>{
  const result=await query(`SELECT o.*,o.id AS order_id FROM orders o WHERE o.id::text=$1 OR o.order_number=$1`,[req.params.id]);
  if(!result.rowCount) throw new AppError(404,'Order not found.','NOT_FOUND'); const order=result.rows[0];
  const [items,history]=await Promise.all([query(`SELECT oi.product_name_snapshot AS name,oi.product_legacy_id AS id,oi.quantity AS qty,oi.unit_price::float8 AS "unitPrice",oi.line_total::float8 AS "lineTotal",oi.size_name AS size,COALESCE(json_agg(json_build_object('id',x.option_id,'label',x.option_label_snapshot,'price',x.unit_price_snapshot)) FILTER(WHERE x.id IS NOT NULL),'[]') AS addons FROM order_items oi LEFT JOIN order_item_options x ON x.order_item_id=oi.id WHERE oi.order_id=$1 GROUP BY oi.id`,[order.id]),query(`SELECT previous_status AS "previousStatus",new_status AS status,note,created_at AS "createdAt" FROM order_status_history WHERE order_id=$1 ORDER BY created_at`,[order.id])]);
  res.json({order:{...order,items:items.rows,history:history.rows}});
});
router.patch('/admin/orders/:id/status',async(req,res)=>{
  const input=z.object({status:z.enum(['confirmed','preparing','ready_for_pickup','out_for_delivery','delivered','completed','cancelled']),note:z.string().trim().max(500).optional().default('')}).parse(req.body);
  const order=await withTransaction(async client=>{
    const found=await client.query(`SELECT * FROM orders WHERE id::text=$1 OR order_number=$1 FOR UPDATE`,[req.params.id]);
    if(!found.rowCount) throw new AppError(404,'Order not found.','NOT_FOUND'); const current=found.rows[0];
    if((current.fulfillment==='pickup'&&input.status==='out_for_delivery')||(current.fulfillment==='delivery'&&input.status==='ready_for_pickup')) throw new AppError(400,'That status does not match the fulfillment type.','INVALID_TRANSITION');
    if(!transitions[current.order_status]?.includes(input.status)) throw new AppError(409,`Cannot change order from ${current.order_status} to ${input.status}.`,'INVALID_TRANSITION');
    const updated=(await client.query(`UPDATE orders SET order_status=$2,updated_at=now() WHERE id=$1 RETURNING *`,[current.id,input.status])).rows[0];
    await client.query(`INSERT INTO order_status_history(order_id,previous_status,new_status,changed_by,note) VALUES($1,$2,$3,$4,$5)`,[current.id,current.order_status,input.status,req.session.user.id,input.note]);
    const title=`Order ${input.status.replaceAll('_',' ')}`;
    await client.query(`INSERT INTO notifications(user_id,order_id,guest_token_hash,event_key,notification_type,title,message) VALUES($1,$2,$3,$4,'order_status',$5,$6) ON CONFLICT(order_id,event_key) DO NOTHING`,[current.user_id,current.id,current.tracking_token_hash,`status:${input.status}`,title,`Order ${current.order_number} is now ${input.status.replaceAll('_',' ')}.`]);
    return updated;
  });
  res.json({order:{id:order.id,orderNumber:order.order_number,status:order.order_status,updatedAt:order.updated_at}});
});
router.patch('/admin/orders/:id/payment',async(req,res)=>{
  const status=z.object({status:z.enum(['paid','failed','refunded'])}).parse(req.body).status;
  const result=await withTransaction(async client=>{
    const order=await client.query(`SELECT id FROM orders WHERE id::text=$1 OR order_number=$1 FOR UPDATE`,[req.params.id]);
    if(!order.rowCount) throw new AppError(404,'Order not found.','NOT_FOUND');
    await client.query(`UPDATE orders SET payment_status=$2,updated_at=now() WHERE id=$1`,[order.rows[0].id,status]);
    await client.query(`UPDATE payments SET payment_status=$2,updated_at=now() WHERE order_id=$1`,[order.rows[0].id,status]);
    return order.rows[0].id;
  }); res.json({orderId:result,paymentStatus:status});
});

router.get('/admin/products',async(_req,res)=>{const r=await query(`SELECT p.legacy_id AS id,p.slug,p.name,p.description,p.price::float8 AS price,p.image_path AS image,p.is_active AS active,p.is_available AS available,p.is_featured AS featured,c.slug AS category FROM products p JOIN categories c ON c.id=p.category_id ORDER BY p.created_at DESC`);res.json({products:r.rows});});
async function saveProduct(input,legacyId=null){
  const category=await query(`SELECT id FROM categories WHERE slug=$1 AND is_active=TRUE`,[input.category]); if(!category.rowCount) throw new AppError(400,'Choose an active category.','INVALID_CATEGORY');
  if(legacyId){const r=await query(`UPDATE products SET name=$2,description=$3,category_id=$4,price=$5,image_path=$6,is_active=$7,is_available=$8,is_featured=$9,updated_at=now() WHERE legacy_id=$1 RETURNING legacy_id AS id,name,price::float8 AS price`,[legacyId,input.name,input.description,category.rows[0].id,input.price,input.image||null,input.active,input.available,input.featured]);if(!r.rowCount)throw new AppError(404,'Product not found.','NOT_FOUND');return r.rows[0];}
  const r=await query(`INSERT INTO products(legacy_id,slug,name,description,category_id,price,image_path,is_active,is_available,is_featured) VALUES($1,$1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING legacy_id AS id,name,price::float8 AS price`,[input.id,input.name,input.description,category.rows[0].id,input.price,input.image||null,input.active,input.available,input.featured]);return r.rows[0];
}
router.post('/admin/products',async(req,res)=>{const item=await saveProduct(productSchema.parse(req.body));res.status(201).json({product:item});});
router.patch('/admin/products/:id',async(req,res)=>{const input=productSchema.partial().parse(req.body);const current=await query(`SELECT p.legacy_id AS id,p.slug,p.name,p.description,p.price::float8 AS price,p.image_path AS image,p.is_active AS active,p.is_available AS available,p.is_featured AS featured,c.slug AS category FROM products p JOIN categories c ON c.id=p.category_id WHERE p.legacy_id=$1`,[req.params.id]);if(!current.rowCount)throw new AppError(404,'Product not found.','NOT_FOUND');const item=await saveProduct({...current.rows[0],...input},req.params.id);res.json({product:item});});
router.delete('/admin/products/:id',async(req,res)=>{const r=await query(`DELETE FROM products WHERE legacy_id=$1 RETURNING legacy_id`,[req.params.id]);if(!r.rowCount)throw new AppError(404,'Product not found.','NOT_FOUND');res.status(204).end();});
router.get('/admin/categories',async(_req,res)=>{const r=await query(`SELECT c.slug AS id,c.name,c.description,c.is_active AS active,c.is_group AS "isGroup",p.slug AS parent FROM categories c LEFT JOIN categories p ON p.id=c.parent_id ORDER BY c.sort_order,c.name`);res.json({categories:r.rows});});
router.post('/admin/categories',async(req,res)=>{const v=z.object({id:z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),name:z.string().trim().min(2).max(100),description:z.string().max(1000).optional().default(''),parent:z.string().optional().nullable(),active:z.boolean().optional().default(true),isGroup:z.boolean().optional().default(false)}).parse(req.body);const r=await query(`INSERT INTO categories(slug,name,description,parent_id,is_active,is_group) VALUES($1,$2,$3,(SELECT id FROM categories WHERE slug=$4),$5,$6) RETURNING slug AS id,name`,[v.id,v.name,v.description,v.parent||null,v.active,v.isGroup]);res.status(201).json({category:r.rows[0]});});

router.get('/admin/reservations',async(req,res)=>{const status=String(req.query.status||'');const date=String(req.query.date||'').slice(0,10);const q=String(req.query.q||'').slice(0,100);const r=await query(`SELECT id,reservation_number AS "reservationNumber",customer_name AS "customerName",customer_phone AS phone,customer_email AS email,party_size AS guests,party_size_label AS "guestsLabel",reservation_date AS date,reservation_time AS time,status,special_requests AS "specialRequests",occasion,pre_order_total::float8 AS "preOrderTotal",created_at AS "createdAt" FROM reservations WHERE is_demo=FALSE AND ($1='' OR status=$1) AND ($2='' OR reservation_date=$2::date) AND ($3='' OR reservation_number ILIKE '%'||$3||'%' OR customer_name ILIKE '%'||$3||'%' OR customer_phone ILIKE '%'||$3||'%') ORDER BY reservation_date,reservation_time LIMIT 300`,[status,date,q]);res.json({reservations:r.rows});});
router.patch('/admin/reservations/:id/status',async(req,res)=>{const status=z.object({status:z.enum(['confirmed','rejected','cancelled','completed'])}).parse(req.body).status;const r=await query(`UPDATE reservations SET status=$2,updated_at=now() WHERE id=$1 RETURNING id,reservation_number AS "reservationNumber",status`,[req.params.id,status]);if(!r.rowCount)throw new AppError(404,'Reservation not found.','NOT_FOUND');res.json({reservation:r.rows[0]});});
router.get('/admin/reviews',async(req,res)=>{const status=String(req.query.status||'pending');const r=await query(`SELECT id,customer_name AS name,customer_email AS email,rating,review_text AS review,moderation_status AS status,is_demo AS "isDemo",created_at AS "createdAt" FROM reviews WHERE ($1='' OR moderation_status=$1) ORDER BY created_at DESC LIMIT 300`,[status]);res.json({reviews:r.rows});});
router.patch('/admin/reviews/:id/moderation',async(req,res)=>{const status=z.object({status:z.enum(['approved','rejected'])}).parse(req.body).status;const r=await query(`UPDATE reviews SET moderation_status=$2,updated_at=now() WHERE id=$1 RETURNING id,moderation_status AS status`,[req.params.id,status]);if(!r.rowCount)throw new AppError(404,'Review not found.','NOT_FOUND');res.json({review:r.rows[0]});});
router.patch('/admin/settings',async(req,res)=>{const v=z.object({currencyCode:z.string().length(3).optional(),deliveryFee:z.number().min(0).max(100000).optional(),pickupFee:z.number().min(0).max(100000).optional(),largeSizeSurcharge:z.number().min(0).max(100000).optional(),reservationSlotMinutes:z.number().int().min(15).max(240).optional(),reservationDurationMinutes:z.number().int().min(15).max(480).optional(),maxReservationsPerSlot:z.number().int().min(1).max(100).optional(),maxPartySize:z.number().int().min(1).max(100).optional()}).parse(req.body);const cols={currencyCode:'currency_code',deliveryFee:'delivery_fee',pickupFee:'pickup_fee',largeSizeSurcharge:'large_size_surcharge',reservationSlotMinutes:'reservation_slot_minutes',reservationDurationMinutes:'reservation_duration_minutes',maxReservationsPerSlot:'max_reservations_per_slot',maxPartySize:'max_party_size'};for(const [key,value]of Object.entries(v))await query(`UPDATE restaurant_settings SET ${cols[key]}=$1,updated_at=now() WHERE id=1`,[value]);res.json({ok:true});});

module.exports=router;
