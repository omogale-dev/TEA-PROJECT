require("dotenv").config();

const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
const nodemailer = require("nodemailer");

const app = express();
const PORT = process.env.PORT || 4000;

// --- MIDDLEWARE ---
app.use(cors());
app.use(express.json());

// --- TEMP PRODUCTS (CAN LATER MOVE TO DB) ---
const products = [
  { id: 1, name: "Himalayan Dawn Green", price: 650, size: "80g", tag: "Single estate" },
  { id: 2, name: "Moonlit Chamomile",   price: 580, size: "50g", tag: "Caffeine‑free" },
  { id: 3, name: "Smoked Oak Assam",    price: 720, size: "100g", tag: "Small batch" }
];

// --- MONGODB + MONGOOSE SETUP ---
const MONGO_URL = process.env.MONGO_URL || "mongodb://127.0.0.1:27017/anvis-tea";

// Schema & model
const orderSchema = new mongoose.Schema({
  name: String,
  phone: String,
  address: String,
  cart: [
    {
      id: String,
      name: String,
      price: Number,
      qty: Number
    }
  ],
  createdAt: { type: Date, default: Date.now }
});

const Order = mongoose.model("Order", orderSchema);

// In‑memory fallback store (for Render without Mongo)
const memoryOrders = [];

// --- EMAIL (Nodemailer) ---
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.ORDER_EMAIL_USER,
    pass: process.env.ORDER_EMAIL_PASS
  }
});

async function sendOrderEmail(order) {
  const itemsText = (order.cart || [])
    .map(i => `${i.name} x ${i.qty} (₹${i.price} each)`)
    .join("\n");

  const mailOptions = {
    from: `"Anvi's Tea Orders" <${process.env.ORDER_EMAIL_USER}>`,
    to: process.env.ORDER_NOTIFY_TO || process.env.ORDER_EMAIL_USER,
    subject: `New order #${order._id} from ${order.name}`,
    text:
      `Name: ${order.name}\n` +
      `Phone: ${order.phone}\n` +
      `Address: ${order.address}\n\n` +
      `Items:\n${itemsText}\n\n` +
      `Placed at: ${order.createdAt}`
  };

  await transporter.sendMail(mailOptions);
}

// Connect to Mongo (if available) and start server
async function start() {
  try {
    if (!process.env.MONGO_URL || process.env.MONGO_URL.includes("127.0.0.1")) {
      console.log("No remote Mongo configured; using in‑memory orders on this server.");
    } else {
      await mongoose.connect(MONGO_URL);
      console.log("Connected to MongoDB");
    }

    app.listen(PORT, () => {
      console.log(`Backend running on port ${PORT}`);
    });
  } catch (err) {
    console.error("MongoDB connection error:", err);
    // still start the server with in‑memory store
    app.listen(PORT, () => {
      console.log(`Backend running with in‑memory store on port ${PORT}`);
    });
  }
}

start();

// --- ROUTES ---

// Health check
app.get("/", (req, res) => {
  res.send("Anvi's Tea backend is running");
});

// List products
app.get("/api/products", (req, res) => {
  res.json(products);
});

// Create order
app.post("/api/orders", async (req, res) => {
  try {
    const { name, phone, address, cart } = req.body;

    if (!name || !phone || !address || !Array.isArray(cart) || cart.length === 0) {
      return res.status(400).json({ message: "Invalid order data" });
    }

    let savedOrder;

    if (mongoose.connection.readyState === 1) {
      // Mongo connected
      savedOrder = await Order.create({ name, phone, address, cart });
    } else {
      // In‑memory fallback
      savedOrder = {
        _id: memoryOrders.length + 1,
        name,
        phone,
        address,
        cart,
        createdAt: new Date()
      };
      memoryOrders.push(savedOrder);
    }

    // send email (do not block the response if email fails)
    sendOrderEmail(savedOrder).catch(err => {
      console.error("Error sending order email:", err);
    });

    res.json({ message: "Order received", orderId: savedOrder._id });
  } catch (err) {
    console.error("Error creating order:", err);
    res.status(500).json({ message: "Server error while creating order" });
  }
});

// View all orders (for you/admin)
app.get("/api/orders", async (req, res) => {
  try {
    if (mongoose.connection.readyState === 1) {
      const allOrders = await Order.find().sort({ createdAt: -1 });
      return res.json(allOrders);
    }
    const all = [...memoryOrders].sort((a, b) => b.createdAt - a.createdAt);
    res.json(all);
  } catch (err) {
    console.error("Error fetching orders:", err);
    res.status(500).json({ message: "Server error while fetching orders" });
  }
});
