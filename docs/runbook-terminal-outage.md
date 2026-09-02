# Runbook: Terminal Backend Outage

- **Owner:** Cyber-Minds backend on-call
- **Alert threshold:** 2 consecutive probe failures (both returning `"status":"down"`)
- **Probe cadence:** Every 15 minutes via `health-probe.yml`
- **Health path:** `GET /health` → 200 (ok) or 503 (error)

Before enabling the workflow, set the repository variable to the public health URL:

```bash
gh variable set TERMINAL_HEALTH_URL \
  --body "https://cyberminds-terminal-20260621-ncus.northcentralus.cloudapp.azure.com/health"
```

---

## 1. Triage checklist

Run in order — stop when you find the layer that is broken.

| # | Check | Pass signal |
|---|-------|-------------|
| 1 | Probe artifact in Actions → latest `probe-result-*` | `status` is `ok` or `degraded` |
| 2 | Azure VM reachable | `ssh <vm-user>@<vm-host>` succeeds |
| 3 | Go backend process running | `systemctl is-active cyberminds-terminal` → `active` |
| 4 | Docker daemon running | `systemctl is-active docker` → `active` |
| 5 | Docker ping succeeds | `docker info` exits 0 |
| 6 | Terminal base image present | `docker image inspect terminal-base:latest` exits 0 |

- Failure at step 1 → connection or application layer; inspect the probe category.
- Failure at step 2 → VM is down or SSH key revoked.
- Failure at step 3 → service crashed; check logs before restarting.
- Failure at step 4–5 → Docker daemon issue.
- Failure at step 6 → image was removed; roll back (§3).

---

## 2. Safe service restart

Restart during a maintenance window after announcing a possible learner interruption. The health endpoint intentionally exposes no session count; the backend's graceful shutdown stops session containers.

```bash
# On the Azure VM:
sudo systemctl restart cyberminds-terminal

# Verify it came back:
sleep 5
curl -sf http://localhost:<PORT>/health | python3 -m json.tool
```

If `systemctl restart` fails, read logs before trying again:

```bash
sudo journalctl -u cyberminds-terminal -n 100 --no-pager
```

---

## 3. Rollback to the previous repository commit

The VM deploys the checked-out repository and builds the local `terminal-base:latest` image; it does not pull a versioned backend image from GHCR. On the dedicated deployment checkout:

1. Find the previous known-good commit:

   ```bash
   cd /opt/cyberminds
   git log --oneline --decorate -n 10
   ```

2. Check out the known-good commit and restart the stack:

   ```bash
   git fetch origin main
   git switch --detach <KNOWN_GOOD_COMMIT>
   sudo systemctl restart cyberminds-terminal
   ```

3. Confirm `/health` returns 200 before marking recovered.

Do **not** force-push or rewrite `main`; record the rollback commit for post-incident analysis.

---

## 4. Redeploy from main

Use only when a rollback is not viable. There is no GitHub Actions deploy workflow; redeploy from the dedicated VM checkout:

```bash
cd /opt/cyberminds
git fetch origin main
git switch main
git reset --hard origin/main
sudo systemctl restart cyberminds-terminal
```

Monitor the restart command and the next probe before declaring recovery.

---

## 5. Post-recovery verification

Recovery is confirmed only after **3 consecutive probe passes** (45 minutes at the 15-minute cadence).

Steps:
1. Watch the next 3 `Health Probe` workflow runs in Actions.
2. Confirm each `probe-result.json` artifact shows `"status":"ok"` or `"status":"degraded"` (not `"down"`).
3. Spot-check one CTF challenge end-to-end in the browser.
4. Update the incident thread with the recovery timestamp.

---

## 6. Human escalation trigger

Escalate to the next person on-call when **any** of the following is true:

- Outage exceeds **60 minutes** without a confirmed recovery path.
- Rollback (§3) fails and redeploy (§4) is also failing.
- SSH access to the Azure VM is unavailable.
- Probe shows `"category":"connection_error"` and the Azure portal reports the VM as stopped or deallocated.

Escalation contact: notify the backend owner at `hi@egeuysal.com` and record the incident for follow-up.

---

## 7. What not to do

- Do not share probe artifact URLs externally — they are CI-internal only.
- Do not restart the service during an unannounced learner session.
- Do not roll back by deleting or overwriting image tags — use a known-good commit (§3).
- Do not modify `TERMINAL_HEALTH_URL` in repo vars during an active incident without announcing it — it will break probe baselining.
