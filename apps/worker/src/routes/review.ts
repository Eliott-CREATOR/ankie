import { type CardRow, type ReviewRating, createScheduler, rateCard } from "@ankie/core";

const CARD_COLUMNS = `id, sense_id, atom_type, front, back, state, unlock_after_card,
  unlock_min_stability, due, stability, difficulty, elapsed_days, scheduled_days, reps, lapses,
  last_review, updated_at`;

interface ReviewRequestBody {
  id?: unknown;
  cardId?: unknown;
  rating?: unknown;
  reviewedAt?: unknown;
  durationMs?: unknown;
}

function isValidRating(value: unknown): value is ReviewRating {
  return value === 1 || value === 2 || value === 3 || value === 4;
}

// POST /api/review — {id, cardId, rating, reviewedAt, durationMs}. Runs FSRS, updates the card
// and appends to review_log in one D1 batch (transactional — both succeed or both fail).
// review_log is append-only (docs/spec.md §4) — this never issues an UPDATE against it.
//
// `id` is client-generated (docs/spec.md §4 — review-log rows carry client-generated UUIDs) and
// checked for a prior row before anything else runs. Without this, a retried submission (the
// client can't always tell a failed request from one whose response was lost) would apply FSRS
// twice against the same rating — corrupting the schedule, not just double-logging it. A repeat
// id is treated as "already recorded" and short-circuits with no writes at all.
//
// Every rejection below returns an explicit error response. The C0 gate's planted bug was a
// swallowed error causing silent data loss — this project cannot afford that mistake twice.
export async function handleReview(request: Request, env: { DB: D1Database }): Promise<Response> {
  let body: ReviewRequestBody;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }

  if (typeof body.id !== "string" || body.id.length === 0) {
    return Response.json({ error: "id is required and must be a string" }, { status: 400 });
  }
  if (typeof body.cardId !== "string" || body.cardId.length === 0) {
    return Response.json({ error: "cardId is required and must be a string" }, { status: 400 });
  }
  if (!isValidRating(body.rating)) {
    return Response.json(
      { error: "rating must be 1 (Again), 2 (Hard), 3 (Good), or 4 (Easy)" },
      { status: 400 },
    );
  }
  const now = Date.now();
  // Clamped, not merely validated: a client clock running ahead must never schedule a card into
  // the future relative to the server, or it could become permanently undue.
  const reviewedAt =
    typeof body.reviewedAt === "number" && Number.isFinite(body.reviewedAt) && body.reviewedAt > 0
      ? Math.min(body.reviewedAt, now)
      : now;
  const durationMs =
    typeof body.durationMs === "number" && Number.isFinite(body.durationMs)
      ? body.durationMs
      : null;

  const existing = await env.DB.prepare("SELECT 1 FROM review_log WHERE id = ?1")
    .bind(body.id)
    .first();
  if (existing) {
    return Response.json({ ok: true, duplicate: true, cardId: body.cardId });
  }

  const card = await env.DB.prepare(`SELECT ${CARD_COLUMNS} FROM cards WHERE id = ?1`)
    .bind(body.cardId)
    .first<CardRow>();

  if (!card) {
    return Response.json({ error: `unknown card id: ${body.cardId}` }, { status: 404 });
  }
  if (card.state === "suspended" || card.state === "locked") {
    return Response.json(
      { error: `card ${card.id} is ${card.state}, not reviewable` },
      { status: 409 },
    );
  }

  const settings = await env.DB.prepare(
    "SELECT fsrs_params, desired_retention FROM settings WHERE id = 1",
  ).first<{ fsrs_params: string | null; desired_retention: number }>();

  if (!settings) {
    return Response.json({ error: "settings row missing" }, { status: 500 });
  }

  const scheduler = createScheduler({
    fsrsParams: settings.fsrs_params,
    desiredRetention: settings.desired_retention,
  });

  const result = rateCard(scheduler, card, body.rating, new Date(reviewedAt));
  const savedAt = Date.now();

  const updateCard = env.DB.prepare(
    `UPDATE cards SET state = ?1, due = ?2, stability = ?3, difficulty = ?4, elapsed_days = ?5,
       scheduled_days = ?6, reps = ?7, lapses = ?8, last_review = ?9, updated_at = ?10
     WHERE id = ?11`,
  ).bind(
    result.card.state,
    result.card.due,
    result.card.stability,
    result.card.difficulty,
    result.card.elapsed_days,
    result.card.scheduled_days,
    result.card.reps,
    result.card.lapses,
    result.card.last_review,
    savedAt,
    card.id,
  );

  const insertLog = env.DB.prepare(
    `INSERT INTO review_log (id, card_id, rating, state_before, reviewed_at, duration_ms, typed_answer, device)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, NULL, NULL)`,
  ).bind(body.id, card.id, body.rating, JSON.stringify(card), reviewedAt, durationMs);

  try {
    await env.DB.batch([updateCard, insertLog]);
  } catch (err) {
    return Response.json(
      { error: `failed to save review: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 },
    );
  }

  return Response.json({ ok: true, cardId: card.id, reviewLogId: body.id, card: result.card });
}
