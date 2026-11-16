import { Request, Response } from 'express'
import { prisma } from '../connection/db.js'
import { Role } from '@prisma/client'

export const getOwnerStats = async (_req: Request, res: Response) => {
  try {
    const now = new Date()

    const [
      totalUsers,
      totalTrainers,
      assignedUsers,
      totalShopProducts,
      totalOrders,
      orders,
      orderItems,
      totalPlans,
      activePlanSubscribers,
    ] = await Promise.all([
      prisma.user.count({ where: { role: Role.USER } }),
      prisma.trainer.count(),
      prisma.user.count({ where: { role: Role.USER, trainerId: { not: null } } }),
      prisma.product.count(),
      prisma.order.count(),
      prisma.order.findMany({ select: { total: true } }),
      prisma.orderItem.findMany({ select: { quantity: true } }),
      (prisma as any).plan.count(),
      prisma.user.count({ where: { role: Role.USER, planEndsAt: { gt: now } } }),
    ])

    const totalSalesRevenue = orders.reduce((sum, o) => sum + Number(o.total || 0), 0)
    const totalProductsSold = orderItems.reduce((sum, item) => sum + Number(item.quantity || 0), 0)

    return res.status(200).json({
      totalUsers,
      totalTrainers,
      assignedUsers,
      totalShopProducts,
      totalOrders,
      totalSalesRevenue: Number(totalSalesRevenue.toFixed(2)),
      totalProductsSold,
      totalPlans,
      activePlanSubscribers,
    })
  } catch (err) {
    console.error('getOwnerStats error', err)
    return res.status(500).json({ message: 'Internal server error' })
  }
}
