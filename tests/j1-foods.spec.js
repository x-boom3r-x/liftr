/* J1 : base d'aliments (data/foods.json) — chargement lazy, index,
   recherche préfixe/sous-chaîne insensible aux accents, précache SW. */
const { test, expect } = require('@playwright/test');
const { seed } = require('./helpers');

test.describe('J1 : base d\'aliments', () => {

  test('lazy : rien au boot, 690 aliments après load, promesse mémoïsée', async ({ page }) => {
    await seed(page, {}, 'Mouataz');
    const before = await page.evaluate(() => ({
      api: typeof window.LiftrFoods === 'object',
      count: window.LiftrFoods.all().length
    }));
    expect(before.api).toBe(true);
    expect(before.count, 'foods.json ne doit pas être lu au boot').toBe(0);

    const info = await page.evaluate(async () => {
      const F = window.LiftrFoods;
      const foods = await F.load();
      const again = await F.load();
      return { n: foods.length, same: again === foods, indexed: F.all().length,
               sample: foods.find(f => f.id === 'riz-blanc-long-grain--cuit') };
    });
    expect(info.n).toBe(690);
    expect(info.same, 'loadFoods() doit mémoriser la promesse').toBe(true);
    expect(info.indexed).toBe(690);
    expect(info.sample).toBeTruthy();
    expect(info.sample.state).toBe('Cuit');
    expect(info.sample.kcal).toBe(130);
    expect(info.sample.protein).toBe(2.7);
    expect(info.sample.category).toBeTruthy();
  });

  test('recherche : préfixe d\'abord, accents/casse, ET de tokens, ≤ 30', async ({ page }) => {
    await seed(page, {}, 'Mouataz');
    const r = await page.evaluate(async () => {
      const F = window.LiftrFoods;
      await F.load();
      const names = (q) => F.search(q).map(f => f.name);
      return {
        riz: names('riz'),
        upper: names('RIZ BLANC'),
        pates: names('pates'),
        et: names('poulet blanc sans peau'),
        syn: names('oeufs'),
        blank: F.search('   ').length,
        junk: F.search('zzzqqq').length,
        one: F.search('e').length
      };
    });
    expect(r.riz.length).toBeGreaterThan(0);
    expect(r.riz[0], 'le préfixe du nom passe en tête').toMatch(/^Riz /);
    expect(r.riz.length).toBeLessThanOrEqual(30);
    expect(r.upper[0]).toMatch(/^Riz blanc/);
    expect(r.pates.some(n => n.includes('Pâtes blanches')), 'accents ignorés (pates → Pâtes)').toBe(true);
    expect(r.et.length).toBeGreaterThan(0);
    expect(r.et[0]).toContain('blanc sans peau');
    expect(r.syn.some(n => n.includes('Oeuf')), 'synonyme "oeufs" → Oeuf').toBe(true);
    expect(r.blank).toBe(0);
    expect(r.junk).toBe(0);
    expect(r.one).toBeLessThanOrEqual(30);
  });

  test('conversion : gramsPerUnit (pièce), density, pas de fibres inventées', async ({ page }) => {
    await seed(page, {}, 'Mouataz');
    const g = await page.evaluate(async () => {
      const F = window.LiftrFoods;
      await F.load();
      return {
        oeuf: F.get('oeuf-entier--cuit'),
        lait: F.get('lait-demi-ecreme--tel-que-vendu'),
        missing: F.get('id-inexistant')
      };
    });
    expect(g.oeuf.gramsPerUnit.piece).toBe(50);
    expect(g.oeuf.unitLabel).toContain('oeuf');
    expect(g.lait.density).toBeCloseTo(1.03, 2);
    expect(g.oeuf.fiber, 'fiber/sugar/sodium absents de la source : non émis').toBeUndefined();
    expect(g.missing).toBeNull();
  });

  test('service worker : data/foods.json précaché (hors-ligne)', async ({ page }) => {
    await seed(page, {}, 'Mouataz');
    await page.waitForFunction(() => !!navigator.serviceWorker.controller);
    const hit = await page.evaluate(async () => {
      const url = new URL('data/foods.json', location.href).href;
      for (const k of await caches.keys()) {
        const c = await caches.open(k);
        const res = await c.match(url);
        if (res) return { cached: true, size: (await res.blob()).size };
      }
      return { cached: false, size: 0 };
    });
    expect(hit.cached, 'foods.json doit être dans le cache SW').toBe(true);
    expect(hit.size).toBeGreaterThan(50000);
  });
});
