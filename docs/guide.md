# DataMind interview guide

How I present DataMind in a data analyst or product analytics interview.

Every number here comes from running the code in this repository. Some numbers come from earlier benchmark runs that I could not repeat for this guide, such as the billion-row test, which takes 13.8 GB of disk and about 9 minutes. Each of those is marked **(earlier run)**. Anything I could not verify is marked **(not verified)**.

Quick facts, checked on 3 Oct 2026:

| Fact | Value | How I checked |
|---|---|---|
| Tests | 49 passing in 3 suites | `CI=true npx react-scripts test --watchAll=false` |
| Production build | 226.8 kB main JS (gzip), 15.3 kB lazy chunk, 7.9 kB CSS | `npm run build` |
| Sample dataset | 20,000 rows, 11 columns, 1.2 MB | `src/lib/sampleData.js` |
| Largest file analysed | 1,000,000,000 rows, 13.8 GB, in 8 min 36 s on 4 cores | **(earlier run)** in a Chromium-based browser |
| Live app | https://joelraj18.github.io/datamind-playground2.0/ | Deployed by `.github/workflows/deploy.yml` |

---

## 1. The 60-second pitch

**What it is.** DataMind is a browser app for exploratory data analysis. You drop in a CSV file. It reads every row and gives you summary statistics, charts, correlations, group comparisons, data quality checks and a written report. Nothing is uploaded to a server.

**Who it is for.** Analysts and product people who get a CSV export and need answers quickly, before anyone writes a notebook. Examples: "what does our order data look like?", "which segment pays the most?", "is this column clean enough to use?".

**The problem it solves.** Spreadsheets slow down or crash at around a million rows. Notebooks need setup and code. Many browser tools quietly analyse only a sample. The first version of this project did that too: it read only the first 110,000 rows. DataMind now reads **every row**, even in a 13.8 GB file, and shows which numbers are exact and which are estimates.

**Stack.** React 19, Recharts and hand-written SVG charts, plain CSS. The analysis engine is plain JavaScript in Web Workers, with no server. Data is stored in IndexedDB. Tests use Jest and Testing Library. GitHub Actions deploys the app to GitHub Pages.

**Three things to emphasise:**

1. **Every row, with honest accuracy.** Counts, means, standard deviations, skewness, correlations and group means are always exact. Medians and percentiles are exact up to about 2 million rows, and for whole-number columns of any size. Beyond that they come from a sketch that is accurate to within 0.1%, and the app marks those numbers with "≈".
2. **Scale on a laptop.** The engine splits the file across CPU cores and streams it in 4 MB chunks, so memory stays flat. On 4 cores it handled 10 million rows in 8 s, 100 million rows in 1 min 12 s, and 1 billion rows in 8 min 36 s **(earlier run)**.
3. **Answers, not just charts.** It turns statistics into business-facing output: which features drive the target, which segment is the premium one, which columns are unreliable. In the sample data it finds the story that carrier sales carry big discounts and lower satisfaction.

---

## 2. Architecture

```
CSV file
  │
  ▼
sniff first 1 MB ──► plan (column types, exact or streaming, how many workers)
  │                    src/engine/plan.js:27, :104
  ▼
split into byte ranges, one per core          src/engine/plan.js:204
  │
  ├─► worker 1: tokenise + accumulate ─┐      src/engine/scanner.js:491
  ├─► worker 2: tokenise + accumulate ─┤
  └─► worker N: tokenise + accumulate ─┘
                                        ▼
                     merge partial results          src/engine/merge.js:6
                                        ▼
                     finalise statistics and charts src/engine/finalize.js:508
                                        ▼
               analysis object ──► React views + IndexedDB
```

| Layer | What | Why |
|---|---|---|
| UI | React 19 views in `src/views/`, shared parts in `src/components/`. Ten explorer tabs (`src/views/explorer/ExplorerView.jsx:13`). Recharts for most charts. Hand-written SVG for box plots and the correlation matrix (`src/components/svgCharts.jsx`). | React is a common, well-known choice. Recharts covers standard charts. Custom SVG gives exact control where Recharts has no good chart type. |
| Logic | The engine in `src/engine/` reads bytes, parses fields and keeps running totals. Business summaries live in `src/lib/blueprints.js`. The rule-based Q&A assistant is in `src/lib/assistant.js`. | The engine is plain JavaScript with no dependencies, so it runs the same in a worker, on the main thread and in tests. |
| Data | `src/lib/sampleData.js` generates the sample. Users upload their own CSV files. | The sample is created from a fixed random seed, so it is identical every time and demos are reproducible. |
| Storage | IndexedDB stores each saved analysis, plus the original file if it is 512 MB or smaller (`src/lib/storage.js:65`). localStorage holds only the login session. | localStorage holds only about 5 MB, which broke large datasets on reload. IndexedDB can hold much more. |
| Tests | 49 Jest tests in `src/engine/__tests__/engine.test.js`, `src/lib/__tests__/analysis.test.js` and `src/DataMind.test.js`. | The engine is checked against an independent reference calculation. The app test clicks through every tab like a user would. |
| Deployment | `.github/workflows/deploy.yml` runs `npm ci`, the tests and the build, then publishes `build/` to GitHub Pages on every push to `main`. | Static hosting is free and needs no server, because all the work happens in the browser. |

### Key design choice: one pass, mergeable summaries

I compute every statistic in **one pass over the file**, using summaries that can be **merged**. Each worker keeps sums, counts, hash tables and sketches for its part of the file. The main step adds these together.

Why:

- **Memory stays flat.** A 13.8 GB file never sits in memory. Only the summaries do.
- **Parallel for free.** Sums add up across workers, and so do sketch buckets and distinct-count registers. Splitting the file needs no coordination between workers.
- **Most statistics are exact.** Mean, variance, skewness, kurtosis and correlation all come from sums of powers, which are exact in one pass.

