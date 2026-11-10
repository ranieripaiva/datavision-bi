import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
const prisma = new PrismaClient();
const email = process.env.ADMIN_EMAIL || 'admin@local';
const password = process.env.ADMIN_PASSWORD;
if (!password || password.length < 10) throw new Error('ADMIN_PASSWORD deve ter pelo menos 10 caracteres.');
try {
  const found = await prisma.user.findUnique({ where: { email } });
  if (!found) await prisma.user.create({ data: { name: process.env.ADMIN_NAME || 'Administrador', email, passwordHash: await bcrypt.hash(password, 12), role: 'ADMIN' } });
} finally { await prisma.$disconnect(); }
