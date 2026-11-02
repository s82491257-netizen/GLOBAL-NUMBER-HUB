require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const axios = require('axios');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 10000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
// Serve frontend files from root or /public
app.use(express.static(path.join(__dirname)));
app.use(express.static(path.join(__dirname, 'public')));

// PostgreSQL - Render needs SSL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

// Test DB
pool.connect().then(() => console.log("PostgreSQL Connected")).catch(err => console.error("DB Error", err.message));

// JWT helpers
const JWT_SECRET = process.env.JWT_SECRET || 'global-number-hub-secret-2024';
const generateToken = (payload) => jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });

const auth = (req, res, next) => {
  const header = req.headers.authorization;
  if (!header) return res.status(401).json({ error: 'No token' });
  const token = header.split(' ')[1];
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }
};

const adminAuth = (req, res, next) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  next();
};

// ================= INIT TABLES =================
async function initTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      email VARCHAR(100) UNIQUE NOT NULL,
      password VARCHAR(200) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS admins (
      id SERIAL PRIMARY KEY,
      email VARCHAR(100) UNIQUE NOT NULL,
      password VARCHAR(200) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS numbers (
      id SERIAL PRIMARY KEY,
      country VARCHAR(50) NOT NULL,
      country_code VARCHAR(10),
      phone_number VARCHAR(50) UNIQUE NOT NULL,
      service_type VARCHAR(20) NOT NULL CHECK (service_type IN ('sms','call','both')),
      price_ghs DECIMAL(10,2) NOT NULL,
      available BOOLEAN DEFAULT true,
      provider_name VARCHAR(100),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS orders (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id),
      number_id INTEGER REFERENCES numbers(id),
      phone_number VARCHAR(50),
      country VARCHAR(50),
      service_type VARCHAR(20),
      price_ghs DECIMAL(10,2),
      status VARCHAR(20) DEFAULT 'pending',
      paystack_reference VARCHAR(100) UNIQUE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS payments (
      id SERIAL PRIMARY KEY,
      order_id INTEGER REFERENCES orders(id),
      user_id INTEGER REFERENCES users(id),
      reference VARCHAR(100) UNIQUE NOT NULL,
      amount_ghs DECIMAL(10,2) NOT NULL,
      status VARCHAR(20) DEFAULT 'pending',
      paystack_response JSONB,
      verified_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Create default admin if not exists - password: Admin@123 (you can change after login)
  const adminExists = await pool.query("SELECT * FROM admins WHERE email='admin@globalnumberhub.com'");
  if (adminExists.rows.length === 0) {
    const hash = await bcrypt.hash('Admin@123', 10);
    await pool.query("INSERT INTO admins (email, password) VALUES ($1,$2)", ['admin@globalnumberhub.com', hash]);
    console.log("Default admin created: admin@globalnumberhub.com / Admin@123");
  }
  console.log("Tables ready");
}
initTables();

// ================= PUBLIC API =================

// Countries list
const COUNTRIES = [
  { name: "USA", code: "US", flag: "🇺🇸" },
  { name: "UK", code: "GB", flag: "🇬🇧" },
  { name: "Canada", code: "CA", flag: "🇨🇦" },
  { name: "Germany", code: "DE", flag: "🇩🇪" },
  { name: "France", code: "FR", flag: "🇫🇷" },
  { name: "Australia", code: "AU", flag: "🇦🇺" },
  { name: "Netherlands", code: "NL", flag: "🇳🇱" },
  { name: "Spain", code: "ES", flag: "🇪🇸" },
  { name: "Ghana", code: "GH", flag: "🇬🇭" },
  { name: "Nigeria", code: "NG", flag: "🇳🇬" }
];

app.get('/api/countries', (req, res) => {
  res.json(COUNTRIES);
});

// Get available numbers with filters
app.get('/api/numbers', async (req, res) => {
  try {
    const { country, service } = req.query;
    let query = "SELECT * FROM numbers WHERE available = true";
    const params = [];
    if (country) {
      params.push(country);
      query += ` AND country = $${params.length}`;
    }
    if (service) {
      params.push(service);
      query += ` AND service_type = $${params.length}`;
    }
    query += " ORDER BY price_ghs ASC";
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// User register
app.post('/api/register', async (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password) return res.status(400).json({ error: 'All fields required' });
  try {
    const exists = await pool.query("SELECT id FROM users WHERE email=$1", [email.toLowerCase()]);
    if (exists.rows.length > 0) return res.status(400).json({ error: 'Email already exists' });
    const hash = await bcrypt.hash(password, 10);
    const result = await pool.query("INSERT INTO users (name, email, password) VALUES ($1,$2,$3) RETURNING id, name, email", [name, email.toLowerCase(), hash]);
    const token = generateToken({ id: result.rows[0].id, email, role: 'user' });
    res.json({ token, user: result.rows[0] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// User login
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const result = await pool.query("SELECT * FROM users WHERE email=$1", [email.toLowerCase()]);
    if (result.rows.length === 0) return res.status(400).json({ error: 'Invalid credentials' });
    const valid = await bcrypt.compare(password, result.rows[0].password);
    if (!valid) return res.status(400).json({ error: 'Invalid credentials' });
    const token = generateToken({ id: result.rows[0].id, email: result.rows[0].email, role: 'user' });
    res.json({ token, user: { id: result.rows[0].id, name: result.rows[0].name, email: result.rows[0].email } });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Admin login
app.post('/api/admin/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const result = await pool.query("SELECT * FROM admins WHERE email=$1", [email.toLowerCase()]);
    if (result.rows.length === 0) return res.status(400).json({ error: 'Invalid admin' });
    const valid = await bcrypt.compare(password, result.rows[0].password);
    if (!valid) return res.status(400).json({ error: 'Invalid admin' });
    const token = generateToken({ id: result.rows[0].id, email: result.rows[0].email, role: 'admin' });
    res.json({ token, admin: { email: result.rows[0].email } });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Create order (checkout - before payment)
app.post('/api/orders', auth, async (req, res) => {
  const { number_id } = req.body;
  if (!number_id) return res.status(400).json({ error: 'number_id required' });
  try {
    const num = await pool.query("SELECT * FROM numbers WHERE id=$1 AND available=true", [number_id]);
    if (num.rows.length === 0) return res.status(404).json({ error: 'Number not available' });
    const n = num.rows[0];
    const reference = 'GNH_' + Date.now() + '_' + Math.floor(Math.random()*1000);
    const order = await pool.query(
      "INSERT INTO orders (user_id, number_id, phone_number, country, service_type, price_ghs, status, paystack_reference) VALUES ($1,$2,$3,$4,$5,$6,'pending',$7) RETURNING *",
      [req.user.id, n.id, n.phone_number, n.country, n.service_type, n.price_ghs, reference]
    );
    await pool.query("INSERT INTO payments (order_id, user_id, reference, amount_ghs, status) VALUES ($1,$2,$3,$4,'pending')", [order.rows[0].id, req.user.id, reference, n.price_ghs]);
    res.json({ order: order.rows[0], reference, amount: n.price_ghs });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PAYSTACK VERIFY - Secure delivery only after verification
app.post('/api/paystack/verify', auth, async (req, res) => {
  const { reference } = req.body;
  if (!reference) return res.status(400).json({ error: 'Reference required' });
  try {
    const secret = process.env.PAYSTACK_SECRET_KEY;
    if (!secret) return res.status(500).json({ error: 'Paystack not configured on server' });

    // Verify with Paystack
    const paystackRes = await axios.get(`https://api.paystack.co/transaction/verify/${reference}`, {
      headers: { Authorization: `Bearer ${secret}` }
    });

    const data = paystackRes.data;
    if (!data.status || data.data.status !== 'success') {
      await pool.query("UPDATE payments SET status='failed', paystack_response=$1 WHERE reference=$2", [data, reference]);
      await pool.query("UPDATE orders SET status='failed' WHERE paystack_reference=$1", [reference]);
      return res.status(400).json({ error: 'Payment not successful', paystack: data });
    }

    // Success - deliver number
    await pool.query("UPDATE payments SET status='success', paystack_response=$1, verified_at=NOW() WHERE reference=$2", [data, reference]);
    const orderRes = await pool.query("UPDATE orders SET status='completed' WHERE paystack_reference=$1 RETURNING *", [reference]);
    if (orderRes.rows.length > 0) {
      await pool.query("UPDATE numbers SET available=false WHERE id=$1", [orderRes.rows[0].number_id]);
    }
    res.json({ message: 'Payment verified and number delivered', order: orderRes.rows[0], paystack: data.data });
  } catch (e) {
    console.error(e.response?.data || e.message);
    res.status(500).json({ error: 'Verification failed', details: e.response?.data || e.message });
  }
});

// User dashboard - orders
app.get('/api/my/orders', auth, async (req, res) => {
  try {
    const result = await pool.query("SELECT o.*, n.provider_name FROM orders o LEFT JOIN numbers n ON o.number_id=n.id WHERE o.user_id=$1 ORDER BY o.created_at DESC", [req.user.id]);
    res.json(result.rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// User profile
app.get('/api/my/profile', auth, async (req, res) => {
  const result = await pool.query("SELECT id, name, email, created_at FROM users WHERE id=$1", [req.user.id]);
  res.json(result.rows[0]);
});

// ================= ADMIN API =================
app.get('/api/admin/stats', auth, adminAuth, async (req, res) => {
  try {
    const users = await pool.query("SELECT COUNT(*) FROM users");
    const numbers = await pool.query("SELECT COUNT(*) FROM numbers");
    const orders = await pool.query("SELECT COUNT(*) FROM orders WHERE status='completed'");
    const revenue = await pool.query("SELECT COALESCE(SUM(price_ghs),0) as total FROM orders WHERE status='completed'");
    res.json({
      total_users: users.rows[0].count,
      total_numbers: numbers.rows[0].count,
      total_orders: orders.rows[0].count,
      total_revenue_ghs: revenue.rows[0].total
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/admin/users', auth, adminAuth, async (req, res) => {
  const result = await pool.query("SELECT id, name, email, created_at FROM users ORDER BY created_at DESC");
  res.json(result.rows);
});

app.get('/api/admin/numbers', auth, adminAuth, async (req, res) => {
  const result = await pool.query("SELECT * FROM numbers ORDER BY created_at DESC");
  res.json(result.rows);
});

app.post('/api/admin/numbers', auth, adminAuth, async (req, res) => {
  const { country, country_code, phone_number, service_type, price_ghs, provider_name } = req.body;
  if (!country || !phone_number || !service_type || !price_ghs) return res.status(400).json({ error: 'Missing fields' });
  try {
    const result = await pool.query("INSERT INTO numbers (country, country_code, phone_number, service_type, price_ghs, provider_name, available) VALUES ($1,$2,$3,$4,$5,$6,true) RETURNING *", [country, country_code, phone_number, service_type, price_ghs, provider_name]);
    res.json(result.rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/admin/numbers/:id', auth, adminAuth, async (req, res) => {
  await pool.query("DELETE FROM numbers WHERE id=$1", [req.params.id]);
  res.json({ message: 'Deleted' });
});

app.get('/api/admin/orders', auth, adminAuth, async (req, res) => {
  const result = await pool.query("SELECT o.*, u.email as user_email, u.name as user_name FROM orders o LEFT JOIN users u ON o.user_id=u.id ORDER BY o.created_at DESC");
  res.json(result.rows);
});

app.get('/api/admin/payments', auth, adminAuth, async (req, res) => {
  const result = await pool.query("SELECT p.*, u.email as user_email FROM payments p LEFT JOIN users u ON p.user_id=u.id ORDER BY p.created_at DESC");
  res.json(result.rows);
});

// Frontend catch-all
app.get('*', (req, res) => {
  const indexPath = path.join(__dirname, 'index.html');
  const publicIndex = path.join(__dirname, 'public', 'index.html');
  const fs = require('fs');
  if (fs.existsSync(indexPath)) return res.sendFile(indexPath);
  if (fs.existsSync(publicIndex)) return res.sendFile(publicIndex);
  res.send(`
    <h1>GLOBAL NUMBER HUB API Running</h1>
    <p>Frontend not found, but API is live.</p>
    <p>Visit /api/countries to test</p>
  `);
});

app.listen(PORT, () => {
  console.log(`GLOBAL NUMBER HUB running on port ${PORT}`);
});