What it costs: medians and percentiles cannot be computed exactly in one pass with fixed memory. I handle that in tiers (section 4.2). Where an estimate is unavoidable, the app shows "≈" next to it.

I rejected two alternatives:

- **Load everything into memory and use a library.** The old version did this. It ran out of memory at a few million rows.
- **Ship a database engine compiled to WebAssembly.** It works, but it adds a large download. I would also lose control over progress reporting and over the exact-versus-estimate labels.

---

## 3. What was built and changed

The history comes from `git log --oneline -50`. Dates are commit dates.

### Round 0: starting point (Nov 2025)

- `8e6dacd` Initial project: a Create React App project with one large component, PapaParse for CSV and Tailwind loaded from a CDN.
- `fcb4e50` Added GitHub Pages deploy scripts (`predeploy`, `deploy` in `package.json`).

### Round 1: large files by sampling (Mar 2026)

- `34e3954`, `b4b113f` Removed duplicate script tags.
- `07f9743` Capped analysis at the first 110,000 rows (`MAX_ANALYSIS_ROWS`, still described in the README). Documented the plan to move to IndexedDB.
- `a0b10c3`, `bb1398e`, `99359e0` Added screenshots to the README.

### Round 2: redesign and modular code (2 Oct 2026)

- `92101dc` New interface with a green colour palette, info tips on every statistic, and one large file split into views, components and libraries. 28 files changed (+4,706, −2,755). Merged as `joelraj18/datamind-playground2.0#1` (`b146d05`).

### Round 3: persistence (2 Oct 2026)

- `d572570` Moved saved datasets from localStorage to IndexedDB. Statistics now used 110,000 rows spread evenly across the file instead of the first 110,000.
- `59daf72` Added a GitHub Actions workflow that tests, builds and deploys.

### Round 4: every row, at any size (3 Oct 2026, in `joelraj18/datamind-playground2.0#3`)

- `3749290` New streaming engine in `src/engine/` that is parallel and reads every row. Added a live progress panel with rows per second and a countdown. Added box plots, cumulative (ECDF) plots, Q-Q plots, value bars, a scatter plot with a trend line, group box plots and timelines. Every chart can be downloaded as PNG, SVG or CSV.
- `3bbfc45` Made scanning 5× faster in the browser, and made quantiles exact for whole-number columns at any size.
- `1a5c74c` Fixed a hang on text columns with many unique values. Verified 1 billion rows.
- `8af0047`, `2fb5426` Rewrote the copy in plain language and showed readable column names ("created at" for `created_at`) and dates ("31 Jan 2024"). Generated Python keeps the real column names.

### Notable fixes

| Problem | Fix | Result |
|---|---|---|
| Statistics used only the first 110,000 rows. A sorted file gave wrong answers. | Built a streaming engine that reads every row (`src/engine/scanner.js:491`). | All rows analysed, up to 1 billion **(earlier run)**. |
| Large datasets disappeared on reload. localStorage holds only about 5 MB. | Moved storage to IndexedDB and migrated old records automatically (`src/lib/storage.js:100`). | Datasets and files up to 512 MB survive reloads. |
| The engine ran 15× slower in the browser than in Node on the same code. | Split one huge per-row function into small ones (`scanCategorical`, `scanNumeric`, `scanGroups`, `scanCorrelation`, `scanDates`, `sampleRow`; `src/engine/scanner.js:215` onwards), so the browser's JIT compiler optimises each one. | One worker went from 5 to 24 MB/s. Four workers reached 42 to 47 MB/s **(earlier run)**. |
| `Map` with number keys was slow, because each key is a heap object. | Wrote open-addressing hash tables on typed arrays (`src/engine/tables.js`). | Part of the 5× speed-up in `3bbfc45`. |
| The row estimate was about 5× too high, which pushed a 1M-row file out of exact mode. | Estimate bytes per row from all rows read in the first 1 MB, not just the 5,000 sampled rows (`src/engine/plan.js:38`). | Estimated 1.04M rows for a real 1.0M **(earlier run)**. Exact mode stays exact. |
| Infinite loop on a text column with 60,000 unique values. After pruning, the hash table capacity was not a power of two, so `hash & mask` probing never found a free slot. | Round capacity up to a power of two (`src/engine/tables.js:52`). Stop tracking new names after 3 prunes (`src/engine/scanner.js:13`). | Regression test: `engine.test.js:226`. It finishes in under 1 s. |
| The dense counter store had an offset of `Infinity` when a merge target was empty. | Handled the empty store explicitly (`src/engine/stream.js:35`). | Merges across workers stay exact. |
| The progress counter went backwards between updates. | Made the counter monotonic and capped its projection. Rates and the countdown are smoothed with an exponential moving average (`src/components/AnalysisProgress.jsx:17`). | Numbers move steadily. The countdown matched the real 8 min 36 s closely **(earlier run)**. |
| Downloaded charts included hover tooltips and cursors, and some were clipped. | The export clones the SVG and strips transient layers (`src/lib/chartExport.js:14`). It also sizes the canvas to fit the title and legend (`chartExport.js:32`). | Clean PNG and SVG files with title, subtitle and legend. |
| A box plot of a constant column drew nothing. | Added a special case in `src/components/svgCharts.jsx`. | A single line at the value. |

---

## 4. Feature deep dives

All real numbers below come from the built-in sample, **Phone sales sample.csv** (20,000 rows; section 5). I produced them by running the engine on the sample and reading the analysis object.

### 4.1 Overview and column typing

**Business question.** "What is in this file, and can I trust it?"

**How it works.** The app reads the first 1 MB (`src/engine/plan.js:27`) and works out:

