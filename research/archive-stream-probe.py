"""
Proof that the adsb.lol daily release archive can be mined for a handful of aircraft
without downloading it to disk. Kept as evidence for RESEARCH_TURNSTONE.md, not as
production code — the real provider belongs in src/adsb/providers/.

Measured 2026-08-23 on v2026.08.15: 3.75 GB streamed, 75 987 tar entries, 173 seconds,
and the extracted trace was byte-for-byte identical to the one collected from the live
endpoint.

    python3 research/archive-stream-probe.py
"""

import subprocess, sys, time, os
TAG='v2026.08.15-planes-readsb-prod-0'
BASE=f'https://github.com/adsblol/globe_history_2026/releases/download/{TAG}/{TAG}.tar.'
WANT={f'./traces/{h[-2:]}/trace_full_{h}.json' for h in
      ['505c06','505c07','505c08','505c09','505fa0','505fa1']}
OUT='/private/tmp/claude-501/-Users-peterridzon----GitHub----Lietadielka/823435c7-1c28-4074-8b92-e04616876f5a/scratchpad/extracted'
os.makedirs(OUT, exist_ok=True)

# curl the parts in order into one stream; tar does not care about the split.
cmd = 'set -o pipefail; ' + ' ; '.join(
    f'curl -sL --retry 2 "{BASE}{s}"' for s in ['aa','ab'])
proc = subprocess.Popen(['bash','-c',cmd], stdout=subprocess.PIPE, bufsize=1024*1024)

def readexact(n):
    buf=b''
    while len(buf)<n:
        chunk=proc.stdout.read(n-len(buf))
        if not chunk: break
        buf+=chunk
    return buf

start=time.time(); scanned=0; entries=0; found={}
while True:
    hdr=readexact(512)
    if len(hdr)<512 or hdr[:1]==b'\0': break
    scanned+=512; entries+=1
    name=hdr[0:100].rstrip(b'\0').decode('utf8','replace')
    try: size=int(hdr[124:136].rstrip(b'\0 ').decode() or '0',8)
    except Exception: size=0
    padded=((size+511)//512)*512
    if name in WANT:
        data=readexact(size); readexact(padded-size)
        hexid=name.split('_')[-1].replace('.json','')
        open(f'{OUT}/{hexid}.json.gz','wb').write(data)
        found[hexid]=len(data)
        print(f'  ✓ {name}  {len(data)} B  po {time.time()-start:.0f}s', flush=True)
        if len(found)==len(WANT): break
    else:
        readexact(padded)
    scanned+=padded
    if entries % 40000 == 0:
        print(f'    … {entries} položiek, {scanned/1e9:.2f} GB, {time.time()-start:.0f}s', flush=True)

proc.kill()
el=time.time()-start
print(f'\nhotovo za {el:.0f}s, prejdených {scanned/1e9:.2f} GB, {entries} položiek')
print('nájdené:', found)
