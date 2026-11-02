
const express = require("express");
const session = require("express-session");
const PgSession = require("connect-pg-simple")(session);
const bcrypt = require("bcryptjs");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const { Pool } = require("pg");

const app = express();
const PORT = process.env.PORT || 3000;

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required");
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

app.set("trust proxy", 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: "20kb" }));
app.use(express.urlencoded({ extended: false }));

app.use(session({
  store: new PgSession({
    pool,
    tableName: "user_sessions",
    createTableIfMissing: true
  }),
  secret: process.env.SESSION_SECRET || require("crypto").randomBytes(48).toString("hex"),
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 7 * 24 * 60 * 60 * 1000
  }
}));

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false
});

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function initializeDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      email VARCHAR(255) UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role VARCHAR(20) NOT NULL DEFAULT 'customer',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS orders (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id),
      country VARCHAR(100) NOT NULL,
      service VARCHAR(50) NOT NULL,
      amount NUMERIC(12,2) NOT NULL,
      currency VARCHAR(10) NOT NULL DEFAULT 'GHS',
      status VARCHAR(30) NOT NULL DEFAULT 'pending',
      provider_reference VARCHAR(255),
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS payments (
      id SERIAL PRIMARY KEY,
      order_id INTEGER REFERENCES orders(id),
      reference VARCHAR(255) UNIQUE NOT NULL,
      amount NUMERIC(12,2) NOT NULL,
      status VARCHAR(30) NOT NULL DEFAULT 'pending',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS number_inventory (
      id SERIAL PRIMARY KEY,
      country VARCHAR(100) NOT NULL,
      number_type VARCHAR(50) NOT NULL,
      phone_number VARCHAR(50),
      provider VARCHAR(100),
      provider_id VARCHAR(255),
      price NUMERIC(12,2),
      currency VARCHAR(10) DEFAULT 'GHS',
      status VARCHAR(30) DEFAULT 'unavailable',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
}

function requireLogin(req, res, next) {
  if (!req.session.user) {
    return res.status(401).json({ error: "Please log in first." });
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session.user || req.session.user.role !== "admin") {
    return res.status(403).json({ error: "Administrator access required." });
  }
  next();
}

function safeUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role
  };
}

// REGISTER
app.post("/api/register", authLimiter, async (req, res) => {
  try {
    const name = String(req.body.name || "").trim();
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");
    const adminToken = String(req.body.adminToken || "");

    if (name.length < 2 || name.length > 100) {
      return res.status(400).json({ error: "Enter a valid name." });
    }

    if (!emailPattern.test(email) || email.length > 255) {
      return res.status(400).json({ error: "Enter a valid email." });
    }

    if (password.length < 10 || password.length > 72) {
      return res.status(400).json({
        error: "Password must be at least 10 characters."
      });
    }

    const isAdmin =
      process.env.ADMIN_EMAIL &&
      process.env.ADMIN_SETUP_TOKEN &&
      email === process.env.ADMIN_EMAIL.trim().toLowerCase() &&
      adminToken.length > 0 &&
      adminToken === process.env.ADMIN_SETUP_TOKEN;

    const role = isAdmin ? "admin" : "customer";
    const passwordHash = await bcrypt.hash(password, 12);

    const result = await pool.query(
      `INSERT INTO users (name, email, password_hash, role)
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, email, role`,
      [name, email, passwordHash, role]
    );

    req.session.regenerate((err) => {
      if (err) return res.status(500).json({ error: "Session error." });

      req.session.user = safeUser(result.rows[0]);

      req.session.save((saveErr) => {
        if (saveErr) return res.status(500).json({ error: "Login error." });
        res.status(201).json({
          message: "Account created successfully.",
          user: req.session.user
        });
      });
    });
  } catch (error) {
    if (error.code === "23505") {
      return res.status(409).json({ error: "This email is already registered." });
    }
    console.error("Registration error:", error.message);
    res.status(500).json({ error: "Could not create your account." });
  }
});

