import { Request, Response } from 'express';
import { prisma } from '../connection/db.js';

const PLAN_LIMITS = {
  PREMIUM: { trainersLimit: 3, freeProductsPerMonth: 5, months: 1 },
  GOLD: { trainersLimit: 2, freeProductsPerMonth: 2, months: 1 },
  SILVER: { trainersLimit: 1, freeProductsPerMonth: 1, months: 1 },
} as const;

type PlanKey = keyof typeof PLAN_LIMITS;

// Legacy: subscribe by enum (kept for compatibility)
export const subscribePlan = async (req: Request, res: Response) => {
  try {
    const authUser = (req as any).user as { id: string } | undefined;
    if (!authUser?.id) return res.status(401).json({ message: 'Unauthorized' });

    const { plan } = req.body as { plan?: PlanKey };
    if (!plan || !PLAN_LIMITS[plan]) {
      return res.status(400).json({ message: 'Invalid plan. Use PREMIUM | GOLD | SILVER' });
    }

    const now = new Date();

    // Check if user already has an active plan
    const currentUser = await prisma.user.findUnique({
      where: { id: authUser.id },
      select: { membershipPlan: true, planEndsAt: true },
    });

    if (currentUser?.membershipPlan && currentUser?.planEndsAt && new Date(currentUser.planEndsAt) > now) {
      const daysLeft = Math.max(1, Math.ceil((new Date(currentUser.planEndsAt).getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));
      return res.status(400).json({
        message: `You already have an active ${currentUser.membershipPlan} plan with ${daysLeft} day(s) remaining. You can select a new plan once your current duration expires.`,
        currentPlan: currentUser.membershipPlan,
        planEndsAt: currentUser.planEndsAt,
        daysLeft,
      });
    }

    const ends = new Date(now);
    ends.setMonth(ends.getMonth() + PLAN_LIMITS[plan].months);

    await prisma.user.update({
      where: { id: authUser.id },
      data: {
        membershipPlan: plan as any,
        planStartsAt: now,
        planEndsAt: ends,
        trainersLimit: PLAN_LIMITS[plan].trainersLimit,
        freeProductsPerMonth: PLAN_LIMITS[plan].freeProductsPerMonth,
      } as any,
    });

    return res.status(200).json({
      message: 'Plan selected successfully',
      plan,
      planStartsAt: now.toISOString(),
      planEndsAt: ends.toISOString(),
      limits: PLAN_LIMITS[plan],
    });
  } catch (err) {
    console.error('subscribePlan error', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

// List plans from dedicated Plan table (public)
export const listPlans = async (_req: Request, res: Response) => {
  try {
    const plans = await (prisma as any).plan.findMany({ orderBy: { createdAt: 'desc' } });
    const now = new Date();

    const withPromoAndSlots = await Promise.all(
      plans.map(async (p: any) => {
        const starts = p.discountStartsAt ? new Date(p.discountStartsAt) : null;
        const ends = p.discountEndsAt ? new Date(p.discountEndsAt) : null;
        const inWindow = starts && ends ? now >= starts && now <= ends : false;
        const percent = typeof p.discountPercent === 'number' ? p.discountPercent : null;
        const isPromoActive = inWindow && percent != null && percent >= 70;
        const discountedPrice =
          isPromoActive && typeof p.price === 'number'
            ? Math.max(0, Number((p.price * (1 - percent! / 100)).toFixed(2)))
            : null;

        const totalSlots = typeof p.totalSlots === 'number' ? p.totalSlots : 50;

        // Count active subscribers for this plan
        const orConditions: any[] = [{ planId: p.id }];
        if (p.membershipPlan) {
          orConditions.push({ membershipPlan: p.membershipPlan });
        }

        const activeSubscribers = await prisma.user.count({
          where: {
            role: 'USER',
            planEndsAt: { gt: now },
            OR: orConditions,
          },
        });

        const remainingSlots = Math.max(0, totalSlots - activeSubscribers);
        const isSlotFull = remainingSlots <= 0;

        return {
          ...p,
          totalSlots,
          activeSubscribers,
          remainingSlots,
          isSlotFull,
          isPromoActive,
          discountedPrice,
        };
      })
    );

    return res.status(200).json({ plans: withPromoAndSlots });
  } catch (err) {
    console.error('listPlans error', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

// Subscribe using plan id from Plan table
export const subscribeByPlanId = async (req: Request, res: Response) => {
  try {
    const authUser = (req as any).user as { id: string } | undefined;
    if (!authUser?.id) return res.status(401).json({ message: 'Unauthorized' });

    const { id } = req.params;
    const plan = await (prisma as any).plan.findUnique({ where: { id } });
    if (!plan) return res.status(404).json({ message: 'Plan not found' });

    const now = new Date();

    // Check if user already has an active plan that hasn't expired yet
    const currentUser = await prisma.user.findUnique({
      where: { id: authUser.id },
      select: { membershipPlan: true, planEndsAt: true },
    });

    if (currentUser?.planEndsAt && new Date(currentUser.planEndsAt) > now) {
      const daysLeft = Math.max(1, Math.ceil((new Date(currentUser.planEndsAt).getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));
      const currentPlanName = currentUser.membershipPlan || 'membership';
      return res.status(400).json({
        message: `You already have an active ${currentPlanName} plan with ${daysLeft} day(s) remaining. You can select a new plan once your current duration expires.`,
        currentPlan: currentPlanName,
        planEndsAt: currentUser.planEndsAt,
        daysLeft,
      });
    }

    const totalSlots = typeof plan.totalSlots === 'number' ? plan.totalSlots : 50;

    // Verify slot availability
    const orConditions: any[] = [{ planId: plan.id }];
    if (plan.membershipPlan) {
      orConditions.push({ membershipPlan: plan.membershipPlan });
    }

    const activeSubscribers = await prisma.user.count({
      where: {
        role: 'USER',
        planEndsAt: { gt: now },
        OR: orConditions,
      },
    });

    if (activeSubscribers >= totalSlots) {
      return res.status(400).json({
        message: 'All available slots for this plan are currently filled. Please select another plan.',
        totalSlots,
        remainingSlots: 0,
        isSlotFull: true,
      });
    }

    const durationDays = plan.planDurationDays ?? 30;
    const ends = new Date(now);
    ends.setDate(ends.getDate() + durationDays);

    // Promo evaluation: active if within time window AND discountPercent >= 70
    const promoStarts = plan.discountStartsAt ? new Date(plan.discountStartsAt) : null;
    const promoEnds = plan.discountEndsAt ? new Date(plan.discountEndsAt) : null;
    const inPromoWindow = promoStarts && promoEnds ? now >= promoStarts && now <= promoEnds : false;
    const discountPercent = typeof plan.discountPercent === 'number' ? plan.discountPercent : null;
    const isPromoActive = inPromoWindow && discountPercent != null && discountPercent >= 70;
    const bonusCount = isPromoActive
      ? (typeof plan.freeProductBonusCount === 'number' ? plan.freeProductBonusCount : 1)
      : 0;

    await prisma.user.update({
      where: { id: authUser.id },
      data: {
        planId: plan.id,
        ...(plan.membershipPlan ? { membershipPlan: plan.membershipPlan } : {}),
        planStartsAt: now,
        planEndsAt: ends,
        ...(plan.planTrainersLimit != null ? { trainersLimit: plan.planTrainersLimit } : {}),
        // Always reset the monthly free-product quota on (re)selecting a plan
        freeProductsPerMonth: Number(plan.planFreeProducts ?? 0) + Number(bonusCount),
      } as any,
    });

    return res.status(200).json({
      message: 'Plan selected successfully',
      plan: plan.membershipPlan ?? null,
      planId: plan.id,
      planStartsAt: now.toISOString(),
      planEndsAt: ends.toISOString(),
      totalSlots,
      remainingSlots: Math.max(0, totalSlots - (activeSubscribers + 1)),
      limits: {
        trainersLimit: plan.planTrainersLimit ?? null,
        freeProductsPerMonth: plan.planFreeProducts ?? null,
        durationDays,
      },
      promo: {
        isPromoActive,
        discountPercent,
        bonusFreeProductsGranted: bonusCount,
        discountWindow: {
          startsAt: promoStarts ? promoStarts.toISOString() : null,
          endsAt: promoEnds ? promoEnds.toISOString() : null,
        },
      },
    });
  } catch (err) {
    console.error('subscribeByPlanId error', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

export const createPlan = async (req: Request, res: Response) => {
  try {
    const {
      name,
      description,
      imageUrl,
      price,
      membershipPlan,
      planDurationDays,
      planTrainersLimit,
      planFreeProducts,
      totalSlots,
      discountPercent,
      discountStartsAt,
      discountEndsAt,
      freeProductBonusCount,
    } = req.body as any;

    if (!name || price === undefined || price === null) {
      return res.status(400).json({ message: 'Name and price are required' });
    }

    const parsedSlots =
      totalSlots !== undefined && totalSlots !== null && totalSlots !== ''
        ? Number(totalSlots)
        : 50;

    const created = await (prisma as any).plan.create({
      data: {
        name: String(name).trim(),
        description: description?.trim() || undefined,
        imageUrl: imageUrl?.trim() || undefined,
        price: price as any,
        membershipPlan: membershipPlan ?? undefined,
        planDurationDays: typeof planDurationDays === 'number' ? planDurationDays : undefined,
        planTrainersLimit: typeof planTrainersLimit === 'number' ? planTrainersLimit : undefined,
        planFreeProducts: typeof planFreeProducts === 'number' ? planFreeProducts : undefined,
        totalSlots: Number.isNaN(parsedSlots) ? 50 : parsedSlots,
        discountPercent: typeof discountPercent === 'number' ? discountPercent : undefined,
        discountStartsAt: discountStartsAt ? new Date(discountStartsAt) : undefined,
        discountEndsAt: discountEndsAt ? new Date(discountEndsAt) : undefined,
        freeProductBonusCount: typeof freeProductBonusCount === 'number' ? freeProductBonusCount : undefined,
      },
    });
    return res.status(201).json({ message: 'Plan created', plan: created });
  } catch (err) {
    console.error('createPlan error', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

// Owner: update a plan
export const updatePlan = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const existing = await (prisma as any).plan.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ message: 'Plan not found' });

    const {
      name,
      description,
      imageUrl,
      price,
      membershipPlan,
      planDurationDays,
      planTrainersLimit,
      planFreeProducts,
      totalSlots,
      discountPercent,
      discountStartsAt,
      discountEndsAt,
      freeProductBonusCount,
    } = req.body as any;

    const parsedSlots =
      totalSlots !== undefined && totalSlots !== null && totalSlots !== ''
        ? Number(totalSlots)
        : undefined;

    const updated = await (prisma as any).plan.update({
      where: { id },
      data: {
        ...(name !== undefined ? { name: String(name).trim() } : {}),
        ...(description !== undefined ? { description: description?.trim() || null } : {}),
        ...(imageUrl !== undefined ? { imageUrl: imageUrl?.trim() || null } : {}),
        ...(price !== undefined ? { price: price as any } : {}),
        ...(membershipPlan !== undefined ? { membershipPlan } : {}),
        ...(planDurationDays !== undefined ? { planDurationDays } : {}),
        ...(planTrainersLimit !== undefined ? { planTrainersLimit } : {}),
        ...(planFreeProducts !== undefined ? { planFreeProducts } : {}),
        ...(parsedSlots !== undefined && !Number.isNaN(parsedSlots) ? { totalSlots: parsedSlots } : {}),
        ...(discountPercent !== undefined ? { discountPercent } : {}),
        ...(discountStartsAt !== undefined ? { discountStartsAt: discountStartsAt ? new Date(discountStartsAt) : null } : {}),
        ...(discountEndsAt !== undefined ? { discountEndsAt: discountEndsAt ? new Date(discountEndsAt) : null } : {}),
        ...(freeProductBonusCount !== undefined ? { freeProductBonusCount } : {}),
      },
    });
    return res.status(200).json({ message: 'Plan updated', plan: updated });
  } catch (err) {
    console.error('updatePlan error', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

// Owner: delete a plan
export const deletePlan = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const existing = await (prisma as any).plan.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ message: 'Plan not found' });
    await (prisma as any).plan.delete({ where: { id } });
    return res.status(200).json({ message: 'Plan deleted' });
  } catch (err) {
    console.error('deletePlan error', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
};
