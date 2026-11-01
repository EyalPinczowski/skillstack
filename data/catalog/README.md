# Skillstack – course catalog & RAG seed data

Seed data for the Skillstack plan builder (spec section 3.0): a verified course catalog, organized by **roles**, **skills** and **keywords**, plus everything needed to load it into Postgres and search it semantically.

Researched on 2026-10-29. Put this folder in the repo as `data/catalog/`.

## What's inside

| File | What it is |
|---|---|
| `catalog.json` | 122 learning items: 96 courses / certificate exams + 26 practice templates. Cost model, certificate type, recognition, hours, skills, roles, prerequisites, free alternatives, and verification flags. |
| `roles.json` | 19 target roles with aliases (job titles), summary, weighted skills (1–5), job-description keywords, and an auto-ranked suggested path (`core`, `optional`, `practice`, `free_only`). |
| `skills.json` | 41 skills in 13 categories, each with synonyms/keywords. This is the shared vocabulary for tagging courses, matching job descriptions and (later) reading a CV. |
| `questions.json` | The guided intake: 28 questions in 7 stages (goal, role discovery, background, skill check, time, budget, learning style), each with a "why we ask" hint, branching (`show_if`), and the field it fills (`maps_to`), plus 5 follow-up rules for conflicting answers. Discovery options map interests to roles. |
| `documents.jsonl` | 182 retrieval documents (one per item, role and skill), written as natural-language text ready to embed, with filterable metadata. |
| `schema.sql` | Postgres/Supabase schema: taxonomy, catalog, links, `rag_documents` with a pgvector column + HNSW index, keyword search (tsvector), and `match_catalog()` with budget / free-only / recognition filters. |
| `seed.sql` | Loads all of the above into the schema (idempotent – safe to re-run). |
| `catalog.csv` | The catalog as a spreadsheet, for quick review. |
| `build/` | Python source (`taxonomy.py`, `catalog.py`) and `build.py`, which validates references, runs the lint in `lint.py` and regenerates every file above. Edit the source, then run `python3 build.py` from `build/`. `test_lint.py` tests the lint (`python3 -m unittest test_lint` from `build/`). |

## Roles covered

**Operations & business:** Operations Associate / Analyst · Project Coordinator · Business Analyst · Supply Chain / Logistics Analyst · Finance Operations / Junior Financial Analyst · Revenue Operations / Sales Ops · People Operations / Recruiting Coordinator
**Product & data:** Product Operations / Junior PM · Junior Data / BI Analyst
**Technical:** Technical Operations / Support · QA Tester · Junior Cybersecurity / SOC Analyst · IT Support / Junior Sysadmin
**AI & automation:** AI Implementation / Deployment Specialist · No-code / AI Automation Specialist
**Customer-facing:** Customer Success · Sales Development (SDR/BDR) · Solutions Engineer / Pre-sales · Growth / Digital Marketing

Every role now has at least 6 core items, a free-only path and 4 practice templates. The smallest pools are SOC Analyst and Supply Chain Analyst – the next candidates to extend.

## How retrieval works (RAG)

1. **Embed** each line of `documents.jsonl` with a free, open embedding model run locally (e.g. `all-MiniLM-L6-v2` or `gte-small` via transformers.js – 384 dimensions, no paid API). Store it in `rag_documents.embedding`.
2. **Query:** embed the user's goal ("junior ops role, SQL and Jira, 4 weeks, free only"), then call
   `match_catalog(query_embedding, 20, max_price, free_only, min_recognition)`.
3. **Hybrid:** combine with keyword search on `catalog_items.search_tsv` and exact skill matching via `item_skills`, then rank.
4. **Generate:** pass only the retrieved items to the free LLM, which orders them into a plan and explains each choice. The backend then recalculates hours and cost from the database – never from the model's answer.
5. **Fallback without AI:** use `roles.suggested_path` plus skill matching – the plan builder works even with no model available.

## Data quality – read before using

- `url_verified` / `price_verified` = `true` means the URL or price was confirmed in a source found during research. After the 2026-11-01 link check, **80 of 96** item URLs and **62 of 96** prices are verified; the rest follow the provider's known URL pattern but must be checked. A price is only marked verified when it is stated on the official page; a price that could not be confirmed keeps its earlier value with `price_verified: false` (notes say "Price unverified" where needed). `price: null` is used only where the price varies by country or is not known (9 of 96); price-cap filters exclude those items. The app should show unverified items with a "needs check" badge until the weekly link checker confirms them.
- Prices change often (exams, subscriptions, Udemy sales). `price: null` means it varies by country – show "check price".
- `ai-900` is **superseded** by `ai-901`. The official certification page (checked 2026-11-01) lists AI-901 as the required exam and does not name AI-900, so the replacement is inferred. `ai-900` stays in the catalog but no role points to it; `ai-901` has `price: null` (varies by country) and its hours and recognition are Skillstack estimates carried over from `ai-900`.
- `scrum-open` and `power-bi-learn-path` are prerequisites whose pages could not be reached on 2026-11-01. They are kept, stay `url_verified: false` and say `UNVERIFIED` in their notes; any plan that includes them must show "needs check". Replacement items are not part of this data yet.
- **Subscriptions** (`cost_type: subscription`, e.g. Coursera Plus at $59/month) are stored as a monthly price. The plan builder must compute the real cost from how many months the plan uses them; `match_catalog`'s `max_price` filter compares the monthly price only.
- The `suggested_path` per role is generated by a simple score (skill weight + role tag + recognition). Each of the 6 best-scoring items brings its transitive **required** prerequisites into `core` as a bundle, prerequisites first, so `core` can hold more than 6 ids. It's a sensible starting point, not a curated career plan – review it per role.
- Hour estimates are approximate and should be recalibrated from users' actual hours (spec 3.4).

