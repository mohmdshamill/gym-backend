import { Request, Response } from 'express'
import { prisma } from '../connection/db.js'
import { Role, PaymentMethod , OrderStatus} from '@prisma/client'
import { sendMail } from '../utils/mailer.js'

// PRODUCTS (OWNER)
export const listProducts = async (_req: Request, res: Response) => {
  try {
    const products = await prisma.product.findMany({ orderBy: { createdAt: 'desc' } })
    return res.status(200).json({ products })
  } catch (err) {
    console.error('listProducts error', err)
    return res.status(500).json({ message: 'Internal server error' })
  }
}

export const createProduct = async (req: Request, res: Response) => {
  try {
    const { name, description, imageUrl, price, stock } = req.body as {
      name?: string; description?: string; imageUrl?: string; price?: string | number; stock?: number;
    }
    if (!name || price === undefined || price === null) {
      return res.status(400).json({ message: 'Name and price are required' })
    }
    const created = await prisma.product.create({
      data: ({
        name: name.trim(),
        description: description?.trim() || undefined,
        imageUrl: imageUrl?.trim() || undefined,
        price: price as any, // Prisma Decimal accepts string or Decimal
        stock: typeof stock === 'number' ? stock : 0,
      } as any),
    })
    return res.status(201).json({ message: 'Product created', product: created })
  } catch (err) {
    console.error('createProduct error', err)
    return res.status(500).json({ message: 'Internal server error' })
  }
}

export const updateProduct = async (req: Request, res: Response) => {
  try {
    const { id } = req.params
    const { name, description, imageUrl, price, stock } = req.body as {
      name?: string; description?: string; imageUrl?: string; price?: string | number; stock?: number;
    }

    const existing = await prisma.product.findUnique({ where: { id } })
    if (!existing) return res.status(404).json({ message: 'Product not found' })

    const updated = await prisma.product.update({
      where: { id },
      data: ({
        ...(name !== undefined ? { name: name.trim() } : {}),
        ...(description !== undefined ? { description: description?.trim() || null } : {}),
        ...(imageUrl !== undefined ? { imageUrl: imageUrl?.trim() || null } : {}),
        ...(price !== undefined ? { price: price as any } : {}),
        ...(stock !== undefined ? { stock } : {}),
      } as any),
    })
    return res.status(200).json({ message: 'Product updated', product: updated })
  } catch (err) {
    console.error('updateProduct error', err)
    return res.status(500).json({ message: 'Internal server error' })
  }
}

export const deleteProduct = async (req: Request, res: Response) => {
  try {
    const { id } = req.params
    const existing = await prisma.product.findUnique({ where: { id } })
    if (!existing) return res.status(404).json({ message: 'Product not found' })

    // Prevent deletion if the product has been used in any order items (keeps order history intact)
    const orderItemsCount = await prisma.orderItem.count({ where: { productId: id } })
    if (orderItemsCount > 0) {
      return res.status(409).json({
        message: 'Cannot delete product because it is referenced by existing orders. Consider archiving instead.'
      })
    }

    // Delete cart items referencing this product first, then delete the product
    await prisma.$transaction(async (tx) => {
      await tx.cartItem.deleteMany({ where: { productId: id } })
      await tx.product.delete({ where: { id } })
    })
    return res.status(200).json({ message: 'Product deleted' })
  } catch (err) {
    console.error('deleteProduct error', err)
    return res.status(500).json({ message: 'Internal server error' })
  }
}

