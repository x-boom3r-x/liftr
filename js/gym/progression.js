/* Progression advice for LIFTR's guided-session format.
   Pure and history-derived: it never edits a saved workout or routine. */

const round = value => Math.round((Number(value) || 0) * 100) / 100;

function repsTargetOf(value, fallback){
  const text = String(value == null ? '' : value).trim();
  const range = text.match(/^(\d+)\s*[-–—]\s*(\d+)$/);
  if (range){
    const a = Number(range[1]), b = Number(range[2]);
    if (a > 0 && b >= a && b <= 999) return { min: a, max: b, isRange: true };
  }
  const match = text.match(/\d+/);
  const target = match ? Number(match[0]) : Number(fallback) || 8;
  return target > 0 && target <= 999
    ? { min: target, max: target, isRange: false }
    : { min: 8, max: 8, isRange: false };
}

export function repSequenceOf(value){
  const text = String(value == null ? '' : value).trim();
  if (!text.includes(',') && !text.includes('·')) return [];
  const parts = text.split(/[，,·]/).map(part => part.trim().toLowerCase());
  if (parts.length < 2 || parts.length > 10) return [];
  const rows = parts.map(part => part === 'max' ? 'max' : (/^\d{1,3}$/.test(part) && Number(part) > 0 ? Number(part) : null));
  return rows.every(row => row != null) ? rows : [];
}

function isWarmup(set){
  return !!(set && (set.phase === 'warmup' || set.warmup === true));
}

/**
 * Recommend the next set from the last session's real working rows.
 * A programmed load only goes up when all planned rows at that load reach
 * their target; missing rows and pyramid-like loads hold the current target.
 * A rep range advances by one rep at a time before adding load.
 */
