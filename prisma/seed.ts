/**
 * Database seed — Sample data for development
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...');

  // Create sample customers
  const customers = await Promise.all([
    prisma.customer.upsert({
      where: { phone: '+919876543210' },
      update: {},
      create: { name: 'Rahul Sharma', phone: '+919876543210', email: 'rahul@example.com', timezone: 'Asia/Kolkata', preferredCallStart: '10:00', preferredCallEnd: '18:00' },
    }),
    prisma.customer.upsert({
      where: { phone: '+919876543211' },
      update: {},
      create: { name: 'Priya Patel', phone: '+919876543211', email: 'priya@example.com', timezone: 'Asia/Kolkata' },
    }),
    prisma.customer.upsert({
      where: { phone: '+919876543212' },
      update: {},
      create: { name: 'Amit Kumar', phone: '+919876543212', email: 'amit@example.com', timezone: 'Asia/Kolkata', doNotCall: true },
    }),
    prisma.customer.upsert({
      where: { phone: '+919876543213' },
      update: {},
      create: { name: 'Sneha Gupta', phone: '+919876543213', timezone: 'Asia/Kolkata' },
    }),
    prisma.customer.upsert({
      where: { phone: '+919876543214' },
      update: {},
      create: { name: 'Vikram Singh', phone: '+919876543214', email: 'vikram@example.com', timezone: 'Asia/Kolkata', preferredCallStart: '14:00', preferredCallEnd: '20:00' },
    }),
  ]);

  console.log(`✅ Created ${customers.length} customers`);

  // Create a sample campaign
  const campaign = await prisma.campaign.upsert({
    where: { id: 'seed-campaign-1' },
    update: {},
    create: { id: 'seed-campaign-1', name: 'May 2026 Health Insurance Drive', status: 'ACTIVE', totalCustomers: 5 },
  });

  console.log(`✅ Created campaign: ${campaign.name}`);
  console.log('🌱 Seeding complete!');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