- the delimiter, from comma, semicolon, tab and pipe (`src/engine/csv.js:354`)
- the header, cleaned the same way as pandas: a blank header becomes `Unnamed: i`, and duplicates get `.1`, `.2` (`csv.js:383`)
- each column's type: a column is numeric if at least 90% of its non-empty sampled values parse as numbers, and a date if at least 90% are dates. Anything else is text (`plan.js:101`, `plan.js:104`)
- ID columns: whole numbers that are all unique, with an ID-like name (`OrderID`, `user_id`) or a run that goes up by 1 each row (`plan.js:193`)

Missing values use the same default tokens as `pandas.read_csv`: empty, `NA`, `N/A`, `null`, `NaN`, `None` and others (`csv.js:172`).

**Why this method.** A 90% threshold tolerates a few bad cells, such as "abc" in a number column. Those cells are counted as **invalid** and shown with examples instead of turning the whole column into text. Matching pandas means the numbers agree when someone checks them in a notebook.

**Limits.** The type is decided from the first 1 MB. If a column changes later in the file, for example numbers that become text, the later values are counted as invalid. Dates must be ISO style (`2024-01-31`). Other formats are treated as text **(known limit)**.

**Real numbers.** 11 columns: 6 numeric, 4 text, 1 date. `OrderID` is flagged as an ID and left out of correlations. Completeness is 99.64%. Analysis took 713 ms (in the test runner, main thread).

**30-second demo.** Click **Try a sample dataset**, then stay on **Overview**. Say: *"It typed every column, spotted that OrderID is an identifier, and tells me the file is 99.6% complete. The accuracy box says these statistics are exact."*

### 4.2 Univariate analysis: one column at a time

**Business question.** "What does a typical value look like, how spread out is it, and are there outliers?"

**How it works.** The mean, standard deviation, skewness and kurtosis come from shifted power sums in one pass (`src/engine/finalize.js:27`):

```text
x' = x − shift        (shift = sample mean of the first 1 MB, for numerical stability)
S1 = Σx', S2 = Σx'², S3 = Σx'³, S4 = Σx'⁴

mean = shift + S1/n
m2   = S2/n − (S1/n)²
std  = sqrt(m2 · n/(n−1))                            # sample std, ddof = 1, same as pandas
skew = m3/m2^1.5 · sqrt(n(n−1))/(n−2)                # bias-corrected, same as pandas
kurt = ((n+1)(m4/m2² − 3) + 6)(n−1)/((n−2)(n−3))     # excess kurtosis
CV   = std / |mean| × 100
```

Quantiles use linear interpolation between order statistics, which is the pandas default (`src/engine/sketch.js:165`). The engine picks the most precise method that fits in memory, in this order:

| Tier | When | Accuracy | Code |
|---|---|---|---|
| Exact buffers | About 2 million rows or fewer (`plan.js:11`) | Exact | `finalize.js:236` |
| Distinct table | A column with 1,024 distinct values or fewer | Exact | `tables.js:17` |
| Dense counters | Whole numbers spanning 262,144 values or fewer (prices, ages, years) | Exact at any row count | `stream.js:17` |
| Log sketch | Everything else | Within 0.1% of the value | `sketch.js:9` |

The log sketch places each value v in bucket `ceil(log(v) / log(γ))`, with γ = (1 + 0.001) / (1 − 0.001). Every value in a bucket is within 0.1% of the bucket's representative, so every quantile is too.

Outliers use the box plot rule (`finalize.js:132`):

```text
IQR = Q3 − Q1
outlier if x < Q1 − 1.5·IQR or x > Q3 + 1.5·IQR
```

Histogram bins use the Freedman–Diaconis rule, clamped to 5 to 50 bins (`finalize.js:89`):

```text
bin width = 2 · IQR · n^(−1/3)
```

Bin edges are rounded to "nice" steps such as 10, 20, 25 or 50. Whole-number columns get whole-number bins labelled "400 to 449".

Each numeric card has four views (`src/views/explorer/UnivariateTab.jsx:32`):

- **Histogram:** auto, 10, 20, 50 or 100 bins
- **Box plot**
- **Cumulative (ECDF):** 101 points
- **Q-Q plot against a normal distribution:** 99 points, using the Acklam normal quantile function at `finalize.js:43`

Columns with 30 or fewer distinct values also get exact value bars. Text columns get bars or a donut. Date columns get a timeline by day, week, month or year (`src/lib/timeline.js:50`).

The same statistics in SQL (PostgreSQL):

```sql
SELECT
  COUNT(price)                                            AS n,
  AVG(price)                                              AS mean,
  STDDEV_SAMP(price)                                      AS std,
  PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY price)     AS q1,
  PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY price)     AS median,
  PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY price)     AS q3,
  100.0 * STDDEV_SAMP(price) / ABS(AVG(price))            AS cv_pct
FROM orders;
```

**Why this method.** Power sums give exact moments in one pass and merge by simple addition. A naive Σx² loses precision when values are large and close together. Subtracting a shift first avoids that. I chose the log sketch over a t-digest because it gives a guaranteed relative error bound, not just a usually-good result, and two sketches merge by adding bucket counts.

**Limits and edge cases.**

- A constant column has IQR 0 and std 0. The box plot draws a single line, and CV is undefined when the mean is 0 (shown as n/a).
- Skewness needs at least 3 values, and kurtosis at least 4. Otherwise they show n/a.
- The 1.5 × IQR rule flags many points in skewed data. That is a feature here (see the real numbers below), but I say so in the tip.
- Negative zero is folded into zero (`tables.js:8`).

**Real numbers.**

