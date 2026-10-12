/* J2 : profil nutrition -> buildPlan (js/nutrition.js) -> objectif auto.
   Garde-fous (plancher kcal, plafond de vitesse), poids = source unique
   (DB.weightLog), recalcul auto, ajustement adaptaif propose au clic. */
const { test, expect } = require('@playwright/test');
const { seed, today, daysAgo } = require('./helpers');

const openGoal = async (page) => {
  await page.locator('.tabbar .tab[data-tab="nutrition"]').click();
  await page.locator('#rootSubnav [data-tab="nutri-goal"]').click();
};

const fillPlan = async (page, o) => {
  await page.fill('#profHeight', String(o.height));
  await page.fill('#profAge', String(o.age));
  await page.selectOption('#profSex', o.sex);
  await page.selectOption('#profActivity', o.activity);
  await page.selectOption('#profGoal', o.goal);
  await page.selectOption('#profRate', String(o.rate));
};

const MALE_178 = { height: 178, age: 28, sex: 'male', activity: 'moderate', goal: 'lose', rate: 0.5 };

test.describe('J2 : profil et calcul', () => {

  test('Goal : formulaire de profil + objectif manuel conserve', async ({ page }) => {
    await seed(page, {}, 'Mouataz');
    await openGoal(page);
    await expect(page.locator('#profCalc')).toHaveText('Calculate target');
    await expect(page.locator('#profHeight')).toBeVisible();
    await expect(page.locator('#profSex')).toBeVisible();
    await expect(page.locator('#profWeight'), 'no weight yet : one-time field').toBeVisible();
    await expect(page.locator('#goalKcal'), 'manual target kept (advanced)').toBeVisible();
    await expect(page.locator('#tab-nutri-goal button:has-text("Save goal")')).toBeVisible();
    await expect(page.locator('#nutriPlanCard'), 'no plan without profile+weight').toHaveCount(0);
  });

  test('full calc : explained plan, goal saved, Today follows', async ({ page }) => {
    await seed(page, { weightLog: [{ date: today(), kg: 82 }] }, 'Mouataz');
    await openGoal(page);
    await expect(page.locator('#profWeight'), 'weight already logged : no field').toHaveCount(0);
    await expect(page.locator('#nutriGoal')).toContainText('Current weight: 82 kg');
    await fillPlan(page, MALE_178);
    await page.locator('#profCalc').click();
    await expect(page.locator('#toast')).toContainText('Plan saved');
    await expect(page.locator('#nutriPlanCard')).toBeVisible();
    await expect(page.locator('#nutriPlanCard')).toContainText('Basal burn (BMR)');
    await expect(page.locator('#nutriPlanCard')).toContainText('Daily burn (TDEE)');
    await expect(page.locator('#nutriPlanCard')).toContainText('Daily target');
    await expect(page.locator('#nutriPlanCard')).toContainText('Protein');
    await expect(page.locator('.nutri-plan-legal')).toContainText('not medical advice');

    const st = await page.evaluate(() => ({
      profile: DB.nutri.profile,
      goal: DB.nutri.goal,
      plan: nutriPlan()
    }));
    expect(st.profile.heightCm).toBe(178);
    expect(st.profile.age).toBe(28);
    expect(st.profile.goal).toBe('lose');
    expect(st.plan.bmr).toBeGreaterThan(1000);
    expect(st.plan.tdee).toBeGreaterThan(st.plan.bmr);
    expect(st.plan.kcal).toBeLessThan(st.plan.tdee);   /* lose : deficit */
    expect(st.goal.kcal).toBe(st.plan.kcal);
    expect(st.goal.p).toBe(st.plan.macros.protein);
    expect(st.plan.notes).toEqual([]);

    await page.locator('#rootSubnav [data-tab="nutri-today"]').click();
    await expect(page.locator('.nutri-kcal-sub')).toContainText('goal ' + st.goal.kcal);
  });

  test('weight asked once, written to weightLog (single source)', async ({ page }) => {
    await seed(page, {}, 'Mouataz');
    await openGoal(page);
    await page.fill('#profWeight', '75');
    await fillPlan(page, { height: 170, age: 35, sex: 'female', activity: 'light', goal: 'maintain', rate: 0.5 });
    await page.locator('#profCalc').click();
    await expect(page.locator('#toast')).toContainText('Plan saved');

    const st = await page.evaluate(() => ({
      log: DB.weightLog,
      field: !!document.getElementById('profWeight'),
      hint: document.getElementById('nutriGoal').textContent
    }));
    expect(st.log).toEqual([{ date: today(), kg: 75 }]);
    expect(st.field, 'field gone : the weigh-in log is the source').toBe(false);
    expect(st.hint).toContain('Current weight: 75 kg');
  });

  test('floor 1200 (F) : floor_applied shown clearly', async ({ page }) => {
    await seed(page, { weightLog: [{ date: today(), kg: 45 }] }, 'Mouataz');
    await openGoal(page);
    await fillPlan(page, { height: 140, age: 60, sex: 'female', activity: 'sedentary', goal: 'lose', rate: 1 });
    await page.locator('#profCalc').click();
    await expect(page.locator('.nutri-plan-note', { hasText: 'Target raised to stay above your basal needs.' })).toBeVisible();
    const st = await page.evaluate(() => ({ goal: DB.nutri.goal, plan: nutriPlan() }));
    expect(st.goal.kcal).toBe(1200);
    expect(st.plan.notes).toContain('floor_applied');
  });

  test('speed capped : rate_capped shown, no floor note', async ({ page }) => {
    await seed(page, { weightLog: [{ date: today(), kg: 82 }] }, 'Mouataz');
    await openGoal(page);
    await fillPlan(page, Object.assign({}, MALE_178, { rate: 1 }));
    await page.locator('#profCalc').click();
    await expect(page.locator('.nutri-plan-note', { hasText: 'Speed capped to a safe rate for your body weight.' })).toBeVisible();
    await expect(page.locator('.nutri-plan-note', { hasText: 'Target raised' })).toHaveCount(0);
    const st = await page.evaluate(() => nutriPlan());
    expect(st.notes).toContain('rate_capped');
  });

  test('auto recalc when body weight changes', async ({ page }) => {
    await seed(page, { weightLog: [{ date: daysAgo(3), kg: 82 }] }, 'Mouataz');
    await openGoal(page);
    await fillPlan(page, MALE_178);
    await page.locator('#profCalc').click();
    const before = await page.evaluate(() => DB.nutri.goal.kcal);

    await page.evaluate(() => { DB.weightLog.push({ date: todayISO(), kg: 85 }); save(); });
    await page.locator('#rootSubnav [data-tab="nutri-today"]').click();
    const after = await page.evaluate(() => DB.nutri.goal.kcal);
    expect(after, 'heavier body -> higher burn -> new target').toBeGreaterThan(before);

    await page.locator('#rootSubnav [data-tab="nutri-goal"]').click();
    await expect(page.locator('#nutriPlanCard .nutri-plan-row', { hasText: 'Daily target' })).toContainText(String(after));
  });

  test('adaptive : suggests -150 kcal after 14+ days, applied on click', async ({ page }) => {
    const log = [];
    for (let d = 20; d >= 0; d--) log.push({ date: daysAgo(d), kg: 82 });
    await seed(page, { weightLog: log }, 'Mouataz');
    await openGoal(page);
    await fillPlan(page, MALE_178);
    await page.locator('#profCalc').click();

    await expect(page.locator('.nutri-adapt')).toBeVisible();
    await expect(page.locator('.nutri-adapt')).toContainText('-150 kcal / day');
    const before = await page.evaluate(() => DB.nutri.goal.kcal);

    await page.locator('#adaptApply').click();
    await expect(page.locator('#toast')).toContainText('Target adjusted by -150 kcal');
    const st = await page.evaluate(() => ({ off: DB.nutri.profile.kcalOffset, kcal: DB.nutri.goal.kcal }));
    expect(st.off).toBe(-150);
    expect(st.kcal).toBe(before - 150);
    await expect(page.locator('.nutri-adapt'), 'same suggestion not re-shown today').toHaveCount(0);
  });
});
