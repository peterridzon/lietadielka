import json, os
import pathlib
S=str(pathlib.Path(__file__).parent / 'src')
OUT=str(pathlib.Path(__file__).parent / 'state-flights-preview.html')
head=open(f'{S}/head.html').read(); head2=open(f'{S}/head2.html').read()
body=open(f'{S}/body.html').read(); app=open(f'{S}/app.js').read()
data=json.load(open(f'{S}/export.json')); land=json.load(open(f'{S}/land-simple.json'))
borders=json.load(open(f'{S}/borders-simple.json'))

import base64
LICENSE_URLS={
 'CC BY-SA 4.0':'https://creativecommons.org/licenses/by-sa/4.0/',
 'CC BY-SA 2.0':'https://creativecommons.org/licenses/by-sa/2.0/',
 'CC BY 2.0':'https://creativecommons.org/licenses/by/2.0/',
 'CC BY 4.0':'https://creativecommons.org/licenses/by/4.0/',
}
credits=json.load(open(f'{S}/photos/credits.json'))
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
open(OUT,'w').write('\n'.join([head, head2, body,
  '<script type="application/json" id="flight-data">'+embed(data)+'</script>',
  '<script type="application/json" id="land-data">'+embed(land)+'</script>',
  '<script type="application/json" id="border-data">'+embed(borders)+'</script>',
  '<script type="application/json" id="photo-data">'+embed(photos)+'</script>',
  '<script>\n'+app+'\n</script>']))
print('size', round(os.path.getsize(OUT)/1024,1), 'KB')