| Column | Mean | Median | Std | Skew | CV | Outliers |
|---|---|---|---|---|---|---|
| Price | 1,227.69 | 1,187 | 372.29 | 0.33 | 30.3% | 0 |
| Discount | 38.24 | 26 | 37.06 | 1.47 | 96.9% | 3,076 (15.4%) |
| CustomerAge | 40.65 | 41 | 12.96 | −0.01 | 31.9% | 0 |
| Satisfaction | 3.96 | 4.0 | 0.60 | −0.03 | 15.0% | 0 (787 missing, 3.9%) |
| StorageGB | 477.24 | 256 | 341.76 | 0.67 | 71.6% | 0 |

Discount's fences are −27.5 and 80.5. All 3,076 outliers are above 80.5, and they are not errors (section 4.4). Price percentiles: P1 = 559, P50 = 1,187, P99 = 1,998.

**30-second demo.** Open **Univariate**. On the Discount card, switch from **Histogram** to **Box plot**, then to **Q-Q**. Say: *"The mean is 38 but the median is 26, so it is right-skewed. The box plot flags 15% of rows as outliers. The Q-Q plot bends away from the line at the top. Before I delete outliers, I check where they come from."*

### 4.3 Correlation

**Business question.** "Which numbers move together? What could drive price?"

**How it works.** Pearson correlation is computed on **pairwise-complete** rows from running sums (`src/engine/scanner.js:352`, `finalize.js:374`). Rows complete for every column update shared sums. Rows with gaps update only the pairs they have. That way one missing Satisfaction value does not throw away the row's Price and Discount.

```text
cov = Σxy − Σx·Σy/n
r   = cov / sqrt((Σx² − (Σx)²/n) · (Σy² − (Σy)²/n))
slope (y on x) = cov / (Σx² − (Σx)²/n)
intercept      = mean(y) − slope · mean(x)
```

```sql
SELECT CORR(storage_gb, price), REGR_SLOPE(price, storage_gb), REGR_INTERCEPT(price, storage_gb)
FROM orders;
```

The tab shows a colour-coded matrix (`src/components/svgCharts.jsx`) and a scatter plot (`src/views/explorer/RelationshipTabs.jsx:74`). The scatter plot draws up to 5,000 randomly sampled rows, but its trend line is fitted on **all** rows.

**Why this method.** Pairwise-complete matches pandas `DataFrame.corr()` and uses as much data as possible. Computing from sums means the correlation covers every row, while the chart only needs a sample to look right. The random sample uses reservoir sampling, Algorithm L (`scanner.js:443`), so every row has an equal chance whatever the file size.

**Limits.**

- Pearson measures linear relationships only, and outliers affect it. Spearman would be more robust **(not built)**.
- Pairwise-complete matrices can be slightly inconsistent, because each cell may use different rows.
- At most 40 numeric columns are correlated (`plan.js:16`), and ID columns are excluded.
- A strong "r" is labelled at |r| > 0.7 in the app (`finalize.js:17`). The chat assistant uses 0.6 (`src/lib/assistant.js:70`). That inconsistency is on my fix list.

**Real numbers.**

- StorageGB vs Price: **r = 0.83** over 20,000 rows, slope **0.902** dollars per GB, intercept 797.4. The data generator uses `price = base + (storage − 128) × 0.9 − discount`, so the regression recovers the true coefficient.
- Discount vs Satisfaction: **r = −0.18** over 19,213 rows. This is the pairwise count, because 787 Satisfaction values are missing.
- Every other pair is below 0.1 in absolute value.

**30-second demo.** Open **Correlation**. Point at the dark green StorageGB × Price cell. Scroll to the scatter plot and pick X = StorageGB, Y = Price. Say: *"r is 0.83 and the slope is 0.90 per GB, so every extra 128 GB adds about $115. The trend line uses all 20,000 rows. The dots are a random sample, so the chart stays fast."*

### 4.4 Bivariate: segments compared

**Business question.** "Which segment pays more, gets more discount or is less happy?"

**How it works.** For up to 6 text columns with 2 to 14 categories (`plan.js:13`), the engine keeps per-group sums for each measure. It reports count, mean, std, min, max, Q1, median and Q3 (`finalize.js:302`). In exact mode, group quantiles come from quickselect on each group's values (`finalize.js:258`). In streaming mode they come from per-group counters or sketches (within 0.5%).

```sql
SELECT channel,
       COUNT(*)                                             AS orders,
       AVG(discount)                                        AS mean_discount,
       PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY discount) AS median_discount
FROM orders
GROUP BY channel
ORDER BY mean_discount DESC;
```

The tab shows **Mean & median** bars or **Box plots** per group, plus a table.

**Why this method.** Showing mean next to median reveals skew inside a group. The box plots show overlap, so I don't over-read a small difference in means.

**Limits.**

- Text columns with more than 14 categories are skipped for comparisons. Comparing 500 bars is not useful.
- No significance test is shown yet. With 6,000 rows per group almost everything is "significant", so I would show effect size and a confidence interval instead **(not built)**.

**Real numbers. This is the main story in the sample.**

| Channel | Orders | Mean discount | Mean price | Mean satisfaction |
|---|---|---|---|---|
| Carrier | 6,699 | **74.53** | 1,194.20 | **3.86** |
| Online | 6,644 | 20.13 | 1,240.99 | 4.00 |
| Store | 6,657 | 19.79 | 1,248.12 | 4.01 |

The 3,076 "outliers" in Discount are carrier deals, not bad data. Carrier orders also have lower satisfaction. In the generator, discounts above 100 reduce satisfaction by 0.4.

By model, mean price runs from Pro Max at 1,478.85 down to "e" at 877.16. Region and Color show no real difference: every region's mean price is between 1,222 and 1,230. That is a useful "null result" to point out.

**30-second demo.** Open **Bivariate**. Set **Group by** to Channel and **Measure** to Discount, then switch to **Box plots**. Say: *"Carrier discounts average 75 against 20 elsewhere. That explains the outliers. Then I switch the measure to Satisfaction, and carrier customers score 3.86 against 4.0. That is a hypothesis to test: do deep discounts attract less satisfied customers, or does the carrier experience itself hurt satisfaction?"*

