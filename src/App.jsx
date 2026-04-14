import { useState, useEffect, useRef } from "react";
import {
  fetchRecipes, saveRecipe as dbSaveRecipe, deleteRecipe as dbDeleteRecipe,
  updateRating, fetchHistory, saveMenu, fetchConfig, saveConfig
} from "./supabase.js";

// ─── Constants ────────────────────────────────────────────────────────────────
const DEFAULT_CATEGORIES = ["Carne", "Peixe", "Vegetariano", "Sopas"];
const CAT_PALETTE = ["#C84B31","#2E86AB","#2A9D8F","#F4A261","#E9C46A","#57CC99","#9B5DE5","#F15BB5"];
const catColor = (cat, cats) => CAT_PALETTE[Math.max(0, cats.indexOf(cat)) % CAT_PALETTE.length] || "#999";
const SOPA_CATS = ["Sopas"];
const isMain = r => !SOPA_CATS.includes(r.category);
const isSopa = r => SOPA_CATS.includes(r.category);

// ─── Scoring engine ───────────────────────────────────────────────────────────
function scoreRecipes(recipes, history) {
  const usedAgo = {};
  history.forEach((m, i) => {
    m.ids.forEach(id => { if (usedAgo[id] === undefined) usedAgo[id] = i; });
  });
  return recipes.map(r => {
    const weeksAgo = usedAgo[r.id] !== undefined ? usedAgo[r.id] : 99;
    const recency  = weeksAgo >= 99 ? 0 : Math.round(10 * Math.exp(-0.5 * weeksAgo));
    const ratingBonus = r.rating ? [0, 0.5, 1, 1.5, 2, 3][r.rating] : 0;
    const score  = recency - ratingBonus;
    const weight = 1 / (score + 1);
    return { ...r, _score: score, _weight: weight };
  });
}

function weightedSample(pool, n) {
  const result = [];
  let remaining = [...pool];
  while (result.length < n && remaining.length > 0) {
    const total = remaining.reduce((s, r) => s + r._weight, 0);
    let rand = Math.random() * total, idx = 0;
    for (let i = 0; i < remaining.length; i++) {
      rand -= remaining[i]._weight;
      if (rand <= 0) { idx = i; break; }
    }
    result.push(remaining[idx]);
    remaining.splice(idx, 1);
  }
  return result;
}

function selectMenu(recipes, history, quotas) {
  const { empregada: wantEmp, nao_empregada: wantNoEmp, sopas: wantSopas, maxPerCat } = quotas;
  const violations = [];
  const scored   = scoreRecipes(recipes, history);
  const sopaPool = scored.filter(isSopa);
  const mainScored = scored.filter(isMain);
  const empPool  = mainScored.filter(r => r.attention === "empregada");
  const noEmpPool = mainScored.filter(r => r.attention === "nao_empregada");

  const pickWithCap = (pool, need, existingCatCount = {}) => {
    const catCount = { ...existingCatCount };
    const eligible = pool.filter(r => (catCount[r.category] || 0) < maxPerCat);
    const picked   = weightedSample(eligible, need);
    if (picked.length < need) {
      violations.push("limite por categoria relaxado");
      const usedIds = new Set(picked.map(r => r.id));
      picked.push(...weightedSample(pool.filter(r => !usedIds.has(r.id)), need - picked.length));
    }
    picked.forEach(r => { catCount[r.category] = (catCount[r.category] || 0) + 1; });
    return { picked, catCount };
  };

  const { picked: empPicked, catCount: afterEmp } = pickWithCap(empPool, wantEmp, {});
  const { picked: noEmpPicked } = pickWithCap(noEmpPool, wantNoEmp, afterEmp);
  const { picked: sopaPicked }  = pickWithCap(sopaPool, wantSopas, {});
  const all = [...empPicked, ...noEmpPicked, ...sopaPicked];
  return { ids: all.map(r => r.id), violations };
}

// ─── Star Rating ──────────────────────────────────────────────────────────────
function Stars({ value = 0, onChange, size = 16 }) {
  const [hover, setHover] = useState(0);
  return (
    <div style={{ display:"flex", gap:2, alignItems:"center" }}>
      {[1,2,3,4,5].map(n => (
        <span key={n}
          onClick={e => { e.stopPropagation(); onChange && onChange(n === value ? 0 : n); }}
          onMouseEnter={() => onChange && setHover(n)}
          onMouseLeave={() => setHover(0)}
          style={{ fontSize:size, cursor:onChange?"pointer":"default", lineHeight:1,
            color: n <= (hover || value) ? "#E9A800" : "#D4B896", transition:"color .15s" }}>★</span>
      ))}
    </div>
  );
}

