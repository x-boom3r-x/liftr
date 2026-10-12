# Rapport d'import — suivi_calories_macros.xlsx → data/foods.json

## Structure source

- Feuille unique utilisée : **Aliments** (en-tête ligne 4, données lignes 5 à 754).
- Colonnes : Catégorie · Aliment · État · Calories (kcal) · Protéines (g) · Glucides (g) · Lipides (g) · Protéines pour 100 kcal (g) · Unité courante · Poids d'1 unité (g) · Densité (g/ml) · Origine · Source / remarque · Synonymes / mots-clés (recherche) · Libellé (liste du calculateur)
- Feuilles dérivées NON importées : Recherche / Calculateur / Portions pratiques / _Aide (vues formulaïques de la même base) ; Notes & sources = méthodo.
- **Aucune conversion d'unité nécessaire** : toutes les valeurs sont déjà pour 100 g/100 ml (pas de kJ, pas de « pour 1 portion »).

## Mapping colonnes → champs nutrition.js (pour 100 g)

| Colonne Excel | Champ food |
|---|---|
| Aliment + État | `name` + `state` (1 ligne par état, jamais mélangées) |
| Catégorie | `category` |
| Calories (kcal) | `kcal` |
| Protéines (g) | `protein` |
| Glucides (g) | `carbs` |
| Lipides (g) | `fat` |
| Unité courante + Poids d'1 unité (g) | `gramsPerUnit` (`piece`, `tbsp` pour « c. à soupe », `tsp` pour « c. à café`) + `unitLabel` affichable |
| Densité (g/ml) | `density` |
| Synonymes / mots-clés | `synonyms` (alimenté à la recherche) |
| Protéines pour 100 kcal | ignorée (dérivée) |
| Origine / Source / Libellé | ignorés (provenance, non nutritionnels) |

## Colonnes attendues par nutrition.js ABSENTES de la source

- `fiber`, `sugar`, `sodium_mg` : **aucune colonne dans le fichier** → non émis dans foods.json ; nutrition.js les compte à 0 (`food[f] || 0`). À documenter dans l'UI (pas de données, pas de 0 affiché comme mesure).

## Volume

- **690 aliments** (une ligne par couple Aliment × État) ; 0 doublon (nom, état) ; 0 manquant sur kcal/P/G/L ; 0 négatif.
- États : Cru / sec = 172 · Cuit = 166 · Tel que vendu = 352
- Origines : Original = 614 · Ajout = 76
- Lignes avec unité courante (→ gramsPerUnit) : 99 ; avec densité : 54 ; avec synonymes : 190.
- Catégories : 14.

## Contrôle Atwater (kcal ≈ 4·P + 4·C + 9·F, tolérance ±15 %)

Rappel : fibres/alcool/polyols s'écartent légitimement — **rien n'a été corrigé**, l'auteur tranche.

### Anomalies (23) — écart > 15 % ET > 12 kcal

| Ligne | Aliment | État | kcal indiquées | Atwater calculé | Écart |
|---|---|---|---|---|---|
| 277 | Câpres | Tel que vendu | 23 | 37 | 38 % |
| 300 | Concentré de tomate | Tel que vendu | 82 | 97 | 16 % |
| 333 | Menthe fraîche | Tel que vendu | 70 | 83 | 16 % |
| 380 | Spiruline (séchée) | Tel que vendu | 290 | 395 | 27 % |
| 387 | Tomates séchées | Tel que vendu | 258 | 307 | 16 % |
| 510 | Son d'avoine | Tel que vendu | 246 | 397 | 38 % |
| 528 | Citron | Tel que vendu | 29 | 44 | 35 % |
| 529 | Citron vert | Tel que vendu | 30 | 47 | 36 % |
| 623 | Cacao en poudre non sucré | Tel que vendu | 228 | 433 | 47 % |
| 639 | Bière blonde (env. 5% alcool) | Tel que vendu | 43 | 16 | 62 % |
| 660 | Vin rouge | Tel que vendu | 85 | 11 | 87 % |
| 662 | Cannelle moulue | Tel que vendu | 247 | 349 | 29 % |
| 663 | Cardamome | Tel que vendu | 311 | 378 | 18 % |
| 664 | Clou de girofle | Tel que vendu | 274 | 403 | 32 % |
| 665 | Coriandre (graines) | Tel que vendu | 298 | 430 | 31 % |
| 666 | Cumin moulu | Tel que vendu | 375 | 449 | 16 % |
| 675 | Origan séché | Tel que vendu | 265 | 350 | 24 % |
| 676 | Paprika | Tel que vendu | 282 | 389 | 27 % |
| 678 | Piment en poudre | Tel que vendu | 282 | 382 | 26 % |
| 679 | Poivre noir | Tel que vendu | 251 | 327 | 23 % |
| 683 | Thym séché | Tel que vendu | 276 | 359 | 23 % |
| 684 | Vinaigre balsamique | Tel que vendu | 88 | 70 | 20 % |
| 685 | Vinaigre blanc / de cidre | Tel que vendu | 21 | 4 | 83 % |

