import json, os
import pathlib
S=str(pathlib.Path(__file__).parent / 'src')
OUT=str(pathlib.Path(__file__).parent / 'state-flights-preview.html')
def read(name): return open(f'{S}/{name}', encoding='utf-8').read()
def load(name): return json.load(open(f'{S}/{name}', encoding='utf-8'))
head=read('head.html'); head2=read('head2.html')
body=read('body.html'); app=read('app.js')
data=load('export.json'); land=load('land-simple.json')
borders=load('borders-simple.json')

import base64
LICENSE_URLS={
 'CC BY-SA 4.0':'https://creativecommons.org/licenses/by-sa/4.0/',
 'CC BY-SA 2.0':'https://creativecommons.org/licenses/by-sa/2.0/',
 'CC BY 2.0':'https://creativecommons.org/licenses/by/2.0/',
 'CC BY 4.0':'https://creativecommons.org/licenses/by/4.0/',
}
credits=json.load(open(f'{S}/photos/credits.json', encoding='utf-8'))
photos={}
for reg,c in credits.items():
    raw=open(f'{S}/photos/{reg}-final.jpg','rb').read()
    photos[reg]={
      'src':'data:image/jpeg;base64,'+base64.b64encode(raw).decode(),
      'author':c['author'], 'license':c['license'],
      'licenseUrl':LICENSE_URLS.get(c['license'],'https://commons.wikimedia.org/'),
      'page':c['page'], 'date':c['date'],
      'imageType':c.get('imageType','AIRFRAME'),
      'subjectRegistration':c.get('subjectRegistration'),
      'photoLabel':c.get('photoLabel'),
    }
def embed(o): return json.dumps(o, separators=(',',':'), ensure_ascii=False).replace('</','<\\/')
# A bare fragment is not a document. Served without an encoding declaration, a browser
# falls back to its locale default and reads the UTF-8 bytes as Latin-1 — every diacritic
# in the page turns to mojibake. The charset meta must come first, inside the first 1024
# bytes, before any text the parser could mis-decode.
HEAD_OPEN='<!doctype html>\n<html lang="sk">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">'
open(OUT,'w',encoding='utf-8').write('\n'.join([HEAD_OPEN, head, head2, '</head>\n<body>', body,
  '<script type="application/json" id="flight-data">'+embed(data)+'</script>',
  '<script type="application/json" id="land-data">'+embed(land)+'</script>',
  '<script type="application/json" id="border-data">'+embed(borders)+'</script>',
  '<script type="application/json" id="photo-data">'+embed(photos)+'</script>',
  '<script>\n'+app+'\n</script>', '</body>\n</html>']))
print('size', round(os.path.getsize(OUT)/1024,1), 'KB')
