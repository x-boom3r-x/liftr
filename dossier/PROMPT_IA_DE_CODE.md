# Prompt à donner à l'IA de code

Tu travailles sur mon application existante de suivi de salle de sport (gym tracking). Je veux que tu y intègres un **système de suivi nutritionnel 100 % hors-ligne**, dans la section **Stats**.

## 0. Avant de coder

1. Explore le projet : stack technique, structure des dossiers, navigation, système de stockage local déjà utilisé, thème / composants UI, et l'endroit où sont déjà saisis la **taille** et le **poids actuel** de l'utilisateur.
2. Adapte-toi à l'existant : mêmes conventions de code, même librairie de stockage, même style visuel. Ne réécris pas ce qui fonctionne, n'ajoute pas de dépendance lourde si l'existant suffit.
3. Fais-moi un court plan (fichiers à créer / modifier) avant d'implémenter, puis implémente.

## 1. Données de référence (fournies)

Dossier `nutrition_data/` :

- `foods.json` : 627 aliments, 17 catégories, 57 portions usuelles. **Source de vérité.** `foods.csv` contient les mêmes aliments à plat.
- `nutrition_config.json` : facteurs d'activité, objectifs, intensités, règles de macros, planchers de sécurité. Lis ce fichier au lieu de coder ces valeurs en dur dans la logique.

Structure d'un aliment (toutes les valeurs sont **pour 100 g**) :

```json
{
  "id": "riz_blanc_long_grain",
  "name": "Riz blanc long grain",
  "category_id": "cereales_feculents_pains",
  "search_text": "riz blanc long grain normal ordinaire",
  "as_sold": { "kcal": 365, "protein_g": 7.1, "carbs_g": 80, "fat_g": 0.7 },
  "cooked":  { "kcal": 130, "protein_g": 2.7, "carbs_g": 28.2, "fat_g": 0.3 },
  "note": "bouilli",
  "source": "original",
  "contains_alcohol": false
}
```

Règles de lecture importantes :

- `as_sold` = aliment cru **ou** produit prêt à consommer (fromage, pain, plat, boisson...). `cooked` = après cuisson, sans matière grasse ajoutée. L'un des deux peut être `null`.
- **Cru et cuit donnent des valeurs très différentes pour 100 g** (ex. riz : 365 kcal cru, 130 kcal cuit). L'utilisateur choisit l'état correspondant à ce qu'il a pesé. Si l'état choisi n'existe pas pour l'aliment, bascule automatiquement sur l'état disponible et affiche une indication claire (ne jamais afficher 0 ou NaN).
- `source: "estimate"` = valeur approximative : affiche un petit « ≈ » discret à côté des kcal.
- `contains_alcohol: true` : l'alcool (7 kcal/g) est inclus dans les kcal, donc kcal ≠ 4P + 4G + 9L. Utilise toujours le champ `kcal` pour les calories, ne le recalcule pas.
- Liquides : 1 ml ≈ 1 g.
- `portions[]` : `{ food_id, state, label, grams }` (ex. « 1 oeuf (≈ 50 g) » = 50 g). Elles servent de raccourcis de saisie, et l'utilisateur peut modifier la quantité.
- `search_text` est déjà en minuscules, sans accents, avec œ→oe : normalise la saisie de la même façon (minuscules, suppression des accents, œ→oe), puis recherche par sous-chaîne sur tous les mots tapés (ET logique). « riz », « oeuf », « pates » doivent fonctionner. Classe les résultats : nom qui commence par la saisie d'abord, puis nom qui contient, puis `search_text`.

Intègre `foods.json` comme **asset embarqué** dans l'app : aucun appel réseau, aucune API externe, tout fonctionne en mode avion. Charge-le une fois, indexe-le en mémoire.

## 2. Profil et objectif

Récupère **taille** et **poids actuel** depuis ce qui existe déjà dans l'app (ne redemande pas, ne duplique pas, et relis-les à chaque calcul pour que les cibles se mettent à jour quand le poids change).

Si l'app ne les a pas déjà, ajoute dans un petit écran de configuration nutrition : **âge**, **sexe** (nécessaires pour le métabolisme de base) et **niveau d'activité** (`activity_levels` du config).

L'utilisateur choisit :

1. **Objectif** : Maintien / Prise de masse / Perte de poids.
2. **Intensité** (sauf pour Maintien) : légère / modérée / **grand surplus** ou **grand déficit** (voir `goals[].intensities` du config, en pourcentage du TDEE). Affiche pour chaque option la cible kcal résultante en direct pour qu'il voie l'effet.
3. Option avancée : modifier manuellement la cible kcal et/ou les macros (la saisie manuelle prend alors le dessus).

