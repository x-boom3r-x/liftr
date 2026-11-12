/* ==================================================================
   LIFTR - base locale de commentaires
   1016 textes distincts, écrits un par un, répartis en 11 filtres.
   Aucun fetch, aucun réseau : tout est en modules ES, caché par le SW.
   Format de chaque entrée : { id, filter, comment }
   ================================================================== */
import NEW_PR from './comments/new-pr.js';
import STRENGTH_PROGRESS from './comments/strength-progress.js';
import REPS_PROGRESS from './comments/reps-progress.js';
import VOLUME_PROGRESS from './comments/volume-progress.js';
import CONSISTENCY from './comments/consistency.js';
import COMEBACK from './comments/comeback.js';
import HARD_SESSION from './comments/hard-session.js';
import MILESTONE from './comments/milestone.js';
import GOAL_REACHED from './comments/goal-reached.js';
import SETBACK from './comments/setback.js';
import GENERAL_PROGRESS from './comments/general-progress.js';

const COMMENT_FILTERS = [
  'NEW_PR', 'STRENGTH_PROGRESS', 'REPS_PROGRESS', 'VOLUME_PROGRESS',
  'CONSISTENCY', 'COMEBACK', 'HARD_SESSION', 'MILESTONE', 'GOAL_REACHED',
  'SETBACK', 'GENERAL_PROGRESS'
];

const RAW = {
  NEW_PR: NEW_PR,
  STRENGTH_PROGRESS: STRENGTH_PROGRESS,
  REPS_PROGRESS: REPS_PROGRESS,
  VOLUME_PROGRESS: VOLUME_PROGRESS,
  CONSISTENCY: CONSISTENCY,
  COMEBACK: COMEBACK,
  HARD_SESSION: HARD_SESSION,
  MILESTONE: MILESTONE,
  GOAL_REACHED: GOAL_REACHED,
  SETBACK: SETBACK,
  GENERAL_PROGRESS: GENERAL_PROGRESS
};

const LIFTR_COMMENTS = [];
const BY_FILTER = {};
let _id = 0;
COMMENT_FILTERS.forEach(filter => {
  const entries = [];
  (RAW[filter] || []).forEach(comment => {
    _id++;
    const entry = { id: 'liftr_' + String(_id).padStart(4, '0'), filter: filter, comment: comment };
    LIFTR_COMMENTS.push(entry);
    entries.push(entry);
  });
  BY_FILTER[filter] = entries;
});

function commentsFor(filter){
  return BY_FILTER[filter] || BY_FILTER.GENERAL_PROGRESS || [];
}

Object.assign(window, {
  LIFTR_COMMENTS, COMMENT_FILTERS, commentsFor
});
