#!/usr/bin/env python3
"""
Live rebalance-signal checker for the Leveraged Rotation Strategy.
Mirrors the dashboard engine (hedge score, VIX safety, oversold veto, and the
ADX/Efficiency-Ratio whipsaw->TLT filter) with a selectable 30% anchor fund.
Sends email + Telegram only when the target allocation changes. Stdlib only.

Secrets via env: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID,
                 SMTP_HOST(default smtp.gmail.com), SMTP_PORT(587), SMTP_USER, SMTP_PASS, ALERT_TO
Usage: python check_signal.py [--force] [--dry-run] [--data file.json]
"""
import os, sys, json, time, math, ssl, smtplib, urllib.request, urllib.parse
import datetime as dt
from email.mime.text import MIMEText

HERE = os.path.dirname(os.path.abspath(__file__))
CONFIG = os.path.join(HERE, "strategy_config.json")
STATE = os.path.join(HERE, "state.json")

def yahoo(ticker, ohlc=False):
    now = int(time.time())
    url = (f"https://query1.finance.yahoo.com/v8/finance/chart/{ticker}"
           f"?period1=0&period2={now}&interval=1d&events=div")
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=45) as r:
        d = json.load(r)
    res = d["chart"]["result"][0]; ts = res["timestamp"]; q = res["indicators"]["quote"][0]
    adj = res["indicators"].get("adjclose", [{}])[0].get("adjclose") or q["close"]
    def bd(a): return {dt.datetime.utcfromtimestamp(t).strftime("%Y-%m-%d"): a[i] for i, t in enumerate(ts)}
    out = {"adj": bd(adj)}
    if ohlc:
        out["high"] = bd(q["high"]); out["low"] = bd(q["low"]); out["close"] = bd(q["close"])
    return out

def indicators(prices, sma_w, rsi_w, vol_w):
    n = len(prices); sma=[None]*n; rsi=[None]*n; vol=[None]*n
    run=0.0
    for i in range(n):
        run += prices[i]
        if i>=sma_w: run-=prices[i-sma_w]
        if i>=sma_w-1: sma[i]=run/sma_w
    ag=al=0.0
    for i in range(1,n):
        ch=prices[i]-prices[i-1]; g=max(ch,0); l=max(-ch,0)
        if i<=rsi_w:
            ag+=g; al+=l
            if i==rsi_w: ag/=rsi_w; al/=rsi_w; rsi[i]=100 if al==0 else 100-100/(1+ag/al)
        else:
            ag=(ag*(rsi_w-1)+g)/rsi_w; al=(al*(rsi_w-1)+l)/rsi_w
            rsi[i]=100 if al==0 else 100-100/(1+ag/al)
    ret=[0.0]*n
    for i in range(1,n): ret[i]=prices[i]/prices[i-1]-1
    for i in range(vol_w,n):
        w=ret[i-vol_w+1:i+1]; mu=sum(w)/len(w)
        vol[i]=(sum((x-mu)**2 for x in w)/len(w))**0.5*math.sqrt(252)*100
    return sma,rsi,vol

def compute_adx(high,low,close,period):
    n=len(high); adx=[None]*n
    if n<2*period+1: return adx
    tr=[0.0]*n; pDM=[0.0]*n; mDM=[0.0]*n
    for i in range(1,n):
        up=high[i]-high[i-1]; dn=low[i-1]-low[i]
        pDM[i]=up if (up>dn and up>0) else 0.0
        mDM[i]=dn if (dn>up and dn>0) else 0.0
        tr[i]=max(high[i]-low[i],abs(high[i]-close[i-1]),abs(low[i]-close[i-1]))
    atr=sum(tr[1:period+1]); pd=sum(pDM[1:period+1]); md=sum(mDM[1:period+1])
    dx=[None]*n
    def setdx(i):
        pDI=0 if atr==0 else 100*pd/atr; mDI=0 if atr==0 else 100*md/atr; s=pDI+mDI
        dx[i]=0 if s==0 else 100*abs(pDI-mDI)/s
    setdx(period)
    for i in range(period+1,n):
        atr=atr-atr/period+tr[i]; pd=pd-pd/period+pDM[i]; md=md-md/period+mDM[i]; setdx(i)
    s=sum(dx[period:2*period]); adx[2*period-1]=s/period
    for i in range(2*period,n): adx[i]=(adx[i-1]*(period-1)+dx[i])/period
    return adx

