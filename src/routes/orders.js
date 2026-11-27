'use strict';

const express = require('express');
const crypto = require('node:crypto');
const { z } = require('zod');
const { query, withTransaction } = require('../db/pool');
const { AppError } = require('../utils/errors');
const { requireUser } = require('../middleware/auth');

const router = express.Router();
const schema = z.object({
  items: z.array(z.object({ id: z.string().min(1).max(120), qty: z.number().int().min(1).max(99), size: z.enum(['Regular','Large']).default('Regular'), addons: z.array(z.string().max(80)).max(8).default([]) })).min(1).max(40),
  fulfillment: z.enum(['delivery','pickup']), fullName: z.string().trim().min(2).max(120), phone: z.string().trim().min(7).max(30), email: z.string().trim().email().max(254).optional().or(z.literal('')),
  address: z.string().trim().max(400).optional().default(''), instructions: z.string().trim().max(300).optional().default(''), pickupTime: z.string().trim().max(40).optional().default(''), notes: z.string().trim().max(500).optional().default(''), promoCode: z.string().trim().max(40).optional().default(''), paymentMethod: z.string().trim().max(40)
});
const round = value => Math.round((Number(value) + Number.EPSILON) * 100) / 100;
const sha = value => crypto.createHash('sha256').update(value).digest('hex');

function publicOrder(order, items, history, trackingToken) {
  const sequence = order.fulfillment === 'pickup'
    ? ['pending','confirmed','preparing','ready_for_pickup','completed']
    : ['pending','confirmed','preparing','out_for_delivery','delivered','completed'];
  const labelMap = { pending:'Order Received', confirmed:'Confirmed', preparing:'Being Prepared', ready_for_pickup:'Ready for Pickup', out_for_delivery:'On the Way', delivered:'Delivered', completed:'Completed', cancelled:'Cancelled' };
  const timeline = sequence.map(status => {
    const event = history.find(item => item.new_status === status);
    return { key: status, label: labelMap[status], description: status === 'preparing' ? 'Fresh from our kitchen' : labelMap[status], timestamp: event?.created_at || null, completed: Boolean(event), current: order.order_status === status };
  });
  if (order.order_status === 'cancelled') timeline.push({ key:'cancelled', label:'Cancelled', description:'This order was cancelled', timestamp: history.find(item => item.new_status === 'cancelled')?.created_at || null, completed:true, current:true });
  return {
    orderNumber: order.order_number, fulfillment: order.fulfillment, orderStatus: order.order_status, paymentStatus: order.payment_status,
    fullName: order.customer_name, phone: order.customer_phone, email: order.customer_email,
    address: order.delivery_address || '', instructions: order.delivery_instructions, pickupTime: order.pickup_time,
    pickupLocation: order.fulfillment === 'pickup' ? 'Khanfem · Nasr City, Cairo' : '',
    items: items.map(item => ({ id:item.product_legacy_id, name:item.product_name_snapshot, size:item.size_name, addons:item.options, unitPrice:Number(item.unit_price), qty:item.quantity, lineTotal:Number(item.line_total) })),
    subtotal:Number(order.subtotal), promoCode:order.promo_code || '', discount:Number(order.discount_amount), fee:Number(order.delivery_fee), total:Number(order.total_amount),
    payment:{ method:order.payment_method }, etaMinMinutes:order.fulfillment==='delivery'?25:15, etaMaxMinutes:order.fulfillment==='delivery'?35:20,
    estimatedArrivalAt:order.estimated_arrival_at, createdAt:order.created_at,
    tracking:{ status:order.order_status, statusLabel:labelMap[order.order_status], stageIndex:Math.max(0,sequence.indexOf(order.order_status)), timeline },
    ...(trackingToken ? { trackingToken } : {})
  };
}

