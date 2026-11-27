'use strict';

require('dotenv').config();
const app=require('./src/app');
const {closePool}=require('./src/db/pool');
const port=Number(process.env.PORT)||3000;
const server=app.listen(port,'0.0.0.0',()=>console.log(`Khanfem server listening on port ${port}`));
async function shutdown(signal){console.log(`${signal}: closing server`);server.close(async()=>{await closePool();process.exit(0);});setTimeout(()=>process.exit(1),10000).unref();}
process.on('SIGTERM',()=>shutdown('SIGTERM'));
process.on('SIGINT',()=>shutdown('SIGINT'));
