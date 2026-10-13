/* M2 : cible personnalisée — carte « How your target is computed ».
   Auto plan (défaut, J2 intact) | Custom : kcal TDEE ± offset ou manuel,
   macros presets / % / g/kg. Custom gagne sur le plan ; helpers purs
   targetsFromPercent / targetsFromPerKg testés en unit + via l'UI. */
const { test, expect } = require('@playwright/test');
const { seed, today } = require('./helpers');

const openGoal = async (page) => {
  await page.locator('.tabbar .tab[data-tab="nutrition"]').click();
  await page.locator('#rootSubnav [data-tab="nutri-goal"]').click();
};

const MALE_178 = { height: 178, age: 28, sex: 'male', activity: 'moderate', goal: 'lose', rate: 0.5 };

/* profil + poids + Calculate target -> plan J2 existant */
const makePlan = async (page) => {
  await seed(page, { weightLog: [{ date: today(), kg: 82 }] }, 'Mouataz');
  await openGoal(page);
  await page.fill('#profHeight', String(MALE_178.height));
  await page.fill('#profAge', String(MALE_178.age));
  await page.selectOption('#profSex', MALE_178.sex);
  await page.selectOption('#profActivity', MALE_178.activity);
  await page.selectOption('#profGoal', MALE_178.goal);
  await page.selectOption('#profRate', String(MALE_178.rate));
  await page.locator('#profCalc').click();
  await expect(page.locator('#toast')).toContainText('Plan saved');
};