// CART (USER)
export const getCart = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user as { id: string; role?: Role } | undefined
    if (!user?.id) return res.status(401).json({ message: 'Unauthorized' })

    const items = await prisma.cartItem.findMany({
      where: { userId: user.id },
      include: { product: true },
      orderBy: { createdAt: 'desc' },
    })

    const enriched = items.map((ci) => ({
      id: ci.id,
      productId: ci.productId,
      quantity: ci.quantity,
      product: ci.product,
      lineTotal: (Number(ci.product.price) * ci.quantity).toFixed(2),
    }))

    const subtotal = enriched.reduce((sum: number, it: { lineTotal: string }) => sum + Number(it.lineTotal), 0)

    // Compute freebies information for products under ₹800
    const dbUser = await prisma.user.findUnique({ where: { id: user.id } })
    const planEnds = (dbUser as any)?.planEndsAt as Date | null | undefined
    const planActive = Boolean(planEnds && new Date(planEnds) > new Date())
    const freebiesLimit = planActive ? ((dbUser as any)?.freeProductsPerMonth as number | null | undefined) : 0
    const freebiesRemaining = Math.max(0, freebiesLimit ?? 0)

    let potentialDiscount = 0
    if (freebiesRemaining > 0) {
      const eligibleUnitPrices: number[] = []
      for (const ci of items) {
        const unitPrice = Number(ci.product.price)
        if (unitPrice <= 800) {
          for (let i = 0; i < ci.quantity; i++) {
            eligibleUnitPrices.push(unitPrice)
          }
        }
      }
      eligibleUnitPrices.sort((a, b) => a - b)
      const freeUnits = eligibleUnitPrices.slice(0, Math.min(freebiesRemaining, eligibleUnitPrices.length))
      potentialDiscount = freeUnits.reduce((s, p) => s + p, 0)
    }

    const effectiveTotal = Math.max(0, subtotal - potentialDiscount)

    return res.status(200).json({
      items: enriched,
      total: subtotal.toFixed(2), // kept for backward compatibility
      subtotal: subtotal.toFixed(2),
      potentialDiscount: potentialDiscount.toFixed(2),
      effectiveTotal: effectiveTotal.toFixed(2),
      freebiesRemaining,
      freebiesLimit: freebiesLimit ?? 0,
    })
  } catch (err) {
    console.error('getCart error', err)
    return res.status(500).json({ message: 'Internal server error' })
  }
}

export const addToCart = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user as { id: string } | undefined
    if (!user?.id) return res.status(401).json({ message: 'Unauthorized' })
    const { productId, quantity } = req.body as { productId?: string; quantity?: number }
    if (!productId) return res.status(400).json({ message: 'productId is required' })

    const product = await prisma.product.findUnique({ where: { id: productId } })
    if (!product) return res.status(404).json({ message: 'Product not found' })

    const qty = typeof quantity === 'number' && quantity > 0 ? quantity : 1

    const existing = await prisma.cartItem.findUnique({ where: { userId_productId: { userId: user.id, productId } } })
    if (existing) {
      await prisma.cartItem.update({ where: { id: existing.id }, data: { quantity: existing.quantity + qty } })
    } else {
      await prisma.cartItem.create({ data: { userId: user.id, productId, quantity: qty } })
    }

    return res.status(200).json({ message: 'Added to cart' })
  } catch (err) {
    console.error('addToCart error', err)
    return res.status(500).json({ message: 'Internal server error' })
  }
}

export const removeFromCart = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user as { id: string } | undefined
    if (!user?.id) return res.status(401).json({ message: 'Unauthorized' })
    const { productId, quantity } = req.body as { productId?: string; quantity?: number }
    if (!productId) return res.status(400).json({ message: 'productId is required' })

    const existing = await prisma.cartItem.findUnique({ 
      where: { userId_productId: { userId: user.id, productId } },
      include: { product: true }
    })
    if (!existing) return res.status(404).json({ message: 'Item not in cart' })

    // If quantity is provided and greater than 0, update the quantity
    if (typeof quantity === 'number' && quantity > 0) {
      // Ensure we don't exceed available stock
      const newQuantity = Math.min(quantity, existing.product.stock)
      
      if (newQuantity < 1) {
        // If quantity would be less than 1, remove the item
        await prisma.cartItem.delete({
          where: { id: existing.id }
        })
        return res.status(200).json({ message: 'Item removed from cart' })
      }
      
      // Update the quantity
      await prisma.cartItem.update({
        where: { id: existing.id },
        data: { quantity: newQuantity }
      })
      return res.status(200).json({ message: 'Cart updated' })
    }

    // Otherwise, remove the item completely
    await prisma.cartItem.delete({ where: { id: existing.id } })
    return res.status(200).json({ message: 'Removed from cart' })
  } catch (err) {
    console.error('removeFromCart error', err)
    return res.status(500).json({ message: 'Internal server error' })
  }
}

