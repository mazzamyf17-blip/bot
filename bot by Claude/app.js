/* AgriBot web - HTML + CSS + JavaScript murni.
   Database: localStorage. Cuaca: Open-Meteo (gratis, tanpa API key). */

// ---------- Data master tanaman (nilai perkiraan umum) ----------
const CROPS = [
  { name: "padi", days: 120, tMin: 22, tMax: 32, note: "Butuh genangan air; hindari kekeringan saat berbunga." },
  { name: "jagung", days: 100, tMin: 21, tMax: 32, note: "Rawan busuk batang jika tergenang." },
  { name: "kedelai", days: 85, tMin: 22, tMax: 30, note: "Hindari hujan deras saat panen." },
  { name: "cabai", days: 110, tMin: 20, tMax: 30, note: "Rentan antraknosa saat lembap dan hujan terus." },
  { name: "tomat", days: 90, tMin: 18, tMax: 28, note: "Pangkas tunas air, pasang ajir." },
  { name: "bawang merah", days: 65, tMin: 22, tMax: 32, note: "Tidak tahan genangan." },
  { name: "kangkung", days: 30, tMin: 22, tMax: 34, note: "Suka air, cepat panen." },
  { name: "bayam", days: 25, tMin: 20, tMax: 32, note: "Panen cepat, siram teratur." },
  { name: "singkong", days: 270, tMin: 22, tMax: 32, note: "Tahan kering, tidak tahan genangan." },
];

const WMO = {
  0: ["Cerah", "☀️"], 1: ["Cerah berawan", "🌤"], 2: ["Berawan sebagian", "⛅"], 3: ["Berawan", "☁️"],
  45: ["Berkabut", "🌫"], 48: ["Kabut beku", "🌫"],
  51: ["Gerimis ringan", "🌦"], 53: ["Gerimis", "🌦"], 55: ["Gerimis lebat", "🌧"],
  61: ["Hujan ringan", "🌦"], 63: ["Hujan sedang", "🌧"], 65: ["Hujan lebat", "🌧"],
  80: ["Hujan lokal ringan", "🌦"], 81: ["Hujan lokal sedang", "🌧"], 82: ["Hujan lokal deras", "⛈"],
  95: ["Badai petir", "⛈"], 96: ["Badai petir + es", "⛈"], 99: ["Badai petir lebat", "⛈"],
};

// ---------- Database (localStorage) ----------
const DB_KEY = "agribot_db_v1";
const freshDB = () => ({ farms: [], plantings: [], logs: [], seq: 1 });

function loadDB() {
  try {
    const raw = localStorage.getItem(DB_KEY);
    return raw ? JSON.parse(raw) : freshDB();
  } catch (e) {
    return freshDB();
  }
}

let db = loadDB();

function saveDB() {
  try {
    localStorage.setItem(DB_KEY, JSON.stringify(db));
  } catch (e) {
    alert("Gagal menyimpan data ke browser.");
  }
}

const nextId = () => db.seq++;

// ---------- Util ----------
const $ = (id) => document.getElementById(id);

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

const todayStr = () => new Date().toLocaleDateString("sv-SE");

function addDays(dateStr, n) {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + n);
  return d.toLocaleDateString("sv-SE");
}

function diffDays(a, b) {
  return Math.round((new Date(a + "T00:00:00") - new Date(b + "T00:00:00")) / 86400000);
}

const cropByName = (name) => CROPS.find((c) => c.name === name);
const farmById = (id) => db.farms.find((f) => f.id === id);

// ---------- Cuaca ----------
async function geocode(query) {
  const url = "https://geocoding-api.open-meteo.com/v1/search?" + new URLSearchParams({
    name: query, count: 1, language: "id", countryCode: "ID", format: "json",
  });
  const res = await fetch(url);
  if (!res.ok) throw new Error("Geocoding gagal");
  const data = await res.json();
  if (!data.results || !data.results.length) return null;
  const r = data.results[0];
  return { name: r.name, province: r.admin1 || "", lat: r.latitude, lon: r.longitude };
}

async function getForecast(lat, lon) {
  const url = "https://api.open-meteo.com/v1/forecast?" + new URLSearchParams({
    latitude: lat, longitude: lon, timezone: "auto", forecast_days: 7,
    daily: [
      "weather_code", "temperature_2m_max", "temperature_2m_min",
      "precipitation_sum", "precipitation_probability_max", "wind_speed_10m_max",
    ].join(","),
  });
  const res = await fetch(url);
  if (!res.ok) throw new Error("Forecast gagal");
  const d = (await res.json()).daily;
  return d.time.map((t, i) => ({
    date: t,
    tMin: d.temperature_2m_min[i],
    tMax: d.temperature_2m_max[i],
    rain: d.precipitation_sum[i] || 0,
    prob: d.precipitation_probability_max[i] || 0,
    wind: d.wind_speed_10m_max[i] || 0,
    desc: (WMO[d.weather_code[i]] || ["Tidak diketahui", "❓"])[0],
    icon: (WMO[d.weather_code[i]] || ["", "❓"])[1],
  }));
}

