// invalid-emails.js
import fs from 'fs/promises';
import path from 'path';

const dataDir = 'logs';
const dataFile = path.join(dataDir, 'invalid-emails.json');

const set = new Set();
let saveScheduled = false;

async function ensureDir() {
  await fs.mkdir(dataDir, { recursive: true }).catch(() => {});
}

export async function initInvalidEmails() {
  await ensureDir();
  try {
    const raw = await fs.readFile(dataFile, 'utf8');
    const arr = JSON.parse(raw);
    if (Array.isArray(arr)) arr.forEach(e => set.add(String(e).trim().toLowerCase()));
  } catch (_) { /* brak pliku = pusta lista */ }
}

function scheduleSave() {
  if (saveScheduled) return;
  saveScheduled = true;
  setTimeout(async () => {
    saveScheduled = false;
    try {
      await ensureDir();
      const arr = Array.from(set.values()).sort();
      await fs.writeFile(dataFile, JSON.stringify(arr, null, 2));
    } catch (e) {
      console.error('[invalid-emails] save failed:', e.message);
    }
  }, 500);
}

export function addInvalidEmail(email) {
  const e = String(email || '').trim().toLowerCase();
  if (!e) return;
  if (!set.has(e)) {
    set.add(e);
    console.log(`🚫 blacklist add: ${e}`);
    scheduleSave();
  }
}

export function isInvalidEmail(email) {
  const e = String(email || '').trim().toLowerCase();
  return set.has(e);
}