def compute_er(prices,period):
    n=len(prices); er=[None]*n
    for i in range(period,n):
        change=abs(prices[i]-prices[i-period])
        v=sum(abs(prices[k]-prices[k-1]) for k in range(i-period+1,i+1))
        er[i]=0 if v==0 else change/v
    return er

def lookup_sqqq(h,table):
    t=sorted(table,key=lambda r:r["h"])
    if h<=t[0]["h"]: return t[0]["f"]
    if h>=t[-1]["h"]: return t[-1]["f"]
    for i in range(1,len(t)):
        if h<=t[i]["h"]:
            a,b=t[i-1],t[i]; return a["f"]+(b["f"]-a["f"])*(h-a["h"])/(b["h"]-a["h"])
    return t[-1]["f"]

def whipsaw(adx,er,p):
    if not p.get("whipsaw"): return False
    aL=adx is not None and adx<p["adxThresh"]; eL=er is not None and er<p["erThresh"]
    det=p.get("whipsawDetector","both")
    return aL if det=="adx" else eL if det=="er" else (aL or eL) if det=="either" else (aL and eL)

def state_label(h):
    return "Bull Run" if h<=0.001 else "Weakness" if h<0.35 else "Bear Entry" if h<0.55 else "Full Crash" if h<0.85 else "Panic"

def target(price,sma,rsi,vol,vix,adx,er,p):
    trend=p["wTrend"] if (sma is not None and price<sma) else 0
    volt=p["wVol"] if (vol is not None and vol>p["volThresh"]) else 0
    rt=0
    if rsi is not None:
        if rsi>p["rsiOverheat"]: rt=p["wRsiHot"]
        elif rsi<p["rsiOversold"]: rt=p["wRsiCold"]
    h=max(0.0,min(1.0,trend+volt+rt))
    vetoed=p.get("vetoRsiOversold") and rsi is not None and rsi<p["rsiOversold"]
    if vetoed: h=0.0
    eng=p["enginePct"]/100.0; sf=lookup_sqqq(h,p["lookup"])
    wT,wS,wJ,wTLT=eng*(1-sf),eng*sf,1-eng,0.0
    whip=whipsaw(adx,er,p); safety=False
    if whip: wTLT,wT,wS=eng,0.0,0.0
    else:
        safety=p.get("safetySwitch") and vix is not None and vix>p["vixThresh"]
        if safety: wTLT,wS=wS,0.0
    return dict(h=h,tqqq=wT,sqqq=wS,jepq=wJ,tlt=wTLT,rsi=rsi,vol=vol,vix=vix,adx=adx,er=er,
                price=price,sma=sma,vetoed=vetoed,safety=safety,whip=whip,state=state_label(h))

def pctw(w,alab):
    parts=[("TQQQ",w["tqqq"]),("SQQQ",w["sqqq"]),("TLT",w["tlt"]),(alab,w["jepq"])]
    return " | ".join(f"{n} {round(v*100)}%" for n,v in parts if v>0.001)

def send_telegram(text):
    tok=os.environ.get("TELEGRAM_BOT_TOKEN"); chat=os.environ.get("TELEGRAM_CHAT_ID")
    if not tok or not chat: print("[telegram] secrets not set — skipping"); return False
    url=f"https://api.telegram.org/bot{tok}/sendMessage"
    data=urllib.parse.urlencode({"chat_id":chat,"text":text}).encode()
    try:
        with urllib.request.urlopen(urllib.request.Request(url,data=data),timeout=30) as r:
            ok=json.load(r).get("ok",False)
        print("[telegram]","sent" if ok else "failed"); return ok
    except Exception as e: print("[telegram] error:",e); return False

def send_email(subject,body):
    host=os.environ.get("SMTP_HOST","smtp.gmail.com"); port=int(os.environ.get("SMTP_PORT","587"))
    user=os.environ.get("SMTP_USER"); pw=os.environ.get("SMTP_PASS"); to=os.environ.get("ALERT_TO")
    if not user or not pw or not to: print("[email] secrets not set — skipping"); return False
    msg=MIMEText(body); msg["Subject"]=subject; msg["From"]=user; msg["To"]=to
    try:
        with smtplib.SMTP(host,port,timeout=30) as s:
            s.starttls(context=ssl.create_default_context()); s.login(user,pw)
            s.sendmail(user,[a.strip() for a in to.split(",")],msg.as_string())
        print("[email] sent to",to); return True
    except Exception as e: print("[email] error:",e); return False