function dayName(dateStr) {
  return new Date(dateStr + "T00:00:00").toLocaleDateString("id-ID", {
    weekday: "short", day: "numeric", month: "short",
  });
}

function forecastHTML(days) {
  return '<div class="days">' + days.map((f) => `
    <div class="day">
      <b>${esc(dayName(f.date))}</b>
      <div class="icon">${f.icon}</div>
      <div>${esc(f.desc)}</div>
      <div>${Math.round(f.tMin)}–${Math.round(f.tMax)}°C</div>
      <div>💧 ${f.rain.toFixed(1)} mm (${f.prob}%)</div>
      <div>💨 ${Math.round(f.wind)} km/j</div>
    </div>`).join("") + "</div>";
}

function farmingAdvice(days, crops) {
  const near = days.slice(0, 3);
  const tips = [];
  const totalRain = near.reduce((s, d) => s + d.rain, 0);
  const maxProb = Math.max(...near.map((d) => d.prob));

  if (near.some((d) => d.rain >= 20)) {
    tips.push("⛈ Hujan lebat diperkirakan: tunda pemupukan dan penyemprotan, pastikan drainase lancar.");
  } else if (totalRain < 2 && maxProb < 30) {
    tips.push("☀️ 3 hari ke depan cenderung kering: jadwalkan penyiraman pagi/sore.");
  } else {
    tips.push("🌤 Curah hujan sedang: sesuaikan penyiraman dengan kelembapan tanah.");
  }
  if (near.some((d) => d.tMax >= 34)) tips.push("🔥 Suhu tinggi: beri mulsa dan siram di luar jam terik.");
  if (near.some((d) => d.wind >= 35)) tips.push("💨 Angin kencang: perkuat ajir/penyangga tanaman.");

  const avgMax = near.reduce((s, d) => s + d.tMax, 0) / near.length;
  const avgMin = near.reduce((s, d) => s + d.tMin, 0) / near.length;
  crops.forEach((c) => {
    const t = c.name[0].toUpperCase() + c.name.slice(1);
    if (avgMax > c.tMax) tips.push(`⚠️ ${t}: suhu rata-rata (${Math.round(avgMax)}°C) di atas ideal (${c.tMax}°C).`);
    if (avgMin < c.tMin) tips.push(`⚠️ ${t}: suhu malam (${Math.round(avgMin)}°C) di bawah ideal (${c.tMin}°C).`);
    if (["bawang merah", "singkong", "jagung", "cabai"].includes(c.name) && totalRain > 40) {
      tips.push(`⚠️ ${t}: rentan genangan/penyakit jamur, cek drainase.`);
    }
  });
  return tips;
}

async function weatherFor(query) {
  if (query) {
    const loc = await geocode(query);
    if (!loc) return null;
    return { label: `${loc.name}, ${loc.province}`, days: await getForecast(loc.lat, loc.lon) };
  }
  const farm = db.farms[0];
  if (!farm) return { error: "Belum ada lahan. Tulis nama kota atau tambah lahan dulu." };
  return { label: farm.city, days: await getForecast(farm.lat, farm.lon) };
}

async function adviceForFarm() {
  const farm = db.farms[0];
  if (!farm) return { error: "Tambah lahan dulu di tab Lahan." };
  const days = await getForecast(farm.lat, farm.lon);
  const crops = db.plantings
    .filter((p) => p.farmId === farm.id && p.status === "aktif")
    .map((p) => cropByName(p.crop))
    .filter(Boolean);
  return { city: farm.city, tips: farmingAdvice(days, crops) };
}

// ---------- Render ----------
function renderFarms() {
  const box = $("farm-list");
  if (!db.farms.length) { box.innerHTML = '<p class="hint">Belum ada lahan.</p>'; return; }
  box.innerHTML = db.farms.map((f) => `
    <div class="item">
      <div><b>${esc(f.name)}</b>
        <div class="meta">${esc(f.city)}${f.province ? ", " + esc(f.province) : ""} · ${f.area} ha</div></div>
      <div class="actions"><button class="small danger" data-del-farm="${f.id}">Hapus</button></div>
    </div>`).join("");
}

