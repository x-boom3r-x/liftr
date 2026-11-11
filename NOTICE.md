# Third-party notices and licensing

## LIFTR

The LIFTR application source is distributed under the GNU Affero General Public License version 3.0 (AGPL-3.0); see [LICENSE](LICENSE). The AGPL's network-interaction and corresponding-source terms apply to the combined LIFTR application. LIFTR remains designed for offline use for Gym and Nutrition; Social features require a network connection.

## openGym exercise catalogue

LIFTR includes the 5,632 exercise records in data/exercises-catalogue.json, from the openGym catalogue at commit [8fb98b16861a2728652302a7e6e30c50548493a0](https://github.com/DuarteSantos8/openGym/tree/8fb98b16861a2728652302a7e6e30c50548493a0/catalogue/exercises).

Copyright (C) 2026 Duarte Santos. openGym's code and community-authored catalogue material are licensed under AGPL-3.0. The upstream license is reproduced in LICENSE. The attribution and source mapping for every exercise are recorded in data/exercises-catalogue-provenance.json; the generator is liftr-patch/tools/build-catalogue.py.

The upstream textSource tag has these meanings:

- opengym (4,308 records): community catalogue material covered by openGym's AGPL-3.0.
- exercisedb (1,324 records): the exercise names, muscle groups and instructions retain MIT-licensed provenance from ExerciseDB v1 by AscendAPI, received through hasaneyldrm/exercises-dataset (https://github.com/hasaneyldrm/exercises-dataset). The descriptions in those records were written for openGym and are covered by AGPL-3.0. The MIT license below applies to the ExerciseDB-derived portions only; it does not relicense the descriptions or the combined catalogue.

The openGym NOTICE (https://github.com/DuarteSantos8/openGym/blob/8fb98b16861a2728652302a7e6e30c50548493a0/NOTICE.md) identifies exercise stills and animations licensed from Gym visual as outside the openGym AGPL. LIFTR does not copy or distribute those assets. No openGym frontend component or body-map artwork has been copied in this tranche.

### ExerciseDB MIT notice

Copyright (c) 2026 Hasan Emir Yıldırım

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## Other assets and external services

This notice applies only to the sources described above. Other food data, images and dependencies keep their own provenance and licensing terms. In particular, it does not grant a license for unrelated exercise media already present in LIFTR.
