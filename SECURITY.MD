# 🔐 Security Best Practices for Solana Trading Bot

This document outlines the security practices for working with this repository, especially when handling sensitive information like wallet private keys and environment secrets.

---

## ✅ DO: Safe Key Management

- Store private keys in `backend/wallets/*.txt` and ensure this folder is listed in `.gitignore`
- Never paste keys or sensitive data in:
  - `README.md`, `UPDATES.MD`, or other markdown files
  - Any file tracked by Git unless explicitly ignored
- Use `.env` files for environment secrets (API keys, RPC URLs), and make sure `.env` is ignored
- Use file-based secrets instead of string-pasted secrets in the codebase

---

## ❌ DON’T: Leak Secrets

- Never commit raw secret keys, wallet private keys, or access tokens to Git
- Don’t paste keys into public repos or upload screenshots with sensitive data
- Don’t assume deleting a file removes it from Git history — it does not

---

## 🧼 Cleaning a Leaked Key (Emergency Protocol)

If a key was accidentally pushed:

1. **Revoke or move funds from the affected wallet immediately**
2. Use BFG to clean it:
   ```bash
   echo "leaked_key_here" > ~/bfg-cleanup.txt
   bfg --replace-text ~/bfg-cleanup.txt .
   git reflog expire --expire=now --all
   git gc --prune=now --aggressive
   git push --force
   ```
3. Rotate the key, re-deploy the bot, and check for damage

---

## 🛡️ Optional Tools

- Install GitHub secret scanning alerts (see below)
- Use `pre-commit` hooks with regex to block commits containing key-like strings
- Monitor wallet addresses using a block explorer or notification tool

---

## 🧠 GitHub Secret Scanning (Recommended)

If your repo is **public**, GitHub automatically scans for secrets.

To enable **alerts**:

1. Go to your repository on GitHub
2. Click **Settings** → **Code security and analysis**
3. Under **Secret scanning**, click **Enable alerts**
4. If using GitHub Advanced Security (for private repos), toggle both **Push protection** and **Alerts**

---

## 📁 Example .gitignore

```bash
# Secrets
.env
wallets/
*.txt
*.key
```

---

## 📬 Contact

If you suspect a leak or breach, revoke all secrets and notify the maintainer immediately.

Stay safe.