function renderPlantings() {
  const box = $("plant-list");
  const active = db.plantings.filter((p) => p.status === "aktif");
  if (!active.length) { box.innerHTML = '<p class="hint">Belum ada tanaman aktif.</p>'; return; }
  const today = todayStr();
  box.innerHTML = active.map((p) => {
    const farm = farmById(p.farmId);
    const hst = diffDays(today, p.plantedAt);
    const sisa = diffDays(p.harvestAt, today);
    return `
    <div class="item">
      <div><b>${esc(p.crop)}</b> @ ${esc(farm ? farm.name : "?")}
        <div class="meta">HST ${hst} · ${sisa >= 0 ? "panen " + sisa + " hari lagi" : "lewat jadwal panen " + (-sisa) + " hari"}</div></div>
      <div class="actions">
        <button class="small" data-harvest="${p.id}">Panen</button>
        <button class="small danger" data-del-plant="${p.id}">Hapus</button>
      </div>
    </div>`;
  }).join("");
}

function renderLogs() {
  const sel = $("log-plant").value;
  const box = $("log-list");
  const logs = db.logs.filter((l) => String(l.plantingId) === sel).slice().reverse().slice(0, 30);
  if (!sel) { box.innerHTML = '<p class="hint">Pilih tanaman untuk melihat riwayat.</p>'; return; }
  if (!logs.length) { box.innerHTML = '<p class="hint">Belum ada catatan.</p>'; return; }
  box.innerHTML = logs.map((l) => `
    <div class="item">
      <div><b>${esc(l.kind)}</b> <span class="meta">${esc(l.note)}</span></div>
      <div class="meta">${esc(l.at)}</div>
    </div>`).join("");
}

function fillSelects() {
  $("plant-farm").innerHTML = db.farms.length
    ? db.farms.map((f) => `<option value="${f.id}">${esc(f.name)}</option>`).join("")
    : '<option value="">(tambah lahan dulu)</option>';

  $("plant-crop").innerHTML = CROPS.map((c) => `<option value="${esc(c.name)}">${esc(c.name)}</option>`).join("");

  const active = db.plantings.filter((p) => p.status === "aktif");
  const prev = $("log-plant").value;
  $("log-plant").innerHTML = active.length
    ? active.map((p) => `<option value="${p.id}">#${p.id} ${esc(p.crop)}</option>`).join("")
    : '<option value="">(belum ada tanaman)</option>';
  if (prev && active.some((p) => String(p.id) === prev)) $("log-plant").value = prev;
}

function refreshAll() {
  renderFarms();
  fillSelects();
  renderPlantings();
  renderLogs();
}

// ---------- Event: tab ----------
document.querySelectorAll(".tab").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".panel").forEach((p) => p.classList.remove("active"));
    btn.classList.add("active");
    $(btn.dataset.tab).classList.add("active");
  });
});

// ---------- Event: cuaca ----------
$("weather-btn").addEventListener("click", async () => {
  const out = $("weather-out");
  out.innerHTML = '<p class="hint">Mengambil data...</p>';
  try {
    const r = await weatherFor($("weather-city").value.trim());
    if (r === null) out.innerHTML = '<p class="hint">Daerah tidak ditemukan di Indonesia.</p>';
    else if (r.error) out.innerHTML = `<p class="hint">${esc(r.error)}</p>`;
    else out.innerHTML = `<p><b>${esc(r.label)}</b></p>` + forecastHTML(r.days);
  } catch (e) {
    out.innerHTML = '<p class="hint">Layanan cuaca bermasalah atau tidak ada internet.</p>';
  }
});

$("advice-btn").addEventListener("click", async () => {
  const ul = $("advice-out");
  ul.innerHTML = "<li>Memuat...</li>";
  try {
    const r = await adviceForFarm();
    ul.innerHTML = r.error
      ? `<li>${esc(r.error)}</li>`
      : r.tips.map((t) => `<li>${esc(t)}</li>`).join("");
  } catch (e) {
    ul.innerHTML = "<li>Gagal mengambil cuaca.</li>";
  }
});

// ---------- Event: lahan ----------
$("farm-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const msg = $("farm-msg");
  msg.textContent = "Mencari lokasi...";
  try {
    const loc = await geocode($("farm-city").value.trim());
    if (!loc) { msg.textContent = "Kota/kabupaten tidak ditemukan di Indonesia."; return; }
    db.farms.push({
      id: nextId(),
      name: $("farm-name").value.trim(),
      city: loc.name,
      province: loc.province,
      lat: loc.lat,
      lon: loc.lon,
      area: parseFloat($("farm-area").value),
    });
    saveDB();
    e.target.reset();
    msg.textContent = `Lahan tersimpan (${loc.name}, ${loc.province}).`;
    refreshAll();
  } catch (err) {
    msg.textContent = "Gagal mencari lokasi. Cek koneksi internet.";
  }
});

$("farm-list").addEventListener("click", (e) => {
  const id = Number(e.target.dataset.delFarm);
  if (!id) return;
  if (!confirm("Hapus lahan beserta tanaman dan catatannya?")) return;
  const plantIds = db.plantings.filter((p) => p.farmId === id).map((p) => p.id);
  db.logs = db.logs.filter((l) => !plantIds.includes(l.plantingId));
  db.plantings = db.plantings.filter((p) => p.farmId !== id);
  db.farms = db.farms.filter((f) => f.id !== id);
  saveDB();
  refreshAll();
});