async function loadItems(client, orderId) {
  const result = await client.query(`SELECT oi.product_legacy_id,oi.product_name_snapshot,oi.size_name,oi.quantity,oi.unit_price,oi.line_total,
    COALESCE(json_agg(json_build_object('id',oio.option_id,'label',oio.option_label_snapshot,'price',oio.unit_price_snapshot) ORDER BY oio.option_id) FILTER (WHERE oio.id IS NOT NULL),'[]') AS options
    FROM order_items oi LEFT JOIN order_item_options oio ON oio.order_item_id=oi.id WHERE oi.order_id=$1 GROUP BY oi.id ORDER BY oi.created_at,oi.product_name_snapshot`, [orderId]);
  return result.rows.map(row => ({ ...row, options:typeof row.options==='string'?JSON.parse(row.options):row.options }));
}

router.post('/orders', async (req, res) => {
  const input = schema.parse(req.body);
  if (input.fulfillment === 'delivery' && input.address.length < 5) throw new AppError(400, 'Please enter your delivery address.', 'INVALID_ADDRESS');
  if (input.fulfillment === 'pickup' && !['ASAP · 15 min','9:15','9:30','9:45'].includes(input.pickupTime)) throw new AppError(400, 'Please select a pickup time.', 'INVALID_PICKUP_TIME');
  const allowed = input.fulfillment === 'delivery' ? 'cash-delivery' : 'cash-pickup';
  if (input.paymentMethod !== allowed) throw new AppError(400, 'Online card and wallet payments are unavailable until a payment provider is configured. Choose cash.', 'PAYMENT_NOT_CONFIGURED');
  const idempotencyKey = String(req.get('Idempotency-Key') || '').trim();
  if (!/^[A-Za-z0-9._:-]{16,128}$/.test(idempotencyKey)) throw new AppError(400, 'A valid Idempotency-Key is required.', 'IDEMPOTENCY_KEY_REQUIRED');
  const requestHash = sha(JSON.stringify(input));
  const rawToken = crypto.randomBytes(32).toString('base64url');
  const tokenHash = sha(rawToken);

  const response = await withTransaction(async client => {
    const keyResult = await client.query(`INSERT INTO idempotency_keys(idempotency_key,request_hash,resource_type)
      VALUES($1,$2,'order') ON CONFLICT(idempotency_key) DO UPDATE SET idempotency_key=EXCLUDED.idempotency_key
      RETURNING request_hash,response_payload`, [idempotencyKey,requestHash]);
    const keyRow = keyResult.rows[0];
    if (keyRow.request_hash !== requestHash) throw new AppError(409, 'This checkout key was already used for different order details.', 'IDEMPOTENCY_CONFLICT');
    if (keyRow.response_payload) return keyRow.response_payload;

    const ids = [...new Set(input.items.map(item => item.id))];
    const productResult = await client.query(`SELECT p.id,p.legacy_id,p.slug,p.name,p.description,p.price::float8 AS price,p.currency_code,p.is_available,p.is_active,c.slug AS category
      FROM products p JOIN categories c ON c.id=p.category_id WHERE p.legacy_id=ANY($1::text[]) FOR UPDATE OF p`, [ids]);
    const productMap = new Map(productResult.rows.map(product => [product.legacy_id,product]));
    if (productMap.size !== ids.length) throw new AppError(400, 'One or more menu items no longer exist.', 'PRODUCT_NOT_FOUND');
    for (const product of productMap.values()) if (!product.is_active || !product.is_available) throw new AppError(409, `${product.name} is currently unavailable.`, 'PRODUCT_UNAVAILABLE');

    const addonIds = [...new Set(input.items.flatMap(item => item.addons))];
    const addonResult = addonIds.length ? await client.query(`SELECT id,label,price::float8 AS price,group_key,is_active FROM addons WHERE id=ANY($1::text[])`,[addonIds]) : { rows:[] };
    const addonMap = new Map(addonResult.rows.map(addon => [addon.id,addon]));
    if (addonMap.size !== addonIds.length || addonResult.rows.some(addon => !addon.is_active)) throw new AppError(400, 'One or more add-ons are no longer available.', 'INVALID_ADDON');
    const settingsResult = await client.query(`SELECT currency_code,delivery_fee::float8 AS delivery_fee,pickup_fee::float8 AS pickup_fee,large_size_surcharge::float8 AS large_surcharge FROM restaurant_settings WHERE id=1`);
    const settings = settingsResult.rows[0];
    let subtotal=0;
    const priced=[];
    for (const line of input.items) {
      const product=productMap.get(line.id); const chosen=[...new Set(line.addons)];
      const validGroups=product.category==='hot-drinks'||product.category==='cold-drinks'?['drink']:(product.category==='bakery'||product.category==='desserts'?['sweet','savory']:['savory']);
      const addons=chosen.map(id=>addonMap.get(id));
      if (addons.some(addon=>!validGroups.includes(addon.group_key))) throw new AppError(400, 'An add-on is not valid for this menu item.', 'INVALID_ADDON');
      const addonTotal=addons.reduce((sum,a)=>sum+Number(a.price),0);
      const unit=round(Number(product.price)+(line.size==='Large'?Number(settings.large_surcharge):0)+addonTotal);
      const lineTotal=round(unit*line.qty); subtotal=round(subtotal+lineTotal);
      priced.push({ product,line,addons,unit,lineTotal });
    }

    let fee=input.fulfillment==='delivery'?Number(settings.delivery_fee):Number(settings.pickup_fee);
    let discount=0; let promoCode=null;
    if (input.promoCode) {
      const promoResult=await client.query(`SELECT code,discount_type,discount_value::float8 AS discount_value,minimum_subtotal::float8 AS minimum_subtotal
        FROM promotions WHERE code=upper($1) AND is_active=TRUE AND (starts_at IS NULL OR starts_at<=now()) AND (ends_at IS NULL OR ends_at>now())`,[input.promoCode]);
      const promo=promoResult.rows[0];
      if (!promo || subtotal<Number(promo.minimum_subtotal)) throw new AppError(400,'The promo code is invalid or the order does not meet its minimum.','INVALID_PROMO');
      promoCode=promo.code;
      if (promo.discount_type==='percent') discount=round(subtotal*Number(promo.discount_value)/100);
      else if (promo.discount_type==='fixed') discount=Math.min(subtotal,Number(promo.discount_value));
      else if (promo.discount_type==='free_delivery'&&input.fulfillment==='delivery') fee=0;
    }
    const total=round(Math.max(0,subtotal-discount+fee));
    const orderNumber=`KF-ORD-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    const eta=new Date(Date.now()+((input.fulfillment==='delivery'?35:20)*60_000));
    const orderResult=await client.query(`INSERT INTO orders(order_number,tracking_token_hash,user_id,customer_name,customer_phone,customer_email,fulfillment,payment_method,delivery_address,delivery_instructions,pickup_time,customer_notes,promo_code,subtotal,discount_amount,delivery_fee,total_amount,currency_code,estimated_arrival_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) RETURNING *`,
      [orderNumber,tokenHash,req.session?.user?.id||null,input.fullName,input.phone,input.email||null,input.fulfillment,input.paymentMethod,input.fulfillment==='delivery'?input.address:null,input.instructions,input.fulfillment==='pickup'?input.pickupTime:null,input.notes,promoCode,subtotal,discount,fee,total,settings.currency_code,eta]);
    const order=orderResult.rows[0];
    for (const item of priced) {
      const lineResult=await client.query(`INSERT INTO order_items(order_id,product_id,product_legacy_id,product_name_snapshot,product_slug_snapshot,product_category_snapshot,quantity,size_name,unit_price,line_total)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,[order.id,item.product.id,item.product.legacy_id,item.product.name,item.product.slug,item.product.category,item.line.qty,item.line.size,item.unit,item.lineTotal]);
      for (const addon of item.addons) await client.query(`INSERT INTO order_item_options(order_item_id,option_id,option_label_snapshot,unit_price_snapshot) VALUES($1,$2,$3,$4)`,[lineResult.rows[0].id,addon.id,addon.label,addon.price]);
    }
    await client.query(`INSERT INTO payments(order_id,amount,currency_code,payment_method,payment_status) VALUES($1,$2,$3,$4,'pending')`,[order.id,total,settings.currency_code,input.paymentMethod]);
    await client.query(`INSERT INTO order_status_history(order_id,previous_status,new_status,note) VALUES($1,NULL,'pending','Order placed')`,[order.id]);
    await client.query(`INSERT INTO notifications(user_id,order_id,guest_token_hash,event_key,notification_type,title,message) VALUES($1,$2,$3,'order_placed','order_placed','Order received',$4) ON CONFLICT(order_id,event_key) DO NOTHING`,[order.user_id,order.id,tokenHash,`We received order ${orderNumber}.`]);
    const items=await loadItems(client,order.id);
    const dto=publicOrder(order,items,[{new_status:'pending',created_at:order.created_at}],rawToken);
    await client.query(`UPDATE idempotency_keys SET resource_id=$2,response_payload=$3 WHERE idempotency_key=$1`,[idempotencyKey,order.id,JSON.stringify(dto)]);
    return dto;
  });
  res.status(201).json({ order:response, trackingToken:response.trackingToken });
});

