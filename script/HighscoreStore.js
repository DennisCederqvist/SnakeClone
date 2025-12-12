const KEY = "snake_highscores_v1";

export function loadHighscores() {
  try {
    const raw = localStorage.getItem(KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function saveHighscore(score) {
  const entry = {
    score: Number(score) || 0,
    date: new Date().toISOString().slice(0, 10),
  };

  const list = loadHighscores();
  list.push(entry);

  // sort högst först
  list.sort((a, b) => b.score - a.score);

  // behåll top 5
  const trimmed = list.slice(0, 5);

  localStorage.setItem(KEY, JSON.stringify(trimmed));
  return trimmed;
}

export function clearHighscores() {
  localStorage.removeItem(KEY);
}