def main():
    args=sys.argv[1:]; force="--force" in args; dry="--dry-run" in args
    data_file=args[args.index("--data")+1] if "--data" in args else None
    p=json.load(open(CONFIG))
    alab=p.get("anchorKey","jepq").upper()
    if data_file:
        d=json.load(open(data_file)); dates=d["dates"]
        tq=d["tqqq"]; vx=d["vix"]; hi=d["tqqq_high"]; lo=d["tqqq_low"]; cl=d["tqqq_close"]
    else:
        T=yahoo("TQQQ",ohlc=True); V=yahoo("^VIX")
        dates=sorted(x for x in T["adj"] if x in V["adj"] and x in T["high"])
        tq=[T["adj"][x] for x in dates]; vx=[V["adj"][x] for x in dates]
        hi=[T["high"][x] for x in dates]; lo=[T["low"][x] for x in dates]; cl=[T["close"][x] for x in dates]
    sma,rsi,vol=indicators(tq,int(p["smaWindow"]),int(p["rsiWindow"]),int(p["volWindow"]))
    adx=compute_adx(hi,lo,cl,int(p.get("adxWindow",14)))
    er=compute_er(tq,int(p.get("erWindow",10)))
    i=len(dates)-1
    if "--at-index" in args: i=int(args[args.index("--at-index")+1])%len(dates)
    tw=target(tq[i],sma[i],rsi[i],vol[i],vx[i],adx[i],er[i],p); asof=dates[i]
    bd=(f"trend {'BELOW' if (tw['sma'] and tw['price']<tw['sma']) else 'above'} {int(p['smaWindow'])}d SMA"
        f" · vol {tw['vol']:.0f}% · RSI {tw['rsi']:.0f} · ADX {('%.0f'%tw['adx']) if tw['adx'] is not None else '?'}"
        f" · ER {('%.2f'%tw['er']) if tw['er'] is not None else '?'} · VIX {tw['vix']:.0f}"
        + (" · WHIPSAW→TLT" if tw['whip'] else "") + (" · VIX-safety→TLT" if tw['safety'] else "")
        + (" · OVERSOLD-VETO" if tw['vetoed'] else ""))
    tgt={k:round(tw[k],4) for k in ("tqqq","sqqq","jepq","tlt")}
    prev={}
    if os.path.exists(STATE):
        try: prev=json.load(open(STATE))
        except Exception: prev={}
    pw_=prev.get("target",{}); drift=sum(abs(tgt[k]-pw_.get(k,0)) for k in tgt); changed=drift>0.005
    head="Whipsaw → TLT" if tw['whip'] else tw['state']
    print(f"as of {asof}: {head} (score {tw['h']:.2f}) -> {pctw(tw,alab)}")
    print("  "+bd); print(f"  changed vs last: {changed} (drift {drift:.3f})")
    if changed or force:
        prev_str=pctw({**tw,**{k:pw_.get(k,0) for k in tgt}},alab) if pw_ else "n/a (first run)"
        subject=f"[Strategy] REBALANCE → {head} ({pctw(tw,alab)})"
        body=(f"LEVERAGED ROTATION — REBALANCE SIGNAL\nAs of {asof}\n\n"
              f"State : {head}  (hedge score {tw['h']:.2f} / 1.0)\n"
              f"Target: {pctw(tw,alab)}\nPrev  : {prev_str}\n\nSignals: {bd}\n\n"
              f"Anchor sleeve = {alab}. Signal as of Friday close → execute Monday open.\n"
              f"Educational tool, not investment advice.")
        if dry: print("\n--- DRY RUN, would send ---\n"+subject+"\n\n"+body)
        else: send_telegram(body); send_email(subject,body)
    else: print("  no change — no alert sent")
    if not dry and not data_file:
        json.dump({"asof":asof,"state":head,"score":round(tw["h"],4),"target":tgt,"breakdown":bd,
                   "updated":dt.datetime.utcnow().isoformat()+"Z"},open(STATE,"w"),indent=2)
        print("  state.json updated")

if __name__=="__main__": main()