// ---------- Event: tanam ----------
$("plant-crop").addEventListener("change", () => {
  const c = cropByName($("plant-crop").value);
  $("plant-info").textContent = c ? `Panen ±${c.days} hari. ${c.note}` : "";
});

$("plant-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const farm = farmById(Number($("plant-farm").value));
  const crop = cropByName($("plant-crop").value);
  if (!farm || !crop) return;
  const planted = todayStr();
  db.plantings.push({
    id: nextId(),
    farmId: farm.id,
    crop: crop.name,
    plantedAt: planted,
    harvestAt: addDays(planted, crop.days),
    area: parseFloat($("plant-area").value) || farm.area,
    status: "aktif",
    yieldKg: null,
  });
  saveDB();
  $("plant-area").value = "";
  $("plant-info").textContent = `Tersimpan. Perkiraan panen: ${addDays(planted, crop.days)}.`;
  refreshAll();
});

$("plant-list").addEventListener("click", (e) => {
  const harvestId = Number(e.target.dataset.harvest);
  const delId = Number(e.target.dataset.delPlant);
  if (harvestId) {
    const kg = prompt("Hasil panen (kg)? Kosongkan jika belum tahu.");
    if (kg === null) return;
    const p = db.plantings.find((x) => x.id === harvestId);
    p.status = "panen";
    p.yieldKg = parseFloat(kg.replace(",", ".")) || null;
    saveDB();
    refreshAll();
  } else if (delId) {
    if (!confirm("Hapus tanaman ini beserta catatannya?")) return;
    db.logs = db.logs.filter((l) => l.plantingId !== delId);
    db.plantings = db.plantings.filter((p) => p.id !== delId);
    saveDB();
    refreshAll();
  }
});

// ---------- Event: catatan ----------
$("log-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const pid = Number($("log-plant").value);
  if (!pid) return;
  db.logs.push({
    id: nextId(),
    plantingId: pid,
    kind: $("log-kind").value,
    note: $("log-note").value.trim(),
    at: new Date().toLocaleString("id-ID"),
  });
  saveDB();
  $("log-note").value = "";
  renderLogs();
});
$("log-plant").addEventListener("change", renderLogs);

// ---------- Bot chat ----------
function addMsg(text, who) {
  const chat = $("chat");
  const div = document.createElement("div");
  div.className = "msg " + who;
  div.textContent = text;
  chat.appendChild(div);
  chat.scrollTop = chat.scrollHeight;
}

function forecastText(label, days) {
  return `Cuaca ${label}:\n` + days.map((f) =>
    `${dayName(f.date)}: ${f.desc}, ${Math.round(f.tMin)}–${Math.round(f.tMax)}°C, hujan ${f.rain.toFixed(1)} mm (${f.prob}%)`
  ).join("\n");
}

async function botReply(input) {
  const text = input.toLowerCase().trim();

  if (text.startsWith("cuaca")) {
    const city = input.trim().slice(5).trim();
    const r = await weatherFor(city);
    if (r === null) return "Daerah tidak ditemukan di Indonesia.";
    if (r.error) return r.error;
    return forecastText(r.label, r.days);
  }
  if (text.includes("saran")) {
    const r = await adviceForFarm();
    return r.error ? r.error : `Saran untuk lahan di ${r.city}:\n` + r.tips.join("\n");
  }
  if (text.includes("lahan")) {
    return db.farms.length
      ? db.farms.map((f) => `#${f.id} ${f.name} - ${f.city} (${f.area} ha)`).join("\n")
      : "Belum ada lahan.";
  }
  if (text.includes("tanaman")) {
    const act = db.plantings.filter((p) => p.status === "aktif");
    const today = todayStr();
    return act.length
      ? act.map((p) => `#${p.id} ${p.crop} - panen ${diffDays(p.harvestAt, today)} hari lagi`).join("\n")
      : "Belum ada tanaman aktif.";
  }
  return "Perintah yang tersedia:\n- cuaca <kota>\n- saran\n- lahan\n- tanaman\n\nContoh: cuaca Bandung";
}

$("chat-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const input = $("chat-input").value.trim();
  if (!input) return;
  $("chat-input").value = "";
  addMsg(input, "me");
  try {
    addMsg(await botReply(input), "bot");
  } catch (err) {
    addMsg("Maaf, ada masalah koneksi. Coba lagi nanti.", "bot");
  }
});

// ---------- Mulai ----------
addMsg("Halo! Aku AgriBot 🌾. Ketik 'bantuan' untuk melihat perintah.", "bot");
refreshAll();
$("plant-crop").dispatchEvent(new Event("change"));
