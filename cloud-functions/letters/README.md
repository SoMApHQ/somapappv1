# SoMAp Letters — Cloud Functions

Three HTTPS functions (Firebase 2nd gen) used by `letters.html`:

| Function | What it does | Who may call |
|---|---|---|
| `lettersAi` | ✨ Polish, 🌍 English ⇄ Kiswahili, 📝 Suggest subject, 📋 Notes → Minutes (Claude API, JSON output) | any signed-in SoMAp session (rate-limited 30 / 10 min) |
| `lettersOtpRequest` | emails a 6-digit code to the director's private address | Google accounts listed in `DIRECTOR_EMAILS` only |
| `lettersOtpVerify` | checks the code (5 tries, then 15-minute lock) and releases the vault share | same |

The studio works without these functions: Polish falls back to the offline tidy, and the vault
opens with the password alone. Deploying them adds the real AI assistant and the email code.

## Security model (read this once)

* Company letters, confidential letters (Director Apology, Loan Request, Investor, Minutes of
  Directors, Board Resolution, anything marked confidential) and the director's signature are
  encrypted **in the director's browser** with AES-256-GCM before they are saved. The database
  only ever holds ciphertext. The Head Teacher (and anyone with database access) sees
  "🔒 Confidential".
* The data key is wrapped by the director's **vault password**. With email OTP switched on,
  it is wrapped by password + a per-school share that `lettersOtpVerify` returns only after a
  correct code — so the password alone, or the code alone, opens nothing.
* The vault stays open for 30 minutes per tab, and locks on "Lock now", reload or closing the tab.
* The recovery key shown when the vault is created is the only way back if the password is lost.
* Letter text sent to Polish/Translate lives only in that request; nothing is stored.

## Setup (once)

Requires the Blaze plan on project `somaptestt`.

```bash
# from an empty folder that will hold the functions project
firebase init functions          # choose JavaScript, project somaptestt
cp <repo>/cloud-functions/letters/index.js     functions/index.js
cp <repo>/cloud-functions/letters/package.json functions/package.json
cd functions && npm install && cd ..

# secrets (never committed, never sent to a browser)
firebase functions:secrets:set ANTHROPIC_API_KEY      # from console.anthropic.com
firebase functions:secrets:set LETTERS_VAULT_SECRET   # any long random string, e.g. `openssl rand -base64 48`; never change it once OTP is on
firebase functions:secrets:set SMTP_PASS              # Gmail "app password" of the sending account
```

Parameters are asked for on the first deploy (or put them in `functions/.env.somaptestt`):

```
SMTP_USER=socratesschool2020@gmail.com        # account that sends the code
SMTP_HOST=smtp.gmail.com
LETTERS_OTP_EMAIL=mnyorej@gmail.com           # where codes are delivered (the director's private email)
DIRECTOR_EMAILS=socratesschool2020@gmail.com  # Google logins allowed to request a code (comma-separated, add other schools' directors)
LETTERS_AI_MODEL=claude-sonnet-5-5
```

```bash
firebase deploy --only functions:lettersAi,functions:lettersOtpRequest,functions:lettersOtpVerify
```

The `lettersAi` call enables Anthropic's server-side refusal fallback
(`fallbacks: "default"`), so if the model declines a request it is retried on another model
automatically.

## After deploying

1. Open **Letters → Settings → AI service**. The URL defaults to
   `https://us-central1-somaptestt.cloudfunctions.net`; press **Test connection**.
2. **Settings → Security → Switch email OTP on**: type the vault password, press *Send code*,
   type the code from the email, confirm. From then on unlocking needs both.
3. Merge `rtdb/letters.rules.json` into the live Realtime Database rules.

To change `LETTERS_OTP_EMAIL` later, set the parameter and redeploy — it cannot be changed
from a browser.