// LOGIN
app.post("/api/login", authLimiter, async (req, res) => {
  try {
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");

    const result = await pool.query(
      "SELECT * FROM users WHERE email = $1",
      [email]
    );

    const user = result.rows[0];

    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ error: "Incorrect email or password." });
    }

    req.session.regenerate((err) => {
      if (err) return res.status(500).json({ error: "Session error." });

      req.session.user = safeUser(user);

      req.session.save((saveErr) => {
        if (saveErr) return res.status(500).json({ error: "Login error." });
        res.json({
          message: "Welcome back!",
          user: req.session.user
        });
      });
    });
  } catch (error) {
    console.error("Login error:", error.message);
    res.status(500).json({ error: "Login failed." });
  }
});

// CURRENT CUSTOMER
app.get("/api/me", requireLogin, (req, res) => {
  res.json({ user: req.session.user });
});

// CUSTOMER ORDERS
app.get("/api/my-orders", requireLogin, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, country, service, amount, currency, status, created_at
       FROM orders WHERE user_id = $1 ORDER BY created_at DESC`,
      [req.session.user.id]
    );
    res.json({ orders: result.rows });
  } catch (error) {
    res.status(500).json({ error: "Could not load orders." });
  }
});

// ADMIN OVERVIEW
app.get("/api/admin/overview", requireAdmin, async (req, res) => {
  try {
    const [users, orders, payments, inventory] = await Promise.all([
      pool.query("SELECT COUNT(*) FROM users"),
      pool.query("SELECT COUNT(*) FROM orders"),
      pool.query("SELECT COUNT(*) FROM payments WHERE status = 'success'"),
      pool.query("SELECT COUNT(*) FROM number_inventory")
    ]);

    res.json({
      customers: Number(users.rows[0].count),
      orders: Number(orders.rows[0].count),
      successfulPayments: Number(payments.rows[0].count),
      inventoryItems: Number(inventory.rows[0].count)
    });
  } catch (error) {
    res.status(500).json({ error: "Could not load admin overview." });
  }
});

// ADMIN CUSTOMER LIST
app.get("/api/admin/customers", requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, name, email, role, created_at
       FROM users ORDER BY created_at DESC LIMIT 200`
    );
    res.json({ customers: result.rows });
  } catch (error) {
    res.status(500).json({ error: "Could not load customers." });
  }
});

