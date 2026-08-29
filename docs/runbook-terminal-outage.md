# Runbook: Terminal Backend Outage

**Owner:** Cyber-Minds org — backend on-call  
**Alert threshold:** 2 consecutive probe failures (both returning `"status":"down"`)  
**Probe cadence:** Every 15 minutes via `health-probe.yml`  
**Health path:** `GET /health` → 200 (ok) or 503 (error)

---

## 1. Triage checklist

Run in order — stop when you find the layer that is broken.

| # | Check | Pass signal |
|---|-------|-------------|
| 1 | Probe artifact in Actions → latest `probe-result-*` | `category` is not `connection_error` |
| 2 | Azure VM reachable | `ssh <vm-user>@<vm-host>` succeeds |
| 3 | Go backend process running | `systemctl is-active cyberminds-terminal` → `active` |
| 4 | Docker daemon running | `systemctl is-active docker` → `active` |
| 5 | Docker ping succeeds | `docker info` exits 0 |
| 6 | Container image present | `docker images | grep terminal-backend` has a row |

Failure at step 1 → connection layer (DNS, firewall, Azure NSG rule).  
Failure at step 2 → VM is down or SSH key revoked.  
Failure at step 3 → service crashed; check logs before restarting.  
Failure at step 4–5 → Docker daemon issue.  
Failure at step 6 → image was removed; roll back (§3).

---

## 2. Safe service restart

Restart only after confirming no active learner sessions (check `active_sessions` from the last successful `/health` response).

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

## 3. Rollback to the previous image tag

The deployment uses a tagged Docker image. To roll back:

1. Find the previous known-good tag in the deployment history or CI artifacts.
2. Pull and retag:

   ```bash
   docker pull ghcr.io/cyber-minds/terminal-backend:<PREV_TAG>
   docker tag ghcr.io/cyber-minds/terminal-backend:<PREV_TAG> \
       ghcr.io/cyber-minds/terminal-backend:current
   ```

3. Restart the service (§2).
4. Confirm `/health` returns 200 before marking recovered.

Do **not** force-push or delete the broken tag — leave it for post-incident analysis.

---

## 4. Redeploy from main

Use only when a rollback is not viable (e.g., the previous image is also broken).

```bash
# Trigger the deploy workflow from the Actions UI:
# Actions → Deploy Terminal Backend → Run workflow → branch: main

# Or via CLI:
gh workflow run deploy-terminal.yml --ref main
```

Monitor the deploy run until it completes before declaring recovery.

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

Escalation contact: open an incident in the Cyber-Minds internal tracker and tag the infrastructure owner.

---

## 7. What not to do

- Do not share probe artifact URLs externally — they are CI-internal only.
- Do not restart the service with active sessions without checking `active_sessions` first.
- Do not roll back by deleting or overwriting image tags — use retag (§3).
- Do not modify `TERMINAL_HEALTH_URL` in repo vars during an active incident without announcing it — it will break probe baselining.