export const updateCart = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user as { id: string } | undefined
    if (!user?.id) return res.status(401).json({ message: 'Unauthorized' })
    
    const { productId, quantity } = req.body as { productId?: string; quantity?: number }
    if (!productId || quantity === undefined) {
      return res.status(400).json({ message: 'productId and quantity are required' })
    }
    if (quantity < 0) {
      return res.status(400).json({ message: 'Quantity cannot be negative' })
    }

    const product = await prisma.product.findUnique({ where: { id: productId } })
    if (!product) return res.status(404).json({ message: 'Product not found' })

    const existing = await prisma.cartItem.findUnique({
      where: { userId_productId: { userId: user.id, productId } }
    })

    if (quantity === 0) {
      // If quantity is 0, remove the item
      if (existing) {
        await prisma.cartItem.delete({ where: { id: existing.id } })
      }
      return res.status(200).json({ message: 'Item removed from cart' })
    }

    if (existing) {
      // Update existing cart item
      await prisma.cartItem.update({
        where: { id: existing.id },
        data: { quantity }
      })
    } else {
      // Add new item to cart
      await prisma.cartItem.create({
        data: { userId: user.id, productId, quantity }
      })
    }

    return res.status(200).json({ message: 'Cart updated' })
  } catch (err) {
    console.error('updateCart error', err)
    return res.status(500).json({ message: 'Internal server error' })
  }
}

export const clearCart = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user as { id: string } | undefined
    if (!user?.id) return res.status(401).json({ message: 'Unauthorized' })
    await prisma.cartItem.deleteMany({ where: { userId: user.id } })
    return res.status(200).json({ message: 'Cart cleared' })
  } catch (err) {
    console.error('clearCart error', err)
    return res.status(500).json({ message: 'Internal server error' })
  }
}

// ORDERS
export const createOrder = async (req: Request, res: Response) => {
  try {
    const auth = (req as any).user as { id: string; name: string; email?: string } | undefined
    if (!auth?.id) return res.status(401).json({ message: 'Unauthorized' })

    const { paymentMethod } = req.body as { paymentMethod?: 'COD' | 'UPI' }
    const method: PaymentMethod = paymentMethod === 'UPI' ? PaymentMethod.UPI : PaymentMethod.COD

    const cartItems = await prisma.cartItem.findMany({ where: { userId: auth.id }, include: { product: true } })
    if (cartItems.length === 0) return res.status(400).json({ message: 'Cart is empty' })

    // Validate stock
    for (const ci of cartItems) {
      if (ci.product.stock < ci.quantity) {
        return res.status(409).json({ message: `Insufficient stock for ${ci.product.name}` })
      }
    }

    // Membership freebies: compute remaining freebies for products <= ₹800
    const dbUser = await prisma.user.findUnique({ where: { id: auth.id } })
    const planEnds = (dbUser as any)?.planEndsAt as Date | null | undefined
    const planActive = Boolean(planEnds && new Date(planEnds) > new Date())
    const freebiesLimit = planActive ? ((dbUser as any)?.freeProductsPerMonth as number | null | undefined) : 0
    const remaining = Math.max(0, freebiesLimit ?? 0)

    let discount = 0
    let freeUnitsClaimed = 0

    if (remaining > 0) {
      const eligibleUnitPrices: number[] = []
      for (const ci of cartItems) {
        const unitPrice = Number(ci.product.price)
        if (unitPrice <= 800) {
          for (let i = 0; i < ci.quantity; i++) {
            eligibleUnitPrices.push(unitPrice)
          }
        }
      }
      eligibleUnitPrices.sort((a, b) => a - b)
      const freeUnits = eligibleUnitPrices.slice(0, Math.min(remaining, eligibleUnitPrices.length))
      discount = freeUnits.reduce((s, p) => s + p, 0)
      freeUnitsClaimed = freeUnits.length
    }

    // Compute total after discount
    const subtotal = cartItems.reduce((sum, ci) => sum + (Number(ci.product.price) * ci.quantity), 0)
    const total = Math.max(0, subtotal - discount)

    // Transaction: create order, items, decrement stock, decrement user freebies, clear cart
    const order = await prisma.$transaction(async (tx) => {
      const created = await tx.order.create({
        data: {
          userId: auth.id,
          paymentMethod: method,
          status: OrderStatus.CONFIRMED, // Confirm immediately (COD or placeholder UPI)
          total: total.toFixed(2) as any,
        },
      })

      for (const ci of cartItems) {
        await tx.orderItem.create({
          data: {
            orderId: created.id,
            productId: ci.productId,
            quantity: ci.quantity,
            priceAtPurchase: (ci.product.price) as any,
          },
        })
        // Decrement stock for products
        await tx.product.update({ where: { id: ci.productId }, data: { stock: { decrement: ci.quantity } } })
      }

      // Deduct used free products from user's membership balance
      if (freeUnitsClaimed > 0) {
        await tx.user.update({
          where: { id: auth.id },
          data: {
            freeProductsPerMonth: Math.max(0, (freebiesLimit ?? 0) - freeUnitsClaimed),
          } as any,
        })
      }

      await tx.cartItem.deleteMany({ where: { userId: auth.id } })
      return created
    })

    // Email confirmation (best-effort)
    try {
      if (auth.email) {
        await sendMail({
          to: auth.email,
          subject: 'Order Confirmed',
          text: `Hi ${auth.name}, your order ${order.id} is confirmed. Payment method: ${method}. Total: ${total.toFixed(2)}.`,
        })
      }
    } catch (mailErr) {
      console.warn('Order email failed', mailErr)
    }

    return res.status(201).json({ message: 'Order created', order })
  } catch (err) {
    console.error('createOrder error', err)
    return res.status(500).json({ message: 'Internal server error' })
  }
}