### 4.5 Insights, Decision Center, Segmentation, Predictive

**Business question.** "Give me the headline, the risks and where to look next."

**How it works.** These tabs use rules over the computed statistics:

- **Insights** (`finalize.js:453`) flag:
  - skew above 1 in absolute value
  - outliers in more than 1% of rows
  - non-numeric values in number columns
  - one category covering more than 70% of rows
  - columns more than 20% missing
  - correlations with |r| above 0.7
  - ID columns
  - malformed rows
- **Decision Center** (`src/lib/blueprints.js:21`) lists:
  - unstable measures: CV above 50%
  - drivers: |r| of 0.7 or more
  - risks: the warnings above
- **Data Quality** (`blueprints.js:32`) shows:
  - completeness = 1 − missing cells / all cells
  - high-cardinality columns: unique values above 80% of rows
  - inconsistent measures: CV above 75%
- **Segmentation** (`blueprints.js:70`) guesses the target from a list of name hints (price, revenue, sales and others; `blueprints.js:5`). It then shows the target's strongest driver, its highest-mean "premium" group and the largest "volume" group.
- **Predictive** (`blueprints.js:91`) ranks features with `score = |r with target| / (CV / 100)`. It also lists groups where the mean is far above the median.

**Why this method.** Rules are transparent: every insight can be traced to one number, which matters when a stakeholder asks "why does it say that?". Nothing leaves the browser.

**Limits. I raise these myself.**

- The predictive score is a heuristic, not a model. Dividing by a feature's CV penalises features whose mean is near zero, and CV changes if you shift the units. A cross-validated model with permutation importance would be better.
- Target guessing by name can pick the wrong column.
- Thresholds such as 0.7, 50% and 75% are rules of thumb.

**Real numbers.**

- Insights: Discount is right-skewed (1.47), and Discount has 15.4% outliers. StorageGB and Price have a strong positive correlation (0.83). OrderID looks like an identifier.
- Decision Center: Discount (CV 96.9%) and StorageGB (CV 71.6%) are unstable. StorageGB → Price is the driver.
- Segmentation: target Price, driver StorageGB (r = 0.83), premium group Model = Pro Max (mean 1,478.85), volume group Channel = Carrier (33.5%).
- Predictive: StorageGB scores 1.156. Satisfaction scores 0.115 and Discount 0.102, which shows the heuristic's weakness: Satisfaction has almost no correlation (0.017) but ranks second because its CV is low.

**30-second demo.** Open **Insights**, then **Decision Center**. Say: *"Each line comes from one rule over one number, so it is easy to audit. I would not trust the predictive score on its own. It is a pointer for what to model next."*

### 4.6 Ask: the question box

**Business question.** "Can a non-analyst get a quick answer in plain words?"

**How it works.** `src/lib/assistant.js:23` matches keywords (summary, missing, cv, outlier, percentile, correlation, a column name) and answers from the analysis object. It uses no network calls and no language model.

**Limits.** Keyword matching misses rephrased questions. It cannot compute anything new, only report what the engine already computed.

**Real answer.** "average of price" returns "The average of **Price** is **1,227.69** (median 1,187, standard deviation 372.29)."

**30-second demo.** Click **Ask** and type `which columns have missing values`. Say: *"The answer is Satisfaction, 3.9% missing. It is rule-based on purpose, so it can't make numbers up."*

### 4.7 Live progress and estimated time

**Business question.** "How long will this take, and is it still working?"

**How it works.** Workers report bytes and rows after every 4 MB chunk. The panel (`src/components/AnalysisProgress.jsx:17`) smooths the rates with an exponential moving average (factor 0.3). It projects the row counter between updates so the numbers move steadily, and it counts the time remaining down in real time:

```text
remaining time = bytes remaining / smoothed bytes per second
first guess    = 400 ms + bytes / (20,000 bytes/ms × workers^0.9)   # src/engine/index.js:76
```

The user can cancel at any time. Cancelling terminates the workers (`index.js:33`).

**Real numbers (earlier run).** At 30 s into the 1-billion-row file, the panel showed 57,354,031 rows read, about 6 min 32 s remaining, 2.4M rows/s and 33.3 MB/s. The run finished at 8 min 36 s.

**30-second demo.** Drop in a large CSV, or watch the sample if none is available. Say: *"The time estimate is based on bytes, not rows, because bytes are known up front. It starts from a measured guess and then switches to the live rate."*

### 4.8 Exports

**Business question.** "Can I put this in a deck or carry on in Python?"

**How it works.**

- **Charts:** every chart card exports PNG (2× resolution), SVG or the underlying data as CSV. Export uses the full unfiltered chart, without hover state (`src/lib/chartExport.js`).
- **Report:** a Markdown report (`src/lib/exporters.js:30`).
- **Notebook:** a Jupyter notebook in nbformat 4 (`exporters.js:90`).
- **Python template:** uses the **original** column names, such as `unit_price`, so it runs against the real file (`exporters.js:148`).

**Real check.** A test confirms that the template uses `numerical_cols = ['unit_price', 'unit-count']` while the app shows "unit price" (`src/lib/__tests__/analysis.test.js:60`).

**30-second demo.** On any chart, open **Download** and choose **PNG**. Then click **Notebook (.ipynb)** at the top. Say: *"The tool hands off to a notebook. It does not replace one."*

---

## 5. Data

**Source.** `createSampleCsv()` in `src/lib/sampleData.js:23` generates the data in the browser. It uses a seeded random number generator (mulberry32, seed 42), so every run produces the same file. It is synthetic. It does not come from any real company.

**Size.** 20,000 rows, 11 columns, 1,196,936 bytes.

