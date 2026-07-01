# Auto-Deploy with GitHub Actions — Step by Step

Goal: every push to `main` automatically deploys to the VPS (pull → install →
build → reload), with no manual terminal steps. One-time setup below.

How it works: the workflow `.github/workflows/deploy.yml` SSHes into your VPS as
the `dsr` user and runs the deploy commands. It authenticates with a dedicated
**deploy SSH key** stored as a GitHub **secret**.

---

## 1. Create a dedicated deploy SSH key (on your laptop)

Use a separate key just for deploys (don't reuse your personal key):

```bash
ssh-keygen -t ed25519 -C "github-actions-deploy" -f ~/.ssh/dsr_deploy -N ""
```

This makes two files:
- `~/.ssh/dsr_deploy`      → **private** key (goes into GitHub secrets)
- `~/.ssh/dsr_deploy.pub`  → **public** key (goes onto the VPS)

## 2. Authorize the key on the VPS (for the `dsr` user)

Copy the **public** key into the `dsr` user's authorized_keys. As root (or via
your existing SSH session), run:

```bash
sudo -u dsr mkdir -p /home/dsr/.ssh
# paste the contents of ~/.ssh/dsr_deploy.pub as a new line:
echo "ssh-ed25519 AAAA...the-public-key... github-actions-deploy" | sudo tee -a /home/dsr/.ssh/authorized_keys
sudo chown -R dsr:dsr /home/dsr/.ssh
sudo chmod 700 /home/dsr/.ssh
sudo chmod 600 /home/dsr/.ssh/authorized_keys
```

(Print the public key locally with `cat ~/.ssh/dsr_deploy.pub`.)

Quick test from your laptop — it should log in without a password:
```bash
ssh -i ~/.ssh/dsr_deploy dsr@<VPS_IP> "echo ok && whoami"
```

## 3. Add the GitHub repository secrets

GitHub → your repo → **Settings → Secrets and variables → Actions → New
repository secret**. Add three:

| Secret name   | Value |
|---------------|-------|
| `VPS_HOST`    | your VPS public IP (or `dsrappai.com`) |
| `VPS_USER`    | `dsr` |
| `VPS_SSH_KEY` | the **entire** contents of the **private** key file `~/.ssh/dsr_deploy` (include the `-----BEGIN/END OPENSSH PRIVATE KEY-----` lines) |

To copy the private key contents: `cat ~/.ssh/dsr_deploy`.

## 4. Commit the workflow

The workflow file is already in the repo at `.github/workflows/deploy.yml`.
Just push it:

```bash
cd D:\Project\DSR
git add .github/workflows/deploy.yml deploy.sh docs/CICD_GitHub_Actions_Setup.md
git commit -m "ci: GitHub Actions auto-deploy to VPS"
git push origin main
```

## 5. Verify it runs

- GitHub → **Actions** tab → you'll see the "Deploy to VPS" run start on that push.
- Click it to watch the log; it should end with `[deploy] done at …`.
- You can also trigger it manually any time: **Actions → Deploy to VPS → Run
  workflow**.

From now on: **push to `main` → it deploys itself.** Nothing else to do.

## 6. Database migrations (deliberately manual)

The auto-deploy does **not** run migrations — schema changes should be applied
deliberately, not on every push. When a release includes a new migration, after
the deploy run finishes, apply it once on the VPS:

```bash
ssh dsr@<VPS_IP>
cd /home/dsr/dsr/apps/api
npm run migrate -- <name>      # e.g. letter_counter, order_claim
```

Or use the bundled script for a code+migrate deploy in one go:
```bash
cd /home/dsr/dsr && ./deploy.sh --migrate
```

(`./deploy.sh` with no flag = code-only, same as the workflow.)

## 7. Notes & safety

- **Build runs on the VPS** (1 vCPU). If `npm run build` ever OOMs, add a swap
  file (Deployment guide §16).
- **`concurrency`** in the workflow prevents two deploys overlapping.
- The deploy key only grants SSH to the `dsr` user — rotate it any time by
  regenerating (step 1–3). To revoke, remove its line from
  `/home/dsr/.ssh/authorized_keys` and delete the GitHub secret.
- `.env` is never touched by deploys; it lives only on the VPS (`chmod 600`).
- If a deploy fails, the previous PM2 process keeps serving (graceful reload),
  so the site stays up while you investigate in the Actions log.

## 8. Rollback

```bash
ssh dsr@<VPS_IP>
cd /home/dsr/dsr
git reset --hard <last-good-sha>
cd apps/web && npm run build && pm2 reload dsr-api
```
(Or revert the bad commit on `main` and let the workflow redeploy.)
