const SUPABASE_URL = "https://jfdlkbtrckjltcjkypfi.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_e8oulmywZHnCTSJ0rATwvA_Zj-6TSGS";

const TABLE = "leaderboard";

const headers = {
	"Content-Type": "application/json",
	apikey: SUPABASE_ANON_KEY,
	Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
};

const LOCAL_KEY = "snake_highscores_v3";

function sanitizeInitials(input) {
	return (
		String(input ?? "")
			.toUpperCase()
			.replace(/[^A-Z0-9]/g, "")
			.slice(0, 3) || "AAA"
	);
}

function localLoad() {
	try {
		const raw = localStorage.getItem(LOCAL_KEY);
		const list = raw ? JSON.parse(raw) : [];
		return Array.isArray(list) ? list : [];
	} catch {
		return [];
	}
}

function localSave(entry) {
	const list = localLoad();
	list.push(entry);
	list.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
	const trimmed = list.slice(0, 10);
	localStorage.setItem(LOCAL_KEY, JSON.stringify(trimmed));
	return trimmed;
}

export async function loadHighscores() {
	try {
		const url = `${SUPABASE_URL}/rest/v1/${TABLE}?select=id,initials,score,created_at&order=score.desc&limit=10`;
		const res = await fetch(url, { headers });
		if (!res.ok) throw new Error(`Supabase load failed: ${res.status}`);
		const rows = await res.json();

		return rows.map((r) => ({
			id: r.id,
			initials: r.initials,
			score: Number(r.score ?? 0),
			date: String(r.created_at ?? "").slice(0, 10),
		}));
	} catch {
		return localLoad();
	}
}

/**
 * Save score and return { list, insertedId }.
 * insertedId kan vara null i local fallback.
 */
export async function saveHighscore(score, initials) {
	const entry = {
		id: null,
		initials: sanitizeInitials(initials),
		score: Number(score) || 0,
		date: new Date().toISOString().slice(0, 10),
	};

	// Supabase först
	try {
		// "return=representation" så vi får tillbaka raden (inkl id)
		const url = `${SUPABASE_URL}/rest/v1/${TABLE}?select=id,initials,score,created_at`;
		const res = await fetch(url, {
			method: "POST",
			headers: {
				...headers,
				Prefer: "return=representation",
			},
			body: JSON.stringify({
				initials: entry.initials,
				score: entry.score,
			}),
		});

		if (!res.ok) throw new Error(`Supabase insert failed: ${res.status}`);

		const returned = await res.json(); // array med 1 rad
		const insertedId = returned?.[0]?.id ?? null;

		const list = await loadHighscores();
		return { list, insertedId };
	} catch {
		// Local fallback
		const list = localSave(entry);
		return { list, insertedId: null };
	}
}

export async function qualifiesForTop10(score) {
	const list = await loadHighscores();
	if (list.length < 10) return true;
	const min = Math.min(...list.map((x) => Number(x.score ?? 0)));
	return Number(score) > min;
}
