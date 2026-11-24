// Ajoute le jeu Discord en cours à l'historique stocké dans le KV Lanyard (clé recent_games).
// Lancé par .github/workflows/recent-games.yml. L'ID Discord est lu dans index.html.
import { readFile } from "node:fs/promises";

const API = process.env.LANYARD_API ?? "https://api.lanyard.rest/v1";
const KEY = process.env.LANYARD_API_KEY;
const MAX_GAMES = 5;
const REFRESH_MS = 10 * 60 * 1000; // évite de réécrire à chaque passage pendant une session

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const attr = (name) => html.match(new RegExp(`${name}="([^"]*)"`))?.[1] ?? "";
const id = attr("data-discord-id");
const ignored = attr("data-ignore").split("|");

if (!/^\d{17,20}$/.test(id)) throw new Error("data-discord-id manquant ou invalide dans index.html");
if (!KEY) {
  console.log("::warning::Secret LANYARD_API_KEY manquant : historique non mis à jour");
  process.exit(0);
}

const res = await fetch(`${API}/users/${id}`);
if (!res.ok) throw new Error(`Lanyard GET ${res.status} : as-tu rejoint le serveur Discord de Lanyard ?`);
const { data } = await res.json();

const games = data.activities.filter((a) => a.type === 0 && !ignored.includes(a.name));
if (!games.length) {
  console.log("Aucun jeu en cours.");
  process.exit(0);
}

let history = [];
try { history = JSON.parse(data.kv?.recent_games ?? "[]"); } catch { /* KV illisible : on repart de zéro */ }
if (!Array.isArray(history)) history = [];

const now = Date.now();
let changed = false;
for (const game of games) {
  const known = history.find((g) => g.name === game.name);
  if (known && now - known.last < REFRESH_MS) continue;
  const image = known?.image ?? (await icon(game));
  history = [{ name: game.name, image, last: now }, ...history.filter((g) => g !== known)];
  changed = true;
}
if (!changed) {
  console.log("Historique déjà à jour.");
  process.exit(0);
}

history = history.sort((a, b) => b.last - a.last).slice(0, MAX_GAMES);
const put = await fetch(`${API}/users/${id}/kv/recent_games`, {
  method: "PUT",
  headers: { Authorization: KEY },
  body: JSON.stringify(history),
});
if (!put.ok) throw new Error(`Lanyard PUT ${put.status} : vérifie LANYARD_API_KEY`);
console.log("Historique :", history.map((g) => g.name).join(", "));

// Icône officielle de l'application Discord, sinon null (la page affiche l'initiale)
async function icon({ application_id: app }) {
  if (!app) return null;
  try {
    const r = await fetch(`https://discord.com/api/v10/applications/${app}/rpc`);
    const { icon } = await r.json();
    return icon ? `https://cdn.discordapp.com/app-icons/${app}/${icon}.png?size=128` : null;
  } catch {
    return null;
  }
}