| Column | Type | How it is generated | Real result |
|---|---|---|---|
| OrderID | ID | 10000 + row number | 10,000 to 29,999, flagged as ID |
| OrderDate | Date | A ramp through 2024 (square root of a uniform value), plus 8% of orders on 1 to 14 Sep | 5 Jan 2024 to 30 Dec 2024 |
| Model | Text | 5 models, weighted towards the first (Pro Max) | Pro Max 31.2%, Pro 20.7%, Standard 18.0%, Plus 15.5%, e 14.6% |
| Color | Text | Uniform over 5 colours | About 20% each |
| Region | Text | Uniform over 4 regions | About 25% each |
| Channel | Text | Uniform over Online, Store, Carrier | About 33% each |
| StorageGB | Number | 128, 256, 512 or 1024 | About 5,000 each |
| Price | Number | Model base + (storage − 128) × 0.9 − discount | 449 to 2,005, mean 1,227.69 |
| Discount | Number | Carrier 0 to 150, others 0 to 40 | Mean 38.24, median 26 |
| CustomerAge | Number | Uniform 18 to 63 | Mean 40.65 |
| Satisfaction | Number | 3.0 to 5.0, minus 0.4 if discount > 100, 4% left blank | 2.6 to 5.0, 787 missing |

**Cleaning.** None is needed for the sample. For uploaded files, the engine handles:

- a UTF-8 BOM and CRLF line endings
- semicolon, tab and pipe delimiters
- quoted fields with commas or line breaks
- pandas missing-value tokens
- duplicate and blank headers
- non-numeric values in number columns, counted as invalid with examples
- rows with too few or too many fields, counted as malformed

The test at `src/engine/__tests__/engine.test.js:238` covers a BOM, CRLF, semicolons and an invalid number.

**Patterns an interviewer can find:**

1. **Storage drives price.** r = 0.83, slope 0.902 per GB.
2. **Carrier = deep discounts.** Mean discount is 74.5 against about 20, and these rows are the Discount "outliers".
3. **Deep discounts and lower satisfaction.** r = −0.18 overall. Carrier averages 3.86 against about 4.0.
4. **September launch spike.** 3,669 orders in Sep against 1,963 in Aug. The top two weeks are the weeks of 2 Sep (1,267 orders) and 9 Sep (1,167).
5. **Sales ramp through the year.** 133 orders in Jan, 2,947 in Dec. Average price stays flat at about 1,214 to 1,245 every month, so growth comes from volume, not price.
6. **Premium mix.** Pro Max is the largest group (31%) and the most expensive (mean 1,478.85).
7. **Missing data looks random.** Satisfaction is 3.9% missing, spread evenly across groups. Each region keeps about 4,750 to 4,840 non-missing values.
8. **Null results.** Color, Region and Age have no effect on price or satisfaction. Knowing when nothing is there is part of analysis.

---

## 6. Performance and quality

### Tests

49 tests pass (`CI=true npx react-scripts test --watchAll=false`, about 7 s).

| Suite | Tests | What it covers |
|---|---|---|
| `src/engine/__tests__/engine.test.js` | 41 | Number parsing matches JavaScript. Date parsing rejects invalid dates. Headers are de-duplicated like pandas. Moments and bin edges are checked. The full pipeline is compared with a reference in **4 configurations**: exact or streaming, with 1, 3 or 4 byte ranges. That comparison covers row counts, moments, quantiles (exact or within the sketch bound), histogram totals, correlation, group statistics, categories, missing tokens, quoted commas, dates and the random sample. Also tested: dense counters stay exact across ranges, a 60,000-unique text column finishes, CRLF/BOM/semicolons work, and an empty file is rejected. |
| `src/lib/__tests__/analysis.test.js` | 7 | Formatters. Column typing and ID detection on the sample. Data quality and predictive summaries. The timeline rolls up without losing records. The assistant's answers. Readable names versus source names. The report, notebook and template are well formed. |
| `src/DataMind.test.js` | 1 | End to end: register, analyse the sample, wait for "All 20,000 rows analysed", click every chart type and all 10 tabs, then ask a question. |

The CI workflow runs these tests on every push to `main` before deploying. The build treats lint warnings as errors.

### Scale and speed

| Size | Time | Where measured |
|---|---|---|
| 20,000 rows (1.2 MB, sample) | 713 ms | Test runner, single thread, re-run for this guide |
| 1,000,000 rows (60.8 MB, sample generator) | 22.4 s exact mode, 18.0 s streaming | Test runner, single thread, with code transformed for tests. Re-run for this guide. Much slower than a browser, so not representative. |
| 1,000,000 rows (benchmark file) | Scan in 841 ms at 44 MB/s, exact median | Bundled engine in Node, single core **(earlier run)** |
| 10,000,000 rows (380 MB) | 8.3 s, about 1.5M rows/s, about 10 MB of main-thread memory | Chromium-based browser, 4 cores **(earlier run)** |
| 100,000,000 rows (3.8 GB) | 1 min 12 s, about 1.4M rows/s, flat memory | Same **(earlier run)** |
| 1,000,000,000 rows (13.8 GB) | 8 min 36 s, no errors | Same **(earlier run)** |

The billion-row results matched an independent Python calculation **(earlier run)**:

- counts, means, std and correlations matched
- the whole-number column's quantiles were exact
- decimal quantiles were within 0.1%

I did not repeat the billion-row run for this guide. It needs 13.8 GB of disk and about 9 minutes.

**How it got fast:**

- parallel byte ranges, one per core
- a byte-level tokenizer that never builds strings for numbers
- typed-array hash tables
- small per-row functions that the JIT compiler can optimise

**When it is not parallel.** If a quoted field contains a line break, a byte range could start inside a record. The planner detects this in the first 1 MB and falls back to one worker (`plan.js:161`).

