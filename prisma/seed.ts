/**
 * Seed script - fills the database with demo data.
 *
 *   npm run seed            (or: npx prisma db seed)
 *
 * Safe to re-run: records are upserted / skipped if they already exist.
 *
 * Login credentials (DEMO ONLY - change or do not run in production):
 *   Admin    admin@gympro.com            Admin@12345
 *   Owner    owner@gympro.com            Owner@12345
 *   Trainers <name>@gympro.com           Trainer@12345
 *   Users    <name>@example.com          User@12345   (common password for all users)
 * Override the user password with SEED_USER_PASSWORD in .env if needed.
 */
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { PrismaClient, Role, MembershipPlan, PaymentMethod, OrderStatus } from '@prisma/client';

const prisma = new PrismaClient();

const ADMIN_PASSWORD = 'Admin@12345';
const OWNER_PASSWORD = 'Owner@12345';
const TRAINER_PASSWORD = 'Trainer@12345';
const USER_PASSWORD = process.env.SEED_USER_PASSWORD || 'User@12345';

const daysFromNow = (d: number) => new Date(Date.now() + d * 24 * 60 * 60 * 1000);

async function main() {
  if (process.env.NODE_ENV === 'production' && process.env.SEED_FORCE !== 'true') {
    throw new Error('Refusing to seed demo data in production. Set SEED_FORCE=true to override.');
  }

  const hash = {
    admin: await bcrypt.hash(ADMIN_PASSWORD, 10),
    owner: await bcrypt.hash(OWNER_PASSWORD, 10),
    trainer: await bcrypt.hash(TRAINER_PASSWORD, 10),
    user: await bcrypt.hash(USER_PASSWORD, 10),
  };

  // ---------- Admin & Owner ----------
  await prisma.user.upsert({
    where: { email: 'admin@gympro.com' },
    update: {},
    create: { name: 'Gym Admin', email: 'admin@gympro.com', phone: '9000000001', password: hash.admin, role: Role.ADMIN },
  });
  await prisma.user.upsert({
    where: { email: 'owner@gympro.com' },
    update: {},
    create: { name: 'Gym Owner', email: 'owner@gympro.com', phone: '9000000002', password: hash.owner, role: Role.OWNER },
  });

  // ---------- Trainers ----------
  const trainerData = [
    { name: 'Arjun Menon', email: 'arjun@gympro.com', qualification: 'ACE Certified Personal Trainer', championDetails: 'Mr. Kerala 2022 - Men\'s Physique' },
    { name: 'Meera Nair', email: 'meera@gympro.com', qualification: 'Certified Yoga & Mobility Coach', championDetails: 'State Yogasana Champion 2021' },
    { name: 'Rahul Varma', email: 'rahul@gympro.com', qualification: 'NASM Strength & Conditioning Specialist', championDetails: 'National Powerlifting Bronze 2023' },
    { name: 'Sneha Pillai', email: 'sneha@gympro.com', qualification: 'Certified Nutritionist & HIIT Coach', championDetails: null },
  ];
  const trainers = [];
  for (const t of trainerData) {
    trainers.push(
      await prisma.trainer.upsert({
        where: { email: t.email },
        update: {},
        create: { ...t, password: hash.trainer },
      }),
    );
  }

  // ---------- Plans ----------
  const planData = [
    { name: 'Silver Monthly', description: 'Perfect to get started. 1 trainer and 1 free product every month.', price: 999, membershipPlan: MembershipPlan.SILVER, planDurationDays: 30, planTrainersLimit: 1, planFreeProducts: 1, totalSlots: 100 },
    { name: 'Gold Monthly', description: 'More coaching and more perks. 2 trainers and 2 free products every month.', price: 1599, membershipPlan: MembershipPlan.GOLD, planDurationDays: 30, planTrainersLimit: 2, planFreeProducts: 2, totalSlots: 60 },
    { name: 'Premium Monthly', description: 'The full experience. 3 trainers and 5 free products every month.', price: 2499, membershipPlan: MembershipPlan.PREMIUM, planDurationDays: 30, planTrainersLimit: 3, planFreeProducts: 5, totalSlots: 30 },
    { name: 'Weekend Warrior (Custom)', description: 'Custom 15-day plan without a tier.', price: 599, membershipPlan: null, planDurationDays: 15, planTrainersLimit: 1, planFreeProducts: 1, totalSlots: 25 },
  ];
  const plans: Record<string, { id: string }> = {};
  for (const p of planData) {
    const existing = await prisma.plan.findFirst({ where: { name: p.name } });
    plans[p.name] = existing ?? (await prisma.plan.create({ data: p as any }));
  }

  // ---------- Products ----------
  const productData = [
    { name: 'Whey Protein 1kg', description: 'Chocolate flavour, 24g protein per scoop.', price: 1799, stock: 40, imageUrl: 'https://images.unsplash.com/photo-1593095948071-474c5cc2989d?w=600' },
    { name: 'Creatine Monohydrate 250g', description: 'Micronized, unflavoured.', price: 899, stock: 35, imageUrl: 'https://images.unsplash.com/photo-1579722821273-0f6c7d44362f?w=600' },
    { name: 'Shaker Bottle 700ml', description: 'Leak-proof shaker with mixing ball.', price: 249, stock: 120, imageUrl: 'https://images.unsplash.com/photo-1594737625785-a6cbdabd333c?w=600' },
    { name: 'Resistance Bands Set', description: 'Set of 5 bands with different resistance levels.', price: 499, stock: 80, imageUrl: 'https://images.unsplash.com/photo-1598289431512-b97b0917affc?w=600' },
    { name: 'Gym Gloves', description: 'Padded gloves with wrist support.', price: 349, stock: 70, imageUrl: 'https://images.unsplash.com/photo-1517836357463-d25dfeac3438?w=600' },
    { name: 'Skipping Rope', description: 'Adjustable speed rope with ball bearings.', price: 199, stock: 150, imageUrl: 'https://images.unsplash.com/photo-1434596922112-19c563067271?w=600' },
    { name: 'Yoga Mat 6mm', description: 'Anti-slip, extra cushioned.', price: 699, stock: 60, imageUrl: 'https://images.unsplash.com/photo-1601925260368-ae2f83cf8b7f?w=600' },
    { name: 'Adjustable Dumbbell Pair (20kg)', description: 'Quick-adjust dumbbells for home workouts.', price: 3299, stock: 15, imageUrl: 'https://images.unsplash.com/photo-1583454110551-21f2fa2afe61?w=600' },
    { name: 'BCAA 300g', description: 'Watermelon flavour, 2:1:1 ratio.', price: 1199, stock: 30, imageUrl: 'https://images.unsplash.com/photo-1546483875-ad9014c88eba?w=600' },
    { name: 'Gym Duffel Bag', description: 'Water-resistant bag with shoe compartment.', price: 799, stock: 45, imageUrl: 'https://images.unsplash.com/photo-1553062407-98eeb64c6a62?w=600' },
    { name: 'Foam Roller', description: 'High-density roller for muscle recovery.', price: 599, stock: 50, imageUrl: 'https://images.unsplash.com/photo-1600881333168-2ef49b341f30?w=600' },
    { name: 'Gym T-Shirt (Dry-Fit)', description: 'Breathable quick-dry t-shirt.', price: 449, stock: 90, imageUrl: 'https://images.unsplash.com/photo-1581009146145-b5ef050c2e1e?w=600' },
  ];
  const products: Record<string, { id: string; price: any }> = {};
  for (const p of productData) {
    const existing = await prisma.product.findFirst({ where: { name: p.name } });
    products[p.name] = existing ?? (await prisma.product.create({ data: p as any }));
  }

  // ---------- Regular users (all share one common password) ----------
  // plan: which plan name they are subscribed to (null = no plan), startedDaysAgo controls expiry
  const userData: {
    name: string; email: string; phone: string; heightCm: number; weightKg: number; place: string; bio: string;
    plan: string | null; startedDaysAgo?: number; trainerEmails?: string[];
  }[] = [
    { name: 'Anil Kumar', email: 'anil@example.com', phone: '9847012345', heightCm: 175, weightKg: 78, place: 'Kochi', bio: 'Want to build muscle.', plan: 'Premium Monthly', startedDaysAgo: 5, trainerEmails: ['arjun@gympro.com', 'rahul@gympro.com', 'sneha@gympro.com'] },
    { name: 'Divya Thomas', email: 'divya@example.com', phone: '9946123456', heightCm: 162, weightKg: 58, place: 'Thrissur', bio: 'Weight loss and flexibility.', plan: 'Gold Monthly', startedDaysAgo: 10, trainerEmails: ['meera@gympro.com', 'sneha@gympro.com'] },
    { name: 'Faisal Rahman', email: 'faisal@example.com', phone: '9633234567', heightCm: 180, weightKg: 85, place: 'Kozhikode', bio: 'Strength training.', plan: 'Silver Monthly', startedDaysAgo: 3, trainerEmails: ['rahul@gympro.com'] },
    { name: 'Gayathri S', email: 'gayathri@example.com', phone: '9745345678', heightCm: 158, weightKg: 52, place: 'Trivandrum', bio: 'Yoga and general fitness.', plan: 'Silver Monthly', startedDaysAgo: 45, trainerEmails: ['meera@gympro.com'] }, // expired
    { name: 'Joseph Mathew', email: 'joseph@example.com', phone: '9562456789', heightCm: 172, weightKg: 90, place: 'Kottayam', bio: 'Fat loss journey.', plan: 'Weekend Warrior (Custom)', startedDaysAgo: 2, trainerEmails: ['arjun@gympro.com'] },
    { name: 'Lakshmi Priya', email: 'lakshmi@example.com', phone: '9495567890', heightCm: 165, weightKg: 61, place: 'Palakkad', bio: 'Marathon training.', plan: null },
    { name: 'Nikhil Das', email: 'nikhil@example.com', phone: '9388678901', heightCm: 178, weightKg: 70, place: 'Kannur', bio: 'Just joined, exploring.', plan: null },
    { name: 'Revathi Menon', email: 'revathi@example.com', phone: '9072789012', heightCm: 160, weightKg: 55, place: 'Alappuzha', bio: 'Toning and mobility.', plan: 'Gold Monthly', startedDaysAgo: 20, trainerEmails: ['meera@gympro.com'] },
  ];

  const trainerByEmail = Object.fromEntries(trainers.map((t) => [t.email!, t]));
  const users: Record<string, { id: string }> = {};

  for (const u of userData) {
    const plan = u.plan ? planData.find((p) => p.name === u.plan)! : null;
    const startsAt = plan ? daysFromNow(-(u.startedDaysAgo ?? 0)) : null;
    const endsAt = plan && startsAt ? new Date(startsAt.getTime() + (plan.planDurationDays ?? 30) * 86400000) : null;
    const active = Boolean(endsAt && endsAt > new Date());

    const planFields = plan
      ? {
          planId: plans[plan.name].id,
          membershipPlan: plan.membershipPlan ?? undefined,
          planStartsAt: startsAt!,
          planEndsAt: endsAt!,
          trainersLimit: plan.planTrainersLimit ?? undefined,
          freeProductsPerMonth: active ? plan.planFreeProducts ?? 0 : 0,
        }
      : {};

    const user = await prisma.user.upsert({
      where: { email: u.email },
      update: {},
      create: {
        name: u.name, email: u.email, phone: u.phone, password: hash.user, role: Role.USER,
        heightCm: u.heightCm, weightKg: u.weightKg, place: u.place, bio: u.bio,
        ...planFields,
      } as any,
    });
    users[u.email] = user;

    for (const te of u.trainerEmails ?? []) {
      const trainer = trainerByEmail[te];
      if (!trainer) continue;
      await prisma.userTrainer.upsert({
        where: { userId_trainerId: { userId: user.id, trainerId: trainer.id } },
        update: {},
        create: { userId: user.id, trainerId: trainer.id },
      });
    }
    // legacy single-trainer field
    if (u.trainerEmails?.[0] && trainerByEmail[u.trainerEmails[0]]) {
      await prisma.user.update({ where: { id: user.id }, data: { trainerId: trainerByEmail[u.trainerEmails[0]].id } });
    }
  }

  // ---------- Orders (only for users that have none yet) ----------
  const orderData: { email: string; method: PaymentMethod; status: OrderStatus; daysAgo: number; items: [string, number][] }[] = [
    { email: 'anil@example.com', method: PaymentMethod.UPI, status: OrderStatus.CONFIRMED, daysAgo: 4, items: [['Whey Protein 1kg', 1], ['Shaker Bottle 700ml', 1]] },
    { email: 'divya@example.com', method: PaymentMethod.COD, status: OrderStatus.CONFIRMED, daysAgo: 8, items: [['Yoga Mat 6mm', 1], ['Resistance Bands Set', 1]] },
    { email: 'faisal@example.com', method: PaymentMethod.COD, status: OrderStatus.PENDING, daysAgo: 1, items: [['Creatine Monohydrate 250g', 1], ['Gym Gloves', 1]] },
    { email: 'joseph@example.com', method: PaymentMethod.UPI, status: OrderStatus.PENDING, daysAgo: 0, items: [['Skipping Rope', 2], ['Gym T-Shirt (Dry-Fit)', 1]] },
    { email: 'lakshmi@example.com', method: PaymentMethod.UPI, status: OrderStatus.CANCELLED, daysAgo: 12, items: [['Foam Roller', 1]] },
    { email: 'revathi@example.com', method: PaymentMethod.COD, status: OrderStatus.CONFIRMED, daysAgo: 15, items: [['Gym Duffel Bag', 1], ['BCAA 300g', 1]] },
  ];
  for (const o of orderData) {
    const user = users[o.email];
    if (!user) continue;
    if ((await prisma.order.count({ where: { userId: user.id } })) > 0) continue;
    const total = o.items.reduce((s, [name, qty]) => s + Number(products[name].price) * qty, 0);
    await prisma.order.create({
      data: {
        userId: user.id,
        paymentMethod: o.method,
        status: o.status,
        total: total.toFixed(2),
        createdAt: daysFromNow(-o.daysAgo),
        items: {
          create: o.items.map(([name, qty]) => ({
            productId: products[name].id,
            quantity: qty,
            priceAtPurchase: Number(products[name].price).toFixed(2),
          })),
        },
      },
    });
  }

  // ---------- Cart items ----------
  const cartData: [string, string, number][] = [
    ['nikhil@example.com', 'Whey Protein 1kg', 1],
    ['nikhil@example.com', 'Skipping Rope', 1],
    ['gayathri@example.com', 'Yoga Mat 6mm', 1],
  ];
  for (const [email, product, quantity] of cartData) {
    const user = users[email];
    if (!user) continue;
    await prisma.cartItem.upsert({
      where: { userId_productId: { userId: user.id, productId: products[product].id } },
      update: {},
      create: { userId: user.id, productId: products[product].id, quantity },
    });
  }

  // ---------- Contact messages ----------
  if ((await prisma.contactMessage.count()) === 0) {
    await prisma.contactMessage.createMany({
      data: [
        { name: 'Sanjay P', email: 'sanjay@example.com', phone: '9847999001', message: 'What are the gym timings on Sundays?' },
        { name: 'Anjali R', email: 'anjali@example.com', phone: '9946999002', message: 'Do you offer a trial session before joining?' },
        { name: 'Mohammed Irfan', email: 'irfan@example.com', phone: null, message: 'Interested in the Premium plan. Is there a student discount?' },
      ],
    });
  }

  console.log('\nSeed completed.\n');
  console.log('Logins:');
  console.log(`  Admin    admin@gympro.com        ${ADMIN_PASSWORD}`);
  console.log(`  Owner    owner@gympro.com        ${OWNER_PASSWORD}`);
  console.log(`  Trainers arjun|meera|rahul|sneha@gympro.com   ${TRAINER_PASSWORD}`);
  console.log(`  Users    ${userData.map((u) => u.email.split('@')[0]).join('|')}@example.com   ${USER_PASSWORD}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
