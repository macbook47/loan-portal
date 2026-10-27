# Loan Portal (test target for KRAKEN for QA)

A small two-tier demo app used as a chaos-testing target. Dummy data, no database.

- **api/** - Python (standard library only), port **9000**, health check **/health**.
  Simulates a slower enterprise service: `/health` returns 503 for `STARTUP_DELAY_SEC` (default 5) after start,
  and drains for 5 s on SIGTERM.
- **ui/** - React + nginx on port 8080. Loan simulator, application list, and a
  *Customer experience monitor* that sends traffic twice a second and shows availability and the longest outage.
  nginx proxies `/api` to the API Service.

| API endpoint | Purpose |
|---|---|
| `GET /api/info` | Which pod answered |
| `GET /api/products` | Loan products and rates |
| `POST /api/simulate` | Monthly installment (annuity) |
| `GET/POST /api/applications` | Submit / list applications (in memory, per pod) |

Chaos knobs on the API: `LATENCY_MS`, `ERROR_RATE` (0.0-1.0), `STARTUP_DELAY_SEC`.
UI settings: `API_UPSTREAM` (default `loan-api:9000`), `APP_TITLE`.

## Deploy on OpenShift

```bash
oc project <your-namespace>
oc new-app https://github.com/<you>/loan-portal --context-dir=api --strategy=docker --name=loan-api
oc new-app https://github.com/<you>/loan-portal --context-dir=ui  --strategy=docker --name=loan-ui
oc set probe deployment/loan-api --readiness --get-url=http://:9000/health
oc scale deployment/loan-api --replicas=3
oc create route edge --service=loan-ui
oc get route loan-ui
```

## Test it with KRAKEN for QA
Run `./krkn-qa.sh`, option 2: namespace = yours, deployment = `loan-api`, health path = `/health`, port 9000.
Start traffic in the Customer experience monitor, then run scenarios from option 4.