## 3. Calcul des cibles

```
BMR  = Mifflin-St Jeor   (homme: 10*kg + 6.25*cm - 5*age + 5 ; femme: ... - 161)
TDEE = BMR * facteur_activité
cible_kcal = TDEE * (1 + percent_of_tdee / 100)
protéines_g = g_par_kg[objectif] * poids_kg
lipides_g   = g_par_kg[objectif] * poids_kg
glucides_g  = (cible_kcal - 4*protéines_g - 9*lipides_g) / 4
```

Sécurité (voir `safety` du config) :

- Ne jamais descendre sous le plancher kcal (1200 femme / 1500 homme). Si le calcul tombe dessous, remonte à la valeur plancher et affiche un avertissement discret.
- Glucides jamais sous 50 g : si c'est le cas, réduis un peu les lipides (sans passer sous 0,6 g/kg) puis recalcule.
- Affiche une mention courte du type « Estimation indicative, pas un avis médical ».
- Arrondis kcal à l'entier (au multiple de 10 pour l'affichage de la cible) et macros à l'entier.

## 4. Suivi des repas dans la journée

Dans la section **Stats**, ajoute un bloc / onglet **Nutrition** :

- **Résumé du jour** : kcal consommées / cible, et pour chaque macro (protéines, glucides, lipides) consommé / cible, avec barres ou anneaux de progression, et le **reste à consommer** (kcal et grammes). Si on dépasse, affiche « +X kcal au-dessus » avec une couleur d'alerte douce, sans bloquer.
- **Repas** : Petit-déjeuner, Déjeuner, Dîner, Collations. Chaque repas affiche ses aliments et son sous-total.
- **Ajouter un aliment** : champ de recherche (voir règles de recherche ci-dessus), choix de l'état Cru / Cuit, saisie de la quantité en grammes **ou** choix d'une portion usuelle (qui pré-remplit les grammes). Affiche l'aperçu kcal / P / G / L **avant** validation. Calcul : `valeur_pour_100g * grammes / 100`.
- **Récents et favoris** : liste des derniers aliments ajoutés pour ajouter en deux taps.
- **Modifier / supprimer** une entrée, dupliquer un repas de la veille.
- **Aliment personnalisé** : créer ses propres aliments (nom, kcal/P/G/L pour 100 g), stockés localement à part de `foods.json` (qui reste en lecture seule).
- **Navigation par date** : revenir sur les jours précédents, modifier un jour passé.
- **Historique** : sous le résumé, un graphique simple des 7 / 30 derniers jours (kcal consommées vs cible) et la moyenne sur la période.

Chaque entrée enregistrée contient : `date`, `meal`, `food_id` (ou id d'aliment perso), `state`, `grams`, et une **copie figée** des kcal/P/G/L calculés au moment de l'ajout (pour que l'historique ne change pas si la base est mise à jour).

## 5. Stockage et hors-ligne

- Utilise le stockage local déjà présent dans l'app (SQLite / AsyncStorage / IndexedDB / Room, etc.). Entrées de repas, profil nutrition, favoris, aliments perso : tout en local.
- Aucune requête réseau pour cette fonctionnalité. Vérifie qu'elle marche en mode avion.
- Les cibles sont recalculées à l'ouverture et quand taille, poids, objectif ou intensité changent. Les jours passés gardent la cible qui était en vigueur ce jour-là (enregistre la cible du jour avec le jour).

## 6. Qualité attendue

- Séparer logique et interface : un module pur (`nutrition` : calcul BMR/TDEE/macros, recherche, calcul d'une portion, totaux) testable, et les composants UI par-dessus.
- Tests unitaires sur : Mifflin-St Jeor (homme et femme), cibles pour chaque objectif/intensité, planchers de sécurité, calcul cru vs cuit, repli quand `cooked` est `null`, recherche sans accents (« oeuf », « pates », « riz »), totaux du jour.
- États vides soignés (aucun repas, aucun profil), pas de crash si un champ est manquant, accessibilité de base (contrastes, tailles tactiles), textes de l'interface en **français**.
- Respecte le design existant : réutilise les composants, couleurs et typographies de la section Stats.

## 7. Livrables

1. Le code intégré et fonctionnel dans l'app existante.
2. La liste des fichiers créés / modifiés avec un résumé en quelques lignes.
3. Comment lancer les tests.
4. Les hypothèses que tu as faites (et ce que tu n'as pas pu vérifier).