test.describe('M2 : objectif custom', () => {

  test('defaut : Auto plan, aucune option custom visible', async ({ page }) => {
    await seed(page, {}, 'Mouataz');
    await openGoal(page);
    await expect(page.locator('#calcModeCard')).toBeVisible();
    await expect(page.locator('#calcMode .seg.active')).toHaveText('Auto plan');
    await expect(page.locator('#calcModeCard')).not.toContainText('Calories');
    const mode = await page.evaluate(() => DB.nutri.custom && DB.nutri.custom.mode);
    expect(mode === undefined || mode === 'auto').toBe(true);
  });

  test('helpers purs : targetsFromPercent / targetsFromPerKg', async ({ page }) => {
    await seed(page, {}, 'Mouataz');
    const r = await page.evaluate(() => targetsFromPercent({ kcal: 2000, pPct: 40, cPct: 30, fPct: 30 }));
    expect(r.protein).toBe(200);   /* 2000 * 40% / 4 */
    expect(r.carbs).toBe(150);     /* 2000 * 30% / 4 */
    expect(r.fat).toBe(67);        /* 2000 * 30% / 9 */
    expect(r.pctSum).toBe(100);
    const renorm = await page.evaluate(() => targetsFromPercent({ kcal: 2000, pPct: 40, cPct: 30, fPct: 10 }));
    expect(renorm.protein).toBe(250);  /* somme 80 : normalise */
    expect(renorm.pctSum).toBe(80);
    const perkg = await page.evaluate(() => targetsFromPerKg({ kcal: 2500, weightKg: 82, pPerKg: 2.2, fPerKg: 0.8 }));
    expect(perkg.protein).toBe(180);   /* 2.2 * 82 */
    expect(perkg.fat).toBe(66);        /* 0.8 * 82 */
    expect(perkg.carbs).toBe(297);     /* reste / 4 */
  });

  test('Custom + preset Balanced : resultat, persistance, Today suit', async ({ page }) => {
    await makePlan(page);
    const plan = await page.evaluate(() => nutriPlan());
    await page.locator('#calcMode .seg:has-text("Custom")').click();
    await expect(page.locator('#calcMode .seg.active')).toHaveText('Custom');
    await expect(page.locator('#calcModeCard')).toContainText('How your target is computed');
    await expect(page.locator('#calcModeCard')).toContainText('Daily burn ± offset');
    /* preset Balanced actif par defaut : 30/40/30 du target plan */
    const g = await page.evaluate(() => nutriActiveGoal());
    expect(g.kcal).toBe(plan.kcal);
    expect(g.p).toBe(Math.round(plan.kcal * 0.3 / 4));
    expect(g.c).toBe(Math.round(plan.kcal * 0.4 / 4));
    expect(g.f).toBe(Math.round(plan.kcal * 0.3 / 9));
    await expect(page.locator('#calcResult')).toContainText('Daily target: ' + g.kcal + ' kcal');
    /* Today suit la cible custom */
    await page.locator('#rootSubnav [data-tab="nutri-today"]').click();
    await expect(page.locator('.kcal-eaten')).toContainText('/ ' + g.kcal + ' kcal');
    /* persistence : reload -> Custom toujours actif */
    await page.reload();
    await page.waitForSelector('#mainApp:not(.hidden)');
    await openGoal(page);
    await expect(page.locator('#calcMode .seg.active')).toHaveText('Custom');
  });

  test('kcal manuel : 2000 sans plan ni TDEE', async ({ page }) => {
    await seed(page, {}, 'Mouataz');
    await openGoal(page);
    await page.locator('#calcMode .seg:has-text("Custom")').click();
    /* pas de plan : le mode TDEE explique qu'il faut un plan, on passe en manuel */
    await expect(page.locator('#calcModeCard')).toContainText('Calculate your plan first');
    await page.locator('#kcalSource .seg:has-text("Manual")').click();
    await page.fill('#kcalManual', '2000');
    const g = await page.evaluate(() => nutriActiveGoal());
    expect(g.kcal).toBe(2000);
    await expect(page.locator('#calcResult')).toContainText('2000');
    /* Today : eaten / 2000 */
    await page.locator('#rootSubnav [data-tab="nutri-today"]').click();
    await expect(page.locator('.kcal-eaten')).toContainText('/ 2000 kcal');
  });

  test('TDEE - offset : delta applique, planche kcal reste', async ({ page }) => {
    await makePlan(page);
    const plan = await page.evaluate(() => nutriPlan());
    await page.locator('#calcMode .seg:has-text("Custom")').click();
    await page.fill('#kcalDelta', '-300');
    const g = await page.evaluate(() => nutriActiveGoal());
    expect(g.kcal).toBe(plan.tdee - 300);
    await expect(page.locator('#calcResult')).toContainText(String(plan.tdee - 300));
    /* offset inferieur au plancher BMR : plafonne au planche */
    await page.fill('#kcalDelta', '-4000');
    const g2 = await page.evaluate(() => nutriActiveGoal());
    expect(g2.kcal).toBe(plan.bmr > 1500 ? plan.bmr : 1500);
  });

  test('percentages : 40/30/30 + warn si somme != 100', async ({ page }) => {
    await makePlan(page);
    await page.locator('#calcMode .seg:has-text("Custom")').click();
    await page.locator('#macroMode .seg:has-text("Percentages")').click();
    await expect(page.locator('#calcPctWarn')).toContainText('Sum: 100%');
    await page.fill('#pPct', '50');
    await expect(page.locator('#calcPctWarn')).toContainText('Sum: 120%');
    await expect(page.locator('#calcPctWarn')).toHaveClass(/warn/);
    await page.fill('#pPct', '40');
    await page.fill('#cPct', '30');
    await page.fill('#fPct', '30');
    await expect(page.locator('#calcPctWarn')).not.toHaveClass(/warn/);
    const g = await page.evaluate(() => nutriActiveGoal());
    expect(g.p).toBe(Math.round(g.kcal * 0.4 / 4));
    expect(g.c).toBe(Math.round(g.kcal * 0.3 / 4));
    expect(g.f).toBe(Math.round(g.kcal * 0.3 / 9));
  });

  test('per kg : proteines 2.2, lipides 0.8, glucides = reste', async ({ page }) => {
    await makePlan(page);
    const plan = await page.evaluate(() => nutriPlan());
    await page.locator('#calcMode .seg:has-text("Custom")').click();
    await page.locator('#macroMode .seg:has-text("Per kg")').click();
    await page.fill('#pPerKg', '2.2');
    await page.fill('#fPerKg', '0.8');
    const g = await page.evaluate(() => nutriActiveGoal());
    expect(g.p).toBe(Math.round(2.2 * 82));
    expect(g.f).toBe(Math.round(0.8 * 82));
    expect(g.c).toBe(Math.round((plan.kcal - 2.2 * 82 * 4 - 0.8 * 82 * 9) / 4));
  });

  test('retour Auto plan : le plan J2 redevient la source', async ({ page }) => {
    await makePlan(page);
    const plan = await page.evaluate(() => nutriPlan());
    await page.locator('#calcMode .seg:has-text("Custom")').click();
    await page.locator('#kcalSource .seg:has-text("Manual")').click();
    await page.fill('#kcalManual', '2000');
    let g = await page.evaluate(() => nutriActiveGoal());
    expect(g.kcal).toBe(2000);
    /* Auto : le plan reprend la main (kcalOffset 0) */
    await page.locator('#calcMode .seg:has-text("Auto plan")').click();
    await expect(page.locator('#calcMode .seg.active')).toHaveText('Auto plan');
    await expect(page.locator('#kcalManual'), 'options custom masquees').toHaveCount(0);
    g = await page.evaluate(() => nutriActiveGoal());
    expect(g.kcal).toBe(plan.kcal);
  });
});
