#!/usr/bin/env python3
"""Email the repo admin when CI fails. Reads SMTP secrets from env. Never raises."""
import os, smtplib, ssl
from email.mime.text import MIMEText
host = os.environ.get("SMTP_HOST", "smtp.gmail.com"); port = int(os.environ.get("SMTP_PORT", "587"))
user = os.environ.get("SMTP_USER"); pw = os.environ.get("SMTP_PASS")
to = os.environ.get("CI_ADMIN_EMAIL") or os.environ.get("ALERT_TO")
run = os.environ.get("RUN_URL", ""); commit = (os.environ.get("COMMIT", "") or "")[:8]; actor = os.environ.get("ACTOR", "")
try: out = open("ci-output.txt").read()[-6000:]
except Exception: out = "(no test output captured)"
body = (f"CI FAILED — the dashboard change was NOT deployed.\n\n"
        f"Commit: {commit}\nBy: {actor}\nRun log: {run}\n\n"
        f"--- test output (tail) ---\n{out}\n")
if not (user and pw and to):
    print("SMTP secrets / CI_ADMIN_EMAIL not set; cannot email. Failure summary:\n" + body); raise SystemExit(0)
try:
    msg = MIMEText(body); msg["Subject"] = f"[CI FAILED] TQQQSwingTrader dashboard tests — {commit}"
    msg["From"] = user; msg["To"] = to
    with smtplib.SMTP(host, port, timeout=30) as s:
        s.starttls(context=ssl.create_default_context()); s.login(user, pw)
        s.sendmail(user, [a.strip() for a in to.split(",")], msg.as_string())
    print("Failure email sent to", to)
except Exception as e:
    print("Could not send failure email:", e)