export const listOrders = async (req: Request, res: Response) => {
  try {
    const auth = (req as any).user as { id: string; role?: Role } | undefined
    if (!auth?.id) return res.status(401).json({ message: 'Unauthorized' })

    const isOwner = auth.role === 'OWNER'
    const orders = await prisma.order.findMany({
      where: isOwner ? {} : { userId: auth.id },
      orderBy: { createdAt: 'desc' },
      include: { items: { include: { product: true } }, user: { select: { id: true, name: true, email: true, phone: true } } },
    })
    return res.status(200).json({ orders })
  } catch (err) {
    console.error('listOrders error', err)
    return res.status(500).json({ message: 'Internal server error' })
  }
}

// OWNER: update order status (tracking)
export const updateOrderStatus = async (req: Request, res: Response) => {
  try {
    const { id } = req.params
    const { status } = req.body as { status?: string }
    if (!status || !(Object.values(OrderStatus) as string[]).includes(status)) {
      return res.status(400).json({ message: 'Invalid status' })
    }
    const existing = await prisma.order.findUnique({ where: { id }, include: { items: true } })
    if (!existing) return res.status(404).json({ message: 'Order not found' })
    if (existing.status === OrderStatus.CANCELLED) {
      return res.status(400).json({ message: 'Cancelled orders cannot be changed' })
    }

    const order = await prisma.$transaction(async (tx) => {
      if (status === OrderStatus.CANCELLED) {
        for (const it of existing.items) {
          await tx.product.update({ where: { id: it.productId }, data: { stock: { increment: it.quantity } } })
        }
      }
      return tx.order.update({
        where: { id },
        data: { status: status as OrderStatus },
        include: { items: { include: { product: true } }, user: { select: { id: true, name: true, email: true, phone: true } } },
      })
    })
    return res.status(200).json({ order })
  } catch (err) {
    console.error('updateOrderStatus error', err)
    return res.status(500).json({ message: 'Internal server error' })
  }
}

export const getOrder = async (req: Request, res: Response) => {
  try {
    const auth = (req as any).user as { id: string; role?: Role } | undefined
    if (!auth?.id) return res.status(401).json({ message: 'Unauthorized' })

    const { id } = req.params
    const order = await prisma.order.findUnique({ where: { id }, include: { items: { include: { product: true } }, user: { select: { id: true, name: true, email: true, phone: true } } } })
    if (!order) return res.status(404).json({ message: 'Order not found' })

    const isOwner = auth.role === 'OWNER'
    if (!isOwner && order.userId !== auth.id) return res.status(403).json({ message: 'Forbidden' })

    return res.status(200).json({ order })
  } catch (err) {
    console.error('getOrder error', err)
    return res.status(500).json({ message: 'Internal server error' })
  }
}