### Mineures (54) — écart > 15 % mais ≤ 12 kcal (accepté par atwaterCheck)

| Ligne | Aliment | État | kcal | Atwater | Écart |
|---|---|---|---|---|---|
| 262 | Algue nori | Tel que vendu | 35 | 46 | 24 % |
| 263 | Algue wakame | Tel que vendu | 45 | 54 | 16 % |
| 264 | Artichaut | Cru / sec | 47 | 57 | 18 % |
| 265 | Artichaut | Cuit | 53 | 63 | 16 % |
| 266 | Asperge | Cru / sec | 20 | 25 | 21 % |
| 267 | Asperge | Cuit | 22 | 28 | 21 % |
| 270 | Basilic frais | Tel que vendu | 23 | 29 | 21 % |
| 273 | Blettes | Cru / sec | 19 | 24 | 20 % |
| 274 | Blettes | Cuit | 20 | 25 | 20 % |
| 275 | Brocoli | Cru / sec | 34 | 41 | 17 % |
| 276 | Brocoli | Cuit | 35 | 42 | 17 % |
| 283 | Champignons de Paris | Cru / sec | 22 | 28 | 22 % |
| 284 | Champignons de Paris | Cuit | 28 | 35 | 19 % |
| 287 | Chicorée | Tel que vendu | 23 | 28 | 19 % |
| 289 | Chou blanc | Cuit | 23 | 28 | 18 % |
| 290 | Chou chinois | Tel que vendu | 13 | 17 | 22 % |
| 291 | Chou de Bruxelles | Cru / sec | 43 | 52 | 18 % |
| 292 | Chou de Bruxelles | Cuit | 36 | 43 | 17 % |
| 293 | Chou frisé (kale) | Tel que vendu | 49 | 61 | 19 % |
| 294 | Chou rouge | Tel que vendu | 31 | 37 | 16 % |
| 295 | Chou-fleur | Cru / sec | 25 | 30 | 17 % |
| 296 | Chou-fleur | Cuit | 23 | 28 | 18 % |
| 297 | Chou-rave | Tel que vendu | 27 | 33 | 17 % |
| 299 | Ciboulette | Tel que vendu | 30 | 37 | 19 % |
| 301 | Concombre | Tel que vendu | 15 | 18 | 17 % |
| 302 | Coriandre fraîche | Tel que vendu | 23 | 28 | 17 % |
| 309 | Courgette | Cuit | 15 | 19 | 20 % |
| 310 | Cresson | Tel que vendu | 11 | 15 | 28 % |
| 312 | Endive | Tel que vendu | 17 | 21 | 17 % |
| 313 | Épinards | Cru / sec | 23 | 30 | 22 % |
| 314 | Épinards | Cuit | 23 | 30 | 23 % |
| 319 | Gombo | Cru / sec | 33 | 39 | 16 % |
| 320 | Gombo | Cuit | 22 | 27 | 20 % |
| 321 | Haricots verts | Cru / sec | 31 | 37 | 16 % |
| 322 | Haricots verts | Cuit | 35 | 42 | 16 % |
| 325 | Laitue | Tel que vendu | 15 | 19 | 21 % |
| 327 | Laitue romaine | Tel que vendu | 17 | 21 | 18 % |
| 328 | Mâche | Tel que vendu | 21 | 26 | 19 % |
| 338 | Oignon vert / cébette | Tel que vendu | 32 | 38 | 16 % |
| 341 | Pak choï | Tel que vendu | 13 | 17 | 22 % |
| 348 | Persil frais | Tel que vendu | 36 | 44 | 19 % |
| 352 | Pissenlit (feuilles) | Tel que vendu | 45 | 54 | 17 % |
| 353 | Pleurotes | Tel que vendu | 33 | 41 | 20 % |
| 361 | Poivron vert | Cru / sec | 20 | 24 | 16 % |
| 362 | Poivron vert | Cuit | 24 | 30 | 20 % |
| 369 | Potiron / citrouille | Cru / sec | 26 | 31 | 16 % |
| 371 | Pousses de soja | Tel que vendu | 30 | 37 | 20 % |
| 374 | Roquette | Tel que vendu | 25 | 32 | 21 % |
| 377 | Sauce tomate en conserve | Tel que vendu | 24 | 29 | 16 % |
| 378 | Shiitake | Cru / sec | 34 | 41 | 16 % |
| 386 | Tomates pelées en conserve | Tel que vendu | 32 | 38 | 16 % |
| 642 | Café noir (sans sucre) | Tel que vendu | 1 | 0 | 60 % |
| 647 | Jus de citron | Tel que vendu | 22 | 31 | 29 % |
| 659 | Thé nature (sans sucre) | Tel que vendu | 1 | 1 | 17 % |

