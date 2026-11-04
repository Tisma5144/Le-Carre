// Morceaux de phrases assembles par le code (noms de cartes, « Un Roi »,
// « Paire de Rois »…) : cles ajoutees a la main, [francais, en, it, ru].
const RANKS = [
  // [singulier, pluriel, en sg, en pl, it sg, it pl, ru sg, ru pl, ru genitif pluriel]
  ["As", "As", "Ace", "Aces", "Asso", "Assi", "Туз", "Тузы", "тузов"],
  ["Roi", "Rois", "King", "Kings", "Re", "Re", "Король", "Короли", "королей"],
  ["Dame", "Dames", "Queen", "Queens", "Donna", "Donne", "Дама", "Дамы", "дам"],
  ["Valet", "Valets", "Jack", "Jacks", "Fante", "Fanti", "Валет", "Валеты", "валетов"],
  ["Cavalier", "Cavaliers", "Knight", "Knights", "Cavallo", "Cavalli", "Рыцарь", "Рыцари", "рыцарей"]
];
const out = [];
for (const [fs, fp, es, ep, is, ip, rs, rp, rg] of RANKS) {
  out.push([fs, es, is, rs]);
  if (fp !== fs) out.push([fp, ep, ip, rp]);
  const de = /^[AEIOU]/.test(fp) ? `d'${fp}` : `de ${fp}`;
  out.push([de, `of ${ep}`, /^[AEIOU]/.test(ip) ? `d'${ip}` : `di ${ip}`, rg]);
}
for (const n of ["2", "3", "4", "5", "6", "7", "8", "9", "10"]) {
  out.push([`de ${n}`, `of ${n}s`, `di ${n}`, `${n}`]);
}
const SUITS = ["♠", "♥", "♦", "♣"];
for (const s of SUITS) {
  out.push([`{0} ${s}`, `{0} ${s}`, `{0} ${s}`, `{0} ${s}`]);
  out.push([`{0}${s}`, `{0}${s}`, `{0}${s}`, `{0}${s}`]);
}
out.push(
  ["de {0}", "of {0}", "di {0}", "{0}"],
  ["d'{0}", "of {0}", "d'{0}", "{0}"],
  ["Un {0} !", "One {0}!", "Un {0}!", "Один {0}!"],
  ["Une {0} !", "One {0}!", "Una {0}!", "Одна {0}!"],
  ["Deux {0} !", "Two {0}!", "Due {0}!", "Два {0}!"],
  ["Trois {0} !", "Three {0}!", "Tre {0}!", "Три {0}!"],
  ["Quatre {0} !", "Four {0}!", "Quattro {0}!", "Четыре {0}!"],
  ["Un {0}", "One {0}", "Un {0}", "{0}"],
  ["Une {0}", "One {0}", "Una {0}", "{0}"],
  ["un", "a", "un", ""],
  ["une", "a", "una", ""],
  ["une paire", "a pair", "una coppia", "пару"],
  ["un brelan", "three of a kind", "un tris", "тройку"],
  ["manche", "round", "mano", "раунд"],
  ["donne", "deal", "smazzata", "раздача"],
  ["Bilan", "Balance", "Bilancio", "Итог"],
  ["Recaves", "Rebuys", "Riacquisti", "Докупки"],
  ["depuis 2026", "since 2026", "dal 2026", "с 2026"],
  ["CHEZ", "AT", "DA", "У"],
  ["Le Carré · bar à cartes", "Le Carré · card bar", "Le Carré · bar delle carte", "Le Carré · карточный бар"],
  ["Langue", "Language", "Lingua", "Язык"],
  ["🌐 Langue", "🌐 Language", "🌐 Lingua", "🌐 Язык"],
  ["🌐 Langue · {0}", "🌐 Language · {0}", "🌐 Lingua · {0}", "🌐 Язык · {0}"],
  // morceaux releves en jouant
  ["{0} · {1}", "{0} · {1}", "{0} · {1}", "{0} · {1}"],
  ["Ton pseudo", "Your nickname", "Il tuo nome", "Твоё имя"],
  ["{0} (toi)", "{0} (you)", "{0} (tu)", "{0} (ты)"],
  ["✔ {0}", "✔ {0}", "✔ {0}", "✔ {0}"],
  ["toi", "you", "te", "ты"],
  ["Toi", "You", "Tu", "Ты"],
  ["posé par toi", "played by you", "posato da te", "положил(а) ты"],
  ["Le jeu de toi est dévoilé 🕳️", "Your hand is revealed 🕳️", "La tua mano è svelata 🕳️", "Твоя рука раскрыта 🕳️"],
  ["toi distribue", "you deal", "distribuisci tu", "сдаёшь ты"],
  ["passe", "passed", "passa", "пас"],
  ["{0} <i>(max possible à {1} joueurs)</i>", "{0} <i>(max possible with {1} players)</i>", "{0} <i>(massimo possibile con {1} giocatori)</i>", "{0} <i>(максимум для {1} игроков)</i>"],
  ["{#0} carte", "{0} card", "{0} carta", "{0} карта"],
  ["{#0} cartes", "{0} cards", "{0} carte", "{0} карт"],
  ["{#0} pli", "{0} trick", "{0} presa", "{0} взятка"],
  ["{#0} plis", "{0} tricks", "{0} prese", "{0} взяток"],
  ["atout {0}", "trumps {0}", "atout {0}", "козырь {0}"],
  ["sans atout", "no trump", "senza atout", "без козыря"],
  ["♠ Pique", "♠ Spades", "♠ Picche", "♠ Пики"],
  ["♥ Cœur", "♥ Hearts", "♥ Cuori", "♥ Червы"],
  ["♦ Carreau", "♦ Diamonds", "♦ Quadri", "♦ Бубны"],
  ["♣ Trèfle", "♣ Clubs", "♣ Fiori", "♣ Трефы"],
  ["tu distribues", "you deal", "distribuisci tu", "ты сдаёшь"],
  ["{0} distribue", "{0} deals", "distribuisce {0}", "сдаёт {0}"],
  ["toutes les {#0} mains", "every {0} hands", "ogni {0} mani", "каждые {0} раздач"],
  ["toutes les {#0}", "every {0}", "ogni {0}", "каждые {0}"],
  ["Tu as :", "You have:", "Hai:", "У тебя:"],
  ["tu peux checker", "you can check", "puoi fare check", "можно чек"],
  ["· tu peux checker", "· you can check", "· puoi fare check", "· можно чек"],
  ["à suivre", "to call", "da chiamare", "чтобы уравнять"],
  ["(prochain donneur) lance la main suivante…", "(next dealer) starts the next hand…", "(prossimo mazziere) lancia la mano successiva…", "(следующий дилер) начнёт раздачу…"],
  ["🏆 {0} <b>{1}</b> 🪙", "🏆 {0} <b>{1}</b> 🪙", "🏆 {0} <b>{1}</b> 🪙", "🏆 {0} <b>{1}</b> 🪙"],
  ["{0} ! ✋", "{0}! ✋", "{0}! ✋", "{0}! ✋"],
  ["belote 20", "belote 20", "belote 20", "белот 20"],
  ["annonces {0}", "announcements {0}", "annunci {0}", "объявления {0}"],
  ["capot de {0}", "capot by {0}", "cappotto di {0}", "капот: {0}"],
  ["Annonces : {0} pour {1} — il y aura des cadeaux 🎁", "Bids: {0} for {1} — there'll be gifts 🎁", "Annunci: {0} per {1} — ci saranno regali 🎁", "Заявки: {0} на {1} — будут подарки 🎁"],
  ["Annonces : {0} pour {1} — ça va se battre ! ⚔️", "Bids: {0} for {1} — it'll be a fight! ⚔️", "Annunci: {0} per {1} — sarà battaglia! ⚔️", "Заявки: {0} на {1} — будет драка! ⚔️"],
  ["🏆 {0}", "🏆 {0}", "🏆 {0}", "🏆 {0}"],
  ["🤝 {0}", "🤝 {0}", "🤝 {0}", "🤝 {0}"],
  ["{0} et {1}", "{0} and {1}", "{0} e {1}", "{0} и {1}"],
  ["{0} & {1}", "{0} & {1}", "{0} & {1}", "{0} и {1}"],
  ["Tu cries", "You call", "Gridi", "Ты кричишь"],
  ["{0} crie MENTEUR sur {1} !", "{0} calls LIAR on {1}!", "{0} grida DUBITO a {1}!", "{0} кричит «НЕ ВЕРЮ» игроку {1}!"],
  ["{0} crie MENTEUR sur toi !", "{0} calls LIAR on you!", "{0} grida DUBITO a te!", "{0} кричит тебе «НЕ ВЕРЮ»!"],
  ["Tu cries MENTEUR sur {0} !", "You call LIAR on {0}!", "Gridi DUBITO a {0}!", "Ты кричишь «НЕ ВЕРЮ» игроку {0}!"],
  ["Tu prends : {0} !", "You take: {0}!", "Prendi: {0}!", "Ты берёшь: {0}!"],
  ["{0} prend : {1} !", "{0} takes: {1}!", "{0} prende: {1}!", "{0} берёт: {1}!"],
  ["Tu prends : {0}", "You take: {0}", "Prendi: {0}", "Ты берёшь: {0}"],
  ["{0} prend : {1}", "{0} takes: {1}", "{0} prende: {1}", "{0} берёт: {1}"],
  ["pour {0} demandés", "for {0} bid", "per {0} chiesti", "при заявке {0}"],
  ["au tour de {0}", "{0}'s turn", "tocca a {0}", "ходит {0}"],
  ["au tour de toi", "your turn", "tocca a te", "твой ход"],
  ["atout {0} {1}", "trumps {0} {1}", "atout {0} {1}", "козырь {0} {1}"],
  ["total {0}", "total {0}", "totale {0}", "итого {0}"],
  ["petite blinde", "small blind", "piccolo buio", "малый блайнд"],
  ["grosse blinde", "big blind", "grande buio", "большой блайнд"],
  ["{0} pour un joueur avec {1}", "{0} for a player with {1}", "{0} per un giocatore con {1}", "{0} для игрока с {1}"],
  ["tu ouvres", "you open", "apri tu", "ты открываешь"],
  ["petit au bout {0}", "Petit at the end {0}", "Petit all'ultima {0}", "Пти в конце {0}"],
  ["chelem {0}", "slam {0}", "slam {0}", "шлем {0}"],
  ["et {0}", "and {0}", "e {0}", "и {0}"],
  ["hors ligne", "offline", "offline", "не в сети"],
  ["{0} ({1})", "{0} ({1})", "{0} ({1})", "{0} ({1})"],
  ["🔘 {0}", "🔘 {0}", "🔘 {0}", "🔘 {0}"],
  ["×2 dans {#0} mains", "×2 in {0} hands", "×2 tra {0} mani", "×2 через {0} раздач"],
  ["×2 dans {#0} main", "×2 in {0} hand", "×2 tra {0} mano", "×2 через {0} раздачу"],
  ["Relancer ▴", "Raise ▴", "Rilancia ▴", "Рейз ▴"],
  ["Miser ▴", "Bet ▴", "Punta ▴", "Ставка ▴"],
  ["Relancer à", "Raise to", "Rilancia a", "Рейз до"],
  ["Miser à", "Bet", "Punta", "Ставка"]
);
module.exports = out;
