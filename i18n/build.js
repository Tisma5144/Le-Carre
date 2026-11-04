// Assemble les dictionnaires public/i18n/<langue>.json a partir de
// source-keys.json (phrases francaises relevees dans le code), des fichiers
// tr-*.js ([index, en, it, ru]) et d'extras.js ([francais, en, it, ru]).
// Usage : node i18n/build.js
const fs = require("fs");
const path = require("path");
const dir = __dirname;
const keys = require("./source-keys.json");
const LANGS = ["en", "it", "ru"];
// index sans traduction voulue (code, gabarits sans texte, identifiants)
const SKIP = new Set([25, 28, 50, 51, 459, 717, 762, 764, 765, 786, 791]);
const dict = Object.fromEntries(LANGS.map((l) => [l, {}]));
const seen = new Set();
const ph = (s) => new Set((s.match(/\{#?\d+\}/g) || []).map((p) => p.replace("#", "")));
let problems = 0;
const put = (fr, vals, where) => {
  const want = ph(fr);
  LANGS.forEach((l, i) => {
    const v = vals[i];
    if (v === undefined || v === null) return;
    for (const p of ph(v)) if (!want.has(p)) { console.log(`! ${where} ${l} : ${p} absent de la cle « ${fr} »`); problems += 1; }
    dict[l][fr] = v;
  });
};
for (const f of fs.readdirSync(dir).filter((n) => /^tr-\d+\.js$/.test(n)).sort()) {
  for (const [i, ...vals] of require(path.join(dir, f))) {
    if (!keys[i]) { console.log(`! ${f} : index ${i} inconnu`); problems += 1; continue; }
    if (seen.has(i)) { console.log(`! ${f} : index ${i} en double`); problems += 1; }
    seen.add(i);
    put(keys[i].k, vals, `${f}#${i}`);
  }
}
for (const [fr, ...vals] of require("./extras.js")) put(fr, vals, "extras");
const missing = keys.map((k, i) => i).filter((i) => !seen.has(i) && !SKIP.has(i));
if (missing.length) console.log(`! ${missing.length} phrases sans traduction : ${missing.slice(0, 40).join(", ")}`);
fs.mkdirSync(path.join(dir, "..", "public", "i18n"), { recursive: true });
for (const l of LANGS) fs.writeFileSync(path.join(dir, "..", "public", "i18n", `${l}.json`), JSON.stringify(dict[l]));
console.log(`Dictionnaires : ${Object.keys(dict.en).length} phrases · ${problems} problème(s) · ${missing.length} manquante(s)`);
process.exitCode = problems || missing.length ? 1 : 0;