export function recommendNextSet({ sets, planned, previousPlan, defaultReps = 8, increment = 2.5 } = {}){
  if (planned && planned.mode === 'time'){
    const work = (Array.isArray(sets) ? sets : []).filter(set =>
      set && set.timed && !isWarmup(set) && Number(set.sec) > 0
    );
    if (!work.length || String(planned.progression || 'time').toLowerCase() === 'off') return null;
    const goal = Math.max(1, Math.min(86400, Number(planned.sec) || 1));
    const count = Math.max(1, Math.min(20, Math.round(Number(planned.sets) || work.length)));
    const judged = work.slice(0, count);
    const previousCount = Number(previousPlan && previousPlan.sets);
    const changed = previousPlan && (
      Number(previousPlan.sec) !== goal ||
      (Number.isInteger(previousCount) && previousCount > 0 && previousCount !== count) ||
      (previousPlan.mode != null && previousPlan.mode !== 'time')
    );
    if (changed || work.length < count || judged.length < count){
      return { timed: true, sec: goal, reason: changed
        ? 'The timed target changed; start from the updated plan.'
        : 'Repeat the timed target: not all planned holds were logged.' };
    }
    if (judged.every(set => Number(set.sec) >= goal)){
      return { timed: true, sec: Math.min(86400, goal + 5), reason: 'Every planned hold reached its target; add 5 seconds.' };
    }
    return { timed: true, sec: goal, reason: 'Keep the programmed hold time until every set reaches it.' };
  }
  if (repSequenceOf(planned && planned.reps).length) return null;
  const work = (Array.isArray(sets) ? sets : []).filter(set => {
    if (!set || set.cardio || isWarmup(set)) return false;
    return Number.isFinite(Number(set.weight)) && Number(set.weight) > 0 && Number(set.reps) > 0;
  });
  if (!work.length) return null;

  const amount = Number(increment) > 0 ? Number(increment) : 2.5;
  const range = repsTargetOf(planned && planned.reps, defaultReps);
  const configuredSets = Number(planned && planned.sets);
  const plannedCount = Number.isInteger(configuredSets) && configuredSets > 0
    ? Math.min(configuredSets, 20)
    : work.length;
  const policy = String(planned && planned.progression || 'double').toLowerCase();
  if (policy === 'off') return null;
  const judged = work.slice(0, plannedCount);
  const weight = Number(judged[judged.length - 1].weight);
  const complete = work.length >= plannedCount;
  const sameLoad = judged.length === plannedCount && judged.every(set => Math.abs(Number(set.weight) - weight) < 0.001);

  const samePolicy = String(previousPlan && previousPlan.progression || 'double') === policy;
  if (planned && previousPlan && (!samePolicy || ['sets', 'setsMax', 'reps', 'weight'].some(key =>
    String(planned[key] ?? '') !== String(previousPlan[key] ?? '')
  ))){
    const planWeight = Number(planned.weight);
    return {
      weight: round(planWeight > 0 ? planWeight : weight),
      reps: range.min,
      reason: 'The programmed target changed; start from the updated plan.'
    };
  }

  if (!complete || !sameLoad){
    return {
      weight: round(weight), reps: range.isRange ? range.min : range.max,
      reason: !complete
        ? 'Repeat the target: not all programmed sets were logged.'
        : 'Keep the target load consistent before increasing it.'
    };
  }

  if (policy === 'greyskull'){
    if (plannedCount < 3){
      return { weight: round(weight), reps: range.max, reason: 'Greyskull needs at least three planned sets.' };
    }
    const earlyMiss = judged.slice(0, -1).some(set => Number(set.reps) < range.max);
    const final = judged[judged.length - 1];
    if (!final.failure){
      return { weight: round(weight), reps: range.max, reason: 'Mark the final set as taken to failure to use Greyskull.' };
    }
    if (earlyMiss || Number(final.reps) < range.max){
      return { weight: round(weight * 0.9), reps: range.max, reason: 'Missed the Greyskull target; reduce the load by about 10%.' };
    }
    const multiplier = Number(final.reps) >= range.max * 2 ? 2 : 1;
    return {
      weight: round(weight + amount * multiplier), reps: range.max,
      reason: multiplier === 2 ? 'The final set doubled its target; add two load steps.' : 'The target was met; add one load step.'
    };
  }

  if (policy === 'triple'){
    const baseSets = plannedCount;
    const maxSets = Math.max(baseSets, Math.min(10, Math.round(Number(planned.setsMax) || baseSets)));
    const rows = work.slice(0, maxSets);
    const count = Math.max(baseSets, Math.min(maxSets, rows.length));
    const logged = rows.slice(0, count);
    const sameLoad = logged.length === count && logged.every(set => Math.abs(Number(set.weight) - weight) < 0.001);
    const hold = (sets, reps, reason) => ({ weight: round(weight), reps, sets, reason });
    if (logged.length < baseSets || !sameLoad){
      return hold(baseSets, range.min, 'Repeat the target: not all planned sets were logged at the same load.');
    }
    const top = range.max, bottom = range.min;
    const baseRows = logged.slice(0, baseSets);
    const baseAtTop = baseRows.every(set => Number(set.reps) >= top);
    if (count <= baseSets && !baseAtTop){
      const next = Math.min(top, Math.max(bottom, Math.min(...baseRows.map(set => Number(set.reps))) + 1));
      return hold(baseSets, next, 'Same weight; build every base set toward the top of the rep range.');
    }
    if (count > baseSets && !baseAtTop){
      return hold(baseSets, bottom, 'Repeat the base sets cleanly before adding another set.');
    }
    if (count > baseSets){
      const active = Number(logged[count - 1].reps) || bottom;
      if (active < top) return hold(count, Math.min(top, Math.max(bottom, active + 1)), 'Same weight; build reps on the newest set.');
    }
    if (count < maxSets){
      return { weight: round(weight), reps: bottom, sets: count + 1, reason: 'Every current set reached the top; add one set at the bottom of the range.' };
    }
    return { weight: round(weight + amount), reps: bottom, sets: baseSets, reason: 'Every set reached the top; increase the load and restart at the base sets.' };
  }

  const allAtTop = judged.every(set => Number(set.reps) >= range.max);
  if (allAtTop){
    return {
      weight: round(weight + amount), reps: range.min,
      reason: range.isRange
        ? 'Every planned set reached the top of the rep range.'
        : 'Every planned set reached the programmed rep target.'
    };
  }

  if (policy === 'linear'){
    return { weight: round(weight), reps: range.max, reason: 'Linear progression holds until every planned set reaches its target.' };
  }

  const weakest = Math.min(...judged.map(set => Number(set.reps)));
  const nextReps = range.isRange
    ? Math.min(range.max, Math.max(range.min, weakest + 1))
    : range.max;
  return {
    weight: round(weight), reps: nextReps,
    reason: range.isRange
      ? 'Keep the load and build reps toward the top of the range.'
      : 'Keep the programmed load and reps until every set reaches its target.'
  };
}

export { repsTargetOf };
export default { recommendNextSet, repsTargetOf, repSequenceOf };
