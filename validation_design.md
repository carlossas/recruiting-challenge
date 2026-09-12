# Validation design — Carlos Adrian Garcia Reyes


## Authorship declaration

I created this validation_design markdown fully, I just use AI for validate spelling.

---

### Class 1 — Dependencies vulnerabilities and Missing git workflow

- Instance I fixed: Upgrade and fix security issues using npm audit fix and overrides over the dependencies with issues. 
- The gate I build: New script that ran over a github action pipeline than detect new high or critical vulnerabilities, this ran after create any PR request so nobody can create vulnerabilities to our develop or main branches, also I protected develop and main branchs to avoid any push forced by developers. 
- Where to see the gate in the diff: Hash commit 4a0f7cf819401b005d7d7b272854cdd6bd2b232b
- Yes I created, I think this is one of the most important things to set before start any new code because prevent lot of issues. 

### Class 2 — Auth and Multitenancy Layers

- Instance I fixed: Create basic auth layer and guards for all request, we don't want have open request, we want avoid basic attacks, also I implemented a basic repository class that force to all repositories to implement merchantId filter, this prevent new data cross issues.
- The gate I build: architecture.test.ts implement a full search of any component in the app trying to import bd module without base repisitory class (that force to use merchantId query as part of where clausure), also I implement guards to ask for basic auth token. We would create something more robust implementing entity/data scope strategies like scope claims, auth0 users, cloud jwt sign in and auth ms/library layer dedicated. Also some linter or script that review all functions that try to access to our db are impelenting repository pattern extending from our base repository class. 
- Where to see the gate in the diff: Hash commit 763b674e0c939c4b4707930c492272b1a4008a6e
- Yes I created, I skip some robust solutions because time but I implement the minimum, an application that doesn't have any auth or validation of data scope layers are just spikes or mvps, we need a real prod app even if we just have 1 or 2 request but with the necessary layers to cover a first world class app. 

### Class 3 — Orders Calculations

- Instance I fixed: I fixed creating new const of all types of average or amounts that we could return to the frontend with clearly names, sql query was updated using this types as part of the select clausure.
- The gate I build: architecture.test.ts is the most valuable file of this changes because validate any total_amount out of DAL, so any developer that is trying to set some amount value should pass this test firts, also we implement clearly names in the amounts that we return, this allow to new developer can understand in a easy way what the means the variable returned, also we document the api to clarify what we are returning and frontend now print full info, not just avg (that is ambigous), also unit tests now cover the case of have differents order types and validate each average depending of type.
- Where to see the gate in the diff: Hash commit b211df660b95ad0ac4e0bb437657a3a43175e1a3
- Yes I created, for me is tier 1 issue because involve main product issue in the dashboards, we can not print bad number to our users or we could lost them. This is p1 for the challenge. 
---