### Bugs worth telling as stories

1. **The silent sample.** The original app analysed only the first 110,000 rows. On a file sorted by date, every statistic described only the oldest data. Nothing crashed, so nobody noticed. That is the worst kind of bug for an analyst. It led to the streaming engine.
2. **15× slower in the browser.** The same code ran at 42 MB/s in Node and 5 MB/s in the browser. I profiled it and found one huge per-row function that the browser's optimiser gave up on. Splitting it into small functions gave a 5× speed-up.
3. **The hang.** A text column with 60,000 unique values froze the app. After pruning rare categories, the hash table capacity was not a power of two. `hash & mask` then skipped slots, and the probe loop never found an empty one. One-line fix, plus a regression test.

---

## 7. Likely interview questions with model answers

### Technical: statistics

**1. Why show both mean and median?**
The mean is pulled by the tail and the median is not. For Discount, the mean is 38 and the median is 26, so I know it is right-skewed before I look at a chart. For money metrics I usually report the median as "typical" and the mean for totals.

**2. How do you compute a standard deviation without storing the data?**
I keep running sums of x and x² (after subtracting a shift for precision). Then variance = (Σx² − (Σx)²/n)/(n − 1). Sums add up across workers, so it parallelises. Subtracting a shift avoids catastrophic cancellation when values are large and close together.

**3. Why can't you get an exact median in one pass with fixed memory?**
An exact median needs the order of the data, and any fixed-memory summary must throw information away. So I use tiers. Exact buffers up to about 2 million rows. Exact counters for columns with few distinct values or whole numbers in a limited range. A log-bucket sketch with a guaranteed 0.1% relative error for everything else. The app marks the estimates with "≈".

**4. What is the 1.5 × IQR rule, and when does it mislead?**
A point is an outlier if it is more than 1.5 IQRs outside the box. It assumes a roughly symmetric distribution. In skewed or mixed data, as with Discount, it flags 15% of rows that are really a separate segment. So I treat outliers as a question to investigate, not as data to delete.

**5. Correlation is 0.83. Does storage cause price?**
Here, yes, by construction: the price formula includes storage. In real data I would not claim causation from r. I would ask whether a third factor such as the model drives both. I would also check the relationship within each model and look for an experiment or a natural experiment.

**6. How do you handle missing values in correlation?**
Pairwise-complete: each pair uses the rows where both values exist. That matches pandas and keeps the most data. The trade-off is that cells can be based on different rows. If missingness is not random, I would check whether the rows with missing values differ from the rest first.

**7. What does a Q-Q plot tell you?**
It plots sample quantiles against the quantiles of a normal distribution with the same mean and std. A straight line means roughly normal. A curve at the ends means heavy or light tails. It tells me whether a t-test or a linear model's assumptions are reasonable.

### Technical: SQL and data modelling

**8. Write the SQL for average discount and median satisfaction by channel.**

```sql
SELECT channel,
       COUNT(*) AS orders,
       AVG(discount) AS avg_discount,
       PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY satisfaction) AS median_satisfaction,
       AVG(CASE WHEN satisfaction IS NULL THEN 1.0 ELSE 0 END) AS pct_missing_satisfaction
FROM orders
GROUP BY channel;
```

**9. Find the week with the most orders, and its change against the previous week.**

```sql
WITH weekly AS (
  SELECT DATE_TRUNC('week', order_date) AS week, COUNT(*) AS orders
  FROM orders GROUP BY 1
)
SELECT week, orders,
       orders - LAG(orders) OVER (ORDER BY week) AS change
FROM weekly
ORDER BY orders DESC
LIMIT 1;
```

In the sample this is the week of 2 Sep 2024, with 1,267 orders.

**10. How would you model this data in a warehouse?**
A fact table `fact_orders` with one row per order: order_id, date_key, product_key, customer_key, channel_key, price, discount, satisfaction. Dimensions for date, product (model, storage, colour), customer (age band, region) and channel. Price and discount are additive measures. Satisfaction is not additive, so I average it and keep its count.

**11. Why does the app treat OrderID differently?**
An ID is unique and increasing, so its "mean" and its correlations mean nothing. Worse, a sequential ID correlates with time and can look like a strong driver. I detect IDs by name pattern and uniqueness, and exclude them from correlations and predictions.

### Product sense

**12. Satisfaction dropped 0.2 points last month. What do you do?**
First, check the data: did the survey change, did the response rate drop, did the missing share move? Then segment by channel, model, region and new versus returning customers to find where the drop sits. In this data, carrier orders already score 3.86 against 4.0. So I would check whether the carrier share grew, which would be a mix shift, or whether satisfaction fell within each channel, which would be a real decline. Then I would look for a release, pricing or support change around that date.

**13. Revenue grew 50% in September. Is that good news?**
Partly. The sample shows a launch spike: 3,669 orders against 1,963 in August, while average price stayed flat. So the growth came from volume. I would check whether it holds after launch: October fell back to 2,441. I would also check whether discounts bought it, and whether those customers come back.

**14. Which metric would you put on the Discount programme's dashboard?**
Net revenue per order and the discount rate, split by channel. Satisfaction and repeat purchase as guardrails. Carrier discounts average 75 against 20 elsewhere. The question is whether that buys incremental customers or just gives away margin, which needs a holdout or an A/B test.

**15. A stakeholder says "Region West underperforms". How do you respond?**
In this data West's mean price is 1,222.58 against about 1,229 elsewhere, which is less than 1%. The group box plots overlap almost completely. I would show that the difference is within noise and ask what decision depends on it before slicing further.

**16. How would you decide whether to launch a new feature in this tool?**
I would define the user problem and one success metric, for example the share of uploads that reach a second tab, or time to first insight. I would ship it behind a flag to a share of users and compare. The app has no tracking now, so step one would be privacy-safe event logging.

