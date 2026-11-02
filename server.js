
const express = require("express");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get("/health", (req, res) => {
  res.json({ status: "online", website: "GLOBAL NUMBER HUB" });
});

app.get("/", (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>GLOBAL NUMBER HUB</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:Arial,sans-serif;background:#07111f;color:white}
header{padding:20px 6%;display:flex;justify-content:space-between;align-items:center;background:#0b192c;border-bottom:1px solid #193456}
.logo{font-size:21px;font-weight:900;color:#42a5ff}
nav a{color:white;text-decoration:none;margin-left:18px;font-size:14px}
.hero{text-align:center;padding:75px 18px 60px;background:linear-gradient(135deg,#102e55,#07111f 70%)}
.hero h1{font-size:clamp(35px,7vw,58px);margin-bottom:15px}
.hero h1 span{color:#39a6ff}
.hero p{color:#b9cce0;line-height:1.7;max-width:600px;margin:auto}
.btn{display:inline-block;background:#1689ed;color:white;border:0;padding:14px 24px;border-radius:9px;font-weight:bold;text-decoration:none;margin-top:23px;cursor:pointer}
.container{max-width:1100px;margin:auto;padding:35px 18px}
.heading{text-align:center;margin-bottom:25px}
.heading h2{font-size:28px;margin-bottom:9px}
.heading p{color:#9eb3ca}
.services{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:18px}
.card{background:#10223a;padding:24px;border:1px solid #254263;border-radius:15px}
.card h3{margin-bottom:12px;color:#58b5ff}
.card p{color:#b7c8db;line-height:1.6;font-size:14px}
.card .btn{margin-top:15px}
.order{background:#10223a;border:1px solid #254263;padding:25px;border-radius:16px;max-width:600px;margin:20px auto}
label{display:block;margin:15px 0 7px;font-size:14px}
select{width:100%;padding:14px;background:#07111f;color:white;border:1px solid #42617e;border-radius:8px}
.notice{background:#332b17;color:#ffdc88;padding:14px;border-radius:8px;font-size:13px;line-height:1.6;margin-top:18px}
footer{text-align:center;padding:30px;color:#92a8bf;background:#081525;margin-top:35px;font-size:13px}
@media(max-width:550px){nav a{margin-left:9px;font-size:12px}.logo{font-size:17px}.hero{padding-top:55px}}
</style>
</head>
<body>
<header>
<div class="logo">GLOBAL NUMBER HUB</div>
<nav><a href="#services">Services</a><a href="#countries">Countries</a><a href="#order">Order</a></nav>
</header>

<section class="hero">
<h1>Your Numbers.<br><span>Your World.</span></h1>
<p>Discover international virtual phone number services for SMS verification, calls and messaging.</p>
<a class="btn" href="#order">Explore Numbers</a>
</section>

<section class="container" id="services">
<div class="heading">
<h2>Our Services</h2>
<p>Choose the virtual number service you need.</p>
</div>
<div class="services">
<div class="card">
<h3>SMS Verification</h3>
<p>Receive SMS verification codes using eligible virtual numbers from supported countries and services.</p>
<a class="btn" href="#order">Explore SMS</a>
</div>
<div class="card">
<h3>Virtual Phone Numbers</h3>
<p>Explore virtual numbers with supported incoming calls and SMS capabilities.</p>
<a class="btn" href="#order">Explore Numbers</a>
</div>
<div class="card">
<h3>International Coverage</h3>
<p>Explore available number options across multiple countries.</p>
<a class="btn" href="#countries">View Countries</a>
</div>
</div>
</section>

<section class="container" id="countries">
<div class="heading">
<h2>Choose Your Country</h2>
<p>Availability depends on our approved providers.</p>
</div>
<div class="services">
<div class="card"><h3>🇺🇸 United States</h3><p>USA virtual numbers</p></div>
<div class="card"><h3>🇬🇧 United Kingdom</h3><p>UK virtual numbers</p></div>
<div class="card"><h3>🇨🇦 Canada</h3><p>Canada virtual numbers</p></div>
<div class="card"><h3>🇩🇪 Germany</h3><p>Germany virtual numbers</p></div>
<div class="card"><h3>🇫🇷 France</h3><p>France virtual numbers</p></div>
<div class="card"><h3>🇬🇭 Ghana</h3><p>Ghana virtual numbers</p></div>
</div>
</section>

<section class="container" id="order">
<div class="heading">
<h2>Find Your Number</h2>
<p>Select your preferred country and service.</p>
</div>
<div class="order">
<form id="searchForm">
<label for="country">Select country</label>
<select id="country" required>
<option value="">Choose a country</option>
<option value="US">🇺🇸 United States</option>
<option value="GB">🇬🇧 United Kingdom</option>
<option value="CA">🇨🇦 Canada</option>
<option value="DE">🇩🇪 Germany</option>
<option value="FR">🇫🇷 France</option>
<option value="GH">🇬🇭 Ghana</option>
</select>
<label for="service">Select service</label>
<select id="service" required>
<option value="sms">SMS verification</option>
<option value="voice">Calls and SMS</option>
</select>
<button class="btn" type="submit">Check Availability</button>
</form>
<div class="notice" id="message">Number inventory and checkout will activate after connecting our approved number suppliers and payment system. No payment is collected on this preview.</div>
</div>
</section>

<footer>
<p><strong>GLOBAL NUMBER HUB</strong></p>
<p>Your Numbers. Your World.</p>
<p>International virtual number marketplace.</p>
</footer>

<script>
document.getElementById("searchForm").addEventListener("submit",function(e){
e.preventDefault();
const country=document.getElementById("country").value;
const service=document.getElementById("service").value;
const message=document.getElementById("message");
message.textContent="Your selection: "+country+" - "+(service==="sms"?"SMS verification":"Calls and SMS")+". Live availability will be enabled after supplier integration.";
});
</script>
</body>
</html>`);
});

app.listen(PORT, "0.0.0.0", () => {
  console.log("GLOBAL NUMBER HUB running on port " + PORT);
});
