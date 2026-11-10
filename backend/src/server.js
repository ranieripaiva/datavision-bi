import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import jwt from '@fastify/jwt';
import multipart from '@fastify/multipart';
import bcrypt from 'bcryptjs';
import XLSX from 'xlsx';
import { PrismaClient } from '@prisma/client';

const app = Fastify({ logger: true, bodyLimit: 12 * 1024 * 1024 });
const prisma = new PrismaClient();
const PORT = Number(process.env.PORT || 3001);
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) throw new Error('JWT_SECRET deve ser configurado no .env com pelo menos 32 caracteres.');
await app.register(helmet);
await app.register(cors, { origin: process.env.CORS_ORIGIN || 'http://localhost:8080' });
await app.register(jwt, { secret: process.env.JWT_SECRET });
await app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024, files: 1 } });

const months = { janeiro:1, fevereiro:2, marco:3, março:3, abril:4, maio:5, junho:6, julho:7, agosto:8, setembro:9, outubro:10, novembro:11, dezembro:12 };
const norm = v => String(v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9%]/g,'');
const number = v => { if (typeof v === 'number') return Number.isFinite(v) ? v : 0; if (v == null || v === '') return 0; const n = Number(String(v).replace(/\./g,'').replace(',','.')); return Number.isFinite(n) ? n : 0; };
const pick = (headers, aliases) => headers.findIndex(h => aliases.includes(norm(h)));
function parseWorkbook(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: false });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) throw new Error('A planilha não possui uma aba válida.');
  const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: true });
  let headerAt = -1, headers = [];
  for (let i=0;i<Math.min(matrix.length,12);i++) {
    const row = (matrix[i] || []).map(norm);
    if (row.includes('mes') && (row.includes('vlvenda2026') || row.includes('vlvenda2025'))) { headerAt=i; headers=matrix[i]; break; }
  }
  if (headerAt < 0) throw new Error('Não encontrei o cabeçalho esperado. Verifique se a planilha contém Mês e Vl. Venda 2026/2025.');
  const idx = {
    month: pick(headers,['mes']), s26:pick(headers,['vlvenda2026']), s25:pick(headers,['vlvenda2025']), s24:pick(headers,['vlvenda2024']),
    returns:pick(headers,['vldevolucao']), retPct:pick(headers,['%devolucao','devolucao']), net:pick(headers,['vlvendaliquida']),
    cmv:pick(headers,['vlcmvvenda']), cmvRet:pick(headers,['vlcmvdevolucao']), netCmv:pick(headers,['vlcmvliquido']),
    profit:pick(headers,['vllucro']), profitPct:pick(headers,['%lucro','lucro']), positive:pick(headers,['qtpositivado'])
  };
  if (idx.month < 0 || idx.s26 < 0 && idx.s25 < 0) throw new Error('As colunas obrigatórias de mês e vendas não foram identificadas.');
  const rows=[];
  for (const r of matrix.slice(headerAt+1)) {
    const rawMonth = String(r[idx.month] ?? '').trim();
    const month = months[norm(rawMonth)];
    if (!month) continue; // ignora total, linhas vazias e títulos
    const val = key => idx[key] < 0 ? 0 : number(r[idx[key]]);
    rows.push({ month, sales2026:val('s26'), sales2025:val('s25'), sales2024:val('s24'), returns:val('returns'), returnPercent:val('retPct'), netSales:val('net'), cmvSales:val('cmv'), cmvReturns:val('cmvRet'), netCmv:val('netCmv'), profit:val('profit'), profitPercent:val('profitPct'), positiveCustomers:Math.round(val('positive')) });
  }
  if (!rows.length) throw new Error('Nenhum mês válido foi encontrado na planilha.');
  return rows;
}
async function auth(req, reply) { try { await req.jwtVerify(); const u=await prisma.user.findUnique({where:{id:req.user.sub}}); if(!u || !u.active) return reply.code(401).send({error:'Acesso não autorizado.'}); req.account=u; } catch { return reply.code(401).send({error:'Sessão inválida ou expirada.'}); } }
async function admin(req, reply) { if(req.account?.role !== 'ADMIN') return reply.code(403).send({error:'Apenas administradores podem executar esta ação.'}); }
app.get('/api/health', async () => ({ status:'ok', service:'DataVision BI' }));
app.post('/api/auth/login', async (req, reply) => {
  const { email, password } = req.body || {};
  if(!email || !password) return reply.code(400).send({error:'Informe e-mail e senha.'});
  const user=await prisma.user.findUnique({where:{email:String(email).toLowerCase().trim()}});
  if(!user || !user.active || !(await bcrypt.compare(String(password),user.passwordHash))) return reply.code(401).send({error:'Credenciais inválidas.'});
  const token=app.jwt.sign({sub:user.id,role:user.role}, {expiresIn:'8h'});
  return { token, user:{id:user.id,name:user.name,email:user.email,role:user.role} };
});
app.get('/api/me',{preHandler:auth},async req=>({id:req.account.id,name:req.account.name,email:req.account.email,role:req.account.role}));
app.post('/api/import',{preHandler:auth},async(req,reply)=>{
  const file=await req.file(); if(!file) return reply.code(400).send({error:'Selecione uma planilha Excel.'});
  const filename=file.filename || 'planilha.xlsx';
  if(!/\.(xlsx|xls)$/i.test(filename)) return reply.code(400).send({error:'Formato não permitido. Envie .xls ou .xlsx.'});
  try {
    const buffer=await file.toBuffer(); const rows=parseWorkbook(buffer);
    const result=await prisma.import.create({data:{filename,rowCount:rows.length,userId:req.account.id,months:{create:rows}}});
    return {id:result.id,filename,rowCount:rows.length,importedAt:result.importedAt};
  } catch(e) { req.log.error(e); return reply.code(422).send({error:e.message || 'Não foi possível processar a planilha.'}); }
});
app.get('/api/dashboard',{preHandler:auth},async req=>{
  const latest=await prisma.import.findFirst({where:{userId:req.account.id},orderBy:{importedAt:'desc'},include:{months:{orderBy:{month:'asc'}}}});
  if(!latest) return { hasData:false, months:[] };
  const data=latest.months;
  const year=Number(req.query.year || 2026); const key=({2024:'sales2024',2025:'sales2025',2026:'sales2026'})[year] || 'sales2026';
  const populated=data.filter(x=>x[key] !== 0);
  const total=field=>populated.reduce((a,x)=>a+(x[field]||0),0);
  const sales=total(key), isCurrent=year===2026, profit=isCurrent?total('profit'):null, cmv=isCurrent?total('netCmv'):null, returns=isCurrent?total('returns'):null, net=isCurrent?total('netSales'):null;
  const previousKey=year===2026?'sales2025':year===2025?'sales2024':null;
  const previous=previousKey?data.reduce((a,x)=>a+(x[previousKey]||0),0):null;
  return {hasData:true,import:{id:latest.id,filename:latest.filename,importedAt:latest.importedAt,rowCount:latest.rowCount},year,availableYears:[2024,2025,2026],kpis:{sales,profit,cmv,returns,netSales:net,profitMargin:isCurrent&&sales?profit/sales*100:null,returnRate:isCurrent&&sales?returns/sales*100:null,positiveCustomers:isCurrent?populated.reduce((a,x)=>a+x.positiveCustomers,0):null,salesChange:previous?((sales-previous)/previous)*100:null},months:data.map(x=>({month:x.month,label:new Date(2026,x.month-1,1).toLocaleString('pt-BR',{month:'short'}),sales:x[key],sales2024:x.sales2024,sales2025:x.sales2025,sales2026:x.sales2026,returns:isCurrent?x.returns:null,netSales:isCurrent?x.netSales:null,cmv:isCurrent?x.netCmv:null,profit:isCurrent?x.profit:null,profitMargin:isCurrent?x.profitPercent:null,positiveCustomers:isCurrent?x.positiveCustomers:null,hasMovement:x[key]!==0}))};
});
app.get('/api/imports',{preHandler:auth},async req=>prisma.import.findMany({where:{userId:req.account.id},orderBy:{importedAt:'desc'},take:20,select:{id:true,filename:true,importedAt:true,rowCount:true}}));
app.get('/api/users',{preHandler:[auth,admin]},async()=>prisma.user.findMany({orderBy:{createdAt:'desc'},select:{id:true,name:true,email:true,role:true,active:true,createdAt:true}}));
app.post('/api/users',{preHandler:[auth,admin]},async(req,reply)=>{
  const {name,email,password,role='USER'}=req.body||{};
  if(!name||!email||!password||String(password).length<10) return reply.code(400).send({error:'Informe nome, e-mail e senha com pelo menos 10 caracteres.'});
  try { const user=await prisma.user.create({data:{name:String(name),email:String(email).toLowerCase().trim(),passwordHash:await bcrypt.hash(String(password),12),role:role==='ADMIN'?'ADMIN':'USER'}}); return reply.code(201).send({id:user.id,name:user.name,email:user.email,role:user.role,active:user.active}); }
  catch { return reply.code(409).send({error:'Não foi possível criar. Verifique se o e-mail já está cadastrado.'}); }
});
app.patch('/api/users/:id',{preHandler:[auth,admin]},async(req,reply)=>{
  const {active,role}=req.body||{}; if(req.params.id===req.account.id && active===false) return reply.code(400).send({error:'Você não pode desativar seu próprio usuário.'});
  const data={}; if(typeof active==='boolean') data.active=active; if(role) data.role=role==='ADMIN'?'ADMIN':'USER';
  try { return await prisma.user.update({where:{id:req.params.id},data,select:{id:true,name:true,email:true,role:true,active:true}}); } catch { return reply.code(404).send({error:'Usuário não encontrado.'}); }
});
app.setErrorHandler((err,req,reply)=>{ req.log.error(err); reply.code(err.statusCode||500).send({error:err.statusCode && err.statusCode<500?err.message:'Erro interno. Consulte o log do servidor.'}); });
app.addHook('onClose',async()=>prisma.$disconnect());
try { await app.listen({port:PORT,host:'0.0.0.0'}); } catch(err) { app.log.error(err); process.exit(1); }
