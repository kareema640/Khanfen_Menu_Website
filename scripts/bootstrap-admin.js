'use strict';

require('dotenv').config();
const bcrypt=require('bcryptjs');
const {query,closePool}=require('../src/db/pool');

async function main(){
  const name=String(process.env.ADMIN_NAME||'').trim();
  const email=String(process.env.ADMIN_EMAIL||'').trim();
  const password=String(process.env.ADMIN_PASSWORD||'');
  if(name.length<2||name.length>120) throw new Error('Set ADMIN_NAME (2–120 characters).');
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Set a valid ADMIN_EMAIL.');
  if(password.length<16||password.length>128) throw new Error('Set ADMIN_PASSWORD to at least 16 characters (maximum 128).');
  const exists=await query(`SELECT EXISTS(SELECT 1 FROM users WHERE role='admin') AS has_admin`);
  if(exists.rows[0].has_admin) throw new Error('An administrator already exists; bootstrap is one-time and will not replace credentials.');
  const hash=await bcrypt.hash(password,12);
  const result=await query(`INSERT INTO users(full_name,email,password_hash,role) VALUES($1,$2,$3,'admin') RETURNING id,email`,[name,email,hash]);
  console.log(`Created initial Khanfem owner account for ${result.rows[0].email}. Remove temporary ADMIN_* environment values now.`);
}
main().catch(error=>{console.error(`Owner bootstrap failed: ${error.message}`);process.exitCode=1;}).finally(closePool);
