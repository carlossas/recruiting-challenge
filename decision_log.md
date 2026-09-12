# Decision Log — Carlos Adrian Garcia Reyes

## Authorship declaration

I created this decision_log markdown fully, I just use AI for validate spelling. 

---

## Issues addressed

> Defects, security smells, architectural problems, missing pieces, scaling risks — anything you decided was worth your time. For each, fill in **every** sub-field. An empty field is a worse signal than an awkward answer.

- **Issue 1 — Npm dependencies vulnerabilities**
  - What was wrong or weak: After my first install with "npm i", the audit recognize 4 vulnerabilities
  - Shape of my improvement: I did a "Npm audit fix" first of all to check if any automatic fix for that dependencies, that's resolve 1 of 4, after that I did a reasearch with claude to review if there are any major version with the fix and check benefit-cost to upgrade, the result was that already exist versions with the fix without any breaking or code change, I just did the update and create a script that validate critial vulnerabilities that I already add to my pipelines on github to run on every PR request to avoid introduce new critical vulnerabilities. 
  - **Confidence (1–10):** 10
  - **What would falsify this fix** Maybe some devs could be disagree to introduce a override for a moderate vulnerability, but I think this doesn't have any risk to do in this point of the app. 
  - **I disagreed with Claude on:** Claude propuse just fix the vulnerabilities without evaluate the scope of the changes, I asked first for a investigation to do a human-judge of this, also Claude doesn't propuse any solution to avoid this on future, I propuse create a script to run in our pipelines and avoid new vulnerabilities, but being flexible just validating "Criticals and Highs", also I created the pipelines for github actions protecting main and develop force commits. 

- **Issue 2 — Missing Auth and Tenancy Layer (Wrong data scoping/filters)**
  - What was wrong or weak: All request was just validating a header present on the request but this is a critial vulnerability because allow to any user hardcode this value and access to PII data or even modify with update/create requests also some filters was not filtering by merchant so data was crossed or wrong.
  - Shape of my improvement: I created 2 auth layers for this app, the first one allows create a jwt token with full access (the challenge request access for both merchants), but this jwt just allow create merchant tokens with an auth endpoint (new one), this means that in the future we could restrict the access just to 1 merchant because the layer is separate, also I created a base repository class that is implemented on all repositories/entities from the app, this create a protection to force any repository implement a merchandId in the query/update/insert/delete to prevent new bugs for missing merchantId query declarations.
  - **Confidence (1–10):** 9
  - **What would falsify this fix:** I think this is a quickly implementation to fix some gaps and works fine for our estimated time and bugs, but for a real production resolution jwt created on the same server are not usually used on production envs, we should use something more robust like auth0 or maybe auth microservicio full dedicated to this work. 
  - **I disagreed with Claude on:** Claude was thinking just in a simple jwt, but doesn't think how raise or insert this jwt, also I had force httpOnly cookie becase by default claude was implementing just localstorage, also I specific request for guards and base class repository because is something that usally agents doesn't think, they just repeat code but not prevent future cases.

- **Issue 3 — <short title>**
  - What was wrong or weak:
  - Shape of my improvement:
  - **Confidence (1–10):**
  - **What would falsify this fix:**
  - **I disagreed with Claude on:**
  - Alternatives I considered and rejected:

## Feature chosen

- **Feature:**
- **Why this one and not the others:**
- **What I cut to ship it in budget:**
- **Confidence (1–10) that the shape I picked is the right one:**
- **What would change my mind:**

## Things I noticed but did NOT fix

> Class-of-bug instances you saw and chose not to touch. For each, name the *reason* you cut it (scope / time / dependency / "needs a larger conversation").

-

## Docs / code I left alone deliberately

-

## What I'd do with another 6 hours

-

## Where I felt uncertain

> At least three places in this submission where you were not confident. Genuine uncertainty is a strength signal. "Nothing — I was confident everywhere" is itself a red flag and will be probed.

-
-
-
