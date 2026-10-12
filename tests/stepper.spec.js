const { test, expect } = require('@playwright/test');
const { seed, daysAgo } = require('./helpers');

const dayA = { id: 'd1', name: 'A', type: 'PUSH', exercises: [{ id: 'e1', name: 'Développé couché' }] };

async function openSetModal(page){
  await page.click('button[data-tab="seance"]');
  await page.locator('button:has-text("Start")').first().click();
  await expect(page.locator('#activeModal')).toHaveClass(/show/);
  await page.locator('#activeExercises button:has-text("+ Set")').first().click();
  await expect(page.locator('#addSetModal')).toHaveClass(/show/);
}

const plusOf = (page, field) =>
  page.locator('#addSetModal .field:has(#' + field + ') .stepper button').last();
const minusOf = (page, field) =>
  page.locator('#addSetModal .field:has(#' + field + ') .stepper button').first();

test.describe('Steppers + / −', () => {

  test('spam de 100 clics : progression monotone, sur le pas, jamais invalide', async ({ page }) => {
    await seed(page, { programme: [dayA] }, 'Mouataz');
    await openSetModal(page);

    const plus = plusOf(page, 'weightInput');
    for (let i = 0; i < 100; i++) await plus.click();
    const v = parseFloat(await page.locator('#weightInput').inputValue());

    expect(v).toBe(270);                       /* 20 + 100 × 2.5 */
    expect(await page.locator('#weightInput').evaluate(el => el.checkValidity())).toBe(true);
    expect(await page.locator('#weightInput').evaluate(el => el.validity.stepMismatch)).toBe(false);
  });

  test('entrée de modale immobile : le + est visable dès la 1re frame, 10 appuis aveugles y atterrissent', async ({ page }) => {
    await seed(page, { programme: [dayA] }, 'Mouataz');
    await openSetModal(page);

    const plus = plusOf(page, 'weightInput');
    const b0 = await plus.boundingBox();
    expect(b0).toBeTruthy();

    /* appuis rapides au point figé, mesuré pendant l'entrée, sans re-localiser :
       si la modale glissait, la cible partirait sous le doigt et ces clics
       tomberaient ailleurs (bug « + » pressé vite à l'ouverture). */
    const cx = b0.x + b0.width / 2, cy = b0.y + b0.height / 2;
    for (let i = 0; i < 10; i++) await page.mouse.click(cx, cy);
    expect(parseFloat(await page.locator('#weightInput').inputValue())).toBe(45); /* 20 + 10 × 2.5 */

    /* après l'entrée, le bouton n'a pas bougé d'un pixel */
    await page.waitForTimeout(400);
    const b1 = await plus.boundingBox();
    expect(Math.abs(b1.x - b0.x)).toBeLessThan(0.5);
    expect(Math.abs(b1.y - b0.y)).toBeLessThan(0.5);
  });

  test('départ hors grille (62,7) : reste valide après chaque clic', async ({ page }) => {
    await seed(page, { programme: [dayA] }, 'Mouataz');
    await openSetModal(page);

    await page.fill('#weightInput', '62.7');
    const plus = plusOf(page, 'weightInput');
    for (let i = 0; i < 6; i++){
      await plus.click();
      expect(await page.locator('#weightInput').evaluate(el => el.checkValidity())).toBe(true);
      expect(await page.locator('#weightInput').evaluate(el => el.validity.stepMismatch)).toBe(false);
    }
    expect(await page.locator('#weightInput').inputValue()).toBe('77.7');
  });

  test('bornes : le poids ne file pas au-delà de 999 kg, ni sous 0', async ({ page }) => {
    await seed(page, { programme: [dayA] }, 'Mouataz');
    await openSetModal(page);

    await page.fill('#weightInput', '998');
    for (let i = 0; i < 4; i++) await plusOf(page, 'weightInput').click();
    expect(await page.locator('#weightInput').inputValue()).toBe('999');

    await page.fill('#weightInput', '1');
    for (let i = 0; i < 5; i++) await minusOf(page, 'weightInput').click();
    expect(await page.locator('#weightInput').inputValue()).toBe('0');

    await page.fill('#repsInput', '1');
    for (let i = 0; i < 5; i++) await minusOf(page, 'repsInput').click();
    expect(await page.locator('#repsInput').inputValue()).toBe('0');

    await page.fill('#assistedInput', '1');
    for (let i = 0; i < 5; i++) await minusOf(page, 'assistedInput').click();
    expect(await page.locator('#assistedInput').inputValue()).toBe('0');
  });

  test('une valeur saisie absurde est assainie à l’enregistrement', async ({ page }) => {
    await seed(page, { programme: [dayA] }, 'Mouataz');
    await openSetModal(page);

    await page.fill('#weightInput', '100000.55');
    await page.fill('#repsInput', '4000');
    await page.locator('#addSetModal button:has-text("Save set")').click();

    expect(await page.evaluate(() => DB.active.exercises[0].sets[0]))
      .toEqual({ weight: 999, reps: 999, assisted: 0 });
  });

  test('réouverture pendant l’ajustement : la valeur tapée n’est pas écrasée', async ({ page }) => {
    await seed(page, { programme: [dayA] }, 'Mouataz');
    await openSetModal(page);

    for (let i = 0; i < 4; i++) await plusOf(page, 'weightInput').click();
    expect(await page.locator('#weightInput').inputValue()).toBe('30');

    await page.evaluate(() => openAddSet(0));
    expect(await page.locator('#weightInput').inputValue()).toBe('30');
    await expect(page.locator('#addSetModal')).toHaveClass(/show/);
  });

  test('steppers cardio bornés', async ({ page }) => {
    await seed(page, {
      programme: [{ id: 'd1', name: 'A', type: 'CARDIO', exercises: [{ id: 'e1', name: 'Treadmill', cardio: true }] }]
    }, 'Mouataz');

    await page.click('button[data-tab="seance"]');
    await page.locator('button:has-text("Start")').first().click();
    await expect(page.locator('#activeModal')).toHaveClass(/show/);
    await page.locator('#activeExercises button:has-text("+ Run")').first().click();
    await expect(page.locator('#addSetModal')).toHaveClass(/show/);

    await page.fill('#cardioKmInput', '9998');
    for (let i = 0; i < 40; i++) await plusOf(page, 'cardioKmInput').click();
    expect(await page.locator('#cardioKmInput').inputValue()).toBe('9999');

    for (let i = 0; i < 20; i++) await minusOf(page, 'cardioMinInput').click();
    expect(await page.locator('#cardioMinInput').inputValue()).toBe('1');
  });

  test('poids du jour (stats) : 200 clics sans flottant parasite', async ({ page }) => {
    test.slow(); /* ~100 ms/clic d'overhead Playwright : 200 clics ≈ 25 s, au-dessus du cap de 30 s */
    await seed(page, { weightLog: [{ date: daysAgo(1), kg: 82 }] }, 'Mouataz');
    await page.click('button[data-tab="stats"]');

    const plus = page.locator('.weight-card .stepper button').last();
    for (let i = 0; i < 200; i++) await plus.click();

    const v = await page.locator('#weightInputVal').inputValue();
    expect(v).toBe('102');                     /* 82 + 200 × 0,1 — pas de 101.99999… */
    expect(await page.locator('#weightInputVal').evaluate(el => el.checkValidity())).toBe(true);
  });
});