// ─── CSS ──────────────────────────────────────────────────────────────────────
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,600;1,300;1,400&family=DM+Sans:wght@300;400;500;600&display=swap');
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --b900:#2C1F14;--b700:#4A3728;--b500:#6B4F38;--b400:#9A7B5A;--b200:#D4B896;--b100:#EDE0CC;
  --warm:#F5F0E8;--cream:#FAF7F2;--tc:#C84B31;--sage:#5A8C73;
  --ss:0 2px 16px rgba(44,31,20,.07);--sm:0 6px 32px rgba(44,31,20,.13);
  --r:14px;--rs:8px;--t:all .2s cubic-bezier(.4,0,.2,1)
}
body{font-family:'DM Sans',sans-serif;background:var(--cream);color:var(--b900);min-height:100vh;font-size:14px;line-height:1.5}
.app{display:flex;flex-direction:column;min-height:100vh}
.hdr{background:var(--b900);padding:0 28px;height:56px;display:flex;align-items:center;justify-content:space-between;position:sticky;top:0;z-index:100}
.logo{display:flex;align-items:center;gap:9px}
.logo-mark{width:32px;height:32px;background:var(--tc);border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:15px}
.logo-name{font-family:'Cormorant Garamond',serif;font-size:20px;font-weight:600;color:var(--cream)}
.logo-tag{font-size:9px;color:var(--b400);letter-spacing:.07em;text-transform:uppercase}
.nav{display:flex;gap:2px}
.nb{height:32px;padding:0 13px;border:none;border-radius:6px;background:transparent;color:var(--b200);font-family:'DM Sans',sans-serif;font-size:12.5px;cursor:pointer;transition:var(--t)}
.nb:hover{background:rgba(255,255,255,.07);color:#fff}
.nb.on{background:var(--tc);color:#fff;font-weight:500}
.main{flex:1;padding:24px 28px;max-width:1340px;margin:0 auto;width:100%}
.btn{display:inline-flex;align-items:center;gap:5px;padding:0 15px;height:34px;border-radius:var(--rs);border:none;cursor:pointer;font-family:'DM Sans',sans-serif;font-size:13px;font-weight:500;transition:var(--t);white-space:nowrap}
.bp{background:var(--b900);color:#fff}.bp:hover{background:var(--b700)}
.ba{background:var(--tc);color:#fff}.ba:hover{background:#a83d27}
.bo{background:transparent;color:var(--b700);border:1.5px solid var(--b200)}.bo:hover{border-color:var(--b700);background:var(--warm)}
.bg{background:transparent;color:var(--b400)}.bg:hover{color:var(--b900);background:var(--warm)}
.bs{font-size:12px;height:28px;padding:0 10px}
.bxs{font-size:11px;height:24px;padding:0 8px}
.ph{display:flex;align-items:center;justify-content:space-between;margin-bottom:20px}
.pt{font-family:'Cormorant Garamond',serif;font-size:24px;font-weight:300;color:var(--b900)}
.pt em{font-style:italic;color:var(--tc)}
.psub{font-size:11.5px;color:var(--b400);margin-top:2px}
.fi{width:100%;padding:8px 11px;border:1.5px solid var(--b200);border-radius:var(--rs);font-family:'DM Sans',sans-serif;font-size:13px;background:#fff;outline:none;transition:var(--t)}
.fi:focus{border-color:var(--b700)}
.fse{width:100%;padding:7px 10px;border:1.5px solid var(--b200);border-radius:var(--rs);font-size:13px;background:#fff;outline:none}
.fta{width:100%;padding:8px 11px;border:1.5px solid var(--b200);border-radius:var(--rs);font-family:'DM Sans',sans-serif;font-size:13px;background:#fff;outline:none;resize:vertical;transition:var(--t)}
.fta:focus{border-color:var(--b700)}
.fg{margin-bottom:12px}
.fl{display:block;font-size:11px;font-weight:600;color:var(--b500);text-transform:uppercase;letter-spacing:.05em;margin-bottom:5px}
.fc{display:flex;gap:4px;flex-wrap:wrap}
.ch{height:26px;padding:0 10px;border-radius:5px;border:1.5px solid var(--b200);background:transparent;font-size:11.5px;cursor:pointer;transition:var(--t);color:var(--b700)}
.ch:hover{border-color:var(--b700)}.ch.on{background:var(--b900);color:#fff;border-color:var(--b900)}
.ap{display:inline-flex;align-items:center;gap:3px;padding:2px 7px;border-radius:4px;font-size:10.5px;font-weight:500}
.ae{background:#FEF3CD;color:#856404}.an{background:#E8F5E9;color:#2E7D32}
.ar{background:#E3F2FD;color:#1565C0}.al{background:#F3E5F5;color:#6A1B9A}
.ai{background:#FDECEA;color:#C0392B}
.tg{display:flex;gap:4px}.to{flex:1;padding:6px;border:1.5px solid var(--b200);border-radius:6px;font-size:12px;cursor:pointer;background:#fff;transition:var(--t)}
.to.on{background:var(--b900);color:#fff;border-color:var(--b900)}
.ir{display:grid;grid-template-columns:1fr 70px 55px auto;gap:5px;margin-bottom:6px;align-items:center}
.mo{position:fixed;inset:0;background:rgba(44,31,20,.45);z-index:200;display:flex;align-items:flex-start;justify-content:center;padding:24px;overflow-y:auto}
.md{background:#fff;border-radius:var(--r);box-shadow:0 24px 80px rgba(44,31,20,.2);width:100%;max-width:760px;animation:su .2s ease}
.mdl{max-width:900px}
.mh{padding:18px 22px;border-bottom:1px solid var(--b100);display:flex;align-items:center;justify-content:space-between}
.mt{font-family:'Cormorant Garamond',serif;font-size:20px;font-weight:600}
.mb{padding:20px 22px}
.mc{width:30px;height:30px;border:none;border-radius:6px;background:var(--warm);color:var(--b700);cursor:pointer;font-size:14px;display:flex;align-items:center;justify-content:center}
.tst{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:var(--b900);color:var(--cream);padding:10px 18px;border-radius:10px;font-size:13px;font-weight:500;display:flex;align-items:center;gap:8px;box-shadow:0 8px 32px rgba(44,31,20,.25);z-index:999;animation:su .2s ease}
@keyframes su{from{opacity:0;transform:translateY(8px) translateX(-50%)}to{opacity:1;transform:translateY(0) translateX(-50%)}}
.menu-layout{display:grid;grid-template-columns:260px 1fr;gap:20px;align-items:start}
.cfg-panel{background:#fff;border-radius:var(--r);box-shadow:var(--ss);position:sticky;top:76px}
.cfg-head{padding:14px 18px;border-bottom:1px solid var(--b100)}
.cfg-title{font-family:'Cormorant Garamond',serif;font-size:16px;font-weight:600}
.cfg-sub{font-size:10px;color:var(--b400);margin-top:1px}
.cfg-body{padding:16px 18px}
.cfg-row{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;gap:8px}
.cfg-label{font-size:12px;color:var(--b700);font-weight:500;display:flex;flex-direction:column;gap:1px}
.cfg-label span:last-child{font-size:10px;color:var(--b400);font-weight:400}
.stepper{display:flex;align-items:center;gap:7px;flex-shrink:0}
.step-btn{width:24px;height:24px;border:none;border-radius:5px;background:var(--warm);color:var(--b700);font-size:13px;cursor:pointer;transition:var(--t);display:flex;align-items:center;justify-content:center}
.step-btn:hover{background:var(--b100)}
.step-val{font-family:'Cormorant Garamond',serif;font-size:22px;font-weight:600;color:var(--b900);min-width:24px;text-align:center;line-height:1}
.cfg-div{height:1px;background:var(--b100);margin:12px 0}
.gen-btn{width:100%;height:40px;border-radius:9px;font-size:13.5px;font-weight:600;display:flex;align-items:center;justify-content:center;gap:7px;border:none;cursor:pointer;transition:var(--t);background:var(--tc);color:#fff}
.gen-btn:hover{background:#a83d27;transform:translateY(-1px);box-shadow:0 4px 14px rgba(200,75,49,.3)}
.gen-btn:disabled{opacity:.45;transform:none;box-shadow:none;cursor:not-allowed}
.menu-panel{background:#fff;border-radius:var(--r);box-shadow:var(--ss);overflow:hidden}
.menu-panel-head{padding:14px 20px;border-bottom:1px solid var(--b100);display:flex;align-items:flex-start;justify-content:space-between;gap:12px}
.menu-panel-title{font-family:'Cormorant Garamond',serif;font-size:17px;font-weight:600;color:var(--b900)}
.dish-row{padding:11px 20px;border-bottom:1px solid var(--b100);display:flex;align-items:center;gap:12px;transition:var(--t);cursor:pointer}
.dish-row:last-child{border-bottom:none}
.dish-row:hover{background:var(--warm)}
.dish-num{font-family:'Cormorant Garamond',serif;font-size:20px;font-weight:300;color:var(--b200);width:24px;text-align:right;flex-shrink:0;line-height:1}
.shop-drawer{background:#fff;border-radius:var(--r);box-shadow:var(--ss);overflow:hidden;margin-top:16px}
.shop-head{padding:12px 20px;background:var(--b900);color:var(--cream);display:flex;align-items:center;justify-content:space-between}
.shop-title{font-family:'Cormorant Garamond',serif;font-size:15px;font-weight:600}
.shop-sec{border-bottom:1px solid var(--b100)}.shop-sec:last-child{border-bottom:none}
.shop-sec-hd{padding:9px 16px;background:var(--warm);font-size:11px;font-weight:600;color:var(--b500);letter-spacing:.05em;text-transform:uppercase;display:flex;justify-content:space-between}
.shop-item{padding:8px 16px;display:flex;align-items:center;gap:10px;border-bottom:1px solid var(--b100)}
.shop-item:last-child{border-bottom:none}
.shop-item:hover{background:var(--cream)}
.sck{width:17px;height:17px;border-radius:4px;border:2px solid var(--b200);cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:var(--t);font-size:10px}
.sck.on{background:var(--sage);border-color:var(--sage);color:#fff}
.menu-empty{padding:52px 28px;text-align:center}
.menu-empty-icon{font-size:40px;margin-bottom:12px}
.gen-overlay{padding:36px 28px;text-align:center}
@keyframes spin{to{transform:rotate(360deg)}}
.recipe-list{background:#fff;border-radius:var(--r);box-shadow:var(--ss);overflow:hidden}
.rl-row{display:flex;align-items:center;gap:10px;padding:9px 14px;border-bottom:1px solid var(--b100);transition:var(--t);cursor:default}
.rl-row:last-child{border-bottom:none}
.rl-row:hover{background:var(--warm)}
.rl-dot{width:8px;height:8px;border-radius:50%;flex-shrink:0}
.rl-name{flex:1;font-size:13px;font-weight:500;color:var(--b900);line-height:1.3}
.rl-meta{font-size:11px;color:var(--b400);margin-top:1px}
.rl-actions{display:flex;gap:4px;align-items:center;flex-shrink:0}
.rl-group-hd{padding:8px 14px 5px;background:var(--warm);font-size:10px;font-weight:700;color:var(--b400);letter-spacing:.07em;text-transform:uppercase;border-bottom:1px solid var(--b100);display:flex;align-items:center;gap:6px}
.ai-inline{background:var(--b900);overflow:hidden}
.ai-msgs{max-height:200px;overflow-y:auto;padding:11px 14px;display:flex;flex-direction:column;gap:8px}
.ai-msgs::-webkit-scrollbar{width:3px}
.ai-msgs::-webkit-scrollbar-thumb{background:rgba(255,255,255,.1);border-radius:2px}
.ai-msg-a{background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.08);color:var(--cream);padding:8px 12px;border-radius:9px;font-size:12.5px;line-height:1.6}
.ai-msg-u{background:var(--tc);color:#fff;padding:8px 12px;border-radius:9px;font-size:12.5px;line-height:1.6;align-self:flex-end;max-width:85%}
.ai-foot{padding:9px 12px;border-top:1px solid rgba(255,255,255,.08);display:flex;gap:6px}
.ai-inp{flex:1;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.12);border-radius:7px;padding:7px 10px;color:var(--cream);font-family:'DM Sans',sans-serif;font-size:12.5px;outline:none;transition:var(--t)}
.ai-inp::placeholder{color:rgba(255,255,255,.25)}.ai-inp:focus{border-color:rgba(255,255,255,.3)}
.ai-send{width:30px;height:30px;background:var(--tc);border:none;border-radius:6px;color:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:13px;transition:var(--t);flex-shrink:0}
.ai-send:hover{background:#a83d27}.ai-send:disabled{opacity:.4;cursor:not-allowed}
.td{display:flex;gap:3px;align-items:center}
.td-d{width:4px;height:4px;background:var(--b400);border-radius:50%;animation:tp 1.4s infinite ease-in-out}
.td-d:nth-child(2){animation-delay:.2s}.td-d:nth-child(3){animation-delay:.4s}
@keyframes tp{0%,60%,100%{opacity:.35;transform:translateY(0)}30%{opacity:1;transform:translateY(-4px)}}
.ai-rc-card{margin-top:8px;padding:9px 11px;background:rgba(255,255,255,.06);border-radius:6px;border:1px solid rgba(255,255,255,.1)}
.import-layout{display:grid;grid-template-columns:1fr 1fr;gap:20px;align-items:start}
.imp-card{background:#fff;border-radius:var(--r);box-shadow:var(--ss);overflow:hidden}
.imp-head{padding:12px 18px;background:var(--warm);border-bottom:1px solid var(--b100);font-weight:600;font-size:13px;color:var(--b700)}
.imp-body{padding:16px 18px}
.uz{border:2px dashed var(--b200);border-radius:var(--r);padding:28px 18px;text-align:center;cursor:pointer;transition:var(--t);background:var(--cream)}
.uz:hover,.uz.dg{border-color:var(--tc);background:rgba(200,75,49,.03)}
.imp-preview{max-height:340px;overflow-y:auto;border:1px solid var(--b100);border-radius:9px}
.imp-row{padding:8px 14px;border-bottom:1px solid var(--b100);display:flex;align-items:center;gap:9px}
.imp-row:last-child{border-bottom:none}
.settings-panel{background:#fff;border-radius:var(--r);box-shadow:var(--ss);padding:20px 22px;max-width:480px}
@media(max-width:860px){
  .menu-layout{grid-template-columns:1fr}
  .cfg-panel{position:static}
  .import-layout{grid-template-columns:1fr}
  .main{padding:16px 12px}
  .hdr{padding:0 14px}
}
`;

// ─── App ──────────────────────────────────────────────────────────────────────
export default function App() {
  const [tab, setTab]               = useState("menu");
  const [recipes, setRecipes]       = useState([]);
  const [cats, setCats]             = useState(DEFAULT_CATEGORIES);
  const [history, setHistory]       = useState([]);
  const [activeMenu, setActiveMenu] = useState(null);
  const [shopChecked, setShopChecked] = useState({});
  const [quotas, setQuotas]         = useState({ total:6, empregada:2, nao_empregada:3, sopas:1, maxPerCat:2 });
  const [loading, setLoading]       = useState(true);
  const [toast, setToast]           = useState(null);
  const [editR, setEditR]           = useState(null);
  const [viewR, setViewR]           = useState(null);

  // ── Load from Supabase on mount ──────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const [recs, hist, savedQuotas, savedMenu] = await Promise.all([
          fetchRecipes(),
          fetchHistory(),
          fetchConfig("quotas"),
          fetchConfig("active_menu"),
        ]);
        setRecipes(recs);
        setHistory(hist);
        if (savedQuotas) setQuotas(q => ({ ...q, ...savedQuotas }));
        if (savedMenu)   setActiveMenu(savedMenu);
        const allCats = [...new Set([...DEFAULT_CATEGORIES, ...recs.map(r => r.category)])];
        setCats(allCats);
      } catch(e) {
        console.error("Load error:", e);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // ── Persist quotas to Supabase when they change ──────────────────────────────
  useEffect(() => {
    if (!loading) saveConfig("quotas", quotas).catch(console.error);
  }, [quotas]);

  const showToast = (msg, icon = "✓") => {
    setToast({ msg, icon });
    setTimeout(() => setToast(null), 2600);
  };

  const handleSaveRecipe = async (r) => {
    try {
      const savedId = await dbSaveRecipe(r);
      const updated = await fetchRecipes();
      setRecipes(updated);
      if (r.category && !cats.includes(r.category)) setCats(c => [...c, r.category]);
      showToast(r.id ? "Receita atualizada!" : "Receita criada!", r.id ? "✏️" : "🍽️");
    } catch(e) { showToast("Erro ao guardar: " + e.message, "⚠"); }
    setEditR(null);
  };

  const handleRateRecipe = async (id, rating) => {
    setRecipes(rs => rs.map(r => r.id === id ? { ...r, rating } : r));
    if (viewR?.id === id) setViewR(v => ({ ...v, rating }));
    try { await updateRating(id, rating); }
    catch(e) { console.error("Rating error:", e); }
  };

  const handleDeleteRecipe = async (id) => {
    try {
      await dbDeleteRecipe(id);
      setRecipes(rs => rs.filter(x => x.id !== id));
      setActiveMenu(m => m ? { ...m, ids: m.ids.filter(i => i !== id) } : m);
      showToast("Removida.", "🗑️");
    } catch(e) { showToast("Erro ao remover.", "⚠"); }
  };

  const acceptMenu = async (ids, reason = "") => {
    const m = { date: new Date().toISOString(), ids, reason };
    setActiveMenu(m);
    setHistory(h => [m, ...h].slice(0, 20));
    setShopChecked({});
    showToast("Menu gerado!", "📅");
    try {
      await Promise.all([
        saveMenu(ids, reason),
        saveConfig("active_menu", m),
      ]);
    } catch(e) { console.error("Save menu error:", e); }
  };

  const shoppingList = (() => {
    if (!activeMenu) return {};
    const items = {};
    activeMenu.ids.forEach(id => {
      const r = recipes.find(x => x.id === id);
      if (!r?.ingredients) return;
      r.ingredients.forEach(ing => {
        const k = ing.name.toLowerCase();
        if (items[k]) items[k].qty += Number(ing.qty) || 0;
        else items[k] = { ...ing, qty: Number(ing.qty) || 0 };
      });
    });
    return items;
  })();

  if (loading) return (
    <>
      <style>{CSS}</style>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"center", height:"100vh", flexDirection:"column", gap:16, color:"var(--b400)" }}>
        <div style={{ width:40, height:40, border:"3px solid var(--b100)", borderTopColor:"var(--tc)", borderRadius:"50%", animation:"spin .8s linear infinite" }}></div>
        <div style={{ fontFamily:"Cormorant Garamond,serif", fontSize:18 }}>A carregar Mesa Minha…</div>
      </div>
    </>
  );

  return (
    <>
      <style>{CSS}</style>
      <div className="app">
        <header className="hdr">
          <div className="logo">
            <div className="logo-mark">🍳</div>
            <div><div className="logo-name">Mesa Minha</div><div className="logo-tag">Planeador de Menus</div></div>
          </div>
          <nav className="nav">
            {[["menu","📅 Menu"],["recipes","📖 Receitas"],["import","📥 Importar"],["settings","⚙️"]].map(([id,l]) => (
              <button key={id} className={`nb ${tab===id?"on":""}`} onClick={() => setTab(id)}>{l}</button>
            ))}
          </nav>
        </header>

        <main className="main">
          {viewR ? (
            <RecipeDetail recipe={viewR} cats={cats}
              onClose={() => setViewR(null)}
              onEdit={() => { setEditR(viewR); setViewR(null); }}
              onRate={handleRateRecipe} />
          ) : (
            <>
              {tab==="menu"     && <MenuTab recipes={recipes} cats={cats} history={history} activeMenu={activeMenu} quotas={quotas} setQuotas={setQuotas} onAccept={acceptMenu} shoppingList={shoppingList} shopChecked={shopChecked} setShopChecked={setShopChecked} onViewRecipe={setViewR} />}
              {tab==="recipes"  && <RecipesTab recipes={recipes} cats={cats} onEdit={setEditR} onView={setViewR} onDelete={handleDeleteRecipe} onCreate={() => setEditR({})} onSave={handleSaveRecipe} onRate={handleRateRecipe} />}
              {tab==="import"   && <ImportTab cats={cats} onImport={async (newRecs) => {
                for (const r of newRecs) {
                  try { await dbSaveRecipe(r); } catch {}
                }
                const updated = await fetchRecipes();
                setRecipes(updated);
                showToast(`${newRecs.length} receitas importadas!`, "📥");
              }} />}
              {tab==="settings" && <SettingsTab />}
            </>
          )}
        </main>

        {editR !== null && <RecipeEditor recipe={editR} cats={cats} onSave={handleSaveRecipe} onClose={() => setEditR(null)} />}
        {toast && <div className="tst"><span>{toast.icon}</span><span>{toast.msg}</span></div>}
      </div>
    </>
  );
}

// ─── Settings Tab ─────────────────────────────────────────────────────────────
function SettingsTab() {
  return (
    <div>
      <div className="ph"><div><div className="pt">Con<em>figurações</em></div><div className="psub">Informação sobre a app</div></div></div>
      <div className="settings-panel">
        <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:16 }}>
          <div style={{ width:36, height:36, background:"var(--tc)", borderRadius:9, display:"flex", alignItems:"center", justifyContent:"center", fontSize:18 }}>🗄️</div>
          <div>
            <div style={{ fontWeight:600, fontSize:14, color:"var(--b900)" }}>Supabase activo</div>
            <div style={{ fontSize:12, color:"var(--b400)", marginTop:2 }}>Dados sincronizados na cloud</div>
          </div>
          <div style={{ marginLeft:"auto", width:10, height:10, borderRadius:"50%", background:"#2A9D8F", flexShrink:0 }}></div>
        </div>
        <div style={{ padding:"13px 15px", background:"var(--warm)", borderRadius:9, fontSize:12.5, color:"var(--b500)", lineHeight:1.8 }}>
          <div style={{ fontWeight:600, marginBottom:6, color:"var(--b700)" }}>Base de dados</div>
          <div>As receitas e menus estão guardados no Supabase. Para editar receitas directamente podes usar o <strong>Table Editor</strong> em supabase.com.</div>
          <div style={{ marginTop:8, color:"var(--b400)", fontSize:12 }}>
            O Chef IA (✨) está disponível dentro do claude.ai. Para activar na PWA é necessário um backend com chave da Anthropic.
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Menu Tab ─────────────────────────────────────────────────────────────────
function MenuTab({ recipes, cats, history, activeMenu, quotas, setQuotas, onAccept, shoppingList, shopChecked, setShopChecked, onViewRecipe }) {
  const [generating, setGenerating] = useState(false);
  const [shopOpen, setShopOpen]     = useState(false);
  const [lastViolations, setLastViolations] = useState([]);
  const [showRules, setShowRules]   = useState(false);

  const menuRecipes  = activeMenu ? activeMenu.ids.map(id => recipes.find(r => r.id === id)).filter(Boolean) : [];
  const attCount = {
    emp:  menuRecipes.filter(r => isMain(r) && r.attention === "empregada").length,
    nao:  menuRecipes.filter(r => isMain(r) && r.attention === "nao_empregada").length,
    sopa: menuRecipes.filter(isSopa).length,
  };

  const generateMenu = async () => {
    if (recipes.length < 3) { alert("Adiciona pelo menos 3 receitas."); return; }
    setGenerating(true); setLastViolations([]);
    const { ids, violations } = selectMenu(recipes, history, quotas);
    setLastViolations(violations);
    onAccept(ids, "");
    setGenerating(false);
  };

  const shopList   = Object.entries(shoppingList);
  const chkdCount  = shopList.filter(([k]) => shopChecked[k]).length;
  const shopGroups = shopList.reduce((acc, [k, item]) => {
    const g = ["g","kg"].includes(item.unit) ? "🥕 Frescos & Secos" : ["ml","l"].includes(item.unit) ? "🫙 Líquidos" : item.unit === "unid" ? "📦 Unidades" : "🧂 Outros";
    if (!acc[g]) acc[g] = [];
    acc[g].push([k, item]);
    return acc;
  }, {});

  return (
    <div>
      <div className="ph">
        <div><div className="pt">Menu da <em>Semana</em></div></div>
        <button className="btn bg bs" onClick={() => setShowRules(r => !r)}>{showRules ? "▲" : "📋"} Regras</button>
      </div>

      {showRules && (
        <div style={{ background:"#fff", borderRadius:"var(--r)", boxShadow:"var(--ss)", padding:"14px 18px", marginBottom:18, display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(200px,1fr))", gap:12 }}>
          {[
            ["🎲","Seleção por peso","Receitas recentes têm menor probabilidade. Decaimento exponencial."],
            ["⭐","Rating","Receitas com nota mais alta têm maior peso. 5★ = 3× mais provável."],
            ["🗂️","Máx. por categoria",`No máximo ${quotas.maxPerCat} prato${quotas.maxPerCat>1?"s":""} da mesma categoria.`],
            ["👨‍🍳","Quotas",`${quotas.empregada} com atenção + ${quotas.nao_empregada} sem atenção + ${quotas.sopas} sopa.`],
          ].map(([icon, title, desc]) => (
            <div key={title} style={{ display:"flex", gap:9 }}>
              <span style={{ fontSize:18, flexShrink:0 }}>{icon}</span>
              <div><div style={{ fontWeight:600, fontSize:12.5, color:"var(--b700)", marginBottom:2 }}>{title}</div><div style={{ fontSize:11.5, color:"var(--b400)", lineHeight:1.6 }}>{desc}</div></div>
            </div>
          ))}
        </div>
      )}

      <div className="menu-layout">
        <div className="cfg-panel">
          <div className="cfg-head"><div className="cfg-title">Configuração</div><div className="cfg-sub">Quotas e diversidade</div></div>
          <div className="cfg-body">
            {[["👨‍🍳 Com atenção","empregada"],["⏲️ Sem atenção","nao_empregada"],["🍲 Sopa","sopas"]].map(([label, key]) => (
              <div key={key} className="cfg-row">
                <div className="cfg-label"><span>{label}</span></div>
                <div className="stepper">
                  <button className="step-btn" onClick={() => setQuotas(q => { const nv=Math.max(0,q[key]-1); return {...q,[key]:nv,total:q.empregada+q.nao_empregada+q.sopas-(q[key]-nv)}; })}>−</button>
                  <div style={{textAlign:"center"}}><div className="step-val">{quotas[key]}</div></div>
                  <button className="step-btn" onClick={() => setQuotas(q => { const nv=q[key]+1; return {...q,[key]:nv,total:q.empregada+q.nao_empregada+q.sopas+(nv-q[key])}; })}>+</button>
                </div>
              </div>
            ))}
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"6px 0 10px",borderTop:"1px solid var(--b100)",marginTop:2}}>
              <span style={{fontSize:12,color:"var(--b500)",fontWeight:600}}>🍽️ Total por semana</span>
              <span style={{fontFamily:"Cormorant Garamond,serif",fontSize:24,fontWeight:600,color:"var(--b900)"}}>{quotas.empregada+quotas.nao_empregada+quotas.sopas}</span>
            </div>
            <div className="cfg-div"/>
            <div style={{ fontSize:11, fontWeight:600, color:"var(--b400)", textTransform:"uppercase", letterSpacing:".05em", marginBottom:9 }}>Diversidade</div>
            <div className="cfg-row">
              <div className="cfg-label"><span>🗂️ Máx. por categoria</span><span>ex: máx. {quotas.maxPerCat} de Carne</span></div>
              <div className="stepper">
                <button className="step-btn" onClick={() => setQuotas(q => ({...q,maxPerCat:Math.max(1,q.maxPerCat-1)}))}>−</button>
                <div style={{textAlign:"center"}}><div className="step-val">{quotas.maxPerCat}</div></div>
                <button className="step-btn" onClick={() => setQuotas(q => ({...q,maxPerCat:q.maxPerCat+1}))}>+</button>
              </div>
            </div>
            <div className="cfg-div"/>
            <button className="gen-btn" onClick={generateMenu} disabled={generating || recipes.length < 3}>
              {generating
                ? <><div style={{width:15,height:15,border:"2px solid rgba(255,255,255,.3)",borderTopColor:"#fff",borderRadius:"50%",animation:"spin .7s linear infinite"}}></div>A gerar…</>
                : <>✨ Gerar Menu</>}
            </button>
            {lastViolations.length > 0 && (
              <div style={{marginTop:9,padding:"7px 11px",background:"#FEF3CD",borderRadius:6,fontSize:11,color:"#856404",lineHeight:1.6}}>
                ⚠ {lastViolations.join(" · ")}
              </div>
            )}
          </div>
        </div>

        <div>
          <div className="menu-panel">
            {activeMenu ? (
              <>
                <div className="menu-panel-head">
                  <div>
                    <div className="menu-panel-title">Menu desta semana</div>
                    <div style={{fontSize:11.5,color:"var(--b400)",marginTop:3,display:"flex",gap:10,flexWrap:"wrap"}}>
                      <span>👨‍🍳 {attCount.emp}</span><span>⏲️ {attCount.nao}</span><span>🍲 {attCount.sopa}</span>
                    </div>
                    {activeMenu.reason && <div style={{fontSize:12,color:"var(--b500)",marginTop:4,fontStyle:"italic"}}>"{activeMenu.reason}"</div>}
                  </div>
                  <div style={{display:"flex",gap:6,flexShrink:0}}>
                    <button className="btn bo bs" onClick={() => setShopOpen(o => !o)}>🛒 {shopOpen?"Fechar":"Compras"}</button>
                    <button className="btn ba bs" onClick={generateMenu} disabled={generating}>↺ Regenerar</button>
                  </div>
                </div>
                {menuRecipes.map((r,i) => (
                  <div key={r.id} className="dish-row" onClick={() => onViewRecipe(r)}>
                    <div className="dish-num">{i+1}</div>
                    <div style={{width:8,height:8,borderRadius:"50%",background:catColor(r.category,cats),flexShrink:0}}></div>
                    <div style={{flex:1}}>
                      <div style={{fontWeight:500,fontSize:13.5}}>{r.name}</div>
                      <div style={{fontSize:11,color:"var(--b400)",display:"flex",alignItems:"center",gap:8,marginTop:2}}>
                        <span>{r.category}</span>
                        {r.time > 0 && <span>⏱{r.time}min</span>}
                        {r.rating > 0 && <Stars value={r.rating} size={11} />}
                      </div>
                    </div>
                    <div style={{display:"flex",gap:3}}>
                      {isSopa(r)
                        ? <span className="ap" style={{background:"#EBF5FB",color:"#1A5276"}}>🍲</span>
                        : <span className={`ap ${r.attention==="empregada"?"ae":"an"}`}>{r.attention==="empregada"?"👨‍🍳":"⏲️"}</span>}
                    </div>
                  </div>
                ))}
              </>
            ) : (
              <div className="menu-empty">
                <div className="menu-empty-icon">🍽️</div>
                <div style={{fontFamily:"Cormorant Garamond,serif",fontSize:20,fontWeight:300,color:"var(--b700)",marginBottom:6}}>Ainda sem menu esta semana</div>
                <div style={{fontSize:13,color:"var(--b400)"}}>Configura as quotas e clica em <strong>Gerar Menu</strong></div>
              </div>
            )}
          </div>

          {shopOpen && activeMenu && (
            <div className="shop-drawer">
              <div className="shop-head">
                <div className="shop-title">Lista de Compras</div>
                <div style={{display:"flex",alignItems:"center",gap:10,fontSize:12,color:"var(--b400)"}}>
                  <span>{chkdCount}/{shopList.length}</span>
                  {chkdCount > 0 && <button className="btn bg bxs" style={{color:"var(--b200)"}} onClick={() => setShopChecked({})}>Limpar</button>}
                </div>
              </div>
              {Object.entries(shopGroups).map(([grp, items]) => (
                <div key={grp} className="shop-sec">
                  <div className="shop-sec-hd"><span>{grp}</span><span style={{fontWeight:400}}>{items.length}</span></div>
                  {items.sort((a,b) => a[0].localeCompare(b[0])).map(([k, item]) => (
                    <div key={k} className="shop-item">
                      <div className={`sck ${shopChecked[k]?"on":""}`} onClick={() => setShopChecked(c => ({...c,[k]:!c[k]}))}>
                        {shopChecked[k] && "✓"}
                      </div>
                      <div style={{flex:1,fontSize:13}}>{item.name}</div>
                      <div style={{fontSize:12,color:"var(--b400)",fontWeight:500}}>{item.qty > 0 ? `${item.qty} ${item.unit}` : item.unit}</div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}

          {history.length > 0 && (
            <div style={{background:"#fff",borderRadius:"var(--r)",boxShadow:"var(--ss)",padding:"14px 18px",marginTop:16}}>
              <div style={{fontSize:11,fontWeight:700,color:"var(--b400)",textTransform:"uppercase",letterSpacing:".06em",marginBottom:10}}>Historial</div>
              {history.slice(0,5).map((m,i) => (
                <div key={i} style={{padding:"7px 0",borderBottom:i<Math.min(history.length,5)-1?"1px solid var(--b100)":"none",display:"flex",alignItems:"center",gap:8,fontSize:11.5,color:"var(--b500)"}}>
                  <span>📅</span>
                  <span>{new Date(m.date).toLocaleDateString("pt-PT")}</span>
                  <span style={{color:"var(--b200)"}}>·</span>
                  <span>{m.ids.length} pratos</span>
                  {m.reason && <span style={{color:"var(--b400)",fontStyle:"italic",flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>— {m.reason}</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Recipes Tab ──────────────────────────────────────────────────────────────
function RecipesTab({ recipes, cats, onEdit, onView, onDelete, onCreate, onSave, onRate }) {
  const [q, setQ]         = useState("");
  const [cat, setCat]     = useState("Todas");
  const [attn, setAttn]   = useState("Todos");
  const [sort, setSort]   = useState("name");
  const [openAI, setOpenAI] = useState(null);

  const filtered = recipes
    .filter(r => {
      if (cat !== "Todas" && r.category !== cat) return false;
      if (attn === "empregada" && !(isMain(r) && r.attention === "empregada")) return false;
      if (attn === "nao_empregada" && !(isMain(r) && r.attention === "nao_empregada")) return false;
      if (attn === "sopa" && !isSopa(r)) return false;
      if (!r.name.toLowerCase().includes(q.toLowerCase())) return false;
      return true;
    })
    .sort((a,b) => sort==="rating" ? (b.rating||0)-(a.rating||0) : a.name.localeCompare(b.name));

  const incomplete = recipes.filter(r => !r.instructions || !r.ingredients?.length);

  return (
    <div>
      <div className="ph">
        <div>
          <div className="pt">Livro de <em>Receitas</em></div>
          {incomplete.length > 0 && <div className="psub">⚠ {incomplete.length} receita{incomplete.length>1?"s":""} incompleta{incomplete.length>1?"s":""}</div>}
        </div>
        <button className="btn ba bs" onClick={onCreate}>+ Nova</button>
      </div>

      <div style={{display:"flex",gap:8,marginBottom:16,flexWrap:"wrap",alignItems:"center"}}>
        <input className="fi" style={{maxWidth:190}} placeholder="🔍 Pesquisar…" value={q} onChange={e=>setQ(e.target.value)}/>
        <div className="fc">
          {["Todas",...cats].map(c=><button key={c} className={`ch ${cat===c?"on":""}`} onClick={()=>setCat(c)}>{c}</button>)}
        </div>
        <div className="fc">
          {[["Todos","Todos"],["empregada","👨‍🍳"],["nao_empregada","⏲️"],["sopa","🍲"]].map(([v,l])=>(
            <button key={v} className={`ch ${attn===v?"on":""}`} onClick={()=>setAttn(v)}>{l}</button>
          ))}
        </div>
        <div className="fc">
          {[["name","A–Z"],["rating","★ Rating"]].map(([v,l])=>(
            <button key={v} className={`ch ${sort===v?"on":""}`} onClick={()=>setSort(v)}>{l}</button>
          ))}
        </div>
      </div>

      <div className="recipe-list">
        {(() => {
          const catOrder = [...cats, ...filtered.map(r=>r.category).filter(c=>!cats.includes(c))];
          const groups = catOrder.map(c => ({ cat:c, items:filtered.filter(r=>r.category===c) })).filter(g=>g.items.length>0);
          return groups.map(({ cat, items }) => (
            <div key={cat}>
              <div className="rl-group-hd">
                <div className="rl-dot" style={{background:catColor(cat,cats)}}></div>
                {cat} <span style={{color:"var(--b200)",fontWeight:400}}>({items.length})</span>
              </div>
              {items.map(r => {
                const ok = r.instructions && r.ingredients?.length;
                const isOpen = openAI === r.id;
                return (
                  <div key={r.id}>
                    <div className="rl-row">
                      <Stars value={r.rating||0} onChange={rating=>onRate(r.id,rating)} size={12}/>
                      <div style={{flex:1,minWidth:0}}>
                        <div className="rl-name">{r.name}</div>
                        <div className="rl-meta" style={{display:"flex",gap:7,alignItems:"center",flexWrap:"wrap"}}>
                          {!isSopa(r) && <span className={`ap ${r.attention==="empregada"?"ae":"an"}`}>{r.attention==="empregada"?"👨‍🍳":"⏲️"}</span>}
                          {isSopa(r) && <span className="ap" style={{background:"#EBF5FB",color:"#1A5276"}}>🍲</span>}
                          <span className={`ap ${r.speed==="rapido"?"ar":"al"}`}>{r.speed==="rapido"?"⚡":"🐢"}</span>
                          {r.time>0 && <span>{r.time}min</span>}
                          {!ok && <span className="ap ai">⚠</span>}
                        </div>
                      </div>
                      <div className="rl-actions">
                        <button className="btn bo bxs" onClick={()=>onView(r)}>👁</button>
                        <button className="btn bo bxs" onClick={()=>onEdit(r)}>✏️</button>
                        <button className="btn bg bxs" onClick={()=>onDelete(r.id)}>🗑</button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ));
        })()}
      </div>
      {filtered.length===0 && <div style={{textAlign:"center",padding:"44px",color:"var(--b400)"}}><div style={{fontSize:34,marginBottom:9}}>📖</div><div>Nenhuma receita</div></div>}
    </div>
  );
}

// ─── Recipe Detail ────────────────────────────────────────────────────────────
function RecipeDetail({ recipe, cats, onClose, onEdit, onRate }) {
  return (
    <div style={{maxWidth:600,margin:"0 auto"}}>
      <button className="btn bg" style={{marginBottom:18,paddingLeft:0,fontSize:13}} onClick={onClose}>← Voltar</button>
      <div style={{background:"#fff",borderRadius:"var(--r)",boxShadow:"var(--ss)",overflow:"hidden",marginBottom:14}}>
        <div style={{height:6,background:catColor(recipe.category,cats)}}></div>
        <div style={{padding:"18px 20px 20px"}}>
          <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:8,flexWrap:"wrap"}}>
            <div style={{width:7,height:7,borderRadius:"50%",background:catColor(recipe.category,cats)}}></div>
            <span style={{fontSize:11,color:"var(--b400)",textTransform:"uppercase",letterSpacing:".06em",fontWeight:600}}>{recipe.category}</span>
            {isSopa(recipe)
              ? <span className="ap" style={{background:"#EBF5FB",color:"#1A5276"}}>🍲 Sopa</span>
              : <><span className={`ap ${recipe.attention==="empregada"?"ae":"an"}`}>{recipe.attention==="empregada"?"👨‍🍳 Com atenção":"⏲️ Sem atenção"}</span>
                 <span className={`ap ${recipe.speed==="rapido"?"ar":"al"}`}>{recipe.speed==="rapido"?"⚡ Rápido":"🐢 Lento"}</span></>}
          </div>
          <div style={{fontFamily:"Cormorant Garamond,serif",fontSize:26,fontWeight:600,color:"var(--b900)",lineHeight:1.15,marginBottom:10}}>{recipe.name}</div>
          <div style={{display:"flex",alignItems:"center",gap:16,flexWrap:"wrap"}}>
            <Stars value={recipe.rating||0} onChange={r=>onRate(recipe.id,r)} size={20}/>
            <div style={{display:"flex",gap:14,fontSize:12,color:"var(--b400)"}}>
              {recipe.time>0 && <span>⏱ {recipe.time} min</span>}
              {recipe.servings>0 && <span>👤 {recipe.servings} pessoas</span>}
              <span>🥕 {recipe.ingredients?.length||0} ingredientes</span>
            </div>
          </div>
          <div style={{display:"flex",gap:8,marginTop:14,paddingTop:14,borderTop:"1px solid var(--b100)"}}>
            <button className="btn ba bs" onClick={onEdit}>✏️ Editar</button>
          </div>
        </div>
      </div>
      <div style={{background:"#fff",borderRadius:"var(--r)",boxShadow:"var(--ss)",marginBottom:14,overflow:"hidden"}}>
        <div style={{padding:"12px 20px 6px",borderBottom:"1px solid var(--b100)"}}>
          <div style={{fontSize:11,fontWeight:700,color:"var(--b400)",textTransform:"uppercase",letterSpacing:".06em"}}>Ingredientes</div>
        </div>
        <div style={{padding:"6px 0 8px"}}>
          {recipe.ingredients?.length
            ? recipe.ingredients.map((ing,i)=>(
              <div key={i} style={{display:"flex",justifyContent:"space-between",padding:"8px 20px",borderBottom:i<recipe.ingredients.length-1?"1px solid var(--b100)":"none",fontSize:14}}>
                <span>{ing.name}</span>
                <span style={{color:"var(--b400)",fontWeight:500,flexShrink:0,marginLeft:12}}>{ing.qty} {ing.unit}</span>
              </div>
            ))
            : <div style={{padding:"14px 20px",color:"var(--b400)",fontSize:13}}>Sem ingredientes</div>}
        </div>
      </div>
      <div style={{background:"#fff",borderRadius:"var(--r)",boxShadow:"var(--ss)",overflow:"hidden"}}>
        <div style={{padding:"12px 20px 6px",borderBottom:"1px solid var(--b100)"}}>
          <div style={{fontSize:11,fontWeight:700,color:"var(--b400)",textTransform:"uppercase",letterSpacing:".06em"}}>Modo de Preparo</div>
        </div>
        <div style={{padding:"14px 20px"}}>
          {recipe.instructions
            ? <p style={{fontSize:14,lineHeight:1.8,color:"var(--b700)"}}>{recipe.instructions}</p>
            : <div style={{color:"var(--b400)",fontSize:13}}>Sem instruções</div>}
        </div>
      </div>
    </div>
  );
}

// ─── Recipe Editor ────────────────────────────────────────────────────────────
function RecipeEditor({ recipe, cats, onSave, onClose }) {
  const [f, setF] = useState({
    name:recipe.name||"", category:recipe.category||cats[0]||"Carne",
    speed:recipe.speed||"rapido", attention:recipe.attention||"nao_empregada",
    time:recipe.time||30, servings:recipe.servings||3,
    instructions:recipe.instructions||"",
    ingredients:recipe.ingredients?.length?recipe.ingredients:[{name:"",qty:"",unit:"g"}],
    rating:recipe.rating||0, id:recipe.id||null,
  });
  const [newCat, setNewCat] = useState("");
  const set = (k,v) => setF(x=>({...x,[k]:v}));
  const updI = (i,k,v) => { const a=[...f.ingredients]; a[i]={...a[i],[k]:v}; set("ingredients",a); };
  const allCats = newCat&&!cats.includes(newCat)?[...cats,newCat]:cats;

  return (
    <div className="mo" onClick={onClose}>
      <div className="md mdl" onClick={e=>e.stopPropagation()}>
        <div className="mh"><div className="mt">{f.id?"Editar Receita":"Nova Receita"}</div><button className="mc" onClick={onClose}>✕</button></div>
        <div className="mb">
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:20}}>
            <div>
              <div className="fg"><label className="fl">Nome</label><input className="fi" value={f.name} onChange={e=>set("name",e.target.value)} placeholder="Nome da receita"/></div>
              <div className="fg"><label className="fl">Rating</label><Stars value={f.rating||0} onChange={r=>set("rating",r)} size={20}/></div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                <div className="fg">
                  <label className="fl">Categoria</label>
                  <select className="fse" value={f.category} onChange={e=>set("category",e.target.value)}>{allCats.map(c=><option key={c}>{c}</option>)}</select>
                  <input className="fi" style={{marginTop:4,fontSize:12}} placeholder="Nova categoria…" value={newCat} onChange={e=>{setNewCat(e.target.value);if(e.target.value)set("category",e.target.value);}}/>
                </div>
                <div>
                  <div className="fg"><label className="fl">Tempo (min)</label><input className="fi" type="number" value={f.time} onChange={e=>set("time",e.target.value)}/></div>
                  <div className="fg"><label className="fl">Pessoas</label><input className="fi" type="number" value={f.servings} onChange={e=>set("servings",e.target.value)}/></div>
                </div>
              </div>
              <div className="fg"><label className="fl">Atenção</label><div className="tg"><button className={`to ${f.attention==="empregada"?"on":""}`} onClick={()=>set("attention","empregada")}>👨‍🍳 Com atenção</button><button className={`to ${f.attention==="nao_empregada"?"on":""}`} onClick={()=>set("attention","nao_empregada")}>⏲️ Sem atenção</button></div></div>
              <div className="fg"><label className="fl">Velocidade</label><div className="tg"><button className={`to ${f.speed==="rapido"?"on":""}`} onClick={()=>set("speed","rapido")}>⚡ Rápido</button><button className={`to ${f.speed==="lento"?"on":""}`} onClick={()=>set("speed","lento")}>🐢 Lento</button></div></div>
              <div className="fg"><label className="fl">Instruções</label><textarea className="fta" value={f.instructions} onChange={e=>set("instructions",e.target.value)} placeholder="Modo de preparo…" rows={5}/></div>
            </div>
            <div>
              <div className="fl" style={{marginBottom:8}}>Ingredientes</div>
              {f.ingredients.map((ing,i)=>(
                <div key={i} className="ir">
                  <input className="fi" value={ing.name} onChange={e=>updI(i,"name",e.target.value)} placeholder="Ingrediente"/>
                  <input className="fi" value={ing.qty} onChange={e=>updI(i,"qty",e.target.value)} placeholder="Qtd" type="number" step="0.1"/>
                  <input className="fi" value={ing.unit} onChange={e=>updI(i,"unit",e.target.value)} placeholder="un."/>
                  <button className="btn bg" style={{padding:3,color:"var(--tc)",fontSize:11}} onClick={()=>set("ingredients",f.ingredients.filter((_,j)=>j!==i))}>✕</button>
                </div>
              ))}
              <button className="btn bo bs" onClick={()=>set("ingredients",[...f.ingredients,{name:"",qty:"",unit:"g"}])}>+ Ingrediente</button>
            </div>
          </div>
          <div style={{display:"flex",gap:8,justifyContent:"flex-end",marginTop:14,paddingTop:12,borderTop:"1px solid var(--b100)"}}>
            <button className="btn bo" onClick={onClose}>Cancelar</button>
            <button className="btn ba" onClick={()=>{ if(!f.name.trim())return alert("Insere o nome."); onSave({...f,time:Number(f.time),servings:Number(f.servings)}); }}>💾 Guardar</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Import Tab ───────────────────────────────────────────────────────────────
function ImportTab({ cats, onImport }) {
  const [drag, setDrag]     = useState(false);
  const [preview, setPreview] = useState(null);
  const [error, setError]   = useState("");
  const [done, setDone]     = useState(false);
  const fileRef = useRef();

  const parseFile = (file) => {
    setError(""); setPreview(null); setDone(false);
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = e.target.result;
        let parsed = [];
        if (file.name.endsWith(".json")) {
          const raw = JSON.parse(text);
          parsed = (Array.isArray(raw) ? raw : raw.recipes || []).map(r => ({
            name: r.name||r.nome||"", category: r.category||r.categoria||"Outros",
            attention: r.attention||r.atencao||"nao_empregada",
            speed: r.speed||r.velocidade||"rapido",
            time: Number(r.time||r.tempo||r.time_minutes)||0,
            servings: Number(r.servings||r.pessoas)||3,
            ingredients: r.ingredients||r.ingredientes||[],
            instructions: r.instructions||r.instrucoes||r.instruções||"",
          }));
        } else {
          const lines = text.split("\n").filter(Boolean);
          const headers = lines[0].split(",").map(h => h.trim().toLowerCase());
          parsed = lines.slice(1).map(line => {
            const vals = line.split(",");
            const obj = {};
            headers.forEach((h,i) => { obj[h] = (vals[i]||"").trim(); });
            return {
              name: obj.nome||obj.name||"", category: obj.categoria||obj.category||"Outros",
              attention: obj.atencao||obj.attention||"nao_empregada",
              speed: obj.velocidade||obj.speed||"rapido",
              time: Number(obj.tempo||obj.time)||0, servings: Number(obj.pessoas||obj.servings)||3,
              ingredients: [], instructions: obj.instrucoes||obj.instructions||"",
            };
          }).filter(r => r.name);
        }
        setPreview(parsed);
      } catch(err){ setError(err.message||"Erro ao processar."); }
    };
    reader.readAsText(file);
  };

  return (
    <div>
      <div className="ph"><div><div className="pt">Importar <em>Receitas</em></div><div className="psub">CSV ou JSON</div></div></div>
      <div className="import-layout">
        <div>
          {!preview ? (
            <div className={`uz ${drag?"dg":""}`}
              onDragOver={e=>{e.preventDefault();setDrag(true);}}
              onDragLeave={()=>setDrag(false)}
              onDrop={e=>{e.preventDefault();setDrag(false);if(e.dataTransfer.files[0])parseFile(e.dataTransfer.files[0]);}}
              onClick={()=>fileRef.current?.click()}>
              <input ref={fileRef} type="file" accept=".json,.csv,.txt" style={{display:"none"}} onChange={e=>e.target.files[0]&&parseFile(e.target.files[0])}/>
              <div style={{fontSize:32,marginBottom:10}}>📂</div>
              <div style={{fontSize:14,fontWeight:500,color:"var(--b700)",marginBottom:3}}>Arrasta ou clica</div>
              <div style={{fontSize:12,color:"var(--b400)"}}>Aceita .json ou .csv</div>
            </div>
          ) : done ? (
            <div style={{background:"#EBF5FB",border:"1.5px solid #AED6F1",borderRadius:"var(--r)",padding:"20px",textAlign:"center"}}>
              <div style={{fontSize:26,marginBottom:7}}>✅</div>
              <div style={{fontWeight:600,color:"#1A5276"}}>Importado!</div>
            </div>
          ) : (
            <>
              <div style={{marginBottom:10,padding:"9px 13px",background:"#EBF5FB",borderRadius:7,fontSize:13,color:"#1A5276"}}>✓ {preview.length} receitas</div>
              <div className="imp-preview">
                {preview.map((r,i)=>(
                  <div key={i} className="imp-row">
                    <div style={{flex:1}}><div style={{fontWeight:500,fontSize:13}}>{r.name}</div><div style={{fontSize:11,color:"var(--b400)"}}>{r.category}</div></div>
                    <span className={`ap ${r.attention==="empregada"?"ae":"an"}`}>{r.attention==="empregada"?"👨‍🍳":"⏲️"}</span>
                  </div>
                ))}
              </div>
              <div style={{display:"flex",gap:8,marginTop:11,justifyContent:"flex-end"}}>
                <button className="btn bo bs" onClick={()=>setPreview(null)}>← Voltar</button>
                <button className="btn ba bs" onClick={()=>{ onImport(preview); setDone(true); setTimeout(()=>{setPreview(null);setDone(false);},1800); }}>📥 Importar {preview.length}</button>
              </div>
            </>
          )}
          {error && <div style={{marginTop:9,padding:"8px 12px",background:"#FDECEA",color:"#C0392B",borderRadius:7,fontSize:12.5}}>⚠ {error}</div>}
        </div>
        <div style={{display:"flex",flexDirection:"column",gap:14}}>
          <div className="imp-card">
            <div className="imp-head">📄 Formato CSV</div>
            <div className="imp-body">
              <pre style={{background:"var(--warm)",padding:"10px 12px",borderRadius:7,fontSize:11,color:"var(--b700)",overflow:"auto",lineHeight:1.7}}>{`nome,categoria,velocidade,atencao
Frango no forno,Carne,lento,nao_empregada`}</pre>
            </div>
          </div>
          <div className="imp-card">
            <div className="imp-head">📋 Formato JSON</div>
            <div className="imp-body">
              <pre style={{background:"var(--warm)",padding:"10px 12px",borderRadius:7,fontSize:11,color:"var(--b700)",overflow:"auto",lineHeight:1.7}}>{`[{"name":"Frango",
  "category":"Carne",
  "attention":"nao_empregada",
  "ingredients":[...]}]`}</pre>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