## Structure fields and lint

Added to every item (all additive; defaults mean "not set"):

| Field | Meaning |
|---|---|
| `prerequisite_kinds` | One entry per id in `prerequisites`: `required` (a plan must include it first) or `recommended` (order it first if both are in the plan, never add it on its own). All current prerequisites are `required`. In Postgres: `item_links.prerequisite_kind`. |
| `last_verified_at` | `YYYY-MM-DD` of the link check that confirmed `url_verified`, or `null`. Set to `2026-11-01` for the 41 items confirmed in that check; `null` for items verified only in the earlier research pass and for unverified items. In Postgres: `catalog_items.last_verified_at date`. |
| `subscription_group` | Items that share one subscription (currently `coursera-plus`, 12 items). A plan pays for each month of a group once, not once per item. Members must agree on period and price. In Postgres: `catalog_items.subscription_group`. |
| `skill_depth` | Optional map of skill id to `beginner`, `intermediate` or `advanced`: how far the item takes that skill. Empty for every item; only the field and its validation exist. In Postgres: `item_skills.depth`. |

Learn-before-practice ordering for the same skill is a planner rule; this data only provides the prerequisite edges.

`build.py` fails (exit 1, nothing written) when:

- a prerequisite id does not exist, or an item lists itself;
- the prerequisites contain a cycle (the exact cycle is printed, e.g. `a -> b -> c -> a`; required and recommended edges both count);
- a role's `suggested_path.core` holds an item whose required prerequisite is missing from `core` or comes after the item;
- an item has `url_verified: true` but no `https://` url;
- `prerequisite_kinds`, `last_verified_at`, `subscription_group` or `skill_depth` are malformed.

## Main sources

- Google Career Certificates – grow.google/intl/europe/google-career-certificates
- Kaggle Learn micro-courses – kdnuggets.com/7-free-kaggle-micro-courses-for-data-science-beginners
- PSM I exam details – open-exam-prep.com/blog/psm-i-professional-scrum-master-exam-guide-2026
- HackerRank skills certifications – hackerrank-community-knowledge-base.help.usepylon.com/articles/2563639100
- Anthropic Academy – dev.to/amareswer/anthropic-academy-free-claude-courses-and-certificates-22ki
- AWS AI Practitioner – aguidetocloud.com/cert-compass/aws-ai-practitioner
- PL-300 – open-exam-prep.com/blog/pl-300-power-bi-data-analyst-exam-guide-2026
- CAPM costs – rosemet.com/capm-certification-cost-breakdown
- Lean Six Sigma White/Yellow Belt – goleansixsigma.com/white-belt
- Free PM courses (Pendo, ProductLed, Google) – productcompass.pm/p/free-product-management-courses
- HubSpot Academy certifications – coursera.org/articles/hubspot-certification
- Customer success certifications – supademo.com/blog/customer-success-certifications
- Salesforce Administrator – open-exam-prep.com/blog/salesforce-administrator-exam-guide-2026
- Tableau Desktop Foundations – ascendientlearning.com
- Google Ads Search – certpath.pages.dev/certifications/google-ads-search
- Google Cloud Digital Leader – telecomtrainer.com/google-cloud-cloud-digital-leader
- Jira Fundamentals – community.atlassian.com (Jira Fundamentals learning path announcement)
- ISTQB CTFL price – astqb.org/istqb-faqs/what-is-the-price-of-an-istqb-exam
- ISC2 CC program conclusion – isc2.org/insights/2026/04/one-million-certified-cyber-conclusion
- CompTIA Security+ price – hackerdna.com/blog/security-plus-certification-cost
- GitHub Foundations – dev.to/hosana/github-foundations-certification-is-free-1mlk
- IIBA ECBA cost – adaptiveus.com/blog/ecba-certification-cost-in-2026
- HRCI aPHR – examcert.app/blog/aphr-requirements-2026
- Free automation courses (Make, n8n, Zapier, Power Automate, DeepLearning.AI) – analyticsvidhya.com/blog/2026/08/free-ai-automation-courses-with-certificates
- Linux Foundation free courses – careers360.com
- Cisco Introduction to Cybersecurity badge – credly.com/org/cisco/badge/introduction-to-cybersecurity
- Google Technical Writing – developers.google.com/tech-writing
- CFI 14-Day Fundamentals Challenge – corporatefinanceinstitute.com
- Sales certifications for SDRs – hyperbound.ai/blog/sales-certifications
- Recruiting certifications – recruiterflow.com/blog/recruiting-certifications
- Wharton Introduction to Financial Accounting – riseupp.com
- SHRM-CP cost and eligibility – aihr.com/blog/shrm-certification-cost
- University of Minnesota HR Management specialization – coursera.org/specializations/human-resource-management
- CFI FMVA price (Oct 2026) – onlinecourseing.com/cfi-fmva-certification-cost
- QuickBooks ProAdvisor and Xero Advisor – capterra.com (2017 article – verify)
- Apollo Academy courses – apollo.io/academy/guides
