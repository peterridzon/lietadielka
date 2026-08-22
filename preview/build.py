import json, os
S='/private/tmp/claude-501/-Users-peterridzon----GitHub----Lietadielka/823435c7-1c28-4074-8b92-e04616876f5a/scratchpad'
OUT='/Users/peterridzon/-= GitHub =-/Lietadielka/preview/state-flights-preview.html'
head=open(f'{S}/build/head.html').read(); head2=open(f'{S}/build/head2.html').read()
body=open(f'{S}/build/body.html').read(); app=open(f'{S}/build/app.js').read()
data=json.load(open(f'{S}/export.json')); land=json.load(open(f'{S}/land-simple.json'))
borders=json.load(open(f'{S}/borders-simple.json'))
def embed(o): return json.dumps(o, separators=(',',':'), ensure_ascii=False).replace('</','<\\/')
open(OUT,'w').write('\n'.join([head, head2, body,
  '<script type="application/json" id="flight-data">'+embed(data)+'</script>',
  '<script type="application/json" id="land-data">'+embed(land)+'</script>',
  '<script type="application/json" id="border-data">'+embed(borders)+'</script>',
  '<script>\n'+app+'\n</script>']))
print('size', round(os.path.getsize(OUT)/1024,1), 'KB')