### About the project

**17. What was the hardest bug?**
The hang on high-cardinality text. It only appeared after the third prune of a 60,000-value column, so small tests passed. I reproduced it with a generated file, found that the rebuilt table's capacity was not a power of two, and fixed it with a one-line rounding. I also stopped tracking new names after 3 prunes, and added a regression test.

**18. How do you know the numbers are right?**
I test the engine against a straightforward reference calculation in four configurations: exact and streaming, with 1 to 4 workers. Quantiles must be exact or within the sketch's error bound. For the billion-row file I compared the output with an independent Python calculation. The app also states which numbers are exact.

**19. How would it scale further?**

- More cores scale almost linearly, because the work is split by byte ranges.
- Beyond one machine, the same mergeable summaries work as a map-reduce: each node scans a partition, and one step merges the results.
- For repeated queries on the same file, I would convert it to a columnar format like Parquet once, instead of re-parsing CSV text.

**20. What would you change?**

- Replace the predictive score with a cross-validated model and permutation importance.
- Use one correlation threshold everywhere: the assistant uses 0.6 and the app uses 0.7.
- Add Spearman correlation and confidence intervals for group means.
- Replace the demo login, which keeps passwords in browser storage, with real authentication or remove it.

**21. Why do it in the browser instead of Python?**
Privacy and zero setup. The data never leaves the laptop, and anyone with a link can use it. The trade-off is that I had to write the engine myself, and browser memory is limited. That is why the design is streaming.

**22. What does "every row" cost you in accuracy?**
Nothing for counts, means, std, skew, correlations and group means, which are exact. Medians and percentiles beyond about 2 million rows are within 0.1% for decimal columns, and still exact for whole numbers in a range up to 262,144. Group quantiles in streaming mode are within 0.5%.

**23. How did you choose the histogram bins?**
Freedman–Diaconis, bin width 2·IQR·n^(−1/3), because it adapts to spread and is robust to outliers. It is clamped to 5 to 50 bins and rounded to nice edges. Users can override it with 10, 20, 50 or 100 bins.

---

## 8. Next steps

| Idea | Why it matters | Effort |
|---|---|---|
| Real model in the Predictive tab: linear regression or gradient boosting, cross-validated, with permutation importance | The current score is a heuristic and ranks a near-zero correlation second | Medium |
| Confidence intervals and effect sizes for group comparisons | Avoids over-reading small differences, such as the Region one | Small |
| Spearman rank correlation | Robust to outliers and catches relationships that are monotonic but not linear | Small with the sample. Large for every row. |
| Filters and drill-down: recompute for "Channel = Carrier" | Lets me test hypotheses inside the tool | Medium: needs another pass or an index |
| More date formats (`31/01/2024`, timestamps) and time zones | Many real exports are not ISO | Small |
| Parquet and Excel input | Common analyst formats | Medium |
| Remove the demo login, or move to real authentication | Passwords are stored in plain text in localStorage (`src/lib/storage.js:45`). This is fine for a local demo, not for production. | Small |
| Privacy-safe usage analytics | Needed to measure which features help users | Small |
| A/B test readout tab: conversion, lift, confidence interval, sample size | A frequent product analytics task | Medium |
| Use one strong-correlation threshold everywhere | Consistency between the assistant and the app | Small |

---

## 9. Five-minute live demo script

Before the interview, open the live app and create an account (any email; it stays in your browser). Close other heavy tabs.

| Time | Click | Say |
|---|---|---|
| 0:00 to 0:30 | Show the **Datasets** page. | "DataMind analyses CSV files in the browser, every row, with nothing uploaded. I built the engine to handle up to a billion rows." |
| 0:30 to 1:00 | Click **Try a sample dataset**. Point at the progress panel and then at the green strip "All 20,000 rows analysed". | "This is 20,000 synthetic phone orders. The panel shows rows per second and a countdown. On a 13.8 GB file this ran for 8 and a half minutes." |
| 1:00 to 1:30 | **Overview**: point at the column table and the Accuracy box. | "It typed 11 columns, flagged OrderID as an ID, and found Satisfaction 3.9% missing. These statistics are exact. On huge files it shows ≈ where it estimates." |
| 1:30 to 2:15 | **Univariate**: on Discount, switch Histogram → Box plot → Q-Q. | "Mean 38, median 26, skew 1.5, and 15% outliers by the IQR rule. Before I remove anything, I ask where they come from." |
| 2:15 to 3:00 | **Bivariate**: Group by Channel, Measure Discount, then Box plots. Then switch Measure to Satisfaction. | "The outliers are carrier deals: 75 average discount against 20. Carrier customers also score 3.86 against 4.0. That is a hypothesis for an experiment, not a conclusion." |
| 3:00 to 3:40 | **Correlation**: the matrix, then the scatter with X = StorageGB, Y = Price. | "Storage drives price, r = 0.83, slope 0.90 per GB. The dots are a 5,000-row sample. The line is fitted on every row." |
| 3:40 to 4:10 | **Univariate**: scroll to the OrderDate timeline and set it to Month. | "Orders ramp through the year with a September launch spike, 3,669 against 1,963 in August. Average price is flat, so growth is volume." |
| 4:10 to 4:40 | **Insights**, then **Decision Center**. | "Rule-based summaries. Every line traces to one number, so a stakeholder can audit it." |
| 4:40 to 5:00 | On any chart, open **Download** and choose **PNG**. Then click **Notebook (.ipynb)**. | "Charts export clean for a deck, and the notebook hands off to Python with the real column names. Happy to go into how the streaming engine works." |

**If something goes wrong:** the sample needs no file and no network after the page loads. If the live site is down, run `npm ci && npm start` and open http://localhost:3000.
