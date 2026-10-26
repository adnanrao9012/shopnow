import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import rateLimit from 'express-rate-limit';
import path from 'path';
import { fileURLToPath } from 'url';
import adminRouter from './admin.js';
import { Product, Order, User } from './server/models.js';

dotenv.config();

const app = express();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Security & Middleware
app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(cors({ origin: process.env.FRONTEND_URL || '*', credentials: true }));
app.use(express.json());

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: 'Too many requests, please try again later.',
});
app.use('/api/', apiLimiter);

// Database Connection (Optimized for Serverless)
let cachedDb = null;
async function connectDB() {
  if (cachedDb) return cachedDb;
  const db = await mongoose.connect(process.env.MONGODB_URI, {
    maxPoolSize: 10,
  });
  cachedDb = db;
  return db;
}
connectDB().catch(console.error);

// ---------------- REST API ROUTES ----------------

// Products API
app.get('/api/products', async (req, res) => {
  try {
    const { category, search, sort } = req.query;
    let query = {};
    if (category) query.category = category;
    if (search) query.name = { $regex: search, $options: 'i' };
    
    let sortConfig = {};
    if (sort === 'price_asc') sortConfig.price = 1;
    if (sort === 'price_desc') sortConfig.price = -1;
    if (sort === 'newest') sortConfig.createdAt = -1;

    const products = await Product.find(query).sort(sortConfig);
    res.json(products);
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/products/:id', async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ error: 'Product not found' });
    res.json(product);
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Secure Checkout & Order API (Server-side Calculation)
app.post('/api/orders', async (req, res) => {
  try {
    const { customer, shippingAddress, items, shippingMethod } = req.body;
    
    let subtotal = 0;
    const orderItems = [];

    // Never trust client prices; fetch from DB
    for (const item of items) {
      const product = await Product.findById(item.productId);
      if (!product || product.stock < item.quantity) {
        return res.status(400).json({ error: `Product ${product?.name || item.productId} unavailable or insufficient stock.` });
      }
      subtotal += product.price * item.quantity;
      orderItems.push({
        product: product._id,
        name: product.name,
        price: product.price,
        quantity: item.quantity
      });
      
      // Reserve stock safely
      product.stock -= item.quantity;
      await product.save();
    }

    const shippingFee = shippingMethod === 'express' ? 15.00 : 5.00;
    const tax = subtotal * 0.08; // 8% tax demo
    const total = subtotal + shippingFee + tax;

    const order = new Order({
      orderNumber: `NC-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      customer,
      shippingAddress,
      items: orderItems,
      subtotal,
      tax,
      shippingFee,
      total,
      paymentStatus: 'Pending', // Demo COD
      orderStatus: 'Processing'
    });

    await order.save();
    res.status(201).json({ success: true, orderNumber: order.orderNumber, total });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Order processing failed' });
  }
});

// Mount Admin Module
app.use('/api/admin', adminRouter);

// Health Check
app.get('/api/health', (req, res) => {
  res.status(200).json({ status: 'ok', time: new Date() });
});

// Export for Vercel Serverless
export default app;

// Local Development Server
if (process.env.NODE_ENV !== 'production') {
  const PORT = process.env.PORT || 5000;
  app.listen(PORT, () => console.log(`NovaCart Server running on port ${PORT}`));
}