// ADMIN ORDER LIST
app.get("/api/admin/orders", requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT orders.*, users.name, users.email
       FROM orders
       LEFT JOIN users ON users.id = orders.user_id
       ORDER BY orders.created_at DESC LIMIT 200`
    );
    res.json({ orders: result.rows });
  } catch (error) {
    res.status(500).json({ error: "Could not load orders." });
  }
});

// LOGOUT
app.post("/api/logout", requireLogin, (req, res) => {
  req.session.destroy((err) => {
    if (err) return res.status(500).json({ error: "Could not log out." });
    res.clearCookie("connect.sid");
    res.json({ message: "Logged out successfully." });
  });
});

// WEBSITE
app.get("/", (req, res) => {
  res.type("html").send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>GLOBAL NUMBER HUB</title>
<style>
*{box-sizing:border-box}
body{margin:0;background:#07111f;color:#fff;font-family:Arial,sans-serif}
header{padding:20px 6%;background:#0b192c;display:flex;justify-content:space-between;align-items:center;gap:12px}
.logo{color:#42a5ff;font-size:20px;font-weight:900}
nav a{color:#fff;text-decoration:none;margin-left:15px;font-size:14px}
.hero{text-align:center;padding:65px 18px;background:linear-gradient(135deg,#102e55,#07111f)}
.hero h1{font-size:clamp(35px,7vw,58px);margin:0 0 15px}
.hero h1 span{color:#42a5ff}
.hero p{color:#bdcde0;line-height:1.7}
.container{max-width:950px;margin:auto;padding:35px 18px}
.heading{text-align:center;margin-bottom:25px}
.heading p,.muted{color:#aebfd3}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px}
.card,.panel{background:#10223a;border:1px solid #294969;border-radius:14px;padding:22px}
.card h3{color:#58b5ff}
button{background:#1689ed;color:white;border:0;border-radius:8px;padding:13px 18px;font-weight:bold;cursor:pointer}
button.secondary{background:#263c56}
input,select{width:100%;padding:13px;margin:8px 0 15px;border-radius:8px;border:1px solid #45627e;background:#07111f;color:white}
label{font-size:14px}
.panel{max-width:600px;margin:20px auto}
.hidden{display:none!important}
.notice{padding:12px;border-radius:8px;background:#25351e;color:#d8f5a6;margin:12px 0}
.error{background:#4a2027;color:#ffd2d2}
table{width:100%;border-collapse:collapse;font-size:13px}
td,th{padding:10px;border-bottom:1px solid #34506c;text-align:left}
footer{text-align:center;padding:35px;color:#9db1c8}
a{color:#67b9ff}
@media(max-width:550px){header{align-items:flex-start;flex-direction:column}nav a{margin:0 12px 0 0}}
</style>
</head>
<body>
<header>
<div class="logo">GLOBAL NUMBER HUB</div>
<nav>
<a href="#services">Services</a>
<a href="#account">Account</a>
<a href="#account" id="navAccount">Login</a>
</nav>
</header>

<section class="hero">
<h1>Your Numbers.<br><span>Your World.</span></h1>
<p>International virtual numbers for supported SMS, calls and messaging services.</p>
<a href="#services"><button>Explore Services</button></a>
</section>

<section class="container" id="services">
<div class="heading">
<h2>Our Services</h2>
<p>Choose the service you need. Live inventory will appear when approved suppliers are connected.</p>
</div>
<div class="grid">
<div class="card"><h3>SMS Verification</h3><p>Eligible virtual numbers for receiving supported SMS messages.</p></div>
<div class="card"><h3>Calls and SMS</h3><p>Virtual numbers with calling and messaging features where supported.</p></div>
<div class="card"><h3>International Countries</h3><p>Explore USA, UK, Canada, Germany, France and more.</p></div>
</div>
</section>

<section class="container" id="account">
<div class="heading">
<h2>Customer Account</h2>
<p>Create an account or log in to view your dashboard.</p>
</div>

<div class="panel" id="authPanel">
<div id="registerForm">
<h3>Create Account</h3>
<label>Full name</label>
<input id="regName" autocomplete="name" placeholder="Your name">
<label>Email address</label>
<input id="regEmail" type="email" autocomplete="email" placeholder="you@example.com">
<label>Password (minimum 10 characters)</label>
<input id="regPassword" type="password" autocomplete="new-password" placeholder="Create a password">
<label>Administrator setup token (leave blank for customers)</label>
<input id="adminToken" type="password" autocomplete="off" placeholder="Only for the administrator">
<button onclick="register()">Create Account</button>
<p class="muted">Already registered? <a href="#" onclick="showLogin();return false">Log in</a></p>
</div>

<div id="loginForm" class="hidden">
<h3>Log In</h3>
<label>Email address</label>
<input id="loginEmail" type="email" autocomplete="email" placeholder="you@example.com">
<label>Password</label>
<input id="loginPassword" type="password" autocomplete="current-password" placeholder="Your password">
<button onclick="login()">Log In</button>
<p class="muted">New here? <a href="#" onclick="showRegister();return false">Create account</a></p>
</div>
<div id="message" class="notice hidden"></div>
</div>

<div class="panel hidden" id="customerPanel">
<h2>Welcome, <span id="customerName"></span></h2>
<p id="customerEmail" class="muted"></p>
<h3>Your Orders</h3>
<div id="myOrders" class="muted">No orders yet.</div>
<button class="secondary" onclick="logout()">Log Out</button>
</div>

<div class="panel hidden" id="adminPanel">
<h2>Administrator Dashboard</h2>
<p id="adminEmail" class="muted"></p>
<div class="grid">
<div class="card"><h3 id="statCustomers">0</h3><p>Customers</p></div>
<div class="card"><h3 id="statOrders">0</h3><p>Orders</p></div>
<div class="card"><h3 id="statPayments">0</h3><p>Successful payments</p></div>
<div class="card"><h3 id="statInventory">0</h3><p>Inventory records</p></div>
</div>
<h3>Recent Customers</h3>
<div id="customerList" class="muted">Loading...</div>
<h3>Orders</h3>
<div id="orderList" class="muted">Loading...</div>
<button class="secondary" onclick="logout()">Log Out</button>
</div>
</section>

<footer>
<strong>GLOBAL NUMBER HUB</strong><br>
Your Numbers. Your World.<br>
International virtual number marketplace.
</footer>

<script>
const el=id=>document.getElementById(id);

function showMessage(text,isError=false){
 const box=el("message");
 box.textContent=text;
 box.classList.remove("hidden","error");
 if(isError)box.classList.add("error");
}

function showRegister(){
 el("registerForm").classList.remove("hidden");
 el("loginForm").classList.add("hidden");
}
function showLogin(){
 el("loginForm").classList.remove("hidden");
 el("registerForm").classList.add("hidden");
}

async function api(url,method="GET",body){
 const response=await fetch(url,{
  method,
  credentials:"same-origin",
  headers:body?{"Content-Type":"application/json"}:{},
  body:body?JSON.stringify(body):undefined
 });
 const data=await response.json();
 if(!response.ok)throw new Error(data.error||"Something went wrong.");
 return data;
}

async function register(){
 try{
  const data=await api("/api/register","POST",{
   name:el("regName").value,
   email:el("regEmail").value,
   password:el("regPassword").value,
   adminToken:el("adminToken").value
  });
  showMessage(data.message);
  await loadAccount();
 }catch(e){showMessage(e.message,true)}
}

async function login(){
 try{
  const data=await api("/api/login","POST",{
   email:el("loginEmail").value,
   password:el("loginPassword").value
  });
  showMessage(data.message);
  await loadAccount();
 }catch(e){showMessage(e.message,true)}
}

async function logout(){
 try{
  await api("/api/logout","POST",{});
  location.reload();
 }catch(e){showMessage(e.message,true)}
}

function renderTable(container,columns,rows){
 if(!rows.length){container.textContent="No records yet.";return}
 const table=document.createElement("table");
 const head=document.createElement("tr");
 columns.forEach(col=>{
  const th=document.createElement("th");
  th.textContent=col.label;
  head.appendChild(th);
 });
 const thead=document.createElement("thead");
 thead.appendChild(head);
 table.appendChild(thead);
 const tbody=document.createElement("tbody");
 rows.forEach(row=>{
  const tr=document.createElement("tr");
  columns.forEach(col=>{
   const td=document.createElement("td");
   td.textContent=row[col.key]??"";
   tr.appendChild(td);
  });
  tbody.appendChild(tr);
 });
 table.appendChild(tbody);
 container.replaceChildren(table);
}

async function loadAccount(){
 try{
  const data=await api("/api/me");
  el("authPanel").classList.add("hidden");
  el("customerName").textContent=data.user.name;
  el("customerEmail").textContent=data.user.email;
  el("navAccount").textContent="Dashboard";

  if(data.user.role==="admin"){
   el("adminPanel").classList.remove("hidden");
   el("adminEmail").textContent=data.user.email;
   const overview=await api("/api/admin/overview");
   el("statCustomers").textContent=overview.customers;
   el("statOrders").textContent=overview.orders;
   el("statPayments").textContent=overview.successfulPayments;
   el("statInventory").textContent=overview.inventoryItems;
   const customers=await api("/api/admin/customers");
   renderTable(el("customerList"),[
    {key:"name",label:"Name"},
    {key:"email",label:"Email"},
    {key:"role",label:"Role"}
   ],customers.customers);
   const orders=await api("/api/admin/orders");
   renderTable(el("orderList"),[
    {key:"id",label:"Order"},
    {key:"name",label:"Customer"},
    {key:"country",label:"Country"},
    {key:"status",label:"Status"}
   ],orders.orders);
  }else{
   el("customerPanel").classList.remove("hidden");
   const orders=await api("/api/my-orders");
   renderTable(el("myOrders"),[
    {key:"id",label:"Order"},
    {key:"country",label:"Country"},
    {key:"service",label:"Service"},
    {key:"status",label:"Status"}
   ],orders.orders);
  }
 }catch(e){
  if(e.message!=="Please log in first.")console.error(e);
 }
}

loadAccount();
</script>
</body>
</html>`);
});

app.get("/health", (req, res) => {
  res.json({ status: "online", website: "GLOBAL NUMBER HUB" });
});

async function start() {
  await initializeDatabase();
  app.listen(PORT, "0.0.0.0", () => {
    console.log("GLOBAL NUMBER HUB running on port " + PORT);
  });
}

start().catch(error => {
  console.error("Startup error:", error);
  process.exit(1);
});


