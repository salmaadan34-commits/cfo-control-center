# Setting up the live feeds

The dashboard can refresh itself every day from three tools: **HubSpot** (deals and commission), **QuickBooks Online** (invoices) and **Ramp** (card spend). A GitHub Actions job, [`sync-live-data.yml`](.github/workflows/sync-live-data.yml), runs at 13:00 UTC each day, pulls from each tool, commits the results to `data/live/` and asks GitHub Pages to rebuild.

You don't need any of these tools already. Every step below uses a free test (sandbox) account with made-up data. **Never connect a real company's account**: this repository is public, so everything the job pulls is published.

Each feed is optional and works on its own. Until a feed is connected, its part of the dashboard shows sample data with a "Sample data" label.

| Feed | Cost | Realistic without an existing account? |
| --- | --- | --- |
| HubSpot | Free | Yes |
| QuickBooks Online | Free | Yes |
| Ramp | Free sandbox | Maybe not: see the Ramp section |

Plan on about 15 minutes for HubSpot and 20 for QuickBooks.

---

## 1. HubSpot: deals and commission

**Sign up**
1. Create a free HubSpot account at [hubspot.com](https://www.hubspot.com/) (the free CRM, no card needed).
2. Optional but tidy: make a developer test account inside it, under **Development > Testing > Test accounts**. Test accounts are free and include a 90-day trial of enterprise features. They expire after 90 days without API calls, which the daily job prevents.

**Add sample deals**
1. Open **CRM > Deals** and create 8 to 12 deals with made-up company names, amounts and close dates.
2. Spread them across the stages of the default pipeline: some early (Appointment scheduled, Qualified to buy), some later (Presentation scheduled, Decision maker bought in, Contract sent), some Closed won and one or two Closed lost.
3. To show commission for more than one rep, invite one or two made-up users under **Settings > Users & Teams** and assign deals to them. Rep names show on the public page, so use names you're happy to publish.

How the dashboard groups deals: **Open** is stages under 50% likely to close, **In progress** is stages 50% or more, then **Closed won** and **Closed lost**, read from the pipeline's stage settings.

**Create the key**
1. Go to **Settings > Integrations > Service Keys** and create a key. (HubSpot stopped letting new accounts create "private apps" in October 2026; service keys replace them. If your account still offers private apps, one works the same way.)
2. Give it read-only access to **Deals** and **Owners**: the scopes `crm.objects.deals.read` and `crm.objects.owners.read`. If HubSpot shows slightly different names, pick the read-only ones for deals and owners. Nothing needs write access.
3. Copy the key. It goes in the `HUBSPOT_TOKEN` secret (step 4).

**Commission rates** live in [`data/commission_rates.json`](data/commission_rates.json): a default rate plus a rate per rep, matched by the rep's name as it appears in HubSpot. Commission earned is the rate times closed-won amount for deals closed this calendar year. Commission at stake is the rate times in-progress amount. Match reps by name rather than email, because this file is public.

---

## 2. QuickBooks Online: invoices

**Sign up**
1. Create a free account at the [Intuit Developer portal](https://developer.intuit.com/). You don't need a QuickBooks subscription.
2. Intuit gives every developer account a **sandbox company** filled with sample customers and invoices. Find it under **Dashboard > Sandboxes** (or **Sandbox** in the menu). Note its **Company ID**: that's the Realm ID.

**Create an app**
1. On the dashboard, choose **Create an app**, pick **QuickBooks Online and Payments**, give it a name and select the **Accounting** scope (`com.intuit.quickbooks.accounting`).
2. Open the app's **Keys & credentials** page for **Development** (sandbox). Copy the **Client ID** and **Client Secret**.

**Get a refresh token** (no code needed)
1. Open Intuit's **OAuth 2.0 Playground** (from the developer portal menu, under Tools).
2. Choose your app, tick the **Accounting** scope, click **Get authorization code**, approve the sandbox company, then click **Get tokens**.
3. Copy the **Refresh token**. If the playground asks you to add its redirect URL to the app first, add it on the app's Keys & credentials page and try again.

**Why there's one more key.** Intuit can give out a new refresh token every time the job refreshes, and the old one then stops working after a while. The job saves the new one back to the `QBO_REFRESH_TOKEN` secret automatically, which needs a GitHub token allowed to write secrets:

1. On GitHub, go to your profile picture > **Settings > Developer settings > Personal access tokens > Fine-grained tokens > Generate new token**.
2. **Repository access:** Only select repositories > `cfo-control-center`.
3. **Permissions:** Repository permissions > **Secrets: Read and write**. Nothing else.
4. Pick an expiration (up to a year) and generate. It goes in the `SECRETS_ADMIN_TOKEN` secret.

If the QuickBooks feed ever shows "Last sync failed" with `invalid_grant`, the refresh token has lapsed: get a new one from the playground and update `QBO_REFRESH_TOKEN`.

The job only ever calls Intuit's sandbox address (`sandbox-quickbooks.api.intuit.com`), so a production company can't be pulled by mistake.

---

## 3. Ramp: card spend (optional)

Ramp's developer sandbox is requested through a form in Ramp's developer docs (**docs.ramp.com > Developer API > Sandbox access**). Ramp says the sandbox is ready in about a minute and sends an access email, but its getting-started guide assumes you're already a Ramp customer with admin access. Without a Ramp business account, the request may not go through. If it doesn't, skip this section: the card spend panel keeps its sample data and says so.

If you do get a sandbox:
1. Sign in to the sandbox at `demo.ramp.com`.
2. Go to **Company > Developer** and create an app. The sandbox needs its own app, separate from any real Ramp account.
3. Under grant types, add **Client Credentials**. Under allowed scopes, add `transactions:read`.
4. Copy the **Client ID** and **Client Secret**.

The job only ever calls Ramp's sandbox address (`demo-api.ramp.com`) and pulls the last 90 days of transactions.

---

## 4. Add the secrets to GitHub

In this repository on GitHub: **Settings > Secrets and variables > Actions > New repository secret**. Add one secret per row, only for the feeds you set up. Names must match exactly.

| Secret | Feed | Where it comes from |
| --- | --- | --- |
| `HUBSPOT_TOKEN` | HubSpot | Service key (step 1) |
| `QBO_CLIENT_ID` | QuickBooks | App Keys & credentials, Development |
| `QBO_CLIENT_SECRET` | QuickBooks | App Keys & credentials, Development |
| `QBO_REALM_ID` | QuickBooks | Sandbox company ID |
| `QBO_REFRESH_TOKEN` | QuickBooks | OAuth 2.0 Playground |
| `SECRETS_ADMIN_TOKEN` | QuickBooks | GitHub fine-grained token with Secrets: Read and write |
| `RAMP_CLIENT_ID` | Ramp | Sandbox app |
| `RAMP_CLIENT_SECRET` | Ramp | Sandbox app |

Secrets stay private: they can't be read back on GitHub, aren't copied into the repository, and GitHub hides them in job logs.

## 5. Run it the first time

1. Open the **Actions** tab, pick **Sync live data** on the left, and click **Run workflow**.
2. When it finishes (about a minute), the log lists each feed with a record count, or the reason it failed. A failed feed doesn't stop the others.
3. Open the [live demo](https://salmaadan34-commits.github.io/cfo-control-center/) a minute or two later. The header says when the feeds last synced, and each connected panel is labeled "Live".

After that it runs by itself every day.

## How it works

- [`scripts/sync.js`](scripts/sync.js) runs each feed in [`scripts/sources/`](scripts/sources/). A feed runs only when all its secrets are set.
- Raw API responses are turned into small, flat records by the normalizers in [`src/live.js`](src/live.js), the same file the page uses to summarize them. Tests in [`tests/live.test.js`](tests/live.test.js) feed them mock API responses.
- Output: `data/live/ramp.json`, `quickbooks.json`, `hubspot.json`, `status.json` (last run and the state of each feed) and `live.js` (all of it for the page).
- A feed that fails keeps its last good file, and the page marks it "Last sync failed". A feed whose secrets are removed goes back to sample data.
- Error messages are cut to a short code, and any secret value is scrubbed from them before they're logged or saved.
- To run it on your own computer instead, set the same names as environment variables and run `node scripts/sync.js` (Node 18 or later, no installs). Don't commit a `.env` file; `.gitignore` already blocks it.