router.get('/orders/:orderNumber', async (req,res) => {
  const token=String(req.query.token||'');
  if (token.length<32||token.length>128) throw new AppError(404,'Order not found.','NOT_FOUND');
  const result=await query(`SELECT * FROM orders WHERE order_number=$1 AND tracking_token_hash=$2`,[String(req.params.orderNumber).toUpperCase(),sha(token)]);
  if (!result.rowCount) throw new AppError(404,'Order not found.','NOT_FOUND');
  const order=result.rows[0];
  const [items,history]=await Promise.all([
    query(`SELECT oi.product_legacy_id,oi.product_name_snapshot,oi.size_name,oi.quantity,oi.unit_price,oi.line_total,COALESCE(json_agg(json_build_object('id',x.option_id,'label',x.option_label_snapshot,'price',x.unit_price_snapshot)) FILTER(WHERE x.id IS NOT NULL),'[]') AS options FROM order_items oi LEFT JOIN order_item_options x ON x.order_item_id=oi.id WHERE oi.order_id=$1 GROUP BY oi.id ORDER BY oi.created_at`,[order.id]),
    query(`SELECT new_status,created_at FROM order_status_history WHERE order_id=$1 ORDER BY created_at`,[order.id])
  ]);
  const rows=items.rows.map(item=>({...item,options:typeof item.options==='string'?JSON.parse(item.options):item.options}));
  const dto=publicOrder(order,rows,history.rows);
  delete dto.phone; delete dto.email;
  res.json({order:dto});
});
router.get('/orders/:orderNumber/notifications', async (req,res) => {
  const token=String(req.query.token||'');
  const order=await query(`SELECT id FROM orders WHERE order_number=$1 AND tracking_token_hash=$2`,[String(req.params.orderNumber).toUpperCase(),sha(token)]);
  if (!order.rowCount) throw new AppError(404,'Order not found.','NOT_FOUND');
  const result=await query(`SELECT id,title,message,notification_type AS type,read_at AS "readAt",created_at AS "createdAt" FROM notifications WHERE order_id=$1 ORDER BY created_at DESC`,[order.rows[0].id]);
  res.json({notifications:result.rows});
});
router.get('/notifications', requireUser, async (req,res) => {
  const result=await query(`SELECT id,title,message,notification_type AS type,read_at AS "readAt",created_at AS "createdAt" FROM notifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100`,[req.session.user.id]);
  res.json({notifications:result.rows});
});
router.patch('/notifications/:id/read', requireUser, async (req,res) => {
  const isRead=z.object({isRead:z.boolean().optional().default(true)}).parse(req.body||{}).isRead;
  const result=await query(`UPDATE notifications SET read_at=CASE WHEN $3 THEN COALESCE(read_at,now()) ELSE NULL END WHERE id=$1 AND user_id=$2 RETURNING id,read_at AS "readAt"`,[req.params.id,req.session.user.id,isRead]);
  if (!result.rowCount) throw new AppError(404,'Notification not found.','NOT_FOUND');
  res.json({notification:result.rows[0]});
});

module.exports = { router, publicOrder, orderSchema:schema };
