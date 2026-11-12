const { test, expect } = require('@playwright/test');
const { seed, daysAgo, today } = require('./helpers');

const dayA = { id: 'd1', name: 'A', type: 'PUSH', exercises: [{ id: 'e1', name: 'Développé couché' }] };

const EXPECTED = {
  NEW_PR: 120, STRENGTH_PROGRESS: 120, REPS_PROGRESS: 100, VOLUME_PROGRESS: 100,
  CONSISTENCY: 120, COMEBACK: 80, HARD_SESSION: 90, MILESTONE: 80, GOAL_REACHED: 16,
  SETBACK: 70, GENERAL_PROGRESS: 120
};

const histSession = {
  id: 'h1', date: daysAgo(6), dayId: 'd1', dayName: 'A', note: '', performed: 1,
  exercises: [{ id: 'e1', name: 'Développé couché', sets: [{ weight: 60, reps: 8, assisted: 0 }] }],
  totalSets: 1, volume: 480
};

test.describe('Commentaires LIFTR', () => {

  test('base locale : 1016 commentaires distincts, répartition exacte', async ({ page }) => {
    await seed(page, {});
    const r = await page.evaluate(() => {
      const counts = {};
      COMMENT_FILTERS.forEach(f => { counts[f] = 0; });
      let valid = true;
      LIFTR_COMMENTS.forEach(c => {
        counts[c.filter] = (counts[c.filter] || 0) + 1;
        if (!c.id || !c.filter || typeof c.comment !== 'string' || c.comment.length < 5) valid = false;
      });
      return {
        total: LIFTR_COMMENTS.length,
        counts,
        uniqueIds: new Set(LIFTR_COMMENTS.map(c => c.id)).size,
        uniqueTexts: new Set(LIFTR_COMMENTS.map(c => c.comment)).size,
        valid,
        noHttp: LIFTR_COMMENTS.every(c => !/https?:\/\//.test(c.comment))
      };
    });
    expect(r.total).toBe(1016);
    expect(r.counts).toEqual(EXPECTED);
    expect(r.uniqueIds).toBe(1016);
    expect(r.uniqueTexts).toBe(1016);
    expect(r.valid).toBe(true);
    expect(r.noHttp).toBe(true);
  });

  test('détection : le filtre suit les données de la séance', async ({ page }) => {
    await seed(page, {});
    const r = await page.evaluate(() => {
      const d = n => {
        const x = new Date(); x.setDate(x.getDate() - n);
        const p = v => String(v).padStart(2, '0');
        return x.getFullYear() + '-' + p(x.getMonth() + 1) + '-' + p(x.getDate());
      };
      const S = (w, rp) => ({ weight: w, reps: rp, assisted: 0 });
      const sess = (id, date, sets, vol) => ({
        id, date, dayId: 'd1', dayName: 'A', note: '', performed: 1,
        exercises: [{ id: 'e1', name: 'Squat barre', sets: sets }],
        totalSets: sets.length, volume: vol
      });
      const run = (hist, prsHit) => { DB.history = hist; return detectAfterSession(hist[0], prsHit || 0); };
      const many = (n, date, sets, vol) => {
        const a = [];
        for (let i = 0; i < n; i++) a.push(sess('p' + i, date, sets, vol));
        return a;
      };
      const out = {};
      out.newPR = run([sess('c', d(0), [S(70, 5)], 350)], 1);
      out.strength = run([sess('c', d(0), [S(65, 6)], 390), sess('p', d(5), [S(60, 8)], 480)]);
      out.reps = run([sess('c', d(0), [S(60, 10)], 600), sess('p', d(5), [S(60, 8)], 480)]);
      out.volume = run([sess('c', d(0), [S(60, 8), S(60, 8)], 960)].concat(many(3, d(2), [S(60, 8)], 480)));
      out.comeback = run([sess('c', d(0), [S(60, 8)], 480), sess('p', d(20), [S(60, 8)], 480)]);
      out.hard = run([sess('c', d(0), Array(10).fill(S(40, 2)), 800)].concat(many(3, d(2), Array(4).fill(S(100, 5)), 2000)));
      out.milestone = run([sess('c', d(0), [S(60, 8)], 480)].concat(many(9, d(1), [S(60, 8)], 480)));
      out.setback = run([sess('c', d(0), [S(60, 5)], 300), sess('p', d(5), [S(65, 6)], 390)]);
      out.consistency = run([sess('c', d(0), [S(60, 8)], 480)].concat(many(4, d(3), [S(60, 8)], 480)));
      out.general = run([sess('c', d(0), [S(60, 8)], 480)]);
      DB.history = [];
      return out;
    });
    expect(r).toEqual({
      newPR: 'NEW_PR',
      strength: 'STRENGTH_PROGRESS',
      reps: 'REPS_PROGRESS',
      volume: 'VOLUME_PROGRESS',
      comeback: 'COMEBACK',
      hard: 'HARD_SESSION',
      milestone: 'MILESTONE',
      setback: 'SETBACK',
      consistency: 'CONSISTENCY',
      general: 'GENERAL_PROGRESS'
    });
  });

  test('fin de séance : notification LIFTR avec un commentaire de la base', async ({ page }) => {
    page.on('dialog', d => d.accept());
    await seed(page, { programme: [dayA] }, 'Mouataz');

    await page.click('button[data-tab="seance"]');
    await page.locator('#tab-seance button:has-text("Start")').first().click();
    await page.locator('#activeExercises button:has-text("+ Set")').first().click();
    await page.locator('#addSetModal button:has-text("Save set")').click();
    await page.locator('#activeModal button:has-text("Finish session")').click();

    const notif = page.locator('#liftrNotif');
    await expect(notif).toHaveClass(/show/);
    const filter = await page.locator('#liftrText').getAttribute('data-filter');
    expect(EXPECTED).toHaveProperty(filter);
    expect(await page.locator('#liftrSum').textContent()).toContain('set');
    const txt = await page.locator('#liftrText').textContent();
    expect(txt.length).toBeGreaterThan(5);
    const inBase = await page.evaluate(t => LIFTR_COMMENTS.some(c => c.comment === t), txt);
    expect(inBase).toBe(true);

    /* bouton "change" : autre commentaire, même filtre, pas de répétition */
    const firstId = await page.locator('#liftrText').getAttribute('data-id');
    await page.locator('#liftrChange').click();
    await expect(notif).toHaveClass(/show/);
    await expect(page.locator('#liftrText')).not.toHaveAttribute('data-id', firstId);
    await expect(page.locator('#liftrText')).toHaveAttribute('data-filter', filter);

    await page.locator('#liftrClose').click();
    await expect(notif).not.toHaveClass(/show/);
  });

  test('nouveau record : carte de célébration et animation dédiées', async ({ page }) => {
    await seed(page, {});
    await page.evaluate(() => showSessionComment({ id: 'pr-test', exercises: [] }, 1, '1 set · Record broken'));
    const notif = page.locator('#liftrNotif');
    await expect(notif).toHaveClass(/is-pr/);
    await expect(page.locator('#liftrMark')).toHaveText('PERSONAL RECORD');
    await expect(page.locator('#liftrText')).toHaveAttribute('data-filter', 'NEW_PR');
    await expect(page.locator('.mark-pr')).toBeVisible();
    expect(await notif.evaluate(el => getComputedStyle(el).animationName)).toBe('achievementIn');
  });

  test('objectif d’hydratation atteint : citation unique du jour', async ({ page }) => {
    const date = today();
    await seed(page, { nutri: { profile: { waterGoalMl: 500 }, water: { [date]: 250 } } }, 'Mouataz');
    await page.evaluate(() => addWater(250));
    const notif = page.locator('#liftrNotif');
    await expect(notif).toHaveClass(/is-goal/);
    await expect(page.locator('#liftrMark')).toHaveText("TODAY'S GOAL");
    await expect(page.locator('#liftrSum')).toContainText('500 / 500 ml');
    await expect(page.locator('#liftrText')).toHaveAttribute('data-filter', 'GOAL_REACHED');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    expect(await notif.evaluate(el => getComputedStyle(el).animationName)).toBe('none');
  });

  test('onglet Stats : plus de carte LIFTR (notification uniquement)', async ({ page }) => {
    page.on('dialog', d => d.accept());
    await seed(page, { programme: [dayA], history: [histSession] }, 'Mouataz');
    await page.click('button[data-tab="stats"]');

    await expect(page.locator('.liftr-note')).toHaveCount(0);
    await expect(page.locator('#liftrNotif')).not.toHaveClass(/show/);

    /* la notification ne s'affiche qu'après une séance */
    await page.click('button[data-tab="seance"]');
    await page.locator('#tab-seance button:has-text("Start")').first().click();
    await page.locator('#activeExercises button:has-text("+ Set")').first().click();
    await page.locator('#addSetModal button:has-text("Save set")').click();
    await page.locator('#activeModal button:has-text("Finish session")').click();
    await expect(page.locator('#liftrNotif')).toHaveClass(/show/);
    await page.click('button[data-tab="stats"]');
    await expect(page.locator('.liftr-note')).toHaveCount(0);
  });

  test('anti-répétition : 30 tirages uniques dans la même catégorie', async ({ page }) => {
    await seed(page, {}, 'Mouataz');
    const r = await page.evaluate(() => {
      const ids = [];
      for (let i = 0; i < 30; i++){
        const c = pickComment('NEW_PR');
        ids.push(c ? c.id : null);
      }
      let immediate = 0;
      for (let i = 1; i < ids.length; i++) if (ids[i] === ids[i - 1]) immediate++;
      let allNewPr = true;
      ids.forEach(id => {
        const e = LIFTR_COMMENTS.find(c => c.id === id);
        if (!e || e.filter !== 'NEW_PR') allNewPr = false;
      });
      const hist = JSON.parse(localStorage.getItem('at_cmt_' + currentUser) || '{}');
      return {
        immediate,
        unique: new Set(ids).size,
        allNewPr,
        recent: (hist.recent || []).length
      };
    });
    expect(r.immediate).toBe(0);
    expect(r.unique).toBe(30);
    expect(r.allNewPr).toBe(true);
    expect(r.recent).toBe(20);
  });

  test('hors-ligne : notification disponible sans réseau', async ({ page, context }) => {
    await seed(page, { programme: [dayA], history: [histSession] }, 'Mouataz');
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload();
    await page.waitForSelector('#mainApp:not(.hidden)');
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null);

    await context.setOffline(true);
    await page.reload();
    await page.waitForSelector('#mainApp:not(.hidden)');
    const r = await page.evaluate(() => {
      showSessionComment(DB.history[0], 0, 'offline · 1 set');
      const notif = document.getElementById('liftrNotif');
      const txt = document.getElementById('liftrText');
      return {
        total: LIFTR_COMMENTS.length,
        shown: notif.classList.contains('show'),
        filter: txt.getAttribute('data-filter'),
        text: txt.textContent,
        inBase: LIFTR_COMMENTS.some(c => c.comment === txt.textContent)
      };
    });
    expect(r.total).toBe(1016);
    expect(r.shown).toBe(true);
    expect(EXPECTED).toHaveProperty(r.filter);
    expect(r.inBase).toBe(true);
    expect(await page.locator('#liftrSum').textContent()).toContain('set');
    await context.setOffline(false);
  });

  test('aucune erreur console avec les commentaires (4 onglets)', async ({ page }) => {
    const errs = [];
    page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.text()); });
    page.on('pageerror', e => errs.push(String(e)));
    await seed(page, { programme: [dayA], history: [histSession] }, 'Mouataz');
    await page.reload();
    await page.waitForSelector('#mainApp:not(.hidden)');
    for (const t of ['programme', 'seance', 'calendrier', 'stats']){
      await page.evaluate(tab => window.showTab(tab), t);
      await page.waitForTimeout(150);
    }
    expect(errs).toEqual([]);
  });
});
