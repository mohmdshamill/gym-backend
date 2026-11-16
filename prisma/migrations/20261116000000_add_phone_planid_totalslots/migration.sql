-- Columns that were previously added with `prisma db push` only.
-- IF NOT EXISTS keeps this safe on databases that already have them.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "phone" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "planId" TEXT;
ALTER TABLE "Plan" ADD COLUMN IF NOT EXISTS "totalSlots" INTEGER DEFAULT 50